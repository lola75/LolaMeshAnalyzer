import requests
from pathlib import Path

base = Path(__file__).parent
src = base / 'test_source.ply'
tgt = base / 'test_target.ply'
out = base / 'test_align_ransac_response.bin'
url = 'http://127.0.0.1:8000/align-ransac'

print('Posting', src, tgt, 'to', url)
with open(src, 'rb') as f1, open(tgt, 'rb') as f2:
    files = {'source': (src.name, f1, 'application/octet-stream'), 'target': (tgt.name, f2, 'application/octet-stream')}
    r = requests.post(url, files=files)
    print('Status:', r.status_code)
    print('Content-Type:', r.headers.get('Content-Type'))
    with open(out, 'wb') as fo:
        fo.write(r.content)
    print('Saved response to', out)
