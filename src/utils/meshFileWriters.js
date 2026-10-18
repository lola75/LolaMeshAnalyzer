// Scrittura di mesh (vertici pts [x,y,z,...] e triangoli tris [a,b,c,...]) in STL binario,
// OBJ e PLY binario. Le coordinate sono scritte cosi' come sono (mm).

export const MESH_EXPORT_FORMATS = [
  { id: 'stl', label: 'STL', extension: 'stl' },
  { id: 'obj', label: 'OBJ', extension: 'obj' },
  { id: 'ply', label: 'PLY', extension: 'ply' },
]

export function meshToBinarySTL(pts, tris, name = 'mesh') {
  const count = Math.floor(tris.length / 3)
  const buffer = new ArrayBuffer(84 + count * 50)
  const view = new DataView(buffer)
  const header = `LolaMesh CBCT ${name}`.slice(0, 80)
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i) & 0x7f)
  view.setUint32(80, count, true)
  let offset = 84
  for (let t = 0; t < count; t++) {
    const a = tris[t * 3] * 3
    const b = tris[t * 3 + 1] * 3
    const c = tris[t * 3 + 2] * 3
    const ux = pts[b] - pts[a]
    const uy = pts[b + 1] - pts[a + 1]
    const uz = pts[b + 2] - pts[a + 2]
    const vx = pts[c] - pts[a]
    const vy = pts[c + 1] - pts[a + 1]
    const vz = pts[c + 2] - pts[a + 2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const length = Math.hypot(nx, ny, nz) || 1
    nx /= length
    ny /= length
    nz /= length
    for (const value of [nx, ny, nz]) {
      view.setFloat32(offset, value, true)
      offset += 4
    }
    for (const v of [a, b, c]) {
      view.setFloat32(offset, pts[v], true)
      view.setFloat32(offset + 4, pts[v + 1], true)
      view.setFloat32(offset + 8, pts[v + 2], true)
      offset += 12
    }
    offset += 2 // attribute byte count
  }
  return new Uint8Array(buffer)
}

export function meshToOBJ(pts, tris, name = 'mesh') {
  const lines = [`# LolaMesh CBCT`, `o ${String(name).replace(/\s+/g, '_') || 'mesh'}`]
  for (let i = 0; i < pts.length; i += 3) {
    lines.push(`v ${pts[i].toFixed(6)} ${pts[i + 1].toFixed(6)} ${pts[i + 2].toFixed(6)}`)
  }
  for (let i = 0; i < tris.length; i += 3) {
    lines.push(`f ${tris[i] + 1} ${tris[i + 1] + 1} ${tris[i + 2] + 1}`)
  }
  lines.push('')
  return lines.join('\n')
}

export function meshToBinaryPLY(pts, tris) {
  const vertexCount = Math.floor(pts.length / 3)
  const faceCount = Math.floor(tris.length / 3)
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    'comment LolaMesh CBCT',
    `element vertex ${vertexCount}`,
    'property float x',
    'property float y',
    'property float z',
    `element face ${faceCount}`,
    'property list uchar int vertex_indices',
    'end_header',
    '',
  ].join('\n')
  const headerBytes = new TextEncoder().encode(header)
  const buffer = new ArrayBuffer(headerBytes.length + vertexCount * 12 + faceCount * 13)
  new Uint8Array(buffer).set(headerBytes)
  const view = new DataView(buffer)
  let offset = headerBytes.length
  for (let i = 0; i < vertexCount * 3; i++) {
    view.setFloat32(offset, pts[i], true)
    offset += 4
  }
  for (let t = 0; t < faceCount; t++) {
    view.setUint8(offset, 3)
    offset += 1
    for (let k = 0; k < 3; k++) {
      view.setInt32(offset, tris[t * 3 + k], true)
      offset += 4
    }
  }
  return new Uint8Array(buffer)
}

export function meshToFile(pts, tris, format, name) {
  if (format === 'obj') return meshToOBJ(pts, tris, name)
  if (format === 'ply') return meshToBinaryPLY(pts, tris)
  return meshToBinarySTL(pts, tris, name)
}
