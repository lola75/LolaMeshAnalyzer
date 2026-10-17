"""Operazioni del Wizard volume sulla CBCT (funzioni pure su SimpleITK.Image).

Ogni funzione riceve un'immagine e ne restituisce una nuova: la cronologia per
"Annulla" e' gestita da cbct_server.py.

Coordinate: SimpleITK lavora in LPS, NiiVue (NIfTI) in RAS. Le matrici che
arrivano dal frontend (vista 3D, rotazione libera) sono in RAS mm.
"""
import numpy as np
import SimpleITK as sitk

LPS_TO_RAS = np.diag([-1.0, -1.0, 1.0, 1.0])


def background_value(image: sitk.Image) -> float:
    stats = sitk.MinimumMaximumImageFilter()
    stats.Execute(image)
    return stats.GetMinimum()


def index_to_ras_matrix(image: sitk.Image) -> np.ndarray:
    """Matrice 4x4 che porta l'indice voxel (i, j, k) in coordinate RAS (mm)."""
    direction = np.array(image.GetDirection()).reshape(3, 3)
    affine = np.eye(4)
    affine[:3, :3] = direction * np.array(image.GetSpacing())
    affine[:3, 3] = image.GetOrigin()
    return LPS_TO_RAS @ affine


def _with_geometry(array: np.ndarray, reference: sitk.Image) -> sitk.Image:
    image = sitk.GetImageFromArray(array)
    image.CopyInformation(reference)
    return image


# --- Ritaglio con contorno disegnato sulla vista 3D -------------------------------------

def polygon_mask(polygon: list, width: int, height: int) -> np.ndarray:
    """Rasterizza un poligono (pixel canvas) in una maschera booleana height x width (regola pari/dispari)."""
    points = np.asarray(polygon, dtype=np.float64)
    if points.ndim != 2 or points.shape[0] < 3 or points.shape[1] != 2:
        raise ValueError("Il contorno deve avere almeno 3 punti.")
    x0, y0 = points[:, 0], points[:, 1]
    x1, y1 = np.roll(x0, -1), np.roll(y0, -1)
    mask = np.zeros((height, width), dtype=bool)
    columns = np.arange(width) + 0.5
    row_min = max(int(np.floor(points[:, 1].min())), 0)
    row_max = min(int(np.ceil(points[:, 1].max())), height - 1)
    for row in range(row_min, row_max + 1):
        y = row + 0.5
        crossing = (y0 <= y) != (y1 <= y)
        if not crossing.any():
            continue
        xs = x0[crossing] + (y - y0[crossing]) * (x1[crossing] - x0[crossing]) / (y1[crossing] - y0[crossing])
        xs.sort()
        inside = np.zeros(width, dtype=bool)
        for start, end in zip(xs[0::2], xs[1::2]):
            inside |= (columns >= start) & (columns < end)
        mask[row] = inside
    return mask


def crop_by_screen_polygon(
    image: sitk.Image,
    polygon: list,
    mvp_column_major: list,
    viewport: list,
    canvas_size: list,
    keep_inside: bool,
) -> tuple[sitk.Image, int]:
    """Azzera (porta allo sfondo) i voxel che, proiettati con la vista 3D di NiiVue, cadono
    dentro il contorno (keep_inside=False) oppure fuori (keep_inside=True).

    La proiezione replica Niivue.calculateScreenPoint: clip = MVP * [x, y, z, 1] in RAS mm.
    """
    width, height = int(canvas_size[0]), int(canvas_size[1])
    if width <= 0 or height <= 0:
        raise ValueError("Dimensioni del visualizzatore non valide.")
    mvp = np.asarray(mvp_column_major, dtype=np.float64).reshape(4, 4, order="F")
    left, top, view_w, view_h = (float(v) for v in viewport)
    screen_mask = polygon_mask(polygon, width, height)

    to_ras = index_to_ras_matrix(image)
    to_clip = mvp @ to_ras  # indice voxel -> clip space
    nx, ny, nz = image.GetSize()
    jj, ii = np.mgrid[0:ny, 0:nx].astype(np.float64)
    # Il contributo di (i, j) e' uguale per tutte le slice: calcolato una volta sola
    in_plane = [to_clip[r, 0] * ii + to_clip[r, 1] * jj for r in range(4)]
    background = background_value(image)
    array = sitk.GetArrayFromImage(image)
    changed = 0
    for k in range(nz):
        clip = [in_plane[r] + (to_clip[r, 2] * k + to_clip[r, 3]) for r in range(4)]
        w = clip[3]
        valid = w != 0
        safe_w = np.where(valid, w, 1.0)
        sx = (clip[0] / safe_w + 1.0) * 0.5 * view_w + left
        sy = (1.0 - clip[1] / safe_w) * 0.5 * view_h + top
        px, py = np.floor(sx).astype(np.int64), np.floor(sy).astype(np.int64)
        on_canvas = valid & (px >= 0) & (px < width) & (py >= 0) & (py < height)
        inside = np.zeros((ny, nx), dtype=bool)
        inside[on_canvas] = screen_mask[py[on_canvas], px[on_canvas]]
        remove = ~inside if keep_inside else inside
        remove &= array[k] != background
        changed += int(remove.sum())
        array[k][remove] = background
    return _with_geometry(array, image), changed


def trim_to_content(image: sitk.Image, margin_voxels: int = 2) -> sitk.Image:
    """Riduce il volume al riquadro che contiene voxel diversi dallo sfondo."""
    array = sitk.GetArrayViewFromImage(image)
    background = array.min()
    occupied = np.argwhere(array != background)
    if occupied.size == 0:
        raise ValueError("Il ritaglio eliminerebbe tutto il volume.")
    low = np.maximum(occupied.min(axis=0) - margin_voxels, 0)
    high = np.minimum(occupied.max(axis=0) + margin_voxels + 1, array.shape)
    if np.all(low == 0) and np.all(high == array.shape):
        return image
    # indici numpy (z, y, x) -> SimpleITK (x, y, z)
    return sitk.RegionOfInterest(image, size=[int(v) for v in (high - low)[::-1]], index=[int(v) for v in low[::-1]])


# --- Orientamento -------------------------------------------------------------------------

def flip_z(image: sitk.Image) -> sitk.Image:
    """Inverti Z: capovolge i dati lungo l'asse cranio-caudale mantenendo la geometria."""
    return _with_geometry(np.ascontiguousarray(sitk.GetArrayViewFromImage(image)[::-1]), image)


# piano -> assi numpy (asse 0 = z, 1 = y, 2 = x) e indici SimpleITK corrispondenti
_ROTATION_PLANES = {
    "axial": ((1, 2), (1, 0)),
    "coronal": ((0, 2), (2, 0)),
    "sagittal": ((0, 1), (2, 1)),
}


def rotate90(image: sitk.Image, plane: str, turns: int) -> sitk.Image:
    """Ruota i dati di 90 gradi * turns nel piano indicato, mantenendo fermo il centro del volume."""
    if plane not in _ROTATION_PLANES:
        raise ValueError(f"Piano di rotazione sconosciuto: {plane}")
    turns = int(turns) % 4
    if turns == 0:
        return image
    numpy_axes, sitk_axes = _ROTATION_PLANES[plane]
    rotated = np.ascontiguousarray(np.rot90(sitk.GetArrayViewFromImage(image), k=turns, axes=numpy_axes))
    result = sitk.GetImageFromArray(rotated)

    spacing = list(image.GetSpacing())
    if turns % 2 == 1:
        a, b = sitk_axes
        spacing[a], spacing[b] = spacing[b], spacing[a]
    direction = np.array(image.GetDirection()).reshape(3, 3)
    old_size = np.array(image.GetSize(), dtype=np.float64)
    center = np.array(image.GetOrigin()) + direction @ (np.array(image.GetSpacing()) * (old_size - 1) / 2)
    new_size = np.array(result.GetSize(), dtype=np.float64)
    origin = center - direction @ (np.array(spacing) * (new_size - 1) / 2)

    result.SetSpacing(spacing)
    result.SetDirection(image.GetDirection())
    result.SetOrigin(origin.tolist())
    return result


def reorient(image: sitk.Image, world_matrix_ras: list) -> sitk.Image:
    """Applica una rotazione libera (matrice 4x4 RAS, per righe, come mostrata in anteprima
    da NiiVue) ricampionando sulla stessa griglia del volume."""
    matrix = np.asarray(world_matrix_ras, dtype=np.float64).reshape(4, 4)
    if not np.allclose(matrix[3], [0, 0, 0, 1]):
        raise ValueError("Matrice di orientamento non valida.")
    matrix_lps = LPS_TO_RAS @ matrix @ LPS_TO_RAS
    inverse = np.linalg.inv(matrix_lps)  # punto in uscita -> punto da campionare nel volume
    transform = sitk.AffineTransform(3)
    transform.SetMatrix(inverse[:3, :3].flatten().tolist())
    transform.SetTranslation(inverse[:3, 3].tolist())
    resampled = sitk.Resample(image, image, transform, sitk.sitkLinear, background_value(image), sitk.sitkFloat32)
    return _round_to_type(resampled, image)


def _round_to_type(float_image: sitk.Image, reference: sitk.Image) -> sitk.Image:
    """Arrotonda (non tronca) un risultato float al tipo di pixel dell'immagine di riferimento."""
    dtype = sitk.GetArrayViewFromImage(reference).dtype
    rounded = np.rint(sitk.GetArrayViewFromImage(float_image))
    if np.issubdtype(dtype, np.integer):
        info = np.iinfo(dtype)
        rounded = np.clip(rounded, info.min, info.max)
    return _with_geometry(rounded.astype(dtype), reference)


# --- Riduci volume (box) e filtri -------------------------------------------------------

def crop_to_box(image: sitk.Image, corners_ras: list) -> sitk.Image:
    """Ritaglia il volume al box disegnato nella vista 3D.

    corners_ras: gli 8 vertici del box in RAS mm. Si tiene la regione di voxel che li contiene.
    """
    corners = np.asarray(corners_ras, dtype=np.float64)
    if corners.shape != (8, 3):
        raise ValueError("Il box deve avere 8 vertici.")
    # RAS -> LPS (coordinate fisiche di SimpleITK) -> indice voxel continuo
    indices = np.array([
        image.TransformPhysicalPointToContinuousIndex((float(-x), float(-y), float(z)))
        for x, y, z in corners
    ])
    size = np.array(image.GetSize())
    # Il bordo del volume e' a -0.5 / n-0.5 in indici: arrotondando si ottiene [low, high)
    # (+1e-6: errori di arrotondamento della conversione mm -> indice)
    low = np.clip(np.floor(indices.min(axis=0) + 0.5 + 1e-6), 0, size).astype(int)
    high = np.clip(np.floor(indices.max(axis=0) + 0.5 + 1e-6), 0, size).astype(int)
    if np.any(high - low < 2):
        raise ValueError("Il box è troppo piccolo.")
    if np.all(low == 0) and np.all(high == size):
        raise ValueError("Il box comprende già tutto il volume: trascina le maniglie per ridurlo.")
    return sitk.RegionOfInterest(image, size=[int(v) for v in high - low], index=[int(v) for v in low])


def median_filter(image: sitk.Image, radius: int = 1) -> sitk.Image:
    return sitk.Median(image, [int(radius)] * 3)


def smooth_filter(image: sitk.Image, sigma_voxels: float = 0.8) -> sitk.Image:
    sigma_mm = [s * sigma_voxels for s in image.GetSpacing()]
    smoothed = sitk.SmoothingRecursiveGaussian(sitk.Cast(image, sitk.sitkFloat32), sigma_mm)
    return _round_to_type(smoothed, image)


def remove_specks(image: sitk.Image, threshold: float, min_size_mm3: float) -> tuple[sitk.Image, int]:
    """Elimina i gruppi di voxel sopra soglia piu' piccoli di min_size_mm3 (puntini isolati).

    I voxel rimossi prendono il valore tipico dei tessuti molli, cosi' non lasciano
    buchi neri nelle viste 2D.
    """
    array = sitk.GetArrayFromImage(image)
    if threshold >= array.max():
        return image, 0
    mask = sitk.BinaryThreshold(image, lowerThreshold=float(threshold), upperThreshold=float(array.max()),
                                insideValue=1, outsideValue=0)
    labels = sitk.ConnectedComponent(mask, True)
    voxel_mm3 = float(np.prod(image.GetSpacing()))
    min_voxels = max(int(round(min_size_mm3 / voxel_mm3)), 1)
    kept = sitk.RelabelComponent(labels, minimumObjectSize=min_voxels)
    removed = (sitk.GetArrayViewFromImage(mask) > 0) & (sitk.GetArrayViewFromImage(kept) == 0)
    count = int(removed.sum())
    if count == 0:
        return image, 0
    background = array.min()
    soft = array[::4, ::4, ::4]
    soft = soft[(soft > background) & (soft < threshold)]
    fill = np.median(soft) if soft.size else background
    array[removed] = fill
    return _with_geometry(array, image), count
