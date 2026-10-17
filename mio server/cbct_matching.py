"""Matching STL su DICOM: allinea una mesh (scansione intraorale, ceratura, guida...) alla CBCT.

Passi (Matching "Assistita"):
1. Estrazione denti da volume: soglie automatiche (Otsu) separano osso, denti e smalto. Il bersaglio
   e' la superficie delle corone (vicino allo smalto), l'unica parte che la scansione intraorale vede;
   osso e radici sono esclusi perche' creano falsi agganci.
2. Candidati di posizione: RANSAC su descrittori FPFH (piu' scale e ripetizioni) e assi principali (PCA).
3. Scelta del candidato: dopo un ICP grossolano vince chi ha piu' punti della mesh aderenti alle corone
   e meno punti con tessuto denso appena fuori dalla superficie della scansione (in posizione giusta
   fuori c'e' aria o tessuto molle; in posizione sbagliata la mesh e' infilata in osso o denti).
4. Rifinitura con ICP point-to-plane a piu' scale. "Variazione" = errore RMS residuo in mm.

Tutto in RAS mm, lo stesso spazio in cui NiiVue mostra CBCT e mesh (le scansioni dentali sono in mm).
"""
from pathlib import Path

import numpy as np
import open3d as o3d
import SimpleITK as sitk

from cbct_volume_ops import index_to_ras_matrix

TEETH_SPACING_MM = 0.4  # risoluzione di lavoro per l'estrazione dei denti
MIN_COMPONENT_MM3 = 20.0  # gruppi di voxel piu' piccoli sono rumore
CROWN_MARGIN_MM = 1.2  # superficie dei denti considerata "corona" se entro questa distanza dallo smalto
RANSAC_VOXELS_MM = (2.0, 1.25)
RANSAC_REPEATS = 2
FIT_DISTANCE_MM = 0.5
OUTSIDE_STEP_MM = 0.5  # distanza dalla superficie della scansione a cui si controlla la densita'
OUTSIDE_WEIGHT = 2.0  # peso della penalita' "tessuto denso fuori dalla scansione"
UNCERTAIN_OUTSIDE = 0.08  # oltre questa frazione il Matching e' incerto (giusto ~0.05, sbagliato 0.11-0.24 nei test)
EXTRA_ATTEMPTS = 2  # giri di RANSAC aggiuntivi quando la posizione migliore e' incerta
ICP_LEVELS_MM = ((1.0, 2.0), (0.6, 1.0), (0.35, 0.5))  # (voxel, distanza massima)
MAX_SOURCE_POINTS = 150_000
SCORE_POINTS = 20_000


def _no_progress(value: float, message: str | None = None) -> None:
    pass


def _otsu(values: np.ndarray) -> float:
    hist, edges = np.histogram(values, bins=256)
    centers = (edges[:-1] + edges[1:]) / 2
    weight0 = np.cumsum(hist).astype(np.float64)
    weight1 = weight0[-1] - weight0
    mass0 = np.cumsum(hist * centers)
    mean0 = mass0 / np.maximum(weight0, 1)
    mean1 = (mass0[-1] - mass0) / np.maximum(weight1, 1)
    between = weight0 * weight1 * (mean0 - mean1) ** 2
    return float(centers[int(np.argmax(between[:-1]))])


class TeethVolume:
    """Volume a risoluzione di lavoro con le soglie dei denti e le superfici per il Matching."""

    def __init__(self, image: sitk.Image, bone_threshold: float):
        factor = max(1, int(round(TEETH_SPACING_MM / min(image.GetSpacing()))))
        self.image = sitk.BinShrink(image, [factor] * 3) if factor > 1 else image
        self.array = sitk.GetArrayViewFromImage(self.image)  # (k, j, i)
        dense = self.array[self.array > bone_threshold]
        if dense.size < 1000:
            raise ValueError("Nella CBCT non ci sono abbastanza strutture dense: abbassa il contrasto minimo e riprova.")
        # Otsu tra i voxel densi separa osso e denti; un secondo Otsu tra i denti isola lo smalto
        self.teeth_threshold = _otsu(dense)
        teeth_values = dense[dense > self.teeth_threshold]
        self.enamel_threshold = _otsu(teeth_values) if teeth_values.size > 1000 else self.teeth_threshold
        upper = float(dense.max())

        voxel_mm3 = float(np.prod(self.image.GetSpacing()))
        teeth = sitk.BinaryThreshold(self.image, self.teeth_threshold, upper, 1, 0)
        teeth = sitk.RelabelComponent(sitk.ConnectedComponent(teeth), minimumObjectSize=max(1, int(MIN_COMPONENT_MM3 / voxel_mm3))) > 0
        surface = sitk.And(teeth, sitk.Not(sitk.BinaryErode(teeth, [1, 1, 1])))
        enamel = sitk.BinaryThreshold(self.image, self.enamel_threshold, upper, 1, 0)
        radius = max(1, int(round(CROWN_MARGIN_MM / min(self.image.GetSpacing()))))
        crowns = sitk.And(surface, sitk.BinaryDilate(enamel, [radius] * 3))

        self.to_ras = index_to_ras_matrix(self.image)
        self.to_index = np.linalg.inv(self.to_ras)
        self.size = np.array(self.image.GetSize())
        self.teeth_points = self._points(surface)
        crown_points = self._points(crowns)
        if len(self.teeth_points) < 500:
            raise ValueError("Superficie dei denti non trovata nella CBCT: controlla il contrasto e il ritaglio del volume.")
        # Senza smalto riconoscibile (es. volume molto rumoroso) si usa tutta la superficie dei denti
        self.crown_points = crown_points if len(crown_points) >= 500 else self.teeth_points
        self.arches = _split_arches(self.crown_points)

    def _points(self, mask: sitk.Image) -> np.ndarray:
        indices = np.argwhere(sitk.GetArrayViewFromImage(mask) > 0)[:, ::-1].astype(np.float64)  # (i, j, k)
        return indices @ self.to_ras[:3, :3].T + self.to_ras[:3, 3]

    def is_dense(self, points: np.ndarray) -> np.ndarray:
        """True dove la CBCT (voxel piu' vicino) supera la soglia dei denti/osso denso."""
        idx = np.round(points @ self.to_index[:3, :3].T + self.to_index[:3, 3]).astype(int)
        inside = np.all((idx >= 0) & (idx < self.size), axis=1)
        dense = np.zeros(len(points), dtype=bool)
        dense[inside] = self.array[idx[inside, 2], idx[inside, 1], idx[inside, 0]] > self.teeth_threshold
        return dense


def _split_arches(points: np.ndarray) -> list[np.ndarray]:
    """Separa le corone delle due arcate lungo l'asse verticale (asse di minima varianza delle corone).

    La scansione di un'arcata puo' agganciarsi per errore all'arcata opposta: cercare i candidati
    anche contro ciascuna arcata da sola evita lo scambio. Restituisce [] se non si separano bene.
    """
    center = points.mean(axis=0)
    _, vectors = np.linalg.eigh(np.cov((points - center).T))
    height = (points - center) @ vectors[:, 0]
    low, high = np.percentile(height, 25), np.percentile(height, 75)
    for _ in range(20):  # 2-means in una dimensione
        split = (low + high) / 2
        low, high = height[height <= split].mean(), height[height > split].mean()
    split = (low + high) / 2
    groups = [points[height <= split], points[height > split]]
    if min(len(g) for g in groups) < 0.2 * len(points):
        return []
    return groups


def read_mesh_samples(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Punti per la registrazione e, a parte, punti con normali per il punteggio dei candidati."""
    mesh = o3d.io.read_triangle_mesh(str(path))
    if len(mesh.vertices) == 0 or len(mesh.triangles) == 0:
        raise ValueError("La mesh è vuota o in un formato non leggibile (usa STL, PLY o OBJ con triangoli).")
    mesh.compute_triangle_normals()
    count = int(min(MAX_SOURCE_POINTS, max(len(mesh.vertices), 20_000)))
    points = np.asarray(mesh.sample_points_uniformly(number_of_points=count).points)
    scored = mesh.sample_points_uniformly(number_of_points=SCORE_POINTS, use_triangle_normal=True)
    return points, np.asarray(scored.points), np.asarray(scored.normals), np.asarray(mesh.vertices)


def _cloud(points: np.ndarray) -> o3d.geometry.PointCloud:
    return o3d.geometry.PointCloud(o3d.utility.Vector3dVector(np.asarray(points, dtype=np.float64)))


def _with_normals(cloud: o3d.geometry.PointCloud, voxel: float) -> o3d.geometry.PointCloud:
    down = cloud.voxel_down_sample(voxel)
    down.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(radius=voxel * 2.5, max_nn=40))
    return down


def _ransac_candidates(source: o3d.geometry.PointCloud, target: o3d.geometry.PointCloud) -> list[np.ndarray]:
    registration = o3d.pipelines.registration
    candidates = []
    for voxel in RANSAC_VOXELS_MM:
        source_down = _with_normals(source, voxel)
        target_down = _with_normals(target, voxel)
        if len(source_down.points) < 10 or len(target_down.points) < 10:
            continue
        search = o3d.geometry.KDTreeSearchParamHybrid(radius=voxel * 5.0, max_nn=100)
        source_fpfh = registration.compute_fpfh_feature(source_down, search)
        target_fpfh = registration.compute_fpfh_feature(target_down, search)
        distance = voxel * 1.5
        for _ in range(RANSAC_REPEATS):
            result = registration.registration_ransac_based_on_feature_matching(
                source_down, target_down, source_fpfh, target_fpfh, True, distance,
                registration.TransformationEstimationPointToPoint(False), 3,
                [
                    registration.CorrespondenceCheckerBasedOnEdgeLength(0.9),
                    registration.CorrespondenceCheckerBasedOnDistance(distance),
                ],
                registration.RANSACConvergenceCriteria(100_000, 0.999),
            )
            if result.fitness > 0:
                candidates.append(np.asarray(result.transformation))
    return candidates


def _pca_candidates(source_points: np.ndarray, target_points: np.ndarray) -> list[np.ndarray]:
    """Allineamenti dagli assi principali: centri sovrapposti, 4 rotazioni possibili degli assi."""
    def frame(points):
        center = points.mean(axis=0)
        _, vectors = np.linalg.eigh(np.cov((points - center).T))
        return center, vectors[:, ::-1]  # asse principale per primo

    source_center, source_axes = frame(source_points)
    target_center, target_axes = frame(target_points)
    candidates = []
    for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        flipped = source_axes * np.array([sx, sy, sx * sy])
        rotation = target_axes @ flipped.T
        if np.linalg.det(rotation) < 0:
            continue
        matrix = np.eye(4)
        matrix[:3, :3] = rotation
        matrix[:3, 3] = target_center - rotation @ source_center
        candidates.append(matrix)
    return candidates


def _icp(source, target_with_normals: dict, initial: np.ndarray, levels):
    """ICP point-to-plane a piu' scale. target_with_normals: cache {voxel: nuvola con normali}."""
    registration = o3d.pipelines.registration
    matrix, result = initial, None
    for voxel, distance in levels:
        source_level = source.voxel_down_sample(voxel)
        target_level = target_with_normals[voxel]
        if len(source_level.points) < 10 or len(target_level.points) < 10:
            continue
        result = registration.registration_icp(
            source_level, target_level, distance, matrix,
            registration.TransformationEstimationPointToPlane(),
            registration.ICPConvergenceCriteria(relative_fitness=1e-7, relative_rmse=1e-7, max_iteration=60),
        )
        if result.fitness > 0:
            matrix = np.asarray(result.transformation)
    return matrix, result


def _outside_dense(teeth: TeethVolume, points: np.ndarray, normals: np.ndarray, matrix: np.ndarray) -> float:
    """Frazione di punti della scansione con tessuto denso appena fuori dalla superficie.

    Il verso delle normali dipende dal file: si prende il lato con meno tessuto denso, che in
    posizione giusta e' l'aria (in posizione sbagliata entrambi i lati cadono in osso o denti).
    """
    moved = points @ matrix[:3, :3].T + matrix[:3, 3]
    turned = normals @ matrix[:3, :3].T
    plus = teeth.is_dense(moved + OUTSIDE_STEP_MM * turned).mean()
    minus = teeth.is_dense(moved - OUTSIDE_STEP_MM * turned).mean()
    return float(min(plus, minus))


def match_assisted(image: sitk.Image, mesh_path: Path, bone_threshold: float, report=_no_progress) -> dict:
    """Allinea la mesh alla CBCT. Restituisce la matrice 4x4 (RAS mm) da applicare ai vertici della mesh."""
    report(5, "Estrazione denti da volume...")
    teeth = TeethVolume(image, bone_threshold)
    report(25, "Lettura della mesh...")
    mesh_points, score_points, score_normals, _ = read_mesh_samples(mesh_path)
    source, target = _cloud(mesh_points), _cloud(teeth.crown_points)
    target_levels = {voxel: _with_normals(target, voxel) for voxel, _ in ICP_LEVELS_MM}
    score_cloud = _cloud(score_points)
    fit_target = target.voxel_down_sample(0.3)

    def best_of(candidates, best, progress_from, progress_to):
        for index, candidate in enumerate(candidates):
            matrix, _ = _icp(source, target_levels, candidate, ICP_LEVELS_MM[:2])
            fit = o3d.pipelines.registration.evaluate_registration(score_cloud, fit_target, FIT_DISTANCE_MM, matrix).fitness
            outside = _outside_dense(teeth, score_points, score_normals, matrix)
            score = fit - OUTSIDE_WEIGHT * outside
            if best is None or score > best[0]:
                best = (score, matrix, outside)
            report(progress_from + (progress_to - progress_from) * (index + 1) / len(candidates))
        return best

    # Candidati contro entrambe le arcate e contro ciascuna arcata da sola
    search_targets = [teeth.crown_points] + teeth.arches

    def search_round():
        found = []
        for points in search_targets:
            found += _ransac_candidates(source, _cloud(points))
        return found

    report(35, "Matching: ricerca delle posizioni possibili...")
    candidates = search_round()
    for points in search_targets:
        candidates += _pca_candidates(mesh_points, points)
    report(55, "Matching: scelta della posizione migliore...")
    best = best_of(candidates, None, 55, 70)
    # RANSAC e' casuale: se la posizione migliore e' dubbia si cercano altri candidati
    for attempt in range(EXTRA_ATTEMPTS):
        if best is not None and best[2] <= UNCERTAIN_OUTSIDE:
            break
        report(70 + 6 * attempt, "Matching: nuovo tentativo...")
        extra = search_round()
        candidates += extra
        best = best_of(extra, best, 70 + 6 * attempt, 76 + 6 * attempt)
    if best is None:
        raise ValueError("Il Matching non ha trovato una corrispondenza tra mesh e denti della CBCT.")

    report(88, "Matching: rifinitura...")
    matrix, result = _icp(source, target_levels, best[1], ICP_LEVELS_MM)
    if result is None or result.fitness <= 0:
        raise ValueError("La rifinitura del Matching non ha trovato corrispondenze.")
    outside = _outside_dense(teeth, score_points, score_normals, matrix)
    fit = o3d.pipelines.registration.evaluate_registration(score_cloud, fit_target, FIT_DISTANCE_MM, matrix).fitness
    report(100, "Matching completato")
    return {
        "matrix": matrix.tolist(),
        "rms": float(result.inlier_rmse),
        "fitness": float(fit),
        "outsideDense": outside,
        "uncertain": bool(outside > UNCERTAIN_OUTSIDE),
        "teethThreshold": teeth.teeth_threshold,
        "enamelThreshold": teeth.enamel_threshold,
        "candidates": len(candidates),
    }
