import open3d as o3d
from pathlib import Path

in_path = Path('test_align_ransac_response.bin')
temp_ply = Path('test_align_ransac_response_temp.ply')
out_path = Path('test_align_ransac_response_ascii.ply')

if not in_path.exists():
    print('Input file not found:', in_path)
    raise SystemExit(1)

# Read binary PLY produced by server and write ASCII PLY
# Ensure file has .ply extension for Open3D to auto-detect format
temp_ply.write_bytes(in_path.read_bytes())
mesh = o3d.io.read_triangle_mesh(str(temp_ply))
if mesh.is_empty():
    # Try reading as point cloud
    pcd = o3d.io.read_point_cloud(str(in_path))
    if pcd.is_empty():
        print('Open3D could not read mesh or point cloud from file')
        raise SystemExit(2)
    # convert point cloud to triangle mesh with no faces
    o3d.io.write_point_cloud(str(out_path), pcd, write_ascii=True)
    print('Wrote ASCII point cloud to', out_path)
else:
    o3d.io.write_triangle_mesh(str(out_path), mesh, write_ascii=True)
    print('Wrote ASCII triangle mesh to', out_path)
