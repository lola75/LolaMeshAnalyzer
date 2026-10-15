import requests, json
url='http://127.0.0.1:8000/align-icp'
files={'source':('test_source.ply', open('test_source.ply','rb'),'application/octet-stream'), 'target':('test_target.ply', open('test_target.ply','rb'),'application/octet-stream')}
data={'max_distance':'0.02','icp_method':'PointToPoint'}
print('Invio richiesta a', url)
r=requests.post(url, files=files, data=data, timeout=120)
print('Status', r.status_code)
ct=r.headers.get('content-type','')
print('Content-Type:', ct)
if r.status_code!=200:
    print('Body:', r.text[:1000])
    raise SystemExit(1)
# parse multipart
if 'boundary=' in ct:
    boundary = ct.split('boundary=')[-1]
else:
    raise SystemExit('No boundary in content-type')
bound = boundary.encode('utf-8')
body = r.content
# find JSON start (first '{') and start of second boundary
json_start = body.find(b'{')
second_boundary_marker = b'\r\n--' + bound
json_end = body.find(second_boundary_marker)
if json_start==-1 or json_end==-1:
    raise SystemExit('Unable to locate JSON part')
json_bytes = body[json_start:json_end]
diagnostics = json.loads(json_bytes.decode('utf-8'))
# find ply start: after the second boundary marker + headers and blank line
ply_header_index = body.find(b'\r\n\r\n', json_end)
if ply_header_index==-1:
    raise SystemExit('Unable to locate PLY start')
ply_start = ply_header_index + 4
# closing boundary
closing = b'\r\n--' + bound + b'--\r\n'
ply_end = body.rfind(closing)
if ply_end==-1:
    # fallback: take rest
    ply_end = len(body)
ply_bytes = body[ply_start:ply_end]
# save outputs
with open('test_icp_diagnostics.json','wb') as f:
    f.write(json.dumps(diagnostics, indent=2).encode('utf-8'))
with open('test_icp_out.ply','wb') as f:
    f.write(ply_bytes)
print('Saved test_icp_diagnostics.json (len', len(json_bytes), ')')
print('Saved test_icp_out.ply (len', len(ply_bytes), ')')
print('Diagnostics:', diagnostics)
