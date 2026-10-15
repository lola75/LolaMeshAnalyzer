from pathlib import Path
import traceback
import faulthandler

faulthandler.enable(all_threads=True)

import server

base = Path(__file__).parent
src = base / 'test_source.ply'
tgt = base / 'test_target.ply'

print('Loading meshes...')
with open(src, 'rb') as f:
    data_s = f.read()
with open(tgt, 'rb') as f:
    data_t = f.read()

try:
    s_mesh = server.load_mesh_from_bytes(data_s, src.name)
    t_mesh = server.load_mesh_from_bytes(data_t, tgt.name)
    print('Loaded meshes: verts', server._points_count(s_mesh.points), server._points_count(t_mesh.points))
except Exception as e:
    print('Load failed:', e)
    traceback.print_exc()
    raise

try:
    print('Running apply_icp_pre_alignment (Open3D fallback)')
    transformed_mesh, transformation, rmse = server.apply_icp_pre_alignment(s_mesh, t_mesh)
    print('apply_icp_pre_alignment returned:', type(transformed_mesh), 'rmse=', rmse)
except Exception as e:
    print('apply_icp_pre_alignment failed:', e)
    traceback.print_exc()
    raise

print('Done')
