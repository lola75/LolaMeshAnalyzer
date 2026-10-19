"""Segmentazione metodo 2 (test): DentalSegmentator (nnU-Net) sul volume della sessione CBCT.

Tutto quello che riguarda il metodo 2 sta qui e in seg2_infer.py: per scartarlo basta togliere
la riga register(...) da cbct_server.py, questi due file, .venv_seg2 e .models_seg2.

- l'inferenza gira in un processo separato con l'ambiente .venv_seg2 (PyTorch + nnU-Net);
- le etichette (griglia del volume completo) restano nella sessione; al frontend va una copia
  sulla griglia mostrata (copia ridotta) per l'anteprima colorata;
- per ogni struttura si crea il modello 3D come nel metodo 1 (marching cubes + Open3D).
"""
import json
import subprocess
import threading
from pathlib import Path

import numpy as np
import open3d as o3d
import SimpleITK as sitk
from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel
from skimage.measure import marching_cubes

from cbct_volume_ops import index_to_ras_matrix

SERVER_DIR = Path(__file__).resolve().parent
VENV_PYTHON = SERVER_DIR / ".venv_seg2" / "Scripts" / "python.exe"
INFER_SCRIPT = SERVER_DIR / "seg2_infer.py"
MODEL_DIR = (SERVER_DIR / ".models_seg2" / "extracted" / "Dataset112_DentalSegmentator_v100"
             / "nnUNetTrainer__nnUNetPlans__3d_fullres")

LABELS = {
    1: "Cranio superiore e mascella",
    2: "Mandibola",
    3: "Denti superiori",
    4: "Denti inferiori",
    5: "Canale mandibolare",
}
PAD_VOXELS = 3

_status_cache: dict = {}
_status_lock = threading.Lock()


class Seg2RunRequest(BaseModel):
    quality: str = "normal"  # "normal" oppure "max" (con specchiature, piu' lento)
    reduced: bool = True     # anteprima sulla griglia mostrata
    progressId: str | None = None


class Seg2MeshRequest(BaseModel):
    label: int
    spacingMm: float = 0.3
    smoothing: int = 10
    maxTriangles: int = 300_000
    progressId: str | None = None


def _environment_status() -> dict:
    """Ambiente e modello presenti, GPU disponibile (verificato una volta, poi in cache)."""
    with _status_lock:
        if _status_cache:
            return dict(_status_cache)
        status = {"python": VENV_PYTHON.exists(), "model": (MODEL_DIR / "fold_0" / "checkpoint_final.pth").exists(),
                  "gpu": None, "error": None}
        if status["python"]:
            try:
                out = subprocess.run(
                    [str(VENV_PYTHON), "-c",
                     "import torch, nnunetv2; print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')"],
                    capture_output=True, text=True, timeout=120)
                if out.returncode == 0:
                    status["gpu"] = out.stdout.strip() or None
                else:
                    status["error"] = (out.stderr.strip().splitlines() or ["errore sconosciuto"])[-1]
            except (OSError, subprocess.TimeoutExpired) as exc:
                status["error"] = str(exc)
        status["ready"] = status["python"] and status["model"] and not status["error"]
        if status["ready"]:
            _status_cache.update(status)
        return status


def _run_inference(session: dict, quality: str, report) -> dict:
    session_dir: Path = session["dir"]
    input_path = session_dir / "seg2_input.nii.gz"
    output_path = session_dir / "seg2_labels_full.nii.gz"
    report(1, "Preparazione del volume...")
    sitk.WriteImage(session["image"], str(input_path), useCompression=True)
    command = [str(VENV_PYTHON), "-u", str(INFER_SCRIPT), str(input_path), str(output_path), str(MODEL_DIR)]
    if quality == "max":
        command.append("max")
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                               encoding="utf-8", errors="replace", cwd=str(SERVER_DIR),
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    done = None
    stderr_lines: list[str] = []
    reader = threading.Thread(target=lambda: stderr_lines.extend(process.stderr), daemon=True)
    reader.start()
    for line in process.stdout:
        line = line.strip()
        if line.startswith("PROGRESS "):
            _, value, *message = line.split(" ", 2)
            report(5 + 0.85 * float(value), message[0] if message else None)
        elif line.startswith("DONE "):
            done = json.loads(line[5:])
    process.wait()
    reader.join(timeout=5)
    input_path.unlink(missing_ok=True)
    if process.returncode != 0 or done is None:
        detail = next((l.strip() for l in reversed(stderr_lines) if l.strip()), "errore sconosciuto")
        raise RuntimeError(f"DentalSegmentator non riuscito: {detail}")

    report(92, "Lettura delle strutture trovate...")
    labels = sitk.ReadImage(str(output_path), sitk.sitkUInt8)
    output_path.unlink(missing_ok=True)
    if labels.GetSize() != session["image"].GetSize():
        raise RuntimeError("le strutture trovate non hanno la stessa griglia del volume")
    labels.CopyInformation(session["image"])
    session["seg2_labels"] = (session["version"], labels)
    return {**done, "labels": _label_volumes(labels)}


def _label_volumes(labels: sitk.Image) -> list[dict]:
    counts = np.bincount(sitk.GetArrayViewFromImage(labels).ravel(), minlength=len(LABELS) + 1)
    voxel_mm3 = float(np.prod(labels.GetSpacing()))
    return [{"label": value, "name": name, "volumeMm3": round(float(counts[value]) * voxel_mm3, 1)}
            for value, name in LABELS.items()]


def _preview_labels(session: dict, labels: sitk.Image, reduced: bool, factor: int) -> Path:
    """Etichette sulla griglia mostrata (vicino piu' prossimo), compresse, per l'anteprima."""
    if reduced and factor > 1:
        reference = sitk.BinShrink(session["image"], [factor] * 3)
        labels = sitk.Resample(labels, reference, sitk.Transform(), sitk.sitkNearestNeighbor, 0, sitk.sitkUInt8)
    session["seg2_count"] = session.get("seg2_count", 0) + 1
    path = session["dir"] / f"seg2_labels_{session['seg2_count']}.nii.gz"
    sitk.WriteImage(labels, str(path), useCompression=True)
    old = session.get("seg2_preview_path")
    if old:
        Path(old).unlink(missing_ok=True)
    session["seg2_preview_path"] = path
    return path


def _label_mesh(labels: sitk.Image, label: int, spacing_mm: float, smoothing: int, max_triangles: int,
                out_path: Path, report) -> dict:
    """Modello 3D di una struttura: maschera ritagliata, ricampionata a voxel cubici, marching cubes."""
    report(5, "Ricerca della struttura...")
    mask = sitk.Cast(sitk.Equal(labels, label), sitk.sitkUInt8)
    stats = sitk.LabelShapeStatisticsImageFilter()
    stats.Execute(mask)
    if not stats.HasLabel(1):
        raise ValueError(f"{LABELS.get(label, 'Struttura')}: non trovata in questa CBCT.")
    x, y, z, sx, sy, sz = stats.GetBoundingBox(1)
    size = mask.GetSize()
    start = [max(0, v - PAD_VOXELS) for v in (x, y, z)]
    end = [min(n, v + s + PAD_VOXELS) for v, s, n in zip((x, y, z), (sx, sy, sz), size)]
    mask = sitk.RegionOfInterest(mask, [e - s for s, e in zip(start, end)], start)

    report(20, "Preparazione della griglia del modello...")
    current = mask.GetSpacing()
    target = max(spacing_mm, min(current))
    grid = sitk.Cast(mask, sitk.sitkFloat32)
    if any(abs(c - target) > 1e-6 for c in current):
        new_size = [max(1, int(round(n * c / target))) for n, c in zip(mask.GetSize(), current)]
        grid = sitk.Resample(grid, new_size, sitk.Transform(), sitk.sitkLinear, mask.GetOrigin(),
                             [target] * 3, mask.GetDirection(), 0.0, sitk.sitkFloat32)
    report(40, "Levigatura del contorno...")
    smooth = sitk.SmoothingRecursiveGaussian(grid, [0.6 * s for s in grid.GetSpacing()])
    volume = np.pad(sitk.GetArrayFromImage(smooth), 1)

    report(55, "Estrazione della superficie...")
    try:
        verts, faces, _n, _v = marching_cubes(volume, level=0.5, allow_degenerate=False)
    except (ValueError, RuntimeError):
        raise ValueError(f"{LABELS.get(label, 'Struttura')}: troppo piccola per creare un modello.")
    to_ras = index_to_ras_matrix(grid)
    points = (verts[:, ::-1] - 1.0) @ to_ras[:3, :3].T + to_ras[:3, 3]

    report(70, "Alleggerimento del modello...")
    mesh = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(points), o3d.utility.Vector3iVector(faces.astype(np.int32)))
    mesh.remove_degenerate_triangles()
    mesh.remove_duplicated_vertices()
    mesh.remove_unreferenced_vertices()
    if max_triangles > 0 and len(mesh.triangles) > max_triangles:
        mesh = mesh.simplify_quadric_decimation(int(max_triangles))
    if smoothing > 0:
        report(85, "Levigatura del modello...")
        mesh = mesh.filter_smooth_taubin(number_of_iterations=int(smoothing))
    v = np.asarray(mesh.vertices)
    t = np.asarray(mesh.triangles)
    if np.einsum("ij,ij->i", v[t[:, 0]], np.cross(v[t[:, 1]], v[t[:, 2]])).sum() < 0:
        mesh.triangles = o3d.utility.Vector3iVector(t[:, ::-1].copy())
    mesh.compute_triangle_normals()
    mesh.compute_vertex_normals()
    report(95, "Salvataggio del modello...")
    if not o3d.io.write_triangle_mesh(str(out_path), mesh, write_ascii=False):
        raise RuntimeError("Scrittura del modello non riuscita.")
    return {"label": label, "name": LABELS.get(label), "triangles": len(mesh.triangles),
            "spacing": round(grid.GetSpacing()[0], 3)}


def register(app, get_session, progress_reporter, progress_store, reduction_factor) -> None:
    """Aggiunge gli endpoint /cbct/{id}/seg2/... al server CBCT."""

    def session_labels(session: dict) -> sitk.Image:
        stored = session.get("seg2_labels")
        if not stored or stored[0] != session["version"]:
            raise HTTPException(status_code=404, detail="Esegui prima la segmentazione automatica su questo volume.")
        return stored[1]

    @app.get("/cbct/seg2/status")
    def seg2_status():
        return _environment_status()

    @app.post("/cbct/{session_id}/seg2/run")
    async def seg2_run(session_id: str, request: Seg2RunRequest):
        session = get_session(session_id)
        status = await run_in_threadpool(_environment_status)
        if not status["ready"]:
            missing = "ambiente .venv_seg2" if not status["python"] else "modello" if not status["model"] else status["error"]
            raise HTTPException(status_code=503, detail=f"Segmentazione metodo 2 non disponibile: {missing}.")
        if not session["lock"].acquire(blocking=False):
            raise HTTPException(status_code=409, detail="Un'altra operazione e' in corso su questo volume.")
        report = progress_reporter(request.progressId)
        try:
            result = await run_in_threadpool(_run_inference, session, request.quality, report)
            report(96, "Preparazione dell'anteprima...")
            labels = session["seg2_labels"][1]
            factor = reduction_factor(session["image"])
            await run_in_threadpool(_preview_labels, session, labels, request.reduced, factor)
            return {**result, "previewId": session["seg2_count"]}
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        except MemoryError:
            raise HTTPException(status_code=507, detail="Memoria insufficiente per la segmentazione automatica.")
        finally:
            session["lock"].release()
            progress_store.pop(request.progressId, None)

    @app.get("/cbct/{session_id}/seg2/labels.nii.gz")
    def seg2_labels(session_id: str):
        session = get_session(session_id)
        session_labels(session)
        path = session.get("seg2_preview_path")
        if not path or not Path(path).exists():
            raise HTTPException(status_code=404, detail="Nessuna anteprima della segmentazione automatica.")
        return FileResponse(path, media_type="application/octet-stream", filename="labels.nii.gz")

    @app.post("/cbct/{session_id}/seg2/mesh")
    async def seg2_mesh(session_id: str, request: Seg2MeshRequest):
        session = get_session(session_id)
        labels = session_labels(session)
        if request.label not in LABELS:
            raise HTTPException(status_code=422, detail="Struttura sconosciuta.")
        if not session["lock"].acquire(blocking=False):
            raise HTTPException(status_code=409, detail="Un'altra operazione e' in corso su questo volume.")
        report = progress_reporter(request.progressId)
        session["seg2_model_count"] = session.get("seg2_model_count", 0) + 1
        path = session["dir"] / f"seg2_model_{session['seg2_model_count']}.stl"
        try:
            result = await run_in_threadpool(_label_mesh, labels, request.label, request.spacingMm,
                                             request.smoothing, request.maxTriangles, path, report)
            old = session.get("seg2_model_path")
            if old:
                Path(old).unlink(missing_ok=True)
            session["seg2_model_path"] = path
            return {**result, "modelId": session["seg2_model_count"]}
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        except MemoryError:
            raise HTTPException(status_code=507, detail="Memoria insufficiente: usa la qualita' Normale.")
        finally:
            session["lock"].release()
            progress_store.pop(request.progressId, None)

    @app.get("/cbct/{session_id}/seg2/model.stl")
    def seg2_model(session_id: str):
        session = get_session(session_id)
        path = session.get("seg2_model_path")
        if not path or not Path(path).exists():
            raise HTTPException(status_code=404, detail="Nessun modello creato.")
        return FileResponse(path, media_type="application/octet-stream", filename="model.stl")
