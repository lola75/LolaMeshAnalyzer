from pathlib import Path
import server
base=Path(__file__).parent
src=base/'test_source.ply'
with open(src,'rb') as f:
    mesh=server.load_mesh_from_bytes(f.read(), src.name)
tri = mesh.topology.getAllTriVerts()
first = tri[0]
print('dir(first)=', [n for n in dir(first) if not n.startswith('_')])
for attr in ('v0','v1','v2','a','b','c','x','y','z','get','i'):
    if hasattr(first, attr):
        try:
            print(attr, getattr(first, attr))
        except Exception as e:
            print('attr',attr,'error',e)
print('as tuple?')
try:
    print(tuple(first))
except Exception as e:
    print('tuple failed', e)
