from pathlib import Path
import server
base=Path(__file__).parent
src=base/'test_source.ply'
with open(src,'rb') as f:
    mesh=server.load_mesh_from_bytes(f.read(), src.name)
tri = mesh.topology.getAllTriVerts()
first = tri[0]
print('indices:', [v.get() for v in first])
