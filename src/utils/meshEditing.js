import * as THREE from 'three'
import { weldGeometry, findBoundaryLoops } from './holeFiller'

// Operazioni di modifica della mesh: inverti normali, taglio (selezione o piano)
// e modifica del bordo (raddrizza, ricostruisci, estendi). Ogni funzione
// restituisce una nuova geometria indicizzata; quella di partenza non cambia.

const EDGE_KEY_BASE = 67108864
const edgeKey = (a, b) => (a < b ? a * EDGE_KEY_BASE + b : b * EDGE_KEY_BASE + a)

// Geometria dai vertici usati da `indices` (i vertici non usati vengono scartati)
function buildGeometry(positions, colors, indices) {
  const remap = new Int32Array(positions.length / 3).fill(-1)
  const outPositions = []
  const outColors = colors ? [] : null
  const outIndices = new Uint32Array(indices.length)
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]
    if (remap[v] === -1) {
      remap[v] = outPositions.length / 3
      outPositions.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])
      if (outColors) outColors.push(colors[v * 3], colors[v * 3 + 1], colors[v * 3 + 2])
    }
    outIndices[i] = remap[v]
  }
  if (outIndices.length === 0) throw new Error("L'operazione eliminerebbe tutta la mesh.")
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(outPositions, 3))
  if (outColors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(outColors, 3))
  geometry.setIndex(new THREE.BufferAttribute(outIndices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

// ---------- Inverti normali ----------

export function flipNormals(geometry) {
  const { positions, colors, indices } = weldGeometry(geometry)
  const flipped = new Uint32Array(indices.length)
  for (let t = 0; t < indices.length; t += 3) {
    flipped[t] = indices[t]
    flipped[t + 1] = indices[t + 2]
    flipped[t + 2] = indices[t + 1]
  }
  return buildGeometry(positions, colors, flipped)
}

// ---------- Taglio ----------

// Elimina i triangoli con tutti i vertici selezionati (selezione del pennello / area / lazo)
export function deleteSelectedTriangles(data) {
  const { positions, colors, indices } = data.mesh
  const { selected } = data
  const kept = []
  let removed = 0
  for (let t = 0; t < indices.length; t += 3) {
    if (selected[indices[t]] && selected[indices[t + 1]] && selected[indices[t + 2]]) removed++
    else kept.push(indices[t], indices[t + 1], indices[t + 2])
  }
  return { geometry: buildGeometry(positions, colors, kept), removedTriangles: removed }
}

// Taglia la mesh con un piano (normal·p + constant = 0) e tiene la parte con
// distanza negativa. I triangoli attraversati dal piano vengono divisi, così il
// bordo del taglio è netto.
export function clipByPlane(mesh, normal, constant) {
  const { positions: P, colors: C, indices } = mesh
  const positions = Array.from(P)
  const colors = C ? Array.from(C) : null
  const vertexCount = P.length / 3
  const distance = new Float64Array(vertexCount)
  for (let v = 0; v < vertexCount; v++) {
    distance[v] = normal[0] * P[v * 3] + normal[1] * P[v * 3 + 1] + normal[2] * P[v * 3 + 2] + constant
  }
  const cutVertices = new Map()
  const cutVertex = (a, b) => {
    const key = edgeKey(a, b)
    let index = cutVertices.get(key)
    if (index !== undefined) return index
    const t = distance[a] / (distance[a] - distance[b])
    index = positions.length / 3
    for (let k = 0; k < 3; k++) positions.push(P[a * 3 + k] + (P[b * 3 + k] - P[a * 3 + k]) * t)
    if (colors) for (let k = 0; k < 3; k++) colors.push(C[a * 3 + k] + (C[b * 3 + k] - C[a * 3 + k]) * t)
    cutVertices.set(key, index)
    return index
  }

  const kept = []
  let removed = 0
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t], indices[t + 1], indices[t + 2]]
    const inside = tri.map((v) => distance[v] <= 0)
    if (inside[0] && inside[1] && inside[2]) {
      kept.push(...tri)
      continue
    }
    if (!inside[0] && !inside[1] && !inside[2]) {
      removed++
      continue
    }
    // Sutherland–Hodgman sul triangolo: l'ordine dei vertici (e quindi la normale) resta lo stesso
    const polygon = []
    for (let k = 0; k < 3; k++) {
      const a = tri[k]
      const b = tri[(k + 1) % 3]
      if (inside[k]) polygon.push(a)
      if (inside[k] !== inside[(k + 1) % 3]) polygon.push(cutVertex(a, b))
    }
    for (let k = 1; k + 1 < polygon.length; k++) kept.push(polygon[0], polygon[k], polygon[k + 1])
  }
  return { geometry: buildGeometry(positions, colors, kept), removedTriangles: removed }
}

// ---------- Bordo ----------

// Anelli di bordo da modificare: solo il bordo esterno (il più lungo) oppure tutti
function borderLoops(mesh, onlyOuter) {
  const loops = findBoundaryLoops(mesh.indices)
  if (loops.length === 0) throw new Error('La mesh non ha bordi aperti.')
  if (!onlyOuter) return loops
  const P = mesh.positions
  const perimeter = (loop) => {
    let sum = 0
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i] * 3
      const b = loop[(i + 1) % loop.length] * 3
      sum += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2])
    }
    return sum
  }
  return [loops.reduce((best, loop) => (perimeter(loop) > perimeter(best) ? loop : best))]
}

// Levigatura di Taubin lungo gli anelli: toglie le irregolarità senza accorciare il bordo
function smoothLoops(positions, loops, iterations, strength) {
  const lambda = Math.min(1, Math.max(0, strength))
  const mu = -lambda * 1.04
  const next = new Float64Array(3)
  for (let it = 0; it < iterations * 2; it++) {
    const factor = it % 2 === 0 ? lambda : mu
    for (const loop of loops) {
      const n = loop.length
      const old = loop.map((v) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]])
      for (let i = 0; i < n; i++) {
        const prev = old[(i - 1 + n) % n]
        const after = old[(i + 1) % n]
        for (let k = 0; k < 3; k++) next[k] = old[i][k] + factor * ((prev[k] + after[k]) / 2 - old[i][k])
        const v = loop[i]
        positions[v * 3] = next[0]
        positions[v * 3 + 1] = next[1]
        positions[v * 3 + 2] = next[2]
      }
    }
  }
}

export function straightenBorder(geometry, { iterations = 10, strength = 0.5, onlyOuter = true } = {}) {
  const mesh = weldGeometry(geometry)
  const loops = borderLoops(mesh, onlyOuter)
  const positions = Float64Array.from(mesh.positions)
  smoothLoops(positions, loops, iterations, strength)
  return { geometry: buildGeometry(positions, mesh.colors, mesh.indices), loopCount: loops.length }
}

// Ricostruisci bordo: elimina i triangoli "a punta" sul bordo (con due o tre lati
// liberi) e quelli molto schiacciati, poi leviga leggermente il bordo rimasto.
export function rebuildBorder(geometry, { passes = 3, smoothIterations = 3 } = {}) {
  const mesh = weldGeometry(geometry)
  const P = mesh.positions
  let indices = Array.from(mesh.indices)
  let removed = 0
  const minAngle = (a, b, c) => {
    const angle = (o, u, w) => {
      const ux = P[u * 3] - P[o * 3], uy = P[u * 3 + 1] - P[o * 3 + 1], uz = P[u * 3 + 2] - P[o * 3 + 2]
      const wx = P[w * 3] - P[o * 3], wy = P[w * 3 + 1] - P[o * 3 + 1], wz = P[w * 3 + 2] - P[o * 3 + 2]
      const cross = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx)
      return Math.atan2(cross, ux * wx + uy * wy + uz * wz)
    }
    return Math.min(angle(a, b, c), angle(b, c, a), angle(c, a, b))
  }
  for (let pass = 0; pass < passes; pass++) {
    const edgeUse = new Map()
    for (let t = 0; t < indices.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const key = edgeKey(indices[t + k], indices[t + ((k + 1) % 3)])
        edgeUse.set(key, (edgeUse.get(key) || 0) + 1)
      }
    }
    const kept = []
    let removedNow = 0
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]]
      let freeEdges = 0
      for (const [u, w] of [[a, b], [b, c], [c, a]]) if (edgeUse.get(edgeKey(u, w)) === 1) freeEdges++
      const spike = freeEdges >= 2
      const sliver = freeEdges === 1 && minAngle(a, b, c) < (8 * Math.PI) / 180
      if (spike || sliver) removedNow++
      else kept.push(a, b, c)
    }
    indices = kept
    removed += removedNow
    if (removedNow === 0) break
  }
  const positions = Float64Array.from(P)
  const loops = findBoundaryLoops(indices)
  smoothLoops(positions, loops, smoothIterations, 0.4)
  return { geometry: buildGeometry(positions, mesh.colors, indices), removedTriangles: removed }
}

// Estendi bordo: aggiunge una fascia di triangoli oltre il bordo, lunga `distance`.
// direction 'outward' prosegue la superficie verso l'esterno; 'axis' segue la
// direzione opposta alla normale media della mesh (es. verso la base di un'arcata).
export function extendBorder(geometry, { distance = 1, direction = 'outward', onlyOuter = true } = {}) {
  const mesh = weldGeometry(geometry)
  const { positions: P, colors: C, indices } = mesh
  const loops = borderLoops(mesh, onlyOuter)
  const positions = Array.from(P)
  const colors = C ? Array.from(C) : null
  const triangles = Array.from(indices)

  // terzo vertice della faccia adiacente a ogni spigolo di bordo
  const boundaryEdges = new Map()
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) boundaryEdges.set(edgeKey(loop[i], loop[(i + 1) % loop.length]), -1)
  }
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(indices[t + k], indices[t + ((k + 1) % 3)])
      if (boundaryEdges.has(key)) boundaryEdges.set(key, indices[t + ((k + 2) % 3)])
    }
  }

  let axis = null
  if (direction === 'axis') {
    axis = [0, 0, 0]
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2]
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
      axis[0] += uy * vz - uz * vy
      axis[1] += uz * vx - ux * vz
      axis[2] += ux * vy - uy * vx
    }
    const length = Math.hypot(...axis)
    if (length === 0) throw new Error('Impossibile calcolare la direzione media della mesh.')
    axis = axis.map((value) => -value / length)
  }

  // lunghezza media degli spigoli di bordo: decide in quante fasce dividere l'estensione
  let edgeSum = 0
  let edgeCount = 0
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i] * 3
      const b = loop[(i + 1) % loop.length] * 3
      edgeSum += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2])
      edgeCount++
    }
  }
  const steps = Math.min(50, Math.max(1, Math.round(Math.abs(distance) / Math.max(edgeSum / edgeCount, 1e-9))))

  for (const loop of loops) {
    const n = loop.length
    const dirs = loop.map(() => [0, 0, 0])
    if (axis) {
      dirs.forEach((dir) => dir.splice(0, 3, ...axis))
    } else {
      for (let i = 0; i < n; i++) {
        const a = loop[i]
        const b = loop[(i + 1) % n]
        const c = boundaryEdges.get(edgeKey(a, b))
        if (c === undefined || c < 0) continue
        const ex = P[b * 3] - P[a * 3], ey = P[b * 3 + 1] - P[a * 3 + 1], ez = P[b * 3 + 2] - P[a * 3 + 2]
        const el = Math.hypot(ex, ey, ez) || 1
        // dal terzo vertice verso il punto medio dello spigolo, senza la componente lungo lo spigolo
        let ox = (P[a * 3] + P[b * 3]) / 2 - P[c * 3]
        let oy = (P[a * 3 + 1] + P[b * 3 + 1]) / 2 - P[c * 3 + 1]
        let oz = (P[a * 3 + 2] + P[b * 3 + 2]) / 2 - P[c * 3 + 2]
        const along = (ox * ex + oy * ey + oz * ez) / (el * el)
        ox -= along * ex
        oy -= along * ey
        oz -= along * ez
        const ol = Math.hypot(ox, oy, oz) || 1
        for (const j of [i, (i + 1) % n]) {
          dirs[j][0] += ox / ol
          dirs[j][1] += oy / ol
          dirs[j][2] += oz / ol
        }
      }
      dirs.forEach((dir) => {
        const length = Math.hypot(...dir) || 1
        dir[0] /= length
        dir[1] /= length
        dir[2] /= length
      })
    }

    let ring = loop.slice()
    for (let s = 1; s <= steps; s++) {
      const offset = (distance * s) / steps
      const nextRing = loop.map((v, i) => {
        const index = positions.length / 3
        positions.push(P[v * 3] + dirs[i][0] * offset, P[v * 3 + 1] + dirs[i][1] * offset, P[v * 3 + 2] + dirs[i][2] * offset)
        if (colors) colors.push(C[v * 3], C[v * 3 + 1], C[v * 3 + 2])
        return index
      })
      // l'anello percorre il bordo al contrario delle facce: (a, b, b') e (a, b', a') hanno l'orientamento giusto
      for (let i = 0; i < n; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % n]
        const a2 = nextRing[i]
        const b2 = nextRing[(i + 1) % n]
        triangles.push(a, b, b2, a, b2, a2)
      }
      ring = nextRing
    }
  }

  return { geometry: buildGeometry(positions, colors, triangles), loopCount: loops.length, steps }
}
