from pathlib import Path
import server
base=Path(__file__).parent
src=base/'test_source.ply'
with open(src,'rb') as f:
    mesh=server.load_mesh_from_bytes(f.read(), src.name)
print('num faces', mesh.topology.numValidFaces())
print('points count', server._points_count(mesh.points))
tri = mesh.topology.getAllTriVerts()
print('getAllTriVerts type', type(tri))
try:
    print('len(tri)=', len(tri))
    print('first tri element type', type(tri[0]))
    print('first tri element repr', tri[0])
except Exception as e:
    print('error iter tri', e)
