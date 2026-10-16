"""Server CBCT locale (porta 8002).

Carica una CBCT in formato DICOM da una cartella o da un file ZIP e la
converte in un volume NIfTI che il frontend visualizza con NiiVue.

E' separato da server.py: se qualcosa non funziona qui, il server mesh
principale non viene toccato. Non scrive mai nella cartella di origine:
tutti i file temporanei finiscono in %TEMP%\\lola_cbct.
"""
from contextlib import asynccontextmanager
from pathlib import Path
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
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.datastructures import UploadFile as StarletteUploadFile

WORK_ROOT = Path(tempfile.gettempdir()) / "lola_cbct"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # All'avvio elimina i volumi temporanei rimasti da sessioni precedenti
    shutil.rmtree(WORK_ROOT, ignore_errors=True)
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="LolaMeshAnalyzer CBCT Server", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

SESSIONS: dict[str, dict] = {}
SESSIONS_LOCK = threading.Lock()
MAX_SESSIONS = 3
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


def _register_session(session_id: str, session_dir: Path, nifti_path: Path, meta: dict) -> None:
    with SESSIONS_LOCK:
        SESSIONS[session_id] = {"dir": session_dir, "nifti": nifti_path, "meta": meta}
        stale = list(SESSIONS.keys())[:-MAX_SESSIONS]
    for old_id in stale:
        _drop_session(old_id)


def _safe_extract_zip(zip_path: Path, destination: Path) -> None:
    """Estrae lo ZIP impedendo percorsi che escono dalla cartella di destinazione."""
    destination = destination.resolve()
    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            target = (destination / member.filename).resolve()
            if destination not in target.parents and target != destination:
                raise ValueError(f"Percorso non valido nello ZIP: {member.filename}")
        archive.extractall(destination)


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


def _find_dicom_series(root: Path) -> tuple[list[str], int]:
    """Cerca le serie DICOM in tutte le sottocartelle e sceglie quella da caricare.

    Molti esportatori CBCT salvano, oltre alla serie assiale acquisita, scout e
    ricostruzioni coronali/sagittali. Si caricano solo le assiali: scout esclusi,
    originali preferite alle ricostruite (DERIVED), a parita' la serie con piu' file.
    """
    candidates = []
    series_count = 0
    for directory, _subdirs, files in os.walk(root):
        if not files:
            continue
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


def _read_volume(root: Path) -> tuple[sitk.Image, dict]:
    files, series_count = _find_dicom_series(root)
    if not files:
        raise ValueError("Nessuna serie DICOM trovata nella cartella o nello ZIP.")

    if len(files) == 1:
        # CBCT esportate come singolo file DICOM multi-frame
        image = sitk.ReadImage(files[0])
    else:
        reader = sitk.ImageSeriesReader()
        reader.SetFileNames(files)
        image = reader.Execute()

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


def _volume_metadata(image: sitk.Image, info: dict) -> dict:
    array = sitk.GetArrayViewFromImage(image)
    sample = array[::2, ::4, ::4]
    p_low, p_high = np.percentile(sample, [1.0, 99.5])
    return {
        **info,
        "size": list(image.GetSize()),
        "spacing": [round(s, 4) for s in image.GetSpacing()],
        "origin": [round(o, 3) for o in image.GetOrigin()],
        "physicalSizeMm": [round(n * s, 1) for n, s in zip(image.GetSize(), image.GetSpacing())],
        "min": float(array.min()),
        "max": float(array.max()),
        "suggestedWindow": [float(p_low), float(p_high)],
    }


def _reduction_factor(image: sitk.Image) -> int:
    """Fattore intero di riduzione per stare sotto PREVIEW_MAX_VOXELS (1 = nessuna riduzione)."""
    voxels = int(np.prod(image.GetSize()))
    factor = 1
    while voxels / factor ** 3 > PREVIEW_MAX_VOXELS:
        factor += 1
    return factor


def _load_into_session(source_root: Path, session_id: str, session_dir: Path) -> dict:
    image, info = _read_volume(source_root)
    image = _to_compact_pixel_type(image)
    nifti_path = session_dir / "volume.nii"
    sitk.WriteImage(image, str(nifti_path), useCompression=False)
    meta = _volume_metadata(image, info)
    meta["id"] = session_id

    # Copia ridotta per la visualizzazione: il volume completo resta per le elaborazioni
    factor = _reduction_factor(image)
    reduced_path = nifti_path
    if factor > 1:
        reduced = sitk.BinShrink(image, [factor] * 3)
        reduced_path = session_dir / "volume_reduced.nii"
        sitk.WriteImage(reduced, str(reduced_path), useCompression=False)
        meta["reduced"] = {
            "factor": factor,
            "size": list(reduced.GetSize()),
            "spacing": [round(s, 4) for s in reduced.GetSpacing()],
        }
    else:
        meta["reduced"] = None

    _register_session(session_id, session_dir, nifti_path, meta)
    with SESSIONS_LOCK:
        SESSIONS[session_id]["nifti_reduced"] = reduced_path
    return meta


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "cbct"}


@app.post("/cbct/load-path")
def load_from_path(request: LoadPathRequest):
    """Carica da un percorso locale: cartella DICOM oppure file .zip (usato dall'app desktop)."""
    source = Path(request.path)
    if not source.exists():
        raise HTTPException(status_code=404, detail=f"Percorso non trovato: {source}")

    session_id, session_dir = _new_session_dir()
    try:
        if source.is_file():
            if source.suffix.lower() != ".zip":
                raise ValueError("Seleziona una cartella DICOM oppure un file .zip.")
            extracted = session_dir / "dicom"
            _safe_extract_zip(source, extracted)
            return _load_into_session(extracted, session_id, session_dir)
        # Cartella: letta sul posto, senza copiarla ne' modificarla
        return _load_into_session(source, session_id, session_dir)
    except (ValueError, zipfile.BadZipFile, RuntimeError) as exc:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        traceback.print_exc()
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Errore durante il caricamento: {exc}")


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
        return await run_in_threadpool(_load_uploaded_files, files)
    finally:
        await form.close()


def _load_uploaded_files(files: list) -> dict:
    session_id, session_dir = _new_session_dir()
    dicom_dir = session_dir / "dicom"
    dicom_dir.mkdir()
    try:
        if len(files) == 1 and (files[0].filename or "").lower().endswith(".zip"):
            zip_path = session_dir / "upload.zip"
            with zip_path.open("wb") as out:
                shutil.copyfileobj(files[0].file, out)
            _safe_extract_zip(zip_path, dicom_dir)
            zip_path.unlink(missing_ok=True)
        else:
            for index, upload in enumerate(files):
                with (dicom_dir / f"{index:05d}.dcm").open("wb") as out:
                    shutil.copyfileobj(upload.file, out)
        return _load_into_session(dicom_dir, session_id, session_dir)
    except (ValueError, zipfile.BadZipFile, RuntimeError) as exc:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        traceback.print_exc()
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Errore durante il caricamento: {exc}")


@app.get("/cbct/{session_id}/volume.nii")
def get_volume(session_id: str, reduced: bool = False):
    with SESSIONS_LOCK:
        session = SESSIONS.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Volume non trovato o scaduto. Ricarica la CBCT.")
    path = session.get("nifti_reduced", session["nifti"]) if reduced else session["nifti"]
    return FileResponse(path, media_type="application/octet-stream", filename="volume.nii")


@app.delete("/cbct/{session_id}")
def delete_volume(session_id: str):
    _drop_session(session_id)
    return {"deleted": session_id}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8002))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
