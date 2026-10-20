"""Esplora DICOM: tutti i gruppi di immagini (serie) di una cartella CBCT o di uno ZIP.

Pagina "Filtra immagini DICOM" (Strumenti > CBCT). Il server CBCT (porta 8002):
- legge le intestazioni di tutti i file e li raggruppa per serie (SeriesInstanceUID): volume
  assiale, scout, ricostruzioni MPR, immagini singole...;
- crea anteprime PNG delle singole immagini (solo per la visualizzazione);
- esporta le serie scelte copiando i file originali byte per byte (shutil.copy2: anche le date
  restano quelle originali), in una cartella oppure in uno ZIP. I DICOM non vengono mai riscritti.
Al frontend vanno solo dati tecnici, nessun dato anagrafico del paziente.
"""
from concurrent.futures import ThreadPoolExecutor
import io
import re
import shutil
import threading
import uuid
import zipfile
from pathlib import Path

import numpy as np
import SimpleITK as sitk
from fastapi import HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from PIL import Image
from pydantic import BaseModel
from starlette.datastructures import UploadFile as StarletteUploadFile

MAX_SESSIONS = 2
MAX_UPLOAD_FILES = 20_000
THUMB_SIZE = 192

TAGS = {
    "seriesUid": "0020|000e",
    "seriesNumber": "0020|0011",
    "description": "0008|103e",
    "modality": "0008|0060",
    "imageType": "0008|0008",
    "instance": "0020|0013",
    "position": "0020|0032",
    "orientation": "0020|0037",
    "rows": "0028|0010",
    "columns": "0028|0011",
    "pixelSpacing": "0028|0030",
    "thickness": "0018|0050",
    "frames": "0028|0008",
    "seriesDate": "0008|0021",
    "seriesTime": "0008|0031",
    "manufacturer": "0008|0070",
}

KIND_LABELS = {
    "volume": "Volume assiale",
    "scout": "Scout",
    "mpr": "Ricostruzione (MPR)",
    "single": "Immagine singola",
    "other": "Altre immagini",
}


class ScanPathRequest(BaseModel):
    path: str
    progressId: str | None = None


class ExportRequest(BaseModel):
    series: list[int]
    destination: str


SESSIONS: dict[str, dict] = {}
SESSIONS_LOCK = threading.Lock()


def _no_progress(value, message=None):
    pass


def _header(path: Path) -> dict | None:
    """Intestazione DICOM di un file (None se non e' un'immagine DICOM leggibile)."""
    if path.name.upper() == "DICOMDIR":
        return None
    reader = sitk.ImageFileReader()
    reader.SetImageIO("GDCMImageIO")
    reader.SetFileName(str(path))
    try:
        reader.ReadImageInformation()
    except RuntimeError:
        return None
    info = {key: reader.GetMetaData(tag).strip() if reader.HasMetaDataKey(tag) else "" for key, tag in TAGS.items()}
    info["path"] = path
    info["size"] = path.stat().st_size
    return info


def _floats(text: str) -> list[float]:
    try:
        return [float(v) for v in text.replace(",", ".").split("\\") if v.strip()]
    except ValueError:
        return []


def _orientation(iop: list[float]) -> str:
    if len(iop) != 6:
        return "sconosciuto"
    normal = np.cross(iop[:3], iop[3:])
    axis = int(np.argmax(np.abs(normal)))
    if abs(normal[axis]) < 0.8:
        return "obliqua"
    return ["sagittale", "coronale", "assiale"][axis]


def _kind(first: dict, count: int, orientation: str) -> str:
    text = f"{first['imageType']} {first['description']}".upper()
    if any(word in text for word in ("LOCALIZER", "SCOUT", "TOPOGRAM", "SURVIEW")):
        return "scout"
    if any(word in text for word in ("DERIVED", "SECONDARY", "MPR", "REFORMAT", "CURVED", "PANO")):
        return "mpr"
    if count == 1:
        return "single"
    if orientation == "assiale" and count >= 10:
        return "volume"
    return "other"


def _build_series(headers: list[dict]) -> list[dict]:
    groups: dict[str, list[dict]] = {}
    for h in headers:
        key = h["seriesUid"] or f"{h['seriesNumber']}|{h['description']}|{h['modality']}"
        groups.setdefault(key, []).append(h)

    series = []
    for items in groups.values():
        iop = _floats(items[0]["orientation"])
        normal = np.cross(iop[:3], iop[3:]) if len(iop) == 6 else None

        def order(h):
            ipp = _floats(h["position"])
            if normal is not None and len(ipp) == 3:
                return (0, float(np.dot(ipp, normal)))
            try:
                return (1, float(h["instance"]))
            except ValueError:
                return (2, h["path"].name)

        items.sort(key=order)
        # immagini: (file, fotogramma); un DICOM multi-frame contiene piu' immagini
        frames = []
        for h in items:
            try:
                n = max(1, int(h["frames"] or 1))
            except ValueError:
                n = 1
            frames.extend((h["path"], f) for f in range(n))
        first = items[0]
        orientation = _orientation(iop)
        spacing = _floats(first["pixelSpacing"])
        positions = [_floats(h["position"]) for h in items]
        step = None
        if normal is not None and len(items) > 1 and all(len(p) == 3 for p in positions):
            projections = np.array([np.dot(p, normal) for p in positions])
            diffs = np.abs(np.diff(projections))
            diffs = diffs[diffs > 1e-4]
            if len(diffs):
                step = float(np.median(diffs))
        kind = _kind(first, len(frames), orientation)
        series.append({
            "number": first["seriesNumber"],
            "description": first["description"] or "(senza descrizione)",
            "modality": first["modality"],
            "imageType": first["imageType"].replace("\\", " / "),
            "orientation": orientation,
            "kind": kind,
            "kindLabel": KIND_LABELS[kind],
            "files": len(items),
            "images": len(frames),
            "rows": first["rows"],
            "columns": first["columns"],
            "pixelSpacing": [round(v, 4) for v in spacing[:2]],
            "thickness": first["thickness"],
            "sliceStep": round(step, 4) if step else None,
            "date": first["seriesDate"],
            "time": first["seriesTime"].split(".")[0],
            "manufacturer": first["manufacturer"],
            "bytes": int(sum(h["size"] for h in items)),
            "_files": [h["path"] for h in items],
            "_frames": frames,
        })

    def series_order(s):
        try:
            return (0, int(s["number"]))
        except ValueError:
            return (1, s["description"])

    series.sort(key=series_order)
    for index, s in enumerate(series):
        s["index"] = index
    return series


def _scan(root: Path, report=_no_progress) -> tuple[list[dict], int]:
    files = [p for p in root.rglob("*") if p.is_file()]
    if not files:
        raise ValueError("La cartella non contiene file.")
    headers = []
    done = 0
    lock = threading.Lock()

    def read(path):
        nonlocal done
        header = _header(path)
        with lock:
            done += 1
            if done % 50 == 0 or done == len(files):
                report(20 + 75 * done / len(files), f"Lettura delle intestazioni DICOM ({done}/{len(files)})...")
        return header

    with ThreadPoolExecutor(max_workers=8) as pool:
        for header in pool.map(read, files):
            if header:
                headers.append(header)
    if not headers:
        raise ValueError("Nessuna immagine DICOM trovata.")
    return _build_series(headers), len(files) - len(headers)


def _public(series: list[dict]) -> list[dict]:
    return [{k: v for k, v in s.items() if not k.startswith("_")} for s in series]


def _render(path: Path, frame: int, window: tuple[float, float] | None, thumb: bool) -> tuple[bytes, tuple[float, float]]:
    image = sitk.ReadImage(str(path))
    array = sitk.GetArrayFromImage(image)
    if array.ndim == 4:  # multi-frame a colori: (fotogrammi, righe, colonne, canali)
        array = array[min(frame, array.shape[0] - 1)]
    elif array.ndim == 3 and image.GetNumberOfComponentsPerPixel() == 1:
        array = array[min(frame, array.shape[0] - 1)]
    if array.ndim == 3 and array.shape[-1] in (3, 4):  # immagine a colori
        pil = Image.fromarray(array[..., :3].astype(np.uint8))
    else:
        data = array.astype(np.float32)
        if window is None:
            low, high = np.percentile(data, [0.5, 99.5])
            window = (float(low), float(high if high > low else low + 1))
        low, high = window
        scaled = np.clip((data - low) / (high - low), 0, 1) * 255
        pil = Image.fromarray(scaled.astype(np.uint8))
    if thumb:
        pil.thumbnail((THUMB_SIZE, THUMB_SIZE))
    buffer = io.BytesIO()
    pil.save(buffer, format="PNG")
    return buffer.getvalue(), window


def _safe_name(text: str) -> str:
    text = re.sub(r"[\\/:*?\"<>|]+", "_", text).strip(" .")
    return text[:60] or "serie"


def _unique(path: Path) -> Path:
    if not path.exists():
        return path
    for n in range(2, 10_000):
        candidate = path.with_name(f"{path.stem}_{n}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise ValueError(f"Impossibile creare {path}")


def _series_folder_name(s: dict) -> str:
    number = s["number"].zfill(3) if s["number"].isdigit() else s["number"]
    return _safe_name(f"{number} {s['description']} - {s['kindLabel']}".strip())


def _export_to_folder(session: dict, indices: list[int], destination: Path, report=_no_progress) -> dict:
    if not destination.is_dir():
        raise ValueError("La cartella di destinazione non esiste.")
    selected = [session["series"][i] for i in indices]
    total = sum(len(s["_files"]) for s in selected)
    copied = 0
    folders = []
    for s in selected:
        folder = _unique(destination / _series_folder_name(s))
        folder.mkdir(parents=True)
        folders.append(str(folder))
        for source in s["_files"]:
            target = _unique(folder / source.name)
            shutil.copy2(source, target)  # copia identica (contenuto e date) del file originale
            copied += 1
            if copied % 25 == 0 or copied == total:
                report(100 * copied / total, f"Copia dei file ({copied}/{total})...")
    return {"folders": folders, "files": copied}


def _export_zip(session: dict, indices: list[int]) -> Path:
    path = session["dir"] / f"export_{uuid.uuid4().hex[:8]}.zip"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as archive:
        for i in indices:
            s = session["series"][i]
            folder = _series_folder_name(s)
            names = set()
            for source in s["_files"]:
                name = source.name
                n = 2
                while name in names:
                    name = f"{source.stem}_{n}{source.suffix}"
                    n += 1
                names.add(name)
                archive.write(source, f"{folder}/{name}")  # byte per byte, senza ricompressione
    return path


def register(app, progress_reporter, progress_store, safe_extract_zip, work_root: Path) -> None:
    """Aggiunge gli endpoint /dicom/... al server CBCT."""

    def new_session() -> tuple[str, Path]:
        sid = uuid.uuid4().hex
        directory = work_root / f"dicom_{sid}"
        directory.mkdir(parents=True, exist_ok=True)
        return sid, directory

    def drop(sid: str) -> None:
        with SESSIONS_LOCK:
            session = SESSIONS.pop(sid, None)
        if session:
            shutil.rmtree(session["dir"], ignore_errors=True)

    def store(sid: str, session: dict) -> None:
        with SESSIONS_LOCK:
            SESSIONS[sid] = session
            stale = list(SESSIONS.keys())[:-MAX_SESSIONS]
        for old in stale:
            drop(old)

    def get(sid: str) -> dict:
        session = SESSIONS.get(sid)
        if not session:
            raise HTTPException(status_code=404, detail="Cartella DICOM non piu' disponibile: caricala di nuovo.")
        return session

    def finish_scan(sid: str, directory: Path, root: Path, source_name: str, report) -> dict:
        series, skipped = _scan(root, report)
        session = {"id": sid, "dir": directory, "root": root, "series": series, "windows": {}, "source": source_name}
        store(sid, session)
        report(100, "Fatto")
        return {"id": sid, "source": source_name, "series": _public(series), "skippedFiles": skipped}

    @app.post("/dicom/scan-path")
    async def dicom_scan_path(request: ScanPathRequest):
        source = Path(request.path)
        if not source.exists():
            raise HTTPException(status_code=404, detail="Percorso non trovato.")
        sid, directory = new_session()
        report = progress_reporter(request.progressId)

        def work():
            if source.is_file():
                if source.suffix.lower() != ".zip":
                    raise ValueError("Seleziona una cartella DICOM oppure un file .zip.")
                extracted = directory / "files"
                safe_extract_zip(source, extracted, lambda v, m=None: report(v * 20 / 15, m))
                return finish_scan(sid, directory, extracted, source.name, report)
            return finish_scan(sid, directory, source, source.name, report)

        try:
            return await run_in_threadpool(work)
        except (ValueError, zipfile.BadZipFile) as exc:
            shutil.rmtree(directory, ignore_errors=True)
            raise HTTPException(status_code=422, detail=str(exc))
        finally:
            progress_store.pop(request.progressId, None)

    @app.post("/dicom/scan-upload")
    async def dicom_scan_upload(request: Request):
        form = await request.form(max_files=MAX_UPLOAD_FILES, max_fields=MAX_UPLOAD_FILES)
        progress_id = request.query_params.get("progressId")
        report = progress_reporter(progress_id)
        sid, directory = new_session()
        try:
            uploads = [item for item in form.getlist("files") if isinstance(item, StarletteUploadFile)]
            if not uploads:
                raise ValueError("Nessun file ricevuto.")
            files_dir = directory / "files"
            files_dir.mkdir()
            if len(uploads) == 1 and (uploads[0].filename or "").lower().endswith(".zip"):
                zip_path = directory / "upload.zip"
                with zip_path.open("wb") as out:
                    shutil.copyfileobj(uploads[0].file, out)
                await run_in_threadpool(safe_extract_zip, zip_path, files_dir)
                zip_path.unlink(missing_ok=True)
                source_name = uploads[0].filename
            else:
                for index, upload in enumerate(uploads):
                    # nome originale (senza cartelle) con un prefisso numerico: nessuna sovrascrittura
                    name = _safe_name(Path(upload.filename or f"file_{index}").name)
                    with (files_dir / f"{index:05d}_{name}").open("wb") as out:
                        shutil.copyfileobj(upload.file, out)
                source_name = f"{len(uploads)} file"
            return await run_in_threadpool(finish_scan, sid, directory, files_dir, source_name, report)
        except (ValueError, zipfile.BadZipFile) as exc:
            shutil.rmtree(directory, ignore_errors=True)
            raise HTTPException(status_code=422, detail=str(exc))
        finally:
            progress_store.pop(progress_id, None)
            await form.close()

    @app.get("/dicom/{sid}/series/{index}/image/{frame}.png")
    def dicom_image(sid: str, index: int, frame: int, thumb: bool = False):
        session = get(sid)
        if not 0 <= index < len(session["series"]):
            raise HTTPException(status_code=404, detail="Serie inesistente.")
        frames = session["series"][index]["_frames"]
        if not 0 <= frame < len(frames):
            raise HTTPException(status_code=404, detail="Immagine inesistente.")
        path, sub = frames[frame]
        # stessa finestra di contrasto per tutta la serie (calcolata sull'immagine centrale)
        window = session["windows"].get(index)
        if window is None:
            mid_path, mid_sub = frames[len(frames) // 2]
            try:
                _, window = _render(mid_path, mid_sub, None, True)
            except RuntimeError:
                window = None
            session["windows"][index] = window
        try:
            png, _ = _render(path, sub, window, thumb)
        except RuntimeError as exc:
            raise HTTPException(status_code=422, detail=f"Immagine non leggibile: {exc}")
        return Response(content=png, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})

    @app.post("/dicom/{sid}/export")
    async def dicom_export(sid: str, request: ExportRequest, progressId: str | None = None):
        session = get(sid)
        indices = sorted({i for i in request.series if 0 <= i < len(session["series"])})
        if not indices:
            raise HTTPException(status_code=422, detail="Nessuna serie selezionata.")
        report = progress_reporter(progressId)
        try:
            return await run_in_threadpool(_export_to_folder, session, indices, Path(request.destination), report)
        except (ValueError, OSError) as exc:
            raise HTTPException(status_code=422, detail=f"Esportazione non riuscita: {exc}")
        finally:
            progress_store.pop(progressId, None)

    @app.get("/dicom/{sid}/export.zip")
    async def dicom_export_zip(sid: str, series: str):
        session = get(sid)
        try:
            indices = sorted({int(v) for v in series.split(",") if v.strip()})
        except ValueError:
            raise HTTPException(status_code=422, detail="Serie non valide.")
        indices = [i for i in indices if 0 <= i < len(session["series"])]
        if not indices:
            raise HTTPException(status_code=422, detail="Nessuna serie selezionata.")
        path = await run_in_threadpool(_export_zip, session, indices)
        return FileResponse(path, media_type="application/zip", filename="serie_dicom.zip")

    @app.delete("/dicom/{sid}")
    def dicom_close(sid: str):
        drop(sid)
        return {"deleted": sid}
