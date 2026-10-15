from pathlib import Path
import server
base = Path(__file__).parent
src = base / 'test_source.ply'
with open(src,'rb') as f:
    data = f.read()
mesh = server.load_mesh_from_bytes(data, src.name)
print('mesh type', type(mesh))
print('points attr dir:', [n for n in dir(mesh.points) if not n.startswith('_')])
print('topology dir:', [n for n in dir(mesh.topology) if not n.startswith('_')])
# try to access triangles
for name in ('getTriangles','triangles','getFaces','faces','faceList'):
    if hasattr(mesh.topology, name):
        print('found', name, '=>', getattr(mesh.topology,name))

# try iterating known methods
try:
    print('numValidFaces()', mesh.topology.numValidFaces())
except Exception as e:
    print('numValidFaces error', e)

try:
    print('first face via mesh.topology.face(0):', getattr(mesh.topology,'face',None))
except Exception as e:
    print('face access error', e)

print('done')
