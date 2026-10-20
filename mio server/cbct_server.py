"""Server CBCT locale (porta 8002).

Carica una CBCT in formato DICOM da una cartella o da un file ZIP e la
converte in un volume NIfTI che il frontend visualizza con NiiVue.

E' separato da server.py: se qualcosa non funziona qui, il server mesh
principale non viene toccato. Non scrive mai nella cartella di origine:
tutti i file temporanei finiscono in %TEMP%\\lola_cbct.
"""
from contextlib import asynccontextmanager
from pathlib import Path
import json
import os
import shutil
import tempfile
import threading
import traceback
import uuid
import zipfile

import numpy as np
import SimpleITK as sitk
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.datastructures import UploadFile as StarletteUploadFile

import cbct_matching
from local_security import protect_local_server
import cbct_volume_ops as ops

WORK_ROOT = Path(tempfile.gettempdir()) / "lola_cbct"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # All'avvio elimina i volumi temporanei rimasti da sessioni precedenti
    shutil.rmtree(WORK_ROOT, ignore_errors=True)
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="LolaMeshAnalyzer CBCT Server", version="0.1.0", lifespan=lifespan)

# Solo l'app (pagine servite dal PC stesso) puo' usare il server: vedi local_security.py
protect_local_server(app)

SESSIONS: dict[str, dict] = {}
SESSIONS_LOCK = threading.Lock()
MAX_SESSIONS = 2
# Stati precedenti per "Annulla", salvati su disco nella cartella della sessione: in memoria
# resta solo il volume attuale (dopo "Riduci volume" la RAM usata scende davvero)
MAX_UNDO = 3
# Oltre questa soglia la visualizzazione usa una copia ridotta: NiiVue alloca sulla GPU
# circa 10 byte per voxel, quindi 50 milioni di voxel richiedono ~0,5 GB di memoria video
PREVIEW_MAX_VOXELS = 50_000_000
MAX_UPLOAD_FILES = 20_000

# Tag DICOM tecnici restituiti al frontend. Nessun dato anagrafico del paziente.
TECHNICAL_TAGS = {
    "modality": "0008|0060",
    "manufacturer": "0008|0070",
    "model": "0008|1090",
    "seriesDescription": "0008|103e",
    "seriesNumber": "0020|0011",
    "imageType": "0008|0008",
}


class LoadPathRequest(BaseModel):
    path: str
    progressId: str | None = None


class VolumeOperation(BaseModel):
    op: str
    params: dict = {}


# Avanzamento dei caricamenti in corso (0-100), letto dal frontend con GET /cbct/progress/{id}
PROGRESS: dict[str, dict] = {}


def _no_progress(value: float, message: str | None = None) -> None:
    pass


def _progress_reporter(progress_id: str | None):
    if not progress_id:
        return _no_progress
    PROGRESS[progress_id] = {"value": 0.0, "message": "Preparazione..."}

    def report(value: float, message: str | None = None) -> None:
        entry = PROGRESS.get(progress_id)
        if entry is None:
            return
        entry["value"] = round(max(entry["value"], min(float(value), 100.0)), 1)
        if message:
            entry["message"] = message

    return report


def _new_session_dir() -> tuple[str, Path]:
    session_id = uuid.uuid4().hex
    session_dir = WORK_ROOT / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_id, session_dir


def _drop_session(session_id: str) -> None:
    with SESSIONS_LOCK:
        session = SESSIONS.pop(session_id, None)
    if session:
        shutil.rmtree(session["dir"], ignore_errors=True)


def _register_session(session_id: str, session: dict) -> None:
    with SESSIONS_LOCK:
        SESSIONS[session_id] = session
        stale = list(SESSIONS.keys())[:-MAX_SESSIONS]
    for old_id in stale:
        _drop_session(old_id)


def _get_session(session_id: str) -> dict:
    with SESSIONS_LOCK:
        session = SESSIONS.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Volume non trovato o scaduto. Ricarica la CBCT.")
    return session


def _safe_extract_zip(zip_path: Path, destination: Path, report=_no_progress) -> None:
    """Estrae lo ZIP impedendo percorsi che escono dalla cartella di destinazione."""
    destination = destination.resolve()
    with zipfile.ZipFile(zip_path) as archive:
        members = archive.infolist()
        for member in members:
            target = (destination / member.filename).resolve()
            if destination not in target.parents and target != destination:
                raise ValueError(f"Percorso non valido nello ZIP: {member.filename}")
        for index, member in enumerate(members):
            archive.extract(member, destination)
            report(15 * (index + 1) / len(members), "Estrazione dello ZIP...")


def _series_header(file_name: str) -> tuple[str, list[float]]:
    """Tipo immagine (0008|0008) e orientamento (0020|0037) della prima slice di una serie."""
    reader = sitk.ImageFileReader()
    reader.SetFileName(file_name)
    try:
        reader.ReadImageInformation()
    except RuntimeError:
        return "", []
    image_type = reader.GetMetaData("0008|0008").upper() if reader.HasMetaDataKey("0008|0008") else ""
    try:
        orientation = [float(v) for v in reader.GetMetaData("0020|0037").split("\\")]
    except (RuntimeError, ValueError):
        orientation = []
    return image_type, orientation


def _is_axial(orientation: list[float]) -> bool:
    if len(orientation) != 6:
        return False
    row, col = np.array(orientation[:3]), np.array(orientation[3:])
    normal = np.cross(row, col)
    return abs(normal[2]) > 0.9


def _find_dicom_series(root: Path, report=_no_progress) -> tuple[list[str], int]:
    """Cerca le serie DICOM in tutte le sottocartelle e sceglie quella da caricare.

    Molti esportatori CBCT salvano, oltre alla serie assiale acquisita, scout e
    ricostruzioni coronali/sagittali. Si caricano solo le assiali: scout esclusi,
    originali preferite alle ricostruite (DERIVED), a parita' la serie con piu' file.
    """
    candidates = []
    series_count = 0
    directories = [directory for directory, _subdirs, files in os.walk(root) if files]
    for index, directory in enumerate(directories):
        report(15 + 10 * index / len(directories), "Ricerca delle serie DICOM...")
        series_ids = sitk.ImageSeriesReader.GetGDCMSeriesIDs(directory) or ()
        for series_id in series_ids:
            series_count += 1
            names = list(sitk.ImageSeriesReader.GetGDCMSeriesFileNames(directory, series_id))
            image_type, orientation = _series_header(names[0])
            if "LOCALIZER" in image_type:
                continue
            candidates.append({
                "files": names,
                "axial": _is_axial(orientation),
                "original": "ORIGINAL" in image_type,
            })
    axial = [c for c in candidates if c["axial"]]
    # Serie senza orientamento leggibile (es. multi-frame): usate solo se non ci sono assiali
    pool = axial or [c for c in candidates if not c["axial"] and len(c["files"]) == 1] or candidates
    if not pool:
        return [], series_count
    best = max(pool, key=lambda c: (c["original"], len(c["files"])))
    return best["files"], series_count


def _read_technical_tags(file_name: str) -> dict:
    reader = sitk.ImageFileReader()
    reader.SetFileName(file_name)
    reader.LoadPrivateTagsOff()
    try:
        reader.ReadImageInformation()
    except RuntimeError:
        return {}
    tags = {}
    for key, tag in TECHNICAL_TAGS.items():
        if reader.HasMetaDataKey(tag):
            tags[key] = reader.GetMetaData(tag).strip()
    return tags


def _read_volume(root: Path, report=_no_progress) -> tuple[sitk.Image, dict]:
    files, series_count = _find_dicom_series(root, report)
    if not files:
        raise ValueError("Nessuna serie DICOM trovata nella cartella o nello ZIP.")

    report(25, f"Lettura di {len(files)} slice...")
    if len(files) == 1:
        # CBCT esportate come singolo file DICOM multi-frame
        image = sitk.ReadImage(files[0])
    else:
        reader = sitk.ImageSeriesReader()
        reader.SetFileNames(files)
        reader.AddCommand(sitk.sitkProgressEvent, lambda: report(25 + 55 * reader.GetProgress()))
        image = reader.Execute()
    report(80, "Preparazione del volume...")

    if image.GetDimension() != 3 or min(image.GetSize()) < 2:
        raise ValueError(f"La serie trovata non e' un volume 3D (dimensioni {image.GetSize()}).")
    if image.GetNumberOfComponentsPerPixel() != 1:
        raise ValueError("La serie trovata non e' in scala di grigi.")

    info = _read_technical_tags(files[0])
    info["fileCount"] = len(files)
    info["seriesCount"] = series_count
    return image, info


def _to_compact_pixel_type(image: sitk.Image) -> sitk.Image:
    """Converte in int16 quando i valori lo permettono, per dimezzare il volume da trasferire."""
    stats = sitk.MinimumMaximumImageFilter()
    stats.Execute(image)
    low, high = stats.GetMinimum(), stats.GetMaximum()
    if low >= -32768 and high <= 32767:
        return sitk.Cast(image, sitk.sitkInt16)
    return sitk.Cast(image, sitk.sitkFloat32)


def _suggested_window(image: sitk.Image) -> list[float]:
    sample = sitk.GetArrayViewFromImage(image)[::2, ::4, ::4]
    p_low, p_high = np.percentile(sample, [1.0, 99.5])
    return [float(p_low), float(p_high)]


def _geometry_metadata(image: sitk.Image) -> dict:
    array = sitk.GetArrayViewFromImage(image)
    return {
        "size": list(image.GetSize()),
        "spacing": [round(s, 4) for s in image.GetSpacing()],
        "origin": [round(o, 3) for o in image.GetOrigin()],
        "physicalSizeMm": [round(n * s, 1) for n, s in zip(image.GetSize(), image.GetSpacing())],
        "min": float(array.min()),
        "max": float(array.max()),
    }


def _reduction_factor(image: sitk.Image) -> int:
    """Fattore intero di riduzione per stare sotto PREVIEW_MAX_VOXELS (1 = nessuna riduzione)."""
    voxels = int(np.prod(image.GetSize()))
    factor = 1
    while voxels / factor ** 3 > PREVIEW_MAX_VOXELS:
        factor += 1
    return factor


def _refresh_outputs(session: dict) -> dict:
    """Aggiorna metadati e copia ridotta dopo il caricamento o una modifica del volume.

    Il volume completo (volume.nii) viene scritto solo quando il frontend lo chiede,
    perche' alla piena risoluzione pesa centinaia di MB.
    """
    image = session["image"]
    session["version"] += 1
    version = session["version"]
    factor = _reduction_factor(image)
    if factor > 1:
        reduced = sitk.BinShrink(image, [factor] * 3)
        reduced_path = session["dir"] / f"volume_reduced_v{version}.nii"
        sitk.WriteImage(reduced, str(reduced_path), useCompression=False)
        reduced_info = {
            "factor": factor,
            "size": list(reduced.GetSize()),
            "spacing": [round(s, 4) for s in reduced.GetSpacing()],
        }
        full_path = None
    else:
        full_path = session["dir"] / f"volume_v{version}.nii"
        sitk.WriteImage(image, str(full_path), useCompression=False)
        reduced_path, reduced_info = full_path, None

    # Elimina i file della versione precedente (su Windows un file ancora in invio e' bloccato:
    # in quel caso resta nella cartella temporanea e sparisce alla chiusura della sessione)
    for old in (session.get("reduced_path"), session.get("full_path")):
        if old and old not in (reduced_path, full_path):
            try:
                Path(old).unlink(missing_ok=True)
            except OSError:
                pass
    session["reduced_path"], session["full_path"] = reduced_path, full_path

    session["meta"] = {
        **session["info"],
        **_geometry_metadata(image),
        "id": session["id"],
        "version": version,
        "reduced": reduced_info,
        "suggestedWindow": session["suggestedWindow"],
        "undoSteps": len(session["history"]),
    }
    return session["meta"]


def _load_into_session(source_root: Path, session_id: str, session_dir: Path, report=_no_progress) -> dict:
    image, info = _read_volume(source_root, report)
    image = _to_compact_pixel_type(image)
    report(88, "Creazione della copia per la visualizzazione...")
    session = {
        "id": session_id,
        "dir": session_dir,
        "image": image,
        "history": [],
        "info": info,
        "suggestedWindow": _suggested_window(image),
        "version": 0,
        "lock": threading.Lock(),
    }
    meta = _refresh_outputs(session)
    _register_session(session_id, session)
    report(100, "Volume pronto")
    return meta


def _apply_operation(image: sitk.Image, op: str, params: dict) -> tuple[sitk.Image, dict]:
    """Esegue un'operazione del Wizard volume. Restituisce la nuova immagine e un riepilogo."""
    if op == "cropBox":
        cropped = ops.crop_to_box(image, params["cornersRas"])
        size = " × ".join(str(n) for n in cropped.GetSize())
        return cropped, {"message": f"Volume ridotto al box ({size} voxel)."}
    if op == "crop":
        cropped, changed = ops.crop_by_screen_polygon(
            image,
            polygon=params["polygon"],
            mvp_column_major=params["mvp"],
            viewport=params["viewport"],
            canvas_size=params["canvasSize"],
            keep_inside=bool(params.get("keepInside", False)),
        )
        if changed == 0:
            raise ValueError("Il contorno non contiene nessuna parte del volume.")
        return ops.trim_to_content(cropped), {"message": f"Ritaglio eseguito ({changed:,} voxel rimossi).".replace(",", ".")}
    if op == "flipZ":
        return ops.flip_z(image), {"message": "Asse Z invertito."}
    if op == "rotate90":
        return ops.rotate90(image, params["plane"], int(params["turns"])), {"message": "Volume ruotato di 90°."}
    if op == "reorient":
        return ops.reorient(image, params["matrix"]), {"message": "Orientamento applicato."}
    if op == "median":
        return ops.median_filter(image, int(params.get("radius", 1))), {"message": "Filtro mediano applicato."}
    if op == "smooth":
        return ops.smooth_filter(image, float(params.get("sigma", 0.8))), {"message": "Filtro di ammorbidimento applicato."}
    if op == "despeckle":
        cleaned, count = ops.remove_specks(image, float(params["threshold"]), float(params.get("minSizeMm3", 5.0)))
        if count == 0:
            return cleaned, {"message": "Nessun puntino isolato trovato con questa soglia.", "unchanged": True}
        return cleaned, {"message": f"Rimossi {count:,} voxel isolati.".replace(",", ".")}
    raise ValueError(f"Operazione sconosciuta: {op}")


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "cbct"}


@app.get("/cbct/progress/{progress_id}")
def get_progress(progress_id: str):
    return PROGRESS.get(progress_id) or {"value": None, "message": None}


@app.post("/cbct/load-path")
def load_from_path(request: LoadPathRequest):
    """Carica da un percorso locale: cartella DICOM oppure file .zip (usato dall'app desktop)."""
    source = Path(request.path)
    if not source.exists():
        raise HTTPException(status_code=404, detail=f"Percorso non trovato: {source}")

    session_id, session_dir = _new_session_dir()
    report = _progress_reporter(request.progressId)
    try:
        if source.is_file():
            if source.suffix.lower() != ".zip":
                raise ValueError("Seleziona una cartella DICOM oppure un file .zip.")
            extracted = session_dir / "dicom"
            _safe_extract_zip(source, extracted, report)
            return _load_into_session(extracted, session_id, session_dir, report)
        # Cartella: letta sul posto, senza copiarla ne' modificarla
        return _load_into_session(source, session_id, session_dir, report)
    except (ValueError, zipfile.BadZipFile, RuntimeError) as exc:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        traceback.print_exc()
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Errore durante il caricamento: {exc}")
    finally:
        PROGRESS.pop(request.progressId, None)


@app.post("/cbct/load-upload")
async def load_from_upload(request: Request):
    """Carica file inviati dal browser: un singolo .zip oppure tutti i file di una cartella DICOM.

    Il limite predefinito di Starlette (1000 file) e' troppo basso: una CBCT esportata con
    scout e ricostruzioni supera facilmente i 2000 file.
    """
    form = await request.form(max_files=MAX_UPLOAD_FILES, max_fields=MAX_UPLOAD_FILES)
    files = [item for item in form.getlist("files") if isinstance(item, StarletteUploadFile)]
    if not files:
        raise HTTPException(status_code=422, detail="Nessun file ricevuto.")
    try:
        progress_id = request.query_params.get("progressId")
        return await run_in_threadpool(_load_uploaded_files, files, _progress_reporter(progress_id))
    finally:
        PROGRESS.pop(request.query_params.get("progressId"), None)
        await form.close()


def _load_uploaded_files(files: list, report=_no_progress) -> dict:
    session_id, session_dir = _new_session_dir()
    dicom_dir = session_dir / "dicom"
    dicom_dir.mkdir()
    try:
        if len(files) == 1 and (files[0].filename or "").lower().endswith(".zip"):
            zip_path = session_dir / "upload.zip"
            with zip_path.open("wb") as out:
                shutil.copyfileobj(files[0].file, out)
            _safe_extract_zip(zip_path, dicom_dir, report)
            zip_path.unlink(missing_ok=True)
        else:
            for index, upload in enumerate(files):
                with (dicom_dir / f"{index:05d}.dcm").open("wb") as out:
                    shutil.copyfileobj(upload.file, out)
                report(15 * (index + 1) / len(files), "Copia dei file ricevuti...")
        return _load_into_session(dicom_dir, session_id, session_dir, report)
    except (ValueError, zipfile.BadZipFile, RuntimeError) as exc:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        traceback.print_exc()
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Errore durante il caricamento: {exc}")


@app.get("/cbct/{session_id}/volume.nii")
def get_volume(session_id: str, reduced: bool = False):
    session = _get_session(session_id)
    with session["lock"]:
        if reduced:
            path = session["reduced_path"]
        else:
            if session["full_path"] is None:
                full_path = session["dir"] / f"volume_v{session['version']}.nii"
                sitk.WriteImage(session["image"], str(full_path), useCompression=False)
                session["full_path"] = full_path
            path = session["full_path"]
    return FileResponse(path, media_type="application/octet-stream", filename="volume.nii")


def _push_history(session: dict) -> None:
    """Salva il volume attuale su disco per "Annulla" (MetaImage: rilettura esatta e veloce)."""
    path = session["dir"] / f"undo_v{session['version']}.mha"
    sitk.WriteImage(session["image"], str(path), useCompression=False)
    session["history"].append(path)
    for old in session["history"][:-MAX_UNDO]:
        old.unlink(missing_ok=True)
    del session["history"][:-MAX_UNDO]


@app.post("/cbct/{session_id}/ops")
def apply_operation(session_id: str, request: VolumeOperation):
    """Applica un'operazione del Wizard volume al volume completo e aggiorna la copia ridotta."""
    session = _get_session(session_id)
    if not session["lock"].acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Un'altra operazione e' in corso su questo volume.")
    try:
        new_image, summary = _apply_operation(session["image"], request.op, request.params)
        if summary.pop("unchanged", False):
            return {**session["meta"], "summary": summary}
        _push_history(session)
        session["image"] = new_image
        return {**_refresh_outputs(session), "summary": summary}
    except (KeyError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=f"Parametri mancanti o non validi per '{request.op}': {exc}")
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except MemoryError:
        raise HTTPException(status_code=507, detail="Memoria insufficiente per questa operazione. Prova prima la riduzione permanente.")
    finally:
        session["lock"].release()


@app.post("/cbct/{session_id}/undo")
def undo_operation(session_id: str):
    session = _get_session(session_id)
    with session["lock"]:
        if not session["history"]:
            raise HTTPException(status_code=422, detail="Nessuna modifica da annullare.")
        path = session["history"].pop()
        session["image"] = sitk.ReadImage(str(path))
        path.unlink(missing_ok=True)
        return {**_refresh_outputs(session), "summary": {"message": "Ultima modifica annullata."}}


MESH_SUFFIXES = {".stl", ".ply", ".obj"}


@app.post("/cbct/{session_id}/match")
async def match_mesh(session_id: str, request: Request):
    """Matching STL su DICOM ("Assistita"): calcola la matrice che porta la mesh sulla CBCT.

    Form: mesh (file STL/PLY/OBJ), boneThreshold (contrasto minimo attuale), progressId (facoltativo),
    method ("assisted" oppure "points"); con "points" anche pairs = {"mesh": [[x,y,z]...], "cbct": [...]}.
    La mesh non viene modificata: il frontend applica la matrice ai vertici.
    """
    session = _get_session(session_id)
    form = await request.form()
    try:
        upload = form.get("mesh")
        if not isinstance(upload, StarletteUploadFile):
            raise HTTPException(status_code=422, detail="Nessuna mesh ricevuta.")
        suffix = Path(upload.filename or "").suffix.lower()
        if suffix not in MESH_SUFFIXES:
            raise HTTPException(status_code=422, detail="Formato non supportato: usa STL, PLY o OBJ.")
        try:
            bone_threshold = float(form.get("boneThreshold"))
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Soglia di contrasto mancante.")
        progress_id = form.get("progressId")
        method = form.get("method") or "assisted"
        if method == "points":
            try:
                pairs = json.loads(form.get("pairs") or "{}")
                mesh_points, cbct_points = pairs["mesh"], pairs["cbct"]
            except (ValueError, KeyError, TypeError):
                raise HTTPException(status_code=422, detail="Coppie di punti mancanti o non valide.")
        elif method != "assisted":
            raise HTTPException(status_code=422, detail=f"Metodo di Matching sconosciuto: {method}")
        mesh_path = session["dir"] / f"match_mesh{suffix}"
        with mesh_path.open("wb") as out:
            shutil.copyfileobj(upload.file, out)
    finally:
        await form.close()

    if not session["lock"].acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Un'altra operazione e' in corso su questo volume.")
    report = _progress_reporter(progress_id)
    try:
        if method == "points":
            return await run_in_threadpool(
                cbct_matching.match_points, session["image"], mesh_path, bone_threshold, mesh_points, cbct_points, report)
        return await run_in_threadpool(cbct_matching.match_assisted, session["image"], mesh_path, bone_threshold, report)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Errore durante il Matching: {exc}")
    finally:
        session["lock"].release()
        PROGRESS.pop(progress_id, None)
        mesh_path.unlink(missing_ok=True)


@app.delete("/cbct/{session_id}")
def delete_volume(session_id: str):
    _drop_session(session_id)
    return {"deleted": session_id}


# Segmentazione metodo 2 (test, DentalSegmentator): endpoint in cbct_seg2.py. Per scartarla
# basta togliere queste righe.
import cbct_seg2  # noqa: E402

cbct_seg2.register(app, _get_session, _progress_reporter, PROGRESS, _reduction_factor)

# Esplora DICOM (pagina "Filtra immagini DICOM"): endpoint /dicom/... in dicom_browser.py
import dicom_browser  # noqa: E402

dicom_browser.register(app, _progress_reporter, PROGRESS, _safe_extract_zip, WORK_ROOT)


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8002))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
