from pathlib import Path
from tempfile import NamedTemporaryFile
import io
import json
import os
import traceback

import meshlib.mrmeshpy as mr
import numpy as np
import uuid
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Response
from fastapi.responses import FileResponse, JSONResponse

from local_security import protect_local_server

app = FastAPI(
    title="MeshLib Local Mesh Server",
    description="Local Python server for mesh analysis and processing using MeshLib.",
    version="0.1.0",
)

# Solo l'app (pagine servite dal PC stesso) puo' usare il server: vedi local_security.py
protect_local_server(app, allow_credentials=True, expose_headers=["X-Mesh-Stats"])

SUPPORTED_EXTENSIONS = {"stl", "obj", "ply", "glb", "gltf"}

# Soglia minima di coppie attive per considerare valido l'ICP. Se sotto, esegui fallback con pre-allineamento ICP.
MIN_ACTIVE_PAIRS = 10


def _points_count(points_obj) -> int:
    """Return number of vertices for different meshlib VertCoords representations."""
    # Try common APIs in order of likelihood
    try:
        return int(points_obj.size())
    except Exception:
        pass
    try:
        return int(len(points_obj))
    except Exception:
        pass
    # try vec attribute
    try:
        return int(len(points_obj.vec))
    except Exception:
        pass
    # fallback: try conversion via mrmeshnumpy if available
    try:
        import meshlib.mrmeshnumpy as mrn
        arr = mrn.toNumpyArray(points_obj)
        return int(arr.shape[0])
    except Exception:
        pass
    raise RuntimeError('Unable to determine points count from mesh points object')


def load_mesh_from_bytes(data: bytes, filename: str, allow_point_cloud: bool = False) -> mr.Mesh:
    path = Path(filename)
    suffix = path.suffix.lower().lstrip(".")
    if suffix not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Formato file non supportato: {suffix}")

    # Some versions of the MeshLib Python bindings expose a MeshLoad class,
    # older/newer builds may have different API. Provide clearer diagnostics
    # when the expected symbol is missing to help troubleshooting.
    if hasattr(mr, 'MeshLoad'):
        try:
            mesh = mr.MeshLoad.fromAnySupportedFormat(io.BytesIO(data), suffix)
        except Exception as exc:
            raise ValueError(f"Impossibile leggere la mesh o mesh vuota: {exc}")
    else:
        # Fallback for mrmeshpy versions that expose a loadMesh(path, settings)
        # function instead of MeshLoad.fromAnySupportedFormat. Write the bytes
        # to a temporary file and try mr.loadMesh.
        try:
            with NamedTemporaryFile(delete=False, suffix='.' + suffix) as tmp:
                tmp.write(data)
                tmp_path = tmp.name
            # Some builds expect a MeshLoadSettings object
            try:
                settings = mr.MeshLoadSettings()
            except Exception:
                settings = None

            if settings is not None:
                mesh = mr.loadMesh(tmp_path, settings)
            else:
                mesh = mr.loadMesh(tmp_path)

            # remove temp file after load
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
        except Exception as exc:
            available = [n for n in dir(mr) if not n.startswith('_')]
            print(f"[load_mesh_from_bytes] meshlib module lacks 'MeshLoad' and mr.loadMesh failed. Available symbols: {available}")
            raise ValueError(
                f"Impossibile leggere la mesh: load fallito ({exc}). Verifica la versione di MeshLib o usa le wheel in 'mio server/'."
            )

    if _points_count(mesh.points) == 0:
        raise ValueError("Impossibile leggere la mesh o mesh vuota.")

    if mesh.topology.numValidFaces() == 0 and not allow_point_cloud:
        raise ValueError("Impossibile leggere la mesh o mesh vuota.")

    return mesh


def mesh_metadata(mesh: mr.Mesh) -> dict:
    bounding_box = mesh.computeBoundingBox()
    bounds_min = bounding_box.min()
    bounds_max = bounding_box.max()
    return {
        "vertices": int(_points_count(mesh.points)),
        "triangles": int(mesh.topology.numValidFaces()),
        "has_normals": bool(getattr(mesh, "hasNormals", lambda: False)()),
        "has_triangles": mesh.topology.numValidFaces() > 0,
        "bounds": {
            "min": [float(bounds_min.x), float(bounds_min.y), float(bounds_min.z)],
            "max": [float(bounds_max.x), float(bounds_max.y), float(bounds_max.z)],
        },
        "center": [
            float((bounds_min.x + bounds_max.x) / 2.0),
            float((bounds_min.y + bounds_max.y) / 2.0),
            float((bounds_min.z + bounds_max.z) / 2.0),
        ],
        "surface_area": float(mesh.area()),
        "volume": float(mesh.volume()) if mesh.topology.numValidFaces() > 0 else None,
    }


def prepare_point_cloud(mesh: mr.Mesh, save_normals: bool = True) -> mr.PointCloud:
    point_cloud = mr.meshToPointCloud(mesh, saveNormals=save_normals)
    return point_cloud


def compute_rigid_transformation_from_points(source_points: np.ndarray, target_points: np.ndarray) -> np.ndarray:
    source_points = np.asarray(source_points, dtype=np.float64)
    target_points = np.asarray(target_points, dtype=np.float64)
    if source_points.shape != target_points.shape:
        raise ValueError('Le coordinate dei punti devono avere la stessa forma.')
    if source_points.ndim != 2 or source_points.shape[1] != 3:
        raise ValueError('I punti devono essere un array Nx3.')
    if source_points.shape[0] < 3:
        raise ValueError('Servono almeno 3 punti corrispondenti.')
    if not np.isfinite(source_points).all() or not np.isfinite(target_points).all():
        raise ValueError('I punti devono contenere solo valori numerici finiti.')

    source_center = source_points.mean(axis=0)
    target_center = target_points.mean(axis=0)
    source_centered = source_points - source_center
    target_centered = target_points - target_center
    if np.linalg.matrix_rank(source_centered) < 2 or np.linalg.matrix_rank(target_centered) < 2:
        raise ValueError('I punti devono definire almeno un piano: non possono essere tutti collineari.')

    h = source_centered.T @ target_centered
    u, _, vt = np.linalg.svd(h)
    rotation = vt.T @ u.T
    if np.linalg.det(rotation) < 0:
        vt[-1, :] *= -1
        rotation = vt.T @ u.T

    translation = target_center - rotation @ source_center
    transformation = np.eye(4)
    transformation[:3, :3] = rotation
    transformation[:3, 3] = translation

    return transformation


def compute_affine_transformation_from_points(source_points: np.ndarray, target_points: np.ndarray) -> np.ndarray:
    source_points = np.asarray(source_points, dtype=np.float64)
    target_points = np.asarray(target_points, dtype=np.float64)
    if source_points.ndim != 2 or source_points.shape[1] != 3:
        raise ValueError('I punti sorgente devono avere shape (N, 3).')
    if target_points.ndim != 2 or target_points.shape[1] != 3:
        raise ValueError('I punti target devono avere shape (N, 3).')
    if source_points.shape != target_points.shape:
        raise ValueError('Il numero di punti sorgente e target deve coincidere.')
    if source_points.shape[0] < 4:
        raise ValueError('Per calcolare una trasformazione affine 3D servono almeno 4 coppie di punti.')
    if not np.isfinite(source_points).all() or not np.isfinite(target_points).all():
        raise ValueError('I punti devono contenere solo valori numerici finiti.')

    design_matrix = np.column_stack((source_points, np.ones(source_points.shape[0])))
    if np.linalg.matrix_rank(design_matrix) < 4:
        raise ValueError('I punti sorgente devono essere almeno 4 e non complanari.')

    coefficients, _, _, _ = np.linalg.lstsq(design_matrix, target_points, rcond=None)
    matrix = np.eye(4, dtype=np.float64)
    matrix[:3, :3] = coefficients[:3, :].T
    matrix[:3, 3] = coefficients[3, :]
    if not np.isfinite(matrix).all() or abs(np.linalg.det(matrix[:3, :3])) < 1e-12:
        raise ValueError('I punti non definiscono una trasformazione affine valida.')
    return matrix


def _mesh_to_point_array(mesh: mr.Mesh) -> np.ndarray:
    vertex_count = int(_points_count(mesh.points))
    if vertex_count == 0:
        raise ValueError('Il mesh non contiene vertici da trasformare.')

    points = np.empty((vertex_count, 3), dtype=np.float64)
    for i in range(vertex_count):
        pt = mesh.points.vec[i]
        points[i, 0] = float(pt.x)
        points[i, 1] = float(pt.y)
        points[i, 2] = float(pt.z)
    return points


def compute_itk_rigid_registration(
    source_points: np.ndarray,
    target_points: np.ndarray,
    max_points: int = 512,
    source_landmarks: np.ndarray = None,
    target_landmarks: np.ndarray = None,
) -> np.ndarray:
    """Compute a rigid 3D transform with SimpleITK using nearest-neighbor landmark matching."""
    try:
        import SimpleITK as sitk
    except Exception as exc:
        raise RuntimeError('SimpleITK non disponibile. Installa SimpleITK per usare l\'allineamento ITK.') from exc

    source_points = np.asarray(source_points, dtype=np.float64)
    target_points = np.asarray(target_points, dtype=np.float64)

    if source_points.ndim != 2 or source_points.shape[1] != 3:
        raise ValueError('I punti sorgente devono avere shape (N, 3).')
    if target_points.ndim != 2 or target_points.shape[1] != 3:
        raise ValueError('I punti target devono avere shape (N, 3).')
    if source_points.shape[0] < 3 or target_points.shape[0] < 3:
        raise ValueError('Servono almeno 3 punti per inizializzare la trasformazione rigida ITK.')

    if (source_landmarks is None) != (target_landmarks is None):
        raise ValueError('I landmark sorgente e target devono essere forniti insieme.')

    if source_landmarks is not None:
        source_landmarks = np.asarray(source_landmarks, dtype=np.float64)
        target_landmarks = np.asarray(target_landmarks, dtype=np.float64)
        if source_landmarks.ndim != 2 or source_landmarks.shape[1] != 3:
            raise ValueError('I landmark sorgente devono avere shape (N, 3).')
        if target_landmarks.ndim != 2 or target_landmarks.shape[1] != 3:
            raise ValueError('I landmark target devono avere shape (N, 3).')
        if source_landmarks.shape != target_landmarks.shape:
            raise ValueError('Il numero di landmark sorgente e target deve coincidere.')
        if source_landmarks.shape[0] < 3:
            raise ValueError('Servono almeno 3 coppie di landmark per l\'allineamento ITK.')
        if not np.isfinite(source_landmarks).all() or not np.isfinite(target_landmarks).all():
            raise ValueError('I landmark devono contenere solo valori numerici finiti.')
    else:
        try:
            import open3d as o3d
        except Exception as exc:
            raise RuntimeError('Open3D non disponibile per la registrazione automatica delle mesh.') from exc

        source_cloud = o3d.geometry.PointCloud()
        source_cloud.points = o3d.utility.Vector3dVector(source_points)
        target_cloud = o3d.geometry.PointCloud()
        target_cloud.points = o3d.utility.Vector3dVector(target_points)

        combined_extent = max(
            float(np.linalg.norm(np.ptp(source_points, axis=0))),
            float(np.linalg.norm(np.ptp(target_points, axis=0))),
        )
        if not np.isfinite(combined_extent) or combined_extent <= 0:
            raise ValueError('Impossibile determinare la scala delle mesh per l’allineamento automatico.')

        def prepare_global_features(cloud):
            downsampled = cloud.voxel_down_sample(voxel_size)
            if len(downsampled.points) < 3:
                raise ValueError('Le mesh non contengono abbastanza punti distinti per l’allineamento automatico.')
            downsampled.estimate_normals(
                o3d.geometry.KDTreeSearchParamHybrid(radius=voxel_size * 2.5, max_nn=40)
            )
            features = o3d.pipelines.registration.compute_fpfh_feature(
                downsampled,
                o3d.geometry.KDTreeSearchParamHybrid(radius=voxel_size * 5.0, max_nn=100),
            )
            return downsampled, features

        best_landmarks = None
        best_score = (-1.0, float('inf'))
        evaluation_distance = max(combined_extent * 0.02, 1e-6)

        for voxel_ratio in (0.02, 0.01, 0.005):
            voxel_size = max(combined_extent * voxel_ratio, 1e-6)
            source_down, source_features = prepare_global_features(source_cloud)
            target_down, target_features = prepare_global_features(target_cloud)
            correspondence_distance = voxel_size * 1.5
            registration = o3d.pipelines.registration.registration_ransac_based_on_feature_matching(
                source_down,
                target_down,
                source_features,
                target_features,
                True,
                correspondence_distance,
                o3d.pipelines.registration.TransformationEstimationPointToPoint(False),
                3,
                [
                    o3d.pipelines.registration.CorrespondenceCheckerBasedOnEdgeLength(0.9),
                    o3d.pipelines.registration.CorrespondenceCheckerBasedOnDistance(correspondence_distance),
                ],
                o3d.pipelines.registration.RANSACConvergenceCriteria(100000, 0.999),
            )
            correspondences = np.asarray(registration.correspondence_set, dtype=np.int64)
            if registration.fitness <= 0 or correspondences.shape[0] < 3:
                continue

            source_matches = np.asarray(source_down.points)[correspondences[:, 0]]
            target_matches = np.asarray(target_down.points)[correspondences[:, 1]]
            candidate_matrix = o3d.pipelines.registration.evaluate_registration(
                source_down,
                target_down,
                evaluation_distance,
                registration.transformation,
            )
            score = (float(candidate_matrix.fitness), float(candidate_matrix.inlier_rmse))
            if score[0] <= 0 or not np.isfinite(score[1]):
                continue
            if score[0] > best_score[0] or (score[0] == best_score[0] and score[1] < best_score[1]):
                best_landmarks = (source_matches, target_matches)
                best_score = score

        if best_landmarks is None:
            raise ValueError('La ricerca automatica delle corrispondenze non ha trovato un allineamento valido.')

        source_landmarks, target_landmarks = best_landmarks

    fixed_landmarks = source_landmarks.reshape(-1).tolist()
    moving_landmarks = target_landmarks.reshape(-1).tolist()
    transform = sitk.LandmarkBasedTransformInitializer(
        sitk.VersorRigid3DTransform(),
        fixed_landmarks,
        moving_landmarks,
    )

    matrix = np.eye(4, dtype=np.float64)
    matrix[:3, :3] = np.array(transform.GetMatrix(), dtype=np.float64).reshape(3, 3)
    center = np.array(transform.GetCenter(), dtype=np.float64)
    translation = np.array(transform.GetTranslation(), dtype=np.float64)
    matrix[:3, 3] = center - matrix[:3, :3] @ center + translation
    return matrix


def refine_itk_registration(
    source_points: np.ndarray,
    target_points: np.ndarray,
    initial_matrix: np.ndarray,
    max_distance: float,
    use_point_to_plane: bool = True,
):
    """Refine a registration with multi-scale point-to-point or point-to-plane ICP."""
    try:
        import open3d as o3d
    except Exception as exc:
        raise RuntimeError('Open3D non disponibile per il raffinamento ICP.') from exc

    source_cloud = o3d.geometry.PointCloud()
    source_cloud.points = o3d.utility.Vector3dVector(np.asarray(source_points, dtype=np.float64))
    target_cloud = o3d.geometry.PointCloud()
    target_cloud.points = o3d.utility.Vector3dVector(np.asarray(target_points, dtype=np.float64))

    source_cloud.transform(initial_matrix)
    target_array = np.asarray(target_points, dtype=np.float64)
    extent = float(np.linalg.norm(target_array.max(axis=0) - target_array.min(axis=0)))
    if not np.isfinite(extent) or extent <= 0:
        raise ValueError('Impossibile stimare la scala della mesh target per l\'ICP.')

    final_threshold = max(extent * 1e-5, min(float(max_distance), extent * 0.003))
    refinement_matrix = np.eye(4, dtype=np.float64)
    final_result = None
    voxel_ratios = (0.02, 0.01, 0.005, 0.002)
    distance_ratios = (0.08, 0.04, 0.015, 0.003)

    for voxel_ratio, distance_ratio in zip(voxel_ratios, distance_ratios):
        voxel_size = max(extent * voxel_ratio, extent * 1e-5)
        source_level = source_cloud.voxel_down_sample(voxel_size)
        target_level = target_cloud.voxel_down_sample(voxel_size)
        threshold = max(final_threshold, extent * distance_ratio)

        if len(source_level.points) < 3 or len(target_level.points) < 3:
            continue

        if use_point_to_plane and len(target_level.points) >= 30:
            target_level.estimate_normals(
                o3d.geometry.KDTreeSearchParamHybrid(radius=voxel_size * 3.0, max_nn=30)
            )
            estimation = o3d.pipelines.registration.TransformationEstimationPointToPlane()
        else:
            estimation = o3d.pipelines.registration.TransformationEstimationPointToPoint()

        final_result = o3d.pipelines.registration.registration_icp(
            source_level,
            target_level,
            threshold,
            refinement_matrix,
            estimation,
            o3d.pipelines.registration.ICPConvergenceCriteria(
                relative_fitness=1e-7,
                relative_rmse=1e-7,
                max_iteration=60,
            ),
        )
        if final_result.fitness > 0:
            refinement_matrix = final_result.transformation

    if final_result is None or final_result.fitness <= 0:
        raise ValueError('L\'ICP fine non ha trovato corrispondenze tra le mesh dopo l\'inizializzazione ITK.')

    return refinement_matrix @ initial_matrix, {
        'method': (
            'ITK + ICP point-to-plane'
            if use_point_to_plane and len(target_cloud.points) >= 30
            else 'ITK + ICP point-to-point'
        ),
        'rmse': float(final_result.inlier_rmse),
        'fitness': float(final_result.fitness),
        'refinementThreshold': float(max(final_threshold, extent * distance_ratios[-1])),
    }


def _create_icp(
    source: mr.Mesh,
    target: mr.Mesh,
    sampling_voxel_size: float = 0.05,
    method: mr.ICPMethod = mr.ICPMethod.PointToPoint,
    mode: mr.ICPMode = mr.ICPMode.AnyRigidXf,
    distance_threshold: float = 0.5,
    far_dist_factor: float = 2.0,
    mutual_closest: bool = True,
) -> mr.ICP:
    # Prefer using MeshOrPoints when available (handles meshes and point clouds).
    if hasattr(mr, 'MeshOrPoints'):
        source_pc = prepare_point_cloud(source, save_normals=True)
        target_pc = prepare_point_cloud(target, save_normals=True)
        flt = mr.MeshOrPoints(source_pc)
        ref = mr.MeshOrPoints(target_pc)
        try:
            flt.cacheAABBTree()
        except Exception:
            pass
        try:
            ref.cacheAABBTree()
        except Exception:
            pass

        flt_xf = mr.AffineXf3f()
        ref_xf = mr.AffineXf3f()
        icp = mr.ICP(flt, ref, flt_xf, ref_xf, sampling_voxel_size)
    else:
        # Fallback: pass Mesh objects directly to ICP (expected by some bindings)
        flt = source
        ref = target
        try:
            flt.cacheAABBTree()
        except Exception:
            pass
        try:
            ref.cacheAABBTree()
        except Exception:
            pass
        flt_xf = mr.AffineXf3f()
        ref_xf = mr.AffineXf3f()
        icp = mr.ICP(flt, ref, flt_xf, ref_xf, sampling_voxel_size)
    params = icp.getParams()
    params.method = method
    params.icpMode = mode
    params.distThresholdSq = distance_threshold ** 2
    params.farDistFactor = far_dist_factor
    params.mutualClosest = mutual_closest
    icp.setParams(params)
    print(f"[_create_icp] method={method}, mode={mode}, distThresholdSq={params.distThresholdSq}, farDistFactor={params.farDistFactor}, mutualClosest={params.mutualClosest}, sampling_voxel_size={sampling_voxel_size}")
    return icp


def _affine_transform_to_matrix(transform: mr.AffineXf3f) -> np.ndarray:
    matrix = np.eye(4, dtype=np.float32)
    A = transform.A
    matrix[:3, 0] = [A.x.x, A.y.x, A.z.x]
    matrix[:3, 1] = [A.x.y, A.y.y, A.z.y]
    matrix[:3, 2] = [A.x.z, A.y.z, A.z.z]
    b = transform.b
    matrix[:3, 3] = [b.x, b.y, b.z]
    return matrix


def _matrix_to_affine_transform(matrix: np.ndarray) -> mr.AffineXf3f:
    if matrix.shape != (4, 4):
        raise ValueError('La trasformazione deve essere una matrice 4x4.')
    mat = mr.Matrix3f()
    mat.x = mr.Vector3f(float(matrix[0, 0]), float(matrix[0, 1]), float(matrix[0, 2]))
    mat.y = mr.Vector3f(float(matrix[1, 0]), float(matrix[1, 1]), float(matrix[1, 2]))
    mat.z = mr.Vector3f(float(matrix[2, 0]), float(matrix[2, 1]), float(matrix[2, 2]))
    vec = mr.Vector3f(float(matrix[0, 3]), float(matrix[1, 3]), float(matrix[2, 3]))
    transform = mr.AffineXf3f()
    transform.A = mat
    transform.b = vec
    return transform


def save_mesh_or_point_cloud_to_ply(mesh: mr.Mesh, output_path: Path) -> None:
    """Save a mesh or a point cloud as PLY, with a fallback for meshes without faces."""
    if mesh.topology.numValidFaces() > 0:
        mr.saveMesh(mesh, str(output_path))
        return

    # Fallback: export vertices only as a simple ASCII PLY point cloud
    vertex_count = int(_points_count(mesh.points))
    if vertex_count == 0:
        raise ValueError('Il mesh non contiene vertici da esportare.')

    lines = [
        'ply',
        'format ascii 1.0',
        f'element vertex {vertex_count}',
        'property float x',
        'property float y',
        'property float z',
        'end_header',
    ]
    for i in range(vertex_count):
        pt = mesh.points.vec[i]
        lines.append(f'{float(pt.x)} {float(pt.y)} {float(pt.z)}')

    output_path.write_text('\n'.join(lines), encoding='utf-8')


def apply_icp_pre_alignment(source: mr.Mesh, target: mr.Mesh, source_copy: mr.Mesh = None, sampling_voxel_size: float = 0.05):
    """Pre-allineamento tra due mesh usando MeshLib ICP su point cloud estratte."""
    # Use Open3D-based ICP fallback to avoid native crashes in meshlib bindings.
    try:
        import open3d as o3d
    except Exception:
        raise RuntimeError('Open3D non disponibile per fallback ICP; installa open3d.')

    # Helper to get numpy array of points
    def _points_to_numpy(mesh_obj):
        try:
            import meshlib.mrmeshnumpy as mrn
            return mrn.toNumpyArray(mesh_obj.points)
        except Exception:
            # fallback: iterate over mesh.points.vec
            verts = []
            for i in range(_points_count(mesh_obj.points)):
                pt = mesh_obj.points.vec[i]
                verts.append([float(pt.x), float(pt.y), float(pt.z)])
            return np.array(verts, dtype=np.float64)

    src_pts = _points_to_numpy(source)
    tgt_pts = _points_to_numpy(target)

    pcd_src = o3d.geometry.PointCloud()
    pcd_tgt = o3d.geometry.PointCloud()
    pcd_src.points = o3d.utility.Vector3dVector(src_pts)
    pcd_tgt.points = o3d.utility.Vector3dVector(tgt_pts)

    if sampling_voxel_size > 0:
        pcd_src = pcd_src.voxel_down_sample(sampling_voxel_size)
        pcd_tgt = pcd_tgt.voxel_down_sample(sampling_voxel_size)

    # Estimate normals for point-to-plane if possible
    try:
        pcd_src.estimate_normals()
        pcd_tgt.estimate_normals()
    except Exception:
        pass

    threshold = max(0.01, sampling_voxel_size * 2.0)
    try:
        reg = o3d.pipelines.registration.registration_icp(
            pcd_src,
            pcd_tgt,
            threshold,
            np.eye(4),
            o3d.pipelines.registration.TransformationEstimationPointToPoint(),
        )
    except Exception as exc:
        raise RuntimeError(f'Errore esecuzione ICP Open3D: {exc}')

    transformation = reg.transformation
    rmse = float(reg.inlier_rmse) if hasattr(reg, 'inlier_rmse') else None

    # Apply transformation to source vertices and write temp PLY preserving faces
    vertex_count = _points_count(source.points)
    verts = []
    for i in range(vertex_count):
        pt = source.points.vec[i]
        verts.append([float(pt.x), float(pt.y), float(pt.z)])
    verts = np.array(verts, dtype=np.float64)
    # transform
    verts_h = np.hstack([verts, np.ones((verts.shape[0], 1), dtype=np.float64)])
    verts_t = (transformation @ verts_h.T).T[:, :3]

    # collect faces
    faces = []
    tri_vec = source.topology.getAllTriVerts()
    for i in range(len(tri_vec)):
        tri = tri_vec[i]
        faces.append([tri[0].get(), tri[1].get(), tri[2].get()])

    with NamedTemporaryFile(suffix='.ply', delete=False) as tmp:
        out_path = Path(tmp.name)
    # write PLY with faces
    lines = ['ply', 'format ascii 1.0', f'element vertex {len(verts_t)}', 'property float x', 'property float y', 'property float z', f'element face {len(faces)}', 'property list uchar int vertex_indices', 'end_header']
    for v in verts_t:
        lines.append(f'{v[0]} {v[1]} {v[2]}')
    for fidx in faces:
        lines.append(f'3 {fidx[0]} {fidx[1]} {fidx[2]}')
    out_path.write_text('\n'.join(lines), encoding='utf-8')

    # reload as mr.Mesh for compatibility
    try:
        transformed_mesh = mr.loadMesh(str(out_path))
    except Exception:
        # try loadMesh with settings
        try:
            transformed_mesh = mr.loadMesh(str(out_path), mr.MeshLoadSettings())
        except Exception as exc:
            raise RuntimeError(f'Impossibile ricaricare il PLY trasformato: {exc}')

    return transformed_mesh, transformation, rmse


def apply_icp(
    source: mr.Mesh,
    target: mr.Mesh,
    source_copy: mr.Mesh = None,
    max_distance: float = 0.02,
    method: mr.ICPMethod = mr.ICPMethod.PointToPoint,
    mode: mr.ICPMode = mr.ICPMode.AnyRigidXf,
):
    icp = _create_icp(
        source,
        target,
        sampling_voxel_size=max_distance * 5.0,
        method=method,
        mode=mode,
        distance_threshold=max_distance,
    )
    print(f"[apply_icp] selected icp method={method}, mode={mode}, max_distance={max_distance}")
    icp.updatePointPairs()

    num_active_pairs = None
    num_samples = None
    try:
        num_active_pairs = icp.getNumActivePairs()
        num_samples = icp.getNumSamples()
    except Exception as exc:
        print(f"[apply_icp] Warning reading ICP pair stats: {exc}")

    # If there are too few active pairs, try a pre-alignment once
    used_prealign = False
    prealign_rmse = None
    if (num_active_pairs is None) or (num_active_pairs < MIN_ACTIVE_PAIRS):
        print(f"[apply_icp] Warning: active pairs low ({num_active_pairs}), running ICP pre-alignment fallback before ICP")
        try:
            prealign_transformed, prealign_xf, prealign_rmse = apply_icp_pre_alignment(source, target)
            print(f"[apply_icp] ICP pre-alignment fallback completed - RMSE: {prealign_rmse}")
            used_prealign = True
            # Use the pre-aligned source for a second ICP attempt
            source_for_icp = prealign_transformed
            # Recreate ICP with the transformed source
            icp = _create_icp(
                source_for_icp,
                target,
                sampling_voxel_size=max_distance * 5.0,
                method=method,
                mode=mode,
                distance_threshold=max_distance,
            )
            icp.updatePointPairs()
            try:
                num_active_pairs = icp.getNumActivePairs()
                num_samples = icp.getNumSamples()
            except Exception:
                num_active_pairs = None
                num_samples = None
            print(f"[apply_icp] After ICP pre-alignment fallback active pairs={num_active_pairs}, samples={num_samples}")
            # proceed using the new icp instance; also replace source variable used later
            source = source_for_icp
        except Exception as exc:
            print(f"[apply_icp] ICP pre-alignment fallback failed: {exc}")

    transformation = icp.calculateTransformation()
    print(f"[apply_icp] calculateTransformation returned type: {type(transformation)}")
    print(f"[apply_icp] active pairs={num_active_pairs}, samples={num_samples}")

    if isinstance(transformation, (float, int)):
        for name in ('getXf', 'getXf3f', 'getTransformation', 'getFinalTransformation', 'getTransform', 'xf'):
            if hasattr(icp, name):
                try:
                    attr = getattr(icp, name)
                    candidate = attr() if callable(attr) else attr
                    print(f"[apply_icp] obtained candidate transform from icp.{name}: {type(candidate)}")
                    transformation = candidate
                    break
                except Exception as e:
                    print(f"[apply_icp] calling icp.{name} failed: {e}")
    if isinstance(transformation, (float, int)):
        raise ValueError('Impossibile ottenere la trasformazione ICP dall\'oggetto icp; tipo inatteso.')

    rmse = None
    p2pl = None
    transformation_matrix = None
    diagnostics = {
        'num_active_pairs_before': int(num_active_pairs) if num_active_pairs is not None else None,
        'num_samples_before': int(num_samples) if num_samples is not None else None,
        'used_prealign_fallback': used_prealign,
        'prealign_rmse': float(prealign_rmse) if prealign_rmse is not None else None,
        'num_active_pairs_after': None,
        'num_samples_after': None,
    }
    try:
        rmse = float(np.sqrt(icp.getMeanSqDistToPoint()))
        p2pl = float(np.sqrt(icp.getMeanSqDistToPlane()))
    except Exception as exc:
        print(f"[apply_icp] Warning reading ICP metrics: {exc}")

    try:
        transformation_matrix = _affine_transform_to_matrix(transformation)
        print(f"[apply_icp] transformation matrix:\n{transformation_matrix}")
    except Exception as exc:
        print(f"[apply_icp] Warning converting transform to matrix: {exc}")

    # Always operate on a copy of the source mesh so we return the moved source (not the target)
    try:
        transformed_source = mr.Mesh(source_copy) if source_copy is not None else mr.Mesh(source)
    except Exception:
        print('[apply_icp] Warning: unable to create copy of source mesh; transforming in-place')
        transformed_source = source

    print(f"[apply_icp] types -> source: {type(source)}, source_copy: {type(source_copy)}, transformed_source(before transform): {type(transformed_source)}")
    transformed_source.transform(transformation)
    if transformation_matrix is not None:
        print(f"[apply_icp] applied transformation matrix:\n{transformation_matrix}")
    print(f"[apply_icp] completed transform; rmse={rmse}, p2pl={p2pl}")
    # populate diagnostics with after-stats
    try:
        diagnostics['num_active_pairs_after'] = int(icp.getNumActivePairs())
    except Exception:
        diagnostics['num_active_pairs_after'] = None
    try:
        diagnostics['num_samples_after'] = int(icp.getNumSamples())
    except Exception:
        diagnostics['num_samples_after'] = None
    diagnostics['rmse'] = float(rmse) if rmse is not None else None
    diagnostics['p2pl'] = float(p2pl) if p2pl is not None else None
    if transformation_matrix is not None:
        diagnostics['transformation_matrix'] = transformation_matrix.tolist()

    return transformed_source, transformation, rmse, diagnostics


@app.post("/align-points")
async def align_points(
    source: UploadFile = File(...),
    target: UploadFile = File(...),
    source_points: str = Form(...),
    target_points: str = Form(...),
):
    source_filename = source.filename or "source_mesh"
    target_filename = target.filename or "target_mesh"
    print(f"[align_points] Ricevuta richiesta: source={source_filename}, target={target_filename}")
    
    source_data = await source.read()
    target_data = await target.read()
    print(f"[align_points] File letti: source={len(source_data)} bytes, target={len(target_data)} bytes")

    try:
        source_mesh = load_mesh_from_bytes(source_data, source_filename, allow_point_cloud=True)
        target_mesh = load_mesh_from_bytes(target_data, target_filename, allow_point_cloud=True)
        print(f"[align_points] Mesh caricate: source={_points_count(source_mesh.points)} vertices, target={_points_count(target_mesh.points)} vertices")
    except Exception as exc:
        print(f"[align_points] Errore caricamento mesh: {exc}")
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        source_points_arr = np.asarray(json.loads(source_points), dtype=float)
        target_points_arr = np.asarray(json.loads(target_points), dtype=float)
        print(f"[align_points] Punti parsati: source={source_points_arr.shape}, target={target_points_arr.shape}")
    except Exception as exc:
        print(f"[align_points] Errore parsing punti: {exc}")
        raise HTTPException(status_code=400, detail=f"Impossibile leggere i punti: {exc}")

    try:
        transformation = compute_rigid_transformation_from_points(source_points_arr, target_points_arr)
        print(f"[align_points] Trasformazione calcolata")
    except Exception as exc:
        print(f"[align_points] Errore trasformazione: {exc}")
        raise HTTPException(status_code=400, detail=str(exc))

    transformed_source = mr.Mesh(source_mesh)
    transform_xf = _matrix_to_affine_transform(transformation)
    transformed_source.transform(transform_xf)

    with NamedTemporaryFile(suffix=".ply", delete=False) as temp_output:
        output_path = Path(temp_output.name)
    save_mesh_or_point_cloud_to_ply(transformed_source, output_path)
    print(f"[align_points] File output scritto: {output_path}")

    return FileResponse(
        str(output_path),
        media_type="application/octet-stream",
        filename=f"aligned_{Path(source_filename).stem}_to_{Path(target_filename).stem}.ply",
    )


@app.post("/align-ransac")
async def align_ransac(
    source: UploadFile = File(...),
    target: UploadFile = File(...),
):
    """
    Pre-allineamento automatico tra due mesh usando MeshLib ICP su point cloud.
    Questo endpoint esegue un pre-allineamento ICP e non un vero algoritmo RANSAC/FPFH.
    """
    source_filename = source.filename or "source_mesh"
    target_filename = target.filename or "target_mesh"
    print(f"[align_ransac] Ricevuta richiesta: source={source_filename}, target={target_filename}")
    
    source_data = await source.read()
    target_data = await target.read()
    print(f"[align_ransac] File letti: source={len(source_data)} bytes, target={len(target_data)} bytes")

    try:
        source_mesh = load_mesh_from_bytes(source_data, source_filename)
        target_mesh = load_mesh_from_bytes(target_data, target_filename)
        print(f"[align_ransac] Mesh caricate: source={_points_count(source_mesh.points)} vertices, target={_points_count(target_mesh.points)} vertices")
    except Exception as exc:
        print(f"[align_ransac] Errore caricamento mesh: {exc}")
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        transformed_source, transformation, rmse = apply_icp_pre_alignment(source_mesh, target_mesh)
        print(f"[align_ransac] Pre-allineamento ICP completato - RMSE: {rmse}")
    except Exception as exc:
        print(f"[align_ransac] Errore pre-allineamento ICP: {exc}")
        print(traceback.format_exc())
        raise HTTPException(status_code=400, detail=str(exc))

    with NamedTemporaryFile(suffix=".ply", delete=False) as temp_output:
        output_path = Path(temp_output.name)
    mr.saveMesh(transformed_source, str(output_path))
    print(f"[align_ransac] File output scritto: {output_path}")

    return FileResponse(
        str(output_path),
        media_type="application/octet-stream",
        filename=f"icp_prealign_{Path(source_filename).stem}_to_{Path(target_filename).stem}.ply",
    )


def _apply_itk_alignment(
    source: mr.Mesh,
    target: mr.Mesh,
    source_copy: mr.Mesh = None,
    max_distance: float = 0.02,
    source_landmarks: np.ndarray = None,
    target_landmarks: np.ndarray = None,
    registration_model: str = 'rigid',
):
    source_points = _mesh_to_point_array(source)
    target_points = _mesh_to_point_array(target)
    if registration_model == 'affine':
        if source_landmarks is None or target_landmarks is None:
            raise ValueError('La trasformazione affine richiede punti corrispondenti selezionati sulle due mesh.')
        transformation_matrix = compute_affine_transformation_from_points(source_landmarks, target_landmarks)
        transformed_landmarks = source_landmarks @ transformation_matrix[:3, :3].T + transformation_matrix[:3, 3]
        landmark_rmse = float(np.sqrt(np.mean(np.sum((transformed_landmarks - target_landmarks) ** 2, axis=1))))
        refinement_diagnostics = {
            'method': 'Affine (punti corrispondenti)',
            'iterations': 0,
            'rmse': landmark_rmse,
            'fitness': 1.0,
        }
    else:
        if registration_model != 'rigid':
            raise ValueError('Modello di registrazione non supportato.')
        if source_landmarks is not None or target_landmarks is not None:
            if source_landmarks is None or target_landmarks is None:
                raise ValueError('I landmark sorgente e target devono essere forniti insieme.')
            # I punti selezionati danno solo la posizione iniziale; l'ICP point-to-plane
            # rifinisce poi l'allineamento sulle superfici (come nelle versioni precedenti)
            initial_matrix = compute_itk_rigid_registration(
                source_points,
                target_points,
                source_landmarks=source_landmarks,
                target_landmarks=target_landmarks,
            )
            transformation_matrix, refinement_diagnostics = refine_itk_registration(
                source_points,
                target_points,
                initial_matrix,
                max_distance,
                use_point_to_plane=True,
            )
        else:
            initial_matrix = compute_itk_rigid_registration(source_points, target_points)
            transformation_matrix, refinement_diagnostics = refine_itk_registration(
                source_points,
                target_points,
                initial_matrix,
                max_distance,
                use_point_to_plane=False,
            )
    transform_xf = _matrix_to_affine_transform(transformation_matrix)

    try:
        transformed_source = mr.Mesh(source_copy) if source_copy is not None else mr.Mesh(source)
    except Exception:
        transformed_source = source

    transformed_source.transform(transform_xf)
    diagnostics = {
        **refinement_diagnostics,
        'activePairs': int(len(source_landmarks)) if source_landmarks is not None else 0,
        'registrationMode': registration_model if registration_model == 'affine' else ('landmarks' if source_landmarks is not None else 'automatic'),
        'max_distance': float(max_distance),
        'transformation_matrix': transformation_matrix.tolist(),
    }
    return transformed_source, transform_xf, 0.0, diagnostics


@app.post("/align-itk")
async def align_itk(
    source: UploadFile = File(...),
    target: UploadFile = File(...),
    max_distance: float = Form(0.02),
    icp_method: str = Form('PointToPoint'),
    source_points: str = Form(''),
    target_points: str = Form(''),
    registration_model: str = Form('rigid'),
):
    source_filename = source.filename or "source_mesh"
    target_filename = target.filename or "target_mesh"
    source_data = await source.read()
    target_data = await target.read()
    print(f"[align_itk] Ricevuta richiesta: source={source_filename}, target={target_filename}, max_distance={max_distance}, icp_method={icp_method}")

    try:
        source_mesh = load_mesh_from_bytes(source_data, source_filename)
        target_mesh = load_mesh_from_bytes(target_data, target_filename)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        if bool(source_points) != bool(target_points):
            raise ValueError('I landmark sorgente e target devono essere forniti insieme.')
        source_landmarks = np.asarray(json.loads(source_points), dtype=np.float64) if source_points else None
        target_landmarks = np.asarray(json.loads(target_points), dtype=np.float64) if target_points else None
        aligned_mesh, transformation, rmse, diagnostics = _apply_itk_alignment(
            source_mesh,
            target_mesh,
            max_distance=max_distance,
            source_landmarks=source_landmarks,
            target_landmarks=target_landmarks,
            registration_model=registration_model,
        )
    except Exception as exc:
        print(f"[align_itk] Errore durante allineamento ITK: {exc}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Errore ITK: {exc}")

    with NamedTemporaryFile(suffix=".ply", delete=False) as temp_output:
        output_path = Path(temp_output.name)
    mr.saveMesh(aligned_mesh, str(output_path))

    diagnostics_out = {
        'source_filename': source_filename,
        'target_filename': target_filename,
        'max_distance': max_distance,
        'icp_method': icp_method,
        'diagnostics': diagnostics,
    }

    boundary = f"meshlib-{uuid.uuid4().hex}"
    part1_headers = (f"--{boundary}\r\n"
                     "Content-Type: application/json; charset=utf-8\r\n\r\n").encode('utf-8')
    json_bytes = json.dumps(diagnostics_out).encode('utf-8')
    part2_headers = (f"\r\n--{boundary}\r\n"
                     f"Content-Type: application/octet-stream\r\n"
                     f"Content-Disposition: attachment; filename=\"aligned_{Path(source_filename).stem}_to_{Path(target_filename).stem}.ply\"\r\n\r\n").encode('utf-8')
    closing = (f"\r\n--{boundary}--\r\n").encode('utf-8')
    ply_bytes = open(output_path, 'rb').read()
    body = part1_headers + json_bytes + part2_headers + ply_bytes + closing
    return Response(content=body, media_type=f"multipart/mixed; boundary={boundary}")


@app.get("/health")
async def health_check():
    return {"status": "ok", "message": "MeshLib server attivo"}


@app.post("/upload-mesh")
async def upload_mesh(file: UploadFile = File(...)):
    filename = file.filename or "mesh"
    data = await file.read()
    try:
        mesh = load_mesh_from_bytes(data, filename)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    metadata = mesh_metadata(mesh)
    return JSONResponse(content={"filename": filename, "metadata": metadata})


MIN_SIMPLIFIED_TRIANGLES = 4


def simplify_mesh_by_percent(mesh: mr.Mesh, reduction_percent: float) -> dict:
    """Riduce il numero di triangoli della percentuale indicata (0-100) con la decimazione di MeshLib.

    Collassa per primi gli spigoli che introducono meno errore; la riduzione si ferma solo al numero
    di triangoli richiesto, non a un errore massimo. Nei test il bordo di una scansione aperta resta
    al suo posto fino a riduzioni del 75% circa; oltre viene semplificato anch'esso.
    """
    if not np.isfinite(reduction_percent) or not 0 <= reduction_percent <= 100:
        raise ValueError('La riduzione deve essere una percentuale tra 0 e 100.')

    before = mesh_quality_stats(mesh)
    current_faces = mesh.topology.numValidFaces()
    target_faces = max(MIN_SIMPLIFIED_TRIANGLES, int(round(current_faces * (1 - reduction_percent / 100.0))))
    error_introduced = 0.0

    if target_faces < current_faces:
        settings = mr.DecimateSettings()
        settings.strategy = mr.DecimateStrategy.MinimizeError
        settings.maxDeletedFaces = current_faces - target_faces
        settings.maxError = float(np.finfo(np.float32).max)  # nessun limite di errore: decide la percentuale
        settings.optimizeVertexPos = True
        settings.packMesh = True
        if current_faces > 200000:
            settings.subdivideParts = 8  # elaborazione in parallelo per le mesh grandi
        result = mr.decimateMesh(mesh, settings)
        error_introduced = float(result.errorIntroduced)
        print(f"[simplify] facce eliminate={result.facesDeleted}, vertici eliminati={result.vertsDeleted}, errore={result.errorIntroduced}")

    after = mesh_quality_stats(mesh)
    return {
        'requestedPercent': float(reduction_percent),
        'targetTriangles': int(target_faces),
        'achievedPercent': float((1 - after['triangles'] / max(before['triangles'], 1)) * 100),
        'maxErrorIntroduced': error_introduced,
        'before': before,
        'after': after,
    }


@app.post("/simplify")
async def simplify_mesh(
    file: UploadFile = File(...),
    reduction_percent: float = Form(50.0),
):
    filename = file.filename or "mesh"
    data = await file.read()
    try:
        mesh = load_mesh_from_bytes(data, filename)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        stats = simplify_mesh_by_percent(mesh, reduction_percent)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        print(f"[simplify] Errore: {exc}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Errore semplificazione: {exc}")

    with NamedTemporaryFile(suffix=".ply", delete=False) as temp_output:
        output_path = Path(temp_output.name)
    try:
        mr.saveMesh(mesh, str(output_path))
        ply_bytes = output_path.read_bytes()
    finally:
        try:
            output_path.unlink()
        except Exception:
            pass

    return Response(
        content=ply_bytes,
        media_type="application/octet-stream",
        headers={"X-Mesh-Stats": json.dumps(stats)},
    )


def mesh_quality_stats(mesh: mr.Mesh) -> dict:
    """Statistiche sulla regolarità dei triangoli, usate per confrontare prima/dopo il remesh."""
    import meshlib.mrmeshnumpy as mrn

    verts = mrn.getNumpyVerts(mesh).astype(np.float64)
    faces = mrn.getNumpyFaces(mesh.topology)
    if len(faces) == 0:
        return {'triangles': 0}
    edges = np.sort(np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), axis=1)
    edges = np.unique(edges, axis=0)
    lengths = np.linalg.norm(verts[edges[:, 0]] - verts[edges[:, 1]], axis=1)
    a, b, c = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    longest = np.maximum(np.maximum(np.linalg.norm(b - a, axis=1), np.linalg.norm(c - b, axis=1)), np.linalg.norm(a - c, axis=1))
    double_area = np.linalg.norm(np.cross(b - a, c - a), axis=1)
    # lato più lungo / altezza minima: ~1.15 per un triangolo equilatero
    aspect = longest ** 2 / np.maximum(double_area, 1e-30)
    try:
        self_intersections = int(mr.localFindSelfIntersections(mesh).count())
    except Exception:
        self_intersections = None
    return {
        'triangles': int(len(faces)),
        'vertices': int(len(verts)),
        'edgeMean': float(lengths.mean()),
        'edgeMin': float(lengths.min()),
        'edgeMax': float(lengths.max()),
        'edgeVariation': float(lengths.std() / lengths.mean()) if lengths.mean() > 0 else 0.0,
        'elongatedPercent': float(np.mean(aspect > 4) * 100),
        'selfIntersectingFaces': self_intersections,
    }


def isotropic_remesh(mesh: mr.Mesh, target_edge_len: float = 0.0) -> dict:
    """Pulizia della geometria e remesh isotropico (triangoli quasi equilateri e di densità uniforme)."""
    before = mesh_quality_stats(mesh)

    # pulizia: fessure (vertici di bordo quasi coincidenti), spigoli multipli e auto-intersezioni
    diagonal = float(mesh.computeBoundingBox().diagonal())
    united = mr.uniteCloseVertices(mesh, max(diagonal, 1e-9) * 1e-6, True)
    if united:
        print(f"[remesh] Saldati {united} vertici di bordo quasi coincidenti")
    mr.fixMultipleEdges(mesh)
    # CutAndFill: rimuove la zona che si interseca e la richiude; nei test è molto più
    # efficace di Relax (che sposta i vertici) e non lascia buchi
    fix_settings = mr.FixSelfIntersectionSettings()
    fix_settings.method = mr.FixSelfIntersectionMethod.CutAndFill
    fix_settings.maxExpand = 6
    try:
        mr.localFixSelfIntersections(mesh, fix_settings)
    except Exception as exc:
        print(f"[remesh] Correzione auto-intersezioni (prima) non riuscita: {exc}")

    faces = mesh.topology.numValidFaces()
    if target_edge_len <= 0:
        # lato del triangolo equilatero con l'area media: stessa quantità di triangoli, ma uniformi
        target_edge_len = float(np.sqrt(mesh.area() / max(faces, 1) * 4.0 / np.sqrt(3.0)))
    if not np.isfinite(target_edge_len) or target_edge_len <= 0:
        raise ValueError('Impossibile determinare la lunghezza degli spigoli per il remesh.')

    settings = mr.RemeshSettings()
    settings.targetEdgeLen = target_edge_len
    settings.projectOnOriginalMesh = True  # i nuovi vertici restano sulla superficie originale
    settings.finalRelaxIters = 2
    settings.finalRelaxNoShrinkage = True
    settings.maxBdShift = target_edge_len * 0.5  # il bordo di una scansione aperta resta al suo posto
    settings.packMesh = True
    if not mr.remesh(mesh, settings):
        raise ValueError('Remesh interrotto.')

    try:
        mr.localFixSelfIntersections(mesh, fix_settings)
    except Exception as exc:
        print(f"[remesh] Correzione auto-intersezioni (dopo) non riuscita: {exc}")

    return {'targetEdgeLength': target_edge_len, 'before': before, 'after': mesh_quality_stats(mesh)}


def make_solid(mesh: mr.Mesh, voxel_size: float, offset: float, max_triangles: int) -> dict:
    """Crea solido (come "Make Solid" di Meshmixer): chiude le aperture della mesh, poi la
    ricostruisce come volume pieno su una griglia di voxel (superficie chiusa e senza
    auto-intersezioni). offset > 0 ingrandisce il solido, < 0 lo restringe (mm).
    """
    if not (0.02 <= voxel_size <= 2.0):
        raise ValueError('La precisione deve essere tra 0.02 e 2 mm.')
    before = mesh_quality_stats(mesh)
    params = mr.FillHoleParams()
    params.metric = mr.getUniversalMetric(mesh)
    holes = mesh.topology.findHoleRepresentiveEdges()
    for edge in holes:
        mr.fillHole(mesh, edge, params)

    offset_params = mr.OffsetParameters()
    offset_params.voxelSize = voxel_size
    offset_params.signDetectionMode = mr.SignDetectionMode.WindingRule
    solid = mr.offsetMesh(mr.MeshPart(mesh), offset, offset_params)
    if solid.topology.numValidFaces() == 0:
        raise ValueError("Solido vuoto: prova con una precisione piu' fine o un offset maggiore.")

    faces = solid.topology.numValidFaces()
    if max_triangles > 0 and faces > max_triangles:
        settings = mr.DecimateSettings()
        settings.strategy = mr.DecimateStrategy.MinimizeError
        settings.maxDeletedFaces = faces - max_triangles
        settings.maxError = float(np.finfo(np.float32).max)
        settings.optimizeVertexPos = True
        settings.packMesh = True
        settings.subdivideParts = 8
        mr.decimateMesh(solid, settings)
    return {
        'holesClosed': len(holes),
        'voxelSize': voxel_size,
        'offset': offset,
        'volumeMm3': float(solid.volume()),
        'before': before,
        'after': mesh_quality_stats(solid),
        'solid': solid,
    }


@app.post("/make-solid")
async def make_solid_endpoint(
    file: UploadFile = File(...),
    voxel_size: float = Form(0.2),
    offset: float = Form(0.0),
    max_triangles: int = Form(400000),
):
    filename = file.filename or "mesh.stl"
    data = await file.read()
    try:
        mesh = load_mesh_from_bytes(data, filename)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    try:
        stats = make_solid(mesh, voxel_size, offset, max_triangles)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Errore Crea solido: {exc}")
    solid = stats.pop('solid')
    print(f"[make-solid] {filename}: {stats['holesClosed']} aperture chiuse, volume {stats['volumeMm3']:.1f} mm3")

    with NamedTemporaryFile(suffix=".ply", delete=False) as temp_output:
        output_path = Path(temp_output.name)
    try:
        mr.saveMesh(solid, str(output_path))
        ply_bytes = output_path.read_bytes()
    finally:
        try:
            output_path.unlink()
        except Exception:
            pass
    return Response(
        content=ply_bytes,
        media_type="application/octet-stream",
        headers={"X-Mesh-Stats": json.dumps(stats)},
    )


def remesh_near_points(mesh: mr.Mesh, points: np.ndarray, reach: float, target_edge_len: float = 0.0) -> dict:
    """Remesh isotropico solo dei triangoli entro `reach` mm dai punti dati (es. i vertici dei bordi
    da raddrizzare): triangoli regolari lungo il bordo, il resto della mesh resta identico."""
    import meshlib.mrmeshnumpy as mrn
    import open3d as o3d

    if len(points) == 0:
        raise ValueError('Nessun punto del bordo ricevuto.')
    verts = mrn.getNumpyVerts(mesh).astype(np.float64)
    faces = mrn.getNumpyFaces(mesh.topology)
    # distanza di ogni vertice dal punto di bordo piu' vicino (Open3D, in un solo passaggio)
    vert_cloud = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(verts))
    border_cloud = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(points.astype(np.float64)))
    near = np.asarray(vert_cloud.compute_point_cloud_distance(border_cloud)) <= reach
    face_mask = near[faces].any(axis=1)
    if not face_mask.any():
        raise ValueError('Nessun triangolo vicino ai bordi scelti.')
    region_faces = faces[face_mask]
    if target_edge_len <= 0:
        a, b, c = verts[region_faces[:, 0]], verts[region_faces[:, 1]], verts[region_faces[:, 2]]
        area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1).mean()
        target_edge_len = float(np.sqrt(area * 4.0 / np.sqrt(3.0)))  # triangolo equilatero di area media
    region = mrn.faceBitSetFromBools(face_mask)

    settings = mr.RemeshSettings()
    settings.targetEdgeLen = target_edge_len
    settings.region = region
    settings.projectOnOriginalMesh = True
    settings.finalRelaxIters = 2
    settings.finalRelaxNoShrinkage = True
    settings.maxBdShift = target_edge_len * 0.5
    settings.packMesh = True
    if not mr.remesh(mesh, settings):
        raise ValueError('Remesh interrotto.')
    return {'regionTriangles': int(face_mask.sum()), 'targetEdgeLength': target_edge_len,
            'triangles': int(mesh.topology.numValidFaces())}


@app.post("/remesh-near-border")
async def remesh_near_border(
    file: UploadFile = File(...),
    points: str = Form(...),
    reach: float = Form(2.0),
    target_edge_len: float = Form(0.0),
):
    filename = file.filename or "mesh.stl"
    data = await file.read()
    try:
        mesh = load_mesh_from_bytes(data, filename)
        pts = np.asarray(json.loads(points), dtype=np.float64).reshape(-1, 3)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    try:
        stats = remesh_near_points(mesh, pts, float(reach), float(target_edge_len))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Errore remesh del bordo: {exc}")
    print(f"[remesh-bordo] {filename}: {stats}")
    with NamedTemporaryFile(suffix=".ply", delete=False) as temp_output:
        output_path = Path(temp_output.name)
    try:
        mr.saveMesh(mesh, str(output_path))
        ply_bytes = output_path.read_bytes()
    finally:
        try:
            output_path.unlink()
        except Exception:
            pass
    return Response(content=ply_bytes, media_type="application/octet-stream", headers={"X-Mesh-Stats": json.dumps(stats)})


@app.post("/remesh-isotropic")
async def remesh_isotropic(file: UploadFile = File(...), target_edge_len: float = Form(0.0)):
    filename = file.filename or "mesh.stl"
    data = await file.read()
    try:
        mesh = load_mesh_from_bytes(data, filename)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        stats = isotropic_remesh(mesh, target_edge_len)
        print(f"[remesh] {filename}: {stats}")
    except Exception as exc:
        print(f"[remesh] Errore: {exc}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Errore remesh: {exc}")

    with NamedTemporaryFile(suffix=".ply", delete=False) as temp_output:
        output_path = Path(temp_output.name)
    try:
        mr.saveMesh(mesh, str(output_path))
        ply_bytes = output_path.read_bytes()
    finally:
        try:
            output_path.unlink()
        except Exception:
            pass

    return Response(
        content=ply_bytes,
        media_type="application/octet-stream",
        headers={"X-Mesh-Stats": json.dumps(stats)},
    )


@app.post("/align-icp")
async def align_icp(
    source: UploadFile = File(...),
    target: UploadFile = File(...),
    max_distance: float = Form(0.02),
    icp_method: str = Form('PointToPoint'),
):
    source_filename = source.filename or "source_mesh"
    target_filename = target.filename or "target_mesh"
    source_data = await source.read()
    target_data = await target.read()
    print(f"[align_icp] Ricevuta richiesta: source={source_filename}, target={target_filename}, source_bytes={len(source_data)}, target_bytes={len(target_data)}, max_distance={max_distance}, icp_method={icp_method}")

    try:
        source_mesh = load_mesh_from_bytes(source_data, source_filename)
        target_mesh = load_mesh_from_bytes(target_data, target_filename)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        try:
            import SimpleITK as sitk  # noqa: F401
            aligned_mesh, transformation, rmse, diagnostics = _apply_itk_alignment(
                source_mesh,
                target_mesh,
                max_distance=max_distance,
            )
            print(f"[align_icp] ITK rigid registration completed: {diagnostics}")
        except Exception as exc:
            print(f"[align_icp] ITK registration failed, retrying MeshLib ICP fallback: {exc}")
            method = getattr(mr.ICPMethod, icp_method, mr.ICPMethod.PointToPoint)
            aligned_mesh, transformation, rmse, diagnostics = apply_icp(
                source_mesh,
                target_mesh,
                max_distance=max_distance,
                method=method,
            )
    except Exception as exc:
        print(f"[align_icp] Errore durante allineamento: {exc}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Errore allineamento: {exc}")

    with NamedTemporaryFile(suffix=".ply", delete=False) as temp_output:
        output_path = Path(temp_output.name)
    mr.saveMesh(aligned_mesh, str(output_path))
    print(f"[align_icp] File output scritto: {output_path}")

    try:
        ply_bytes = open(output_path, 'rb').read()
    except Exception as exc:
        print(f"[align_icp] Errore lettura file PLY per risposta: {exc}")
        raise HTTPException(status_code=500, detail=f"Errore lettura PLY: {exc}")

    diagnostics_out = {
        'source_filename': source_filename,
        'target_filename': target_filename,
        'max_distance': max_distance,
        'icp_method': icp_method,
        'diagnostics': diagnostics,
    }

    boundary = f"meshlib-{uuid.uuid4().hex}"
    part1_headers = (f"--{boundary}\r\n"
                     "Content-Type: application/json; charset=utf-8\r\n\r\n").encode('utf-8')
    json_bytes = json.dumps(diagnostics_out).encode('utf-8')
    part2_headers = (f"\r\n--{boundary}\r\n"
                     f"Content-Type: application/octet-stream\r\n"
                     f"Content-Disposition: attachment; filename=\"aligned_{Path(source_filename).stem}_to_{Path(target_filename).stem}.ply\"\r\n\r\n").encode('utf-8')
    closing = (f"\r\n--{boundary}--\r\n").encode('utf-8')

    body = part1_headers + json_bytes + part2_headers + ply_bytes + closing

    return Response(content=body, media_type=f"multipart/mixed; boundary={boundary}")


@app.post("/test-icp")
async def test_icp():
    """Endpoint di test che esegue ICP sui file di esempio presenti nella directory del server.
    Restituisce una risposta multipart con diagnostica JSON e il PLY risultante.
    """
    base = Path(__file__).parent
    source_path = base / "test_source.ply"
    target_path = base / "test_target.ply"

    if not source_path.exists() or not target_path.exists():
        raise HTTPException(status_code=404, detail="File di test non trovati sul server")

    try:
        source_data = source_path.read_bytes()
        target_data = target_path.read_bytes()
        source_mesh = load_mesh_from_bytes(source_data, source_path.name)
        target_mesh = load_mesh_from_bytes(target_data, target_path.name)
    except Exception as exc:
        print(f"[test_icp] Errore caricamento mesh di test: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))

    try:
        # Scegli una soglia basata sulla diagonale del target
        bbox = target_mesh.computeBoundingBox()
        diag = bbox.diagonal()
        max_distance = float(diag) * 0.01
        aligned_mesh, transformation, rmse, diagnostics = apply_icp(
            source_mesh,
            target_mesh,
            max_distance=max_distance,
            method=mr.ICPMethod.PointToPlane,
        )
    except Exception as exc:
        print(f"[test_icp] Errore apply_icp: {exc}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(exc))

    with NamedTemporaryFile(suffix=".ply", delete=False) as temp_output:
        output_path = Path(temp_output.name)
    mr.saveMesh(aligned_mesh, str(output_path))

    try:
        ply_bytes = open(output_path, 'rb').read()
    except Exception as exc:
        print(f"[test_icp] Errore lettura file PLY per risposta: {exc}")
        raise HTTPException(status_code=500, detail=f"Errore lettura PLY: {exc}")

    diagnostics_out = {
        'source_filename': str(source_path.name),
        'target_filename': str(target_path.name),
        'max_distance': max_distance,
        'icp_method': 'PointToPlane',
        'diagnostics': diagnostics,
    }

    boundary = f"meshlib-{uuid.uuid4().hex}"
    part1_headers = (f"--{boundary}\r\n"
                     "Content-Type: application/json; charset=utf-8\r\n\r\n").encode('utf-8')
    json_bytes = json.dumps(diagnostics_out).encode('utf-8')
    part2_headers = (f"\r\n--{boundary}\r\n"
                     f"Content-Type: application/octet-stream\r\n"
                     f"Content-Disposition: attachment; filename=\"test_icp_aligned.ply\"\r\n\r\n").encode('utf-8')
    closing = (f"\r\n--{boundary}--\r\n").encode('utf-8')

    body = part1_headers + json_bytes + part2_headers + ply_bytes + closing

    return Response(content=body, media_type=f"multipart/mixed; boundary={boundary}")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get('PORT', 8000))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
