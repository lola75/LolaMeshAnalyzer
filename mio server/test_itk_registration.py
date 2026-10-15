import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import server


def test_itk_registration_helper_returns_4x4_matrix():
    source_points = np.array([
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
    ], dtype=np.float64)
    target_points = np.array([
        [1.0, 0.0, 0.0],
        [1.0, 1.0, 0.0],
        [0.0, 0.0, 0.0],
    ], dtype=np.float64)

    matrix = server.compute_itk_rigid_registration(
        source_points,
        target_points,
        source_landmarks=source_points,
        target_landmarks=target_points,
    )

    assert matrix.shape == (4, 4)
    assert np.isfinite(matrix).all()
    assert np.allclose(matrix[:3, :3].T @ matrix[:3, :3], np.eye(3), atol=1e-5)


def test_itk_landmarks_transform_source_onto_target():
    source_landmarks = np.array([
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    ], dtype=np.float64)
    rotation = np.array([
        [0.0, -1.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0],
    ])
    translation = np.array([2.0, -1.0, 3.0])
    target_landmarks = source_landmarks @ rotation.T + translation

    matrix = server.compute_itk_rigid_registration(
        source_landmarks,
        target_landmarks,
        source_landmarks=source_landmarks,
        target_landmarks=target_landmarks,
    )
    transformed = source_landmarks @ matrix[:3, :3].T + matrix[:3, 3]

    assert np.allclose(transformed, target_landmarks, atol=1e-5)


def test_rigid_point_alignment_uses_landmarks_without_surface_refinement(monkeypatch):
    source_points = np.array([
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    ])
    rotation = np.array([
        [0.0, -1.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0],
    ])
    translation = np.array([2.0, -1.0, 3.0])
    target_points = source_points @ rotation.T + translation
    source_mesh = object()
    target_mesh = object()

    class FakeMesh:
        def __init__(self, _mesh):
            self.points = source_points.copy()

        def transform(self, matrix):
            self.points = self.points @ matrix[:3, :3].T + matrix[:3, 3]

    monkeypatch.setattr(
        server,
        '_mesh_to_point_array',
        lambda mesh: source_points if mesh is source_mesh else target_points,
    )
    monkeypatch.setattr(server.mr, 'Mesh', FakeMesh)
    monkeypatch.setattr(server, '_matrix_to_affine_transform', lambda matrix: matrix)
    monkeypatch.setattr(
        server,
        'refine_itk_registration',
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError('Manual landmark alignment must not run surface ICP.')
        ),
    )

    aligned_mesh, _, _, diagnostics = server._apply_itk_alignment(
        source_mesh,
        target_mesh,
        source_landmarks=source_points[:3],
        target_landmarks=target_points[:3],
        registration_model='rigid',
    )

    assert np.allclose(aligned_mesh.points, target_points, atol=1e-10)
    assert diagnostics['method'] == 'Rigid (punti corrispondenti)'
    assert diagnostics['rmse'] < 1e-10


def test_rigid_point_alignment_rejects_collinear_landmarks():
    collinear_points = np.array([
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [2.0, 0.0, 0.0],
    ])

    try:
        server.compute_rigid_transformation_from_points(collinear_points, collinear_points)
    except ValueError as error:
        assert 'collineari' in str(error)
    else:
        raise AssertionError('Rigid alignment must reject collinear landmarks.')


def test_meshlib_affine_transform_round_trips_numpy_matrix():
    matrix = np.eye(4, dtype=np.float64)
    matrix[:3, :3] = np.array([
        [0.0, -1.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0],
    ])
    matrix[:3, 3] = [2.0, -1.0, 3.0]

    transform = server._matrix_to_affine_transform(matrix)
    round_trip = server._affine_transform_to_matrix(transform)

    assert np.allclose(round_trip, matrix, atol=1e-6)


def test_affine_landmarks_recover_scale_shear_rotation_and_translation():
    source_landmarks = np.array([
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
        [1.0, 1.0, 1.0],
    ])
    expected = np.array([
        [1.2, 0.1, 0.0, 2.0],
        [0.0, 0.8, 0.2, -1.0],
        [0.1, 0.0, 1.1, 3.0],
        [0.0, 0.0, 0.0, 1.0],
    ])
    target_landmarks = source_landmarks @ expected[:3, :3].T + expected[:3, 3]

    matrix = server.compute_affine_transformation_from_points(source_landmarks, target_landmarks)
    transformed = source_landmarks @ matrix[:3, :3].T + matrix[:3, 3]

    assert np.allclose(matrix, expected, atol=1e-10)
    assert np.allclose(transformed, target_landmarks, atol=1e-10)


def test_affine_landmarks_reject_coplanar_points():
    coplanar_points = np.array([
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [1.0, 1.0, 0.0],
    ])

    try:
        server.compute_affine_transformation_from_points(coplanar_points, coplanar_points)
    except ValueError as error:
        assert 'non complanari' in str(error)
    else:
        raise AssertionError('Affine registration must reject coplanar landmarks.')


def test_fine_icp_refinement_reduces_landmark_initialization_error():
    rng = np.random.default_rng(7)
    source_points = rng.uniform(-1.0, 1.0, size=(24, 3))
    angle = 0.08
    rotation = np.array([
        [np.cos(angle), -np.sin(angle), 0.0],
        [np.sin(angle), np.cos(angle), 0.0],
        [0.0, 0.0, 1.0],
    ])
    translation = np.array([0.12, -0.08, 0.05])
    target_points = source_points @ rotation.T + translation

    source_landmarks = source_points[:6]
    target_landmarks = source_landmarks @ rotation.T + translation + np.array([0.025, -0.02, 0.015])
    initial_matrix = server.compute_itk_rigid_registration(
        source_points,
        target_points,
        source_landmarks=source_landmarks,
        target_landmarks=target_landmarks,
    )
    initial = source_points @ initial_matrix[:3, :3].T + initial_matrix[:3, 3]
    refined_matrix, diagnostics = server.refine_itk_registration(
        source_points,
        target_points,
        initial_matrix,
        max_distance=0.15,
    )
    refined = source_points @ refined_matrix[:3, :3].T + refined_matrix[:3, 3]
    initial_error = np.mean(np.linalg.norm(initial - target_points, axis=1))
    refined_error = np.mean(np.linalg.norm(refined - target_points, axis=1))

    assert refined_error < initial_error
    assert diagnostics['rmse'] < initial_error


def test_automatic_itk_registration_handles_rotated_mesh_points():
    import open3d as o3d

    o3d.utility.random.seed(7)
    mesh = o3d.geometry.TriangleMesh.create_torus(
        torus_radius=1.0,
        tube_radius=0.35,
        radial_resolution=48,
        tubular_resolution=24,
    )
    mesh += o3d.geometry.TriangleMesh.create_box(width=0.4, height=0.8, depth=0.6).translate(
        (0.8, 0.1, 0.2)
    )
    source_cloud = mesh.sample_points_poisson_disk(1500, init_factor=5)
    source_points = np.asarray(source_cloud.points)

    expected = np.eye(4)
    expected[:3, :3] = o3d.geometry.get_rotation_matrix_from_xyz((0.3, -0.2, 0.65))
    expected[:3, 3] = [0.4, -0.2, 0.3]
    target_points = source_points @ expected[:3, :3].T + expected[:3, 3]

    initial = server.compute_itk_rigid_registration(source_points, target_points)
    refined, diagnostics = server.refine_itk_registration(
        source_points,
        target_points,
        initial,
        max_distance=0.1,
        use_point_to_plane=False,
    )
    aligned_points = source_points @ refined[:3, :3].T + refined[:3, 3]
    point_rmse = np.sqrt(np.mean(np.sum((aligned_points - target_points) ** 2, axis=1)))

    assert point_rmse < 1e-5
    assert diagnostics['fitness'] == 1.0
    assert diagnostics['method'] == 'ITK + ICP point-to-point'


def test_automatic_registration_refines_with_point_to_point_icp():
    rng = np.random.default_rng(11)
    source_points = rng.uniform(-1.0, 1.0, size=(100, 3))
    initial_matrix = np.eye(4)

    _, diagnostics = server.refine_itk_registration(
        source_points,
        source_points.copy(),
        initial_matrix,
        max_distance=0.1,
        use_point_to_plane=False,
    )

    assert diagnostics['method'] == 'ITK + ICP point-to-point'
