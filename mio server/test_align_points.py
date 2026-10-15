import json
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

import server


def create_test_ply(points):
    ply = [
        'ply',
        'format ascii 1.0',
        f'element vertex {len(points)}',
        'property float x',
        'property float y',
        'property float z',
        'element face 0',
        'property list uchar int vertex_indices',
        'end_header',
    ]
    for x, y, z in points:
        ply.append(f'{x} {y} {z}')
    return '\n'.join(ply).encode('utf-8')


def print_matrix(matrix):
    print('\n'.join([' '.join(f'{v: .6f}' for v in row) for row in matrix]))


def run_direct_point_alignment():
    source_points = np.array([
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
    ], dtype=float)

    target_points = np.array([
        [1.0, 1.0, 1.0],
        [2.0, 1.0, 1.0],
        [1.0, 2.0, 1.0],
    ], dtype=float)

    print('=== Direct point alignment test ===')
    matrix = server.compute_rigid_transformation_from_points(source_points, target_points)
    print('Transformation matrix:')
    print_matrix(matrix)

    transform_xf = server._matrix_to_affine_transform(matrix)
    print('Affine transform A:', transform_xf.A)
    print('Affine transform b:', transform_xf.b)

    return source_points, target_points, matrix


def run_align_points_endpoint_test():
    source_mesh_points = [
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
    ]
    target_mesh_points = [
        [10.0, 10.0, 10.0],
        [11.0, 10.0, 10.0],
        [10.0, 11.0, 10.0],
    ]
    source_points = [
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
    ]
    target_points = [
        [10.0, 10.0, 10.0],
        [11.0, 10.0, 10.0],
        [10.0, 11.0, 10.0],
    ]

    source_ply = create_test_ply(source_mesh_points)
    target_ply = create_test_ply(target_mesh_points)

    print('\n=== align-points endpoint test ===')
    client = TestClient(server.app)
    response = client.post(
        '/align-points',
        files={
            'source': ('source.ply', source_ply, 'application/octet-stream'),
            'target': ('target.ply', target_ply, 'application/octet-stream'),
        },
        data={
            'source_points': json.dumps(source_points),
            'target_points': json.dumps(target_points),
        },
    )

    print('Response status code:', response.status_code)
    if response.status_code != 200:
        print('Response detail:', response.text)
        return

    output_path = Path('aligned_points_test.ply')
    output_path.write_bytes(response.content)
    print(f'Aligned mesh written to: {output_path.resolve()}')
    print('Aligned mesh size:', len(response.content), 'bytes')

    try:
        aligned_mesh = server.load_mesh_from_bytes(response.content, 'aligned_points_test.ply', allow_point_cloud=True)
        bbox = aligned_mesh.computeBoundingBox()
        bbox_min = bbox.min if not callable(getattr(bbox, 'min', None)) else bbox.min()
        bbox_max = bbox.max if not callable(getattr(bbox, 'max', None)) else bbox.max()
        print('Aligned mesh bbox min:', bbox_min, 'max:', bbox_max)
        print('Aligned mesh vertices:', aligned_mesh.points.size(), 'faces:', aligned_mesh.topology.numValidFaces())
    except Exception as exc:
        print('Could not parse aligned mesh from endpoint:', exc)


if __name__ == '__main__':
    run_direct_point_alignment()
    run_align_points_endpoint_test()
