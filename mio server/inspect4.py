from pathlib import Path
import server
base=Path(__file__).parent
src=base/'test_source.ply'
with open(src,'rb') as f:
    mesh=server.load_mesh_from_bytes(f.read(), src.name)
tri = mesh.topology.getAllTriVerts()
first = tri[0]
v0 = first[0]
print('type v0', type(v0))
print('dir v0', [n for n in dir(v0) if not n.startswith('_')])
# try int or value
for method in ('value','id','toInt'):
    if hasattr(v0, method):
        try:
            print(method, getattr(v0, method))
        except Exception as e:
            print('method',method,'error',e)
try:
    print('int(v0)=', int(v0))
except Exception as e:
    print('int(v0) error', e)
try:
    print('repr', repr(v0))
except Exception as e:
    print('repr error', e)
