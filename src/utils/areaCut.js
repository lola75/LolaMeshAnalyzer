import { buildGeometry } from './meshEditing'

// Taglia con Area: l'utente clicca dei punti sulla vista e forma un poligono.
// Il poligono sta su un piano perpendicolare alla direzione della vista e il
// taglio lo proietta in profondità a partire dall'occhio della telecamera.
//
// `area` (coordinate originali della mesh):
//   eye     posizione della telecamera
//   dir     direzione della vista (unitaria)
//   origin  punto del piano del poligono
//   u, v    assi del piano (unitari)
//   polygon punti del poligono [[a, b], ...] nelle coordinate del piano

const EDGE_KEY_BASE = 67108864
const FRONT_GRID_CELLS = 512

// Allarga (distance > 0) o restringe il poligono di `distance` lungo le normali dei lati
export function offsetPolygon(points, distance) {
  const n = points.length
  if (!distance || n < 3) return points
  let area2 = 0
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[(i + 1) % n]
    area2 += x0 * y1 - x1 * y0
  }
  const sign = area2 >= 0 ? 1 : -1
  const edgeNormal = (a, b) => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const length = Math.hypot(dx, dy)
    return length < 1e-12 ? [0, 0] : [(sign * dy) / length, (-sign * dx) / length]
  }
  return points.map((p, i) => {
    const n1 = edgeNormal(points[(i - 1 + n) % n], p)
    const n2 = edgeNormal(p, points[(i + 1) % n])
    let mx = n1[0] + n2[0]
    let my = n1[1] + n2[1]
    const length = Math.hypot(mx, my)
    if (length < 1e-9) return [p[0] + n1[0] * distance, p[1] + n1[1] * distance]
    mx /= length
    my /= length
    // spigoli acuti: lo spostamento è limitato a 4 volte la distanza
    const cos = Math.max(mx * n1[0] + my * n1[1], 0.25)
    return [p[0] + (mx * distance) / cos, p[1] + (my * distance) / cos]
  })
}

function pointInPolygon(x, y, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function polygonBounds(polygon) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [a, b] of polygon) {
    if (a < bounds[0]) bounds[0] = a
    if (b < bounds[1]) bounds[1] = b
    if (a > bounds[2]) bounds[2] = a
    if (b > bounds[3]) bounds[3] = b
  }
  return bounds
}

// Proiezione dall'occhio sul piano del poligono: restituisce [a, b, w] con w = profondità lungo la vista
function makeProjector(area) {
  const { eye, dir, origin, u, v } = area
  const h = (origin[0] - eye[0]) * dir[0] + (origin[1] - eye[1]) * dir[1] + (origin[2] - eye[2]) * dir[2]
  return (x, y, z, out) => {
    const dx = x - eye[0]
    const dy = y - eye[1]
    const dz = z - eye[2]
    const w = dx * dir[0] + dy * dir[1] + dz * dir[2]
    out[2] = w
    if (w <= 1e-9) {
      out[0] = NaN
      out[1] = NaN
      return out
    }
    const k = h / w
    const qx = eye[0] + dx * k - origin[0]
    const qy = eye[1] + dy * k - origin[1]
    const qz = eye[2] + dz * k - origin[2]
    out[0] = qx * u[0] + qy * u[1] + qz * u[2]
    out[1] = qx * v[0] + qy * v[1] + qz * v[2]
    return out
  }
}

// Vertici proiettati, in array che possono crescere quando il taglio aggiunge vertici
function projectVertices(positions, project) {
  const count = positions.length / 3
  const pa = new Array(count)
  const pb = new Array(count)
  const pw = new Array(count)
  const out = [0, 0, 0]
  for (let i = 0; i < count; i++) {
    project(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], out)
    pa[i] = out[0]
    pb[i] = out[1]
    pw[i] = out[2]
  }
  return { pa, pb, pw }
}

// Profondità della prima superficie vista dall'occhio, su una griglia nel piano del
// poligono: serve a misurare la profondità di fresatura dalla superficie.
function buildFrontGrid(indices, proj) {
  const { pa, pb, pw } = proj
  let minA = Infinity
  let minB = Infinity
  let maxA = -Infinity
  let maxB = -Infinity
  for (let i = 0; i < pa.length; i++) {
    if (!(pw[i] > 0)) continue
    if (pa[i] < minA) minA = pa[i]
    if (pb[i] < minB) minB = pb[i]
    if (pa[i] > maxA) maxA = pa[i]
    if (pb[i] > maxB) maxB = pb[i]
  }
  if (!Number.isFinite(minA)) return () => Infinity
  const size = Math.max(maxA - minA, maxB - minB, 1e-9) / FRONT_GRID_CELLS
  const nx = Math.ceil((maxA - minA) / size) + 1
  const ny = Math.ceil((maxB - minB) / size) + 1
  const depth = new Float32Array(nx * ny).fill(Infinity)
  const cellX = (a) => Math.min(nx - 1, Math.max(0, Math.floor((a - minA) / size)))
  const cellY = (b) => Math.min(ny - 1, Math.max(0, Math.floor((b - minB) / size)))
  const write = (cell, w) => {
    if (w < depth[cell]) depth[cell] = w
  }

  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t]
    const i1 = indices[t + 1]
    const i2 = indices[t + 2]
    const w0 = pw[i0]
    const w1 = pw[i1]
    const w2 = pw[i2]
    if (!(w0 > 0 && w1 > 0 && w2 > 0)) continue
    const a0 = pa[i0], b0 = pb[i0]
    const a1 = pa[i1], b1 = pb[i1]
    const a2 = pa[i2], b2 = pb[i2]
    write(cellX(a0) + cellY(b0) * nx, w0)
    write(cellX(a1) + cellY(b1) * nx, w1)
    write(cellX(a2) + cellY(b2) * nx, w2)
    const x0 = cellX(Math.min(a0, a1, a2))
    const x1 = cellX(Math.max(a0, a1, a2))
    const y0 = cellY(Math.min(b0, b1, b2))
    const y1 = cellY(Math.max(b0, b1, b2))
    if (x0 === x1 && y0 === y1) continue
    const det = (b1 - b2) * (a0 - a2) + (a2 - a1) * (b0 - b2)
    if (Math.abs(det) < 1e-18) continue
    for (let y = y0; y <= y1; y++) {
      const cb = minB + (y + 0.5) * size
      for (let x = x0; x <= x1; x++) {
        const ca = minA + (x + 0.5) * size
        const l0 = ((b1 - b2) * (ca - a2) + (a2 - a1) * (cb - b2)) / det
        const l1 = ((b2 - b0) * (ca - a2) + (a0 - a2) * (cb - b2)) / det
        const l2 = 1 - l0 - l1
        if (l0 < 0 || l1 < 0 || l2 < 0) continue
        write(x + y * nx, l0 * w0 + l1 * w1 + l2 * w2)
      }
    }
  }
  return (a, b) => {
    if (!(a >= minA && a <= maxA && b >= minB && b <= maxB)) return Infinity
    return depth[cellX(a) + cellY(b) * nx]
  }
}

// Valore < 0 dentro lo spessore da fresare (profondità dalla prima superficie vista)
const depthField = (front, proj, depth) => (i) => {
  const w = proj.pw[i]
  return w - Math.min(front(proj.pa[i], proj.pb[i]), w) - depth
}

// Vertici da eliminare (anteprima): dentro il poligono (o fuori, se invertito) ed
// entro la profondità di fresatura, se indicata.
export function selectArea(mesh, area, { invert = false, depth = null } = {}) {
  const { positions, indices } = mesh
  const count = positions.length / 3
  const selected = new Uint8Array(count)
  if (area.polygon.length < 3) return selected
  const proj = projectVertices(positions, makeProjector(area))
  const field = depth != null ? depthField(buildFrontGrid(indices, proj), proj, depth) : null
  const [minA, minB, maxA, maxB] = polygonBounds(area.polygon)
  for (let i = 0; i < count; i++) {
    if (!(proj.pw[i] > 0)) continue
    const a = proj.pa[i]
    const b = proj.pb[i]
    const inside = a >= minA && a <= maxA && b >= minB && b <= maxB && pointInPolygon(a, b, area.polygon)
    if (inside === invert) continue
    if (field && field(i) > 0) continue
    selected[i] = 1
  }
  return selected
}

// Taglia la mesh con l'area. I triangoli a cavallo del contorno (e del fondo della
// fresatura) vengono divisi, così il bordo del taglio è netto.
// Restituisce la mesh rimasta e, se `keepRemoved`, la parte tagliata come mesh a sé.
export function cutByArea(mesh, area, { invert = false, depth = null, keepRemoved = false } = {}) {
  const { colors: C, indices, diagonal } = mesh
  const positions = Array.from(mesh.positions)
  const colors = C ? Array.from(C) : null
  const polygon = area.polygon
  if (polygon.length < 3) throw new Error("Traccia almeno 3 punti per definire l'area.")
  const project = makeProjector(area)
  const proj = projectVertices(positions, project)
  const { pa, pb, pw } = proj
  const front = depth != null ? buildFrontGrid(indices, proj) : null
  const eps = Math.max(diagonal || 1, 1e-9) * 1e-9
  const tmp = [0, 0, 0]

  const addVertex = (i, j, t) => {
    const index = positions.length / 3
    for (let k = 0; k < 3; k++) positions.push(positions[i * 3 + k] + (positions[j * 3 + k] - positions[i * 3 + k]) * t)
    if (colors) for (let k = 0; k < 3; k++) colors.push(colors[i * 3 + k] + (colors[j * 3 + k] - colors[i * 3 + k]) * t)
    project(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2], tmp)
    pa.push(tmp[0])
    pb.push(tmp[1])
    pw.push(tmp[2])
    return index
  }

  // Divide i triangoli attraversati dalla superficie value(i) = 0 (solo quelli che
  // passano `filter`). I vicini con un lato diviso vengono suddivisi sullo stesso
  // punto, senza tagliarli, così la mesh resta chiusa (niente crepe).
  const splitPass = (tris, value, filter) => {
    const values = new Map()
    const valueOf = (i) => {
      let s = values.get(i)
      if (s === undefined) values.set(i, (s = value(i)))
      return s
    }
    const edgeVertices = new Map()
    const cutEdge = (i, j) => {
      const lo = Math.min(i, j)
      const hi = Math.max(i, j)
      const key = lo * EDGE_KEY_BASE + hi
      let index = edgeVertices.get(key)
      if (index === undefined) {
        const sLo = valueOf(lo)
        const sHi = valueOf(hi)
        index = addVertex(lo, hi, sLo / (sLo - sHi))
        values.set(index, 0)
        edgeVertices.set(key, index)
      }
      return index
    }
    const sideOf = (i) => {
      const s = valueOf(i)
      return s > eps ? 1 : s < -eps ? -1 : 0
    }

    // 1) triangoli da tagliare e punti di taglio sui loro lati
    const active = new Uint8Array(tris.length / 3)
    let anyActive = false
    for (let t = 0; t < tris.length; t += 3) {
      const i0 = tris[t]
      const i1 = tris[t + 1]
      const i2 = tris[t + 2]
      if (filter && !filter(i0, i1, i2)) continue
      const s0 = sideOf(i0)
      const s1 = sideOf(i1)
      const s2 = sideOf(i2)
      if (Math.max(s0, s1, s2) <= 0 || Math.min(s0, s1, s2) >= 0) continue
      active[t / 3] = 1
      anyActive = true
      if (s0 * s1 < 0) cutEdge(i0, i1)
      if (s1 * s2 < 0) cutEdge(i1, i2)
      if (s2 * s0 < 0) cutEdge(i2, i0)
    }
    if (!anyActive) return tris

    const out = []
    const cutVertex = (i, j) => edgeVertices.get(Math.min(i, j) * EDGE_KEY_BASE + Math.max(i, j))
    // triangolo non tagliato con punti di taglio sui lati: suddiviso su quei punti
    const subdivide = (a, b, c) => {
      let m = cutVertex(a, b)
      if (m !== undefined) {
        subdivide(a, m, c)
        subdivide(m, b, c)
        return
      }
      m = cutVertex(b, c)
      if (m !== undefined) {
        subdivide(a, b, m)
        subdivide(a, m, c)
        return
      }
      m = cutVertex(c, a)
      if (m !== undefined) {
        subdivide(a, b, m)
        subdivide(b, c, m)
        return
      }
      out.push(a, b, c)
    }

    // 2) taglio dei triangoli attivi e suddivisione dei vicini
    const vs = [0, 0, 0]
    const side = [0, 0, 0]
    for (let t = 0; t < tris.length; t += 3) {
      vs[0] = tris[t]
      vs[1] = tris[t + 1]
      vs[2] = tris[t + 2]
      if (!active[t / 3]) {
        subdivide(vs[0], vs[1], vs[2])
        continue
      }
      for (let k = 0; k < 3; k++) side[k] = sideOf(vs[k])
      const above = []
      const below = []
      for (let k = 0; k < 3; k++) {
        const next = (k + 1) % 3
        if (side[k] >= 0) above.push(vs[k])
        if (side[k] <= 0) below.push(vs[k])
        if (side[k] * side[next] < 0) {
          const m = cutEdge(vs[k], vs[next])
          above.push(m)
          below.push(m)
        }
      }
      for (const part of [above, below]) {
        for (let k = 1; k + 1 < part.length; k++) out.push(part[0], part[k], part[k + 1])
      }
    }
    return out
  }

  const visible = (i0, i1, i2) => pw[i0] > 0 && pw[i1] > 0 && pw[i2] > 0

  // triangoli vicini al contorno (gli unici che possono essere attraversati, più quelli
  // che toccano i loro vertici, per la suddivisione dei vicini) e tutti gli altri
  const [minA, minB, maxA, maxB] = polygonBounds(polygon)
  const pad = (Math.max(maxA - minA, maxB - minB) || 1) * 1e-3
  const nearVertex = new Uint8Array(pa.length)
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t]
    const i1 = indices[t + 1]
    const i2 = indices[t + 2]
    if (
      visible(i0, i1, i2) &&
      Math.max(pa[i0], pa[i1], pa[i2]) >= minA - pad &&
      Math.min(pa[i0], pa[i1], pa[i2]) <= maxA + pad &&
      Math.max(pb[i0], pb[i1], pb[i2]) >= minB - pad &&
      Math.min(pb[i0], pb[i1], pb[i2]) <= maxB + pad
    ) {
      nearVertex[i0] = nearVertex[i1] = nearVertex[i2] = 1
    }
  }
  let near = []
  const far = []
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t]
    const i1 = indices[t + 1]
    const i2 = indices[t + 2]
    ;(nearVertex[i0] || nearVertex[i1] || nearVertex[i2] ? near : far).push(i0, i1, i2)
  }

  // un piano per ogni lato: passa per l'occhio e per i due estremi del lato
  const { eye, origin, u, v } = area
  const toSpace = ([a, b]) => [0, 1, 2].map((k) => origin[k] + u[k] * a + v[k] * b - eye[k])
  for (let e = 0; e < polygon.length; e++) {
    const A = polygon[e]
    const B = polygon[(e + 1) % polygon.length]
    const ea = toSpace(A)
    const eb = toSpace(B)
    const n = [ea[1] * eb[2] - ea[2] * eb[1], ea[2] * eb[0] - ea[0] * eb[2], ea[0] * eb[1] - ea[1] * eb[0]]
    const length = Math.hypot(n[0], n[1], n[2])
    if (length < 1e-18) continue
    n[0] /= length
    n[1] /= length
    n[2] /= length
    const eMinA = Math.min(A[0], B[0]) - pad
    const eMaxA = Math.max(A[0], B[0]) + pad
    const eMinB = Math.min(A[1], B[1]) - pad
    const eMaxB = Math.max(A[1], B[1]) + pad
    near = splitPass(
      near,
      (i) => n[0] * (positions[i * 3] - eye[0]) + n[1] * (positions[i * 3 + 1] - eye[1]) + n[2] * (positions[i * 3 + 2] - eye[2]),
      (i0, i1, i2) =>
        visible(i0, i1, i2) &&
        Math.max(pa[i0], pa[i1], pa[i2]) >= eMinA &&
        Math.min(pa[i0], pa[i1], pa[i2]) <= eMaxA &&
        Math.max(pb[i0], pb[i1], pb[i2]) >= eMinB &&
        Math.min(pb[i0], pb[i1], pb[i2]) <= eMaxB
    )
  }

  let tris = near.concat(far)
  let field = null
  if (front) {
    field = depthField(front, proj, depth)
    tris = splitPass(tris, field, visible)
  }

  const kept = []
  const removed = []
  for (let t = 0; t < tris.length; t += 3) {
    const i0 = tris[t]
    const i1 = tris[t + 1]
    const i2 = tris[t + 2]
    let remove = false
    if (visible(i0, i1, i2)) {
      project(
        (positions[i0 * 3] + positions[i1 * 3] + positions[i2 * 3]) / 3,
        (positions[i0 * 3 + 1] + positions[i1 * 3 + 1] + positions[i2 * 3 + 1]) / 3,
        (positions[i0 * 3 + 2] + positions[i1 * 3 + 2] + positions[i2 * 3 + 2]) / 3,
        tmp
      )
      const inside = tmp[2] > 0 && pointInPolygon(tmp[0], tmp[1], polygon)
      remove = inside !== invert && (!field || field(i0) + field(i1) + field(i2) < 0)
    }
    ;(remove ? removed : kept).push(i0, i1, i2)
  }

  if (removed.length === 0) throw new Error("Nessuna parte della mesh si trova dentro l'area tracciata.")
  if (kept.length === 0) throw new Error("L'operazione eliminerebbe tutta la mesh.")
  return {
    geometry: buildGeometry(positions, colors, kept),
    removedGeometry: keepRemoved ? buildGeometry(positions, colors, removed) : null,
    removedTriangles: removed.length / 3,
  }
}

// Punto 3D (coordinate della mesh) di un punto [a, b] del piano dell'area
export const areaPoint = (area, [a, b]) => [0, 1, 2].map((k) => area.origin[k] + area.u[k] * a + area.v[k] * b)
