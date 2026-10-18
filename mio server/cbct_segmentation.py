"""Segmentazione della CBCT per soglia (passo 3 del Wizard volume).

- maschera: voxel con intensita' tra minimo e massimo, facoltativamente solo la regione collegata
  a un punto (seme, RAS mm), senza le isole piu' piccole di un volume dato e con le cavita'
  interne riempite;
- modello 3D: maschera ricalcolata su una griglia isotropa (0.3 o 0.2 mm), superficie con
  marching cubes, poi alleggerimento e levigatura con Open3D. Vertici in RAS mm, lo spazio in
  cui NiiVue mostra CBCT e mesh.
"""
from pathlib import Path

import numpy as np
import open3d as o3d
import SimpleITK as sitk
from skimage.measure import marching_cubes

from cbct_volume_ops import index_to_ras_matrix

LPS_TO_RAS_DIAG = np.array([-1.0, -1.0, 1.0])
SEED_SEARCH_MM = 5.0  # un clic fino a 5 mm dalla zona selezionata vale comunque
PAD_VOXELS = 3


def _no_progress(value: float, message: str | None = None) -> None:
    pass


def _seed_index(mask: sitk.Image, seed_ras) -> tuple[int, int, int]:
    """Voxel della maschera piu' vicino al seme, entro SEED_SEARCH_MM (es. clic sull'osso spugnoso
    interno, non colorato, o appena accanto alla corticale), oppure errore."""
    point = tuple(float(v) for v in np.asarray(seed_ras, dtype=float) * LPS_TO_RAS_DIAG)
    index = np.array(mask.TransformPhysicalPointToContinuousIndex(point))
    size = np.array(mask.GetSize())
    spacing = np.array(mask.GetSpacing())
    if np.any(index < -0.5) or np.any(index > size - 0.5):
        raise ValueError("Il cursore e' fuori dal volume: cliccalo sulla struttura in una slice e riprova.")
    center = np.clip(np.round(index).astype(int), 0, size - 1)
    radius = np.ceil(SEED_SEARCH_MM / spacing).astype(int)
    low = np.maximum(center - radius, 0)
    high = np.minimum(center + radius + 1, size)
    block = sitk.GetArrayViewFromImage(mask)[low[2]:high[2], low[1]:high[1], low[0]:high[0]]  # (z, y, x)
    found = np.argwhere(block > 0)
    if len(found):
        ijk = found[:, ::-1] + low  # (i, j, k)
        distances = np.linalg.norm((ijk - index) * spacing, axis=1)
        found = found[distances <= SEED_SEARCH_MM]
    if len(found) == 0:
        raise ValueError(
            "Vicino al cursore non c'e' niente di colorato: clicca su una slice sopra la struttura rossa "
            "(o abbassa il minimo della soglia) e premi di nuovo \"Solo regione del cursore\".")
    ijk = found[:, ::-1] + low  # (i, j, k)
    distances = np.linalg.norm((ijk - index) * spacing, axis=1)
    i, j, k = ijk[int(np.argmin(distances))]
    return int(i), int(j), int(k)


def threshold_mask(image: sitk.Image, low: float, high: float, seed_ras=None,
                   min_island_mm3: float = 0.0, fill_holes: bool = False) -> sitk.Image:
    """Maschera uint8 (0/1) sulla griglia di image."""
    if high <= low:
        raise ValueError("Il massimo della soglia deve essere maggiore del minimo.")
    mask = sitk.BinaryThreshold(image, float(low), float(high), 1, 0)
    voxel_mm3 = float(np.prod(image.GetSpacing()))

    if seed_ras is not None:
        seed = _seed_index(mask, seed_ras)
        labels = sitk.ConnectedComponent(mask, False)
        label = labels[seed]
        mask = sitk.Cast(sitk.Equal(labels, label), sitk.sitkUInt8)
    elif min_island_mm3 > 0:
        min_voxels = max(1, int(round(min_island_mm3 / voxel_mm3)))
        labels = sitk.RelabelComponent(sitk.ConnectedComponent(mask, False), minimumObjectSize=min_voxels)
        mask = sitk.Cast(labels > 0, sitk.sitkUInt8)

    if fill_holes:
        mask = sitk.BinaryFillhole(mask, fullyConnected=False, foregroundValue=1)
    return sitk.Cast(mask, sitk.sitkUInt8)


def mask_volume_mm3(mask: sitk.Image) -> float:
    return float(sitk.GetArrayViewFromImage(mask).sum()) * float(np.prod(mask.GetSpacing()))


def _bounding_region(mask: sitk.Image, pad: int) -> tuple[list[int], list[int]] | None:
    stats = sitk.LabelShapeStatisticsImageFilter()
    stats.Execute(mask)
    if not stats.HasLabel(1):
        return None
    x, y, z, sx, sy, sz = stats.GetBoundingBox(1)
    size = mask.GetSize()
    start = [max(0, v - pad) for v in (x, y, z)]
    end = [min(n, v + s + pad) for v, s, n in zip((x, y, z), (sx, sy, sz), size)]
    return start, [e - s for s, e in zip(start, end)]


def _resample_isotropic(image: sitk.Image, spacing_mm: float) -> sitk.Image:
    """Ricampiona (lineare) a voxel cubici di spacing_mm, solo se piu' grandi di quelli attuali."""
    current = image.GetSpacing()
    target = max(spacing_mm, min(current))
    if all(abs(c - target) < 1e-6 for c in current):
        return image
    new_size = [max(1, int(round(n * c / target))) for n, c in zip(image.GetSize(), current)]
    return sitk.Resample(image, new_size, sitk.Transform(), sitk.sitkLinear, image.GetOrigin(),
                         [target] * 3, image.GetDirection(), float(np.min(sitk.GetArrayViewFromImage(image))),
                         sitk.sitkFloat32)


def build_mesh(image: sitk.Image, low: float, high: float, seed_ras, min_island_mm3: float,
               fill_holes: bool, spacing_mm: float, smoothing: int, max_triangles: int,
               out_path: Path, report=_no_progress) -> dict:
    """Crea il modello 3D della zona selezionata e lo scrive in STL binario (RAS mm)."""
    report(5, "Ricerca della zona selezionata...")
    # Prima un ritaglio sulla zona selezionata (griglia originale), poi il ricampionamento:
    # cosi' si lavora solo sulla parte di volume che serve
    coarse = threshold_mask(image, low, high, seed_ras, min_island_mm3, fill_holes=False)
    region = _bounding_region(coarse, PAD_VOXELS)
    if region is None:
        raise ValueError("Nessun voxel nella soglia scelta: abbassa il minimo o alza il massimo.")
    cropped = sitk.RegionOfInterest(image, region[1], region[0])

    report(20, "Preparazione della griglia del modello...")
    grid = _resample_isotropic(cropped, spacing_mm)
    mask = threshold_mask(grid, low, high, seed_ras, min_island_mm3, fill_holes)
    report(40, "Levigatura del contorno...")
    # superficie a meta' tra dentro e fuori su una maschera leggermente sfumata: meno "gradini"
    smooth = sitk.SmoothingRecursiveGaussian(sitk.Cast(mask, sitk.sitkFloat32), [0.6 * s for s in grid.GetSpacing()])
    volume = np.pad(sitk.GetArrayFromImage(smooth), 1)  # bordo vuoto: superficie sempre chiusa
    del smooth

    report(55, "Estrazione della superficie...")
    try:
        verts, faces, _normals, _values = marching_cubes(volume, level=0.5, allow_degenerate=False)
    except (ValueError, RuntimeError):
        raise ValueError("Superficie non trovata: la zona selezionata e' troppo piccola.")
    del volume
    ijk = verts[:, ::-1] - 1.0  # (z, y, x) con bordo -> indici (i, j, k) della griglia
    to_ras = index_to_ras_matrix(grid)
    points = ijk @ to_ras[:3, :3].T + to_ras[:3, 3]

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
    # normali verso l'esterno: volume con segno positivo
    v = np.asarray(mesh.vertices)
    t = np.asarray(mesh.triangles)
    signed = np.einsum("ij,ij->i", v[t[:, 0]], np.cross(v[t[:, 1]], v[t[:, 2]])).sum()
    if signed < 0:
        mesh.triangles = o3d.utility.Vector3iVector(t[:, ::-1].copy())
    mesh.compute_triangle_normals()
    mesh.compute_vertex_normals()

    report(95, "Salvataggio del modello...")
    if not o3d.io.write_triangle_mesh(str(out_path), mesh, write_ascii=False):
        raise RuntimeError("Scrittura del modello non riuscita.")
    return {
        "triangles": len(mesh.triangles),
        "vertices": len(mesh.vertices),
        "spacing": round(grid.GetSpacing()[0], 3),
        "volumeMm3": round(mask_volume_mm3(mask), 1),
    }
