import { buildGeometry } from './meshEditing'

// Taglia con Linea: l'utente clicca dei punti sulla superficie; due punti vicini
// sono uniti dal percorso più corto lungo gli spigoli della mesh e l'ultimo si
// collega al primo. Il contorno chiuso divide la superficie in due zone: viene
// eliminata la più piccola (o l'altra, se invertito). Con "Tensione Spigoli" il
// bordo del taglio viene lisciato.

const EDGE_KEY_BASE = 67108864
const edgeKey = (a, b) => (a < b ? a * EDGE_KEY_BASE + b : b * EDGE_KEY_BASE + a)
const MAX_PATH_VISITS = 3000000

// Vicini dei vertici (formato compatto) e triangoli adiacenti, in cache per mesh
const topologyCache = new WeakMap()

function meshTopology(mesh) {
  let topology = topologyCache.get(mesh)
  if (topology) return topology
  const { positions, indices } = mesh
  const vertexCount = positions.length / 3
  const triangleCount = indices.length / 3

  const degree = new Uint32Array(vertexCount + 1)
  for (let i = 0; i < indices.length; i++) degree[indices[i] + 1] += 2
  for (let v = 0; v < vertexCount; v++) degree[v + 1] += degree[v]
  const offsets = degree
  const fill = offsets.slice(0, vertexCount)
  const neighbors = new Uint32Array(offsets[vertexCount])
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k]
      neighbors[fill[a]++] = indices[t + ((k + 1) % 3)]
      neighbors[fill[a]++] = indices[t + ((k + 2) % 3)]
    }
  }

  // triangleNeighbors[t * 3 + k]: triangolo dall'altra parte del lato k (v_k, v_k+1), -1 se bordo
  const triangleNeighbors = new Int32Array(triangleCount * 3).fill(-1)
  const open = new Map()
  for (let t = 0; t < triangleCount; t++) {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(indices[t * 3 + k], indices[t * 3 + ((k + 1) % 3)])
      const other = open.get(key)
      if (other === undefined) {
        open.set(key, t * 3 + k)
      } else if (other >= 0) {
        triangleNeighbors[t * 3 + k] = Math.floor(other / 3)
        triangleNeighbors[other] = t
        open.set(key, -1) // spigoli con più di due triangoli: collegati solo i primi due
      }
    }
  }

  topology = {
    offsets,
    neighbors,
    triangleNeighbors,
    // memoria riutilizzata dalla ricerca dei percorsi
    cost: new Float64Array(vertexCount),
    previous: new Int32Array(vertexCount),
    stamp: new Uint32Array(vertexCount),
    run: 0,
  }
  topologyCache.set(mesh, topology)
  return topology
}

// Coda di priorità minima (heap binario) con valori numerici
class MinHeap {
  constructor() {
    this.keys = []
    this.values = []
  }
  get size() {
    return this.keys.length
  }
  push(key, value) {
    const { keys, values } = this
    let i = keys.length
    keys.push(key)
    values.push(value)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (keys[parent] <= key) break
      keys[i] = keys[parent]
      values[i] = values[parent]
      i = parent
    }
    keys[i] = key
    values[i] = value
  }
  pop() {
    const { keys, values } = this
    const top = values[0]
    const lastKey = keys.pop()
    const lastValue = values.pop()
    const n = keys.length
    if (n > 0) {
      let i = 0
      for (;;) {
        let child = 2 * i + 1
        if (child >= n) break
        if (child + 1 < n && keys[child + 1] < keys[child]) child++
        if (keys[child] >= lastKey) break
        keys[i] = keys[child]
        values[i] = values[child]
        i = child
      }
      keys[i] = lastKey
      values[i] = lastValue
    }
    return top
  }
}

// Percorso più corto lungo gli spigoli della mesh (A*), come elenco di vertici
// da `from` a `to`; null se i due vertici non sono collegati.
export function surfacePath(mesh, from, to) {
  if (from === to) return [from]
  const topology = meshTopology(mesh)
  const { offsets, neighbors, cost, previous, stamp } = topology
  const P = mesh.positions
  const run = ++topology.run
  const tx = P[to * 3]
  const ty = P[to * 3 + 1]
  const tz = P[to * 3 + 2]
  const remaining = (v) => Math.hypot(P[v * 3] - tx, P[v * 3 + 1] - ty, P[v * 3 + 2] - tz)

  const heap = new MinHeap()
  stamp[from] = run
  cost[from] = 0
  previous[from] = -1
  heap.push(remaining(from), from)
  let visits = 0
  while (heap.size > 0) {
    const v = heap.pop()
    if (v === to) break
    if (++visits > MAX_PATH_VISITS) return null
    const base = cost[v]
    const vx = P[v * 3]
    const vy = P[v * 3 + 1]
    const vz = P[v * 3 + 2]
    for (let i = offsets[v]; i < offsets[v + 1]; i++) {
      const w = neighbors[i]
      const next = base + Math.hypot(P[w * 3] - vx, P[w * 3 + 1] - vy, P[w * 3 + 2] - vz)
      if (stamp[w] === run && cost[w] <= next) continue
      stamp[w] = run
      cost[w] = next
      previous[w] = v
      heap.push(next + remaining(w), w)
    }
  }
  if (stamp[to] !== run) return null
  const path = []
  for (let v = to; v !== -1; v = previous[v]) path.push(v)
  return path.reverse()
}

// Contorno chiuso dai percorsi dei segmenti: senza vertici ripetuti di seguito
// né "andata e ritorno" sullo stesso spigolo
export function closedLoop(segments) {
  let loop = []
  for (const segment of segments) {
    for (const v of segment) {
      const n = loop.length
      if (n > 0 && loop[n - 1] === v) continue
      if (n > 1 && loop[n - 2] === v) {
        loop.pop()
        continue
      }
      loop.push(v)
    }
  }
  // stesso controllo attraverso la chiusura del contorno
  while (loop.length > 2) {
    const n = loop.length
    if (loop[0] === loop[n - 1]) loop.pop() // ... a | a ...
    else if (loop[n - 1] === loop[1]) loop = loop.slice(2) // ... b | a b ...
    else if (loop[n - 2] === loop[0]) loop = loop.slice(0, n - 2) // ... a b | a ...
    else break
  }
  return loop
}

// Media gaussiana lungo il contorno chiuso; `sigma` in numero di vertici
function gaussianLoop(values, n, sigma) {
  const radius = Math.min(Math.ceil(sigma * 3), Math.floor((n - 1) / 2))
  const weights = []
  let total = 0
  for (let d = -radius; d <= radius; d++) {
    const w = Math.exp(-(d * d) / (2 * sigma * sigma))
    weights.push(w)
    total += w
  }
  const out = new Float64Array(n * 3)
  for (let i = 0; i < n; i++) {
    for (let d = -radius; d <= radius; d++) {
      const j = (((i + d) % n) + n) % n
      const w = weights[d + radius] / total
      out[i * 3] += values[j * 3] * w
      out[i * 3 + 1] += values[j * 3 + 1] * w
      out[i * 3 + 2] += values[j * 3 + 2] * w
    }
  }
  return out
}

// Posizioni del contorno lisciate con una media gaussiana lungo il contorno, larga
// quanto la forza (in vertici). La media viene applicata "due volte" (2G - G·G): il
// contorno non si restringe e le ondulazioni vengono solo smorzate, mai amplificate.
// Con `normals` i punti si spostano solo lungo la superficie (si toglie la parte lungo
// la normale), così la linea non si stacca dalla mesh anche con lisciature forti.
export function smoothLoopPositions(positions, loop, strength, normals = null) {
  const n = loop.length
  const original = new Float64Array(n * 3)
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) original[i * 3 + k] = positions[loop[i] * 3 + k]
  if (n < 5 || !(strength > 0)) return original
  // la media non supera 1/8 del contorno, altrimenti lo deformerebbe tutto
  const sigma = Math.min(strength, n / 8)
  const once = gaussianLoop(original, n, sigma)
  const twice = gaussianLoop(once, n, sigma)
  const current = new Float64Array(n * 3)
  for (let i = 0; i < n * 3; i++) current[i] = 2 * once[i] - twice[i]
  if (normals) {
    for (let i = 0; i < n; i++) {
      const v = loop[i] * 3
      const dx = current[i * 3] - positions[v]
      const dy = current[i * 3 + 1] - positions[v + 1]
      const dz = current[i * 3 + 2] - positions[v + 2]
      const along = dx * normals[v] + dy * normals[v + 1] + dz * normals[v + 2]
      for (let k = 0; k < 3; k++) current[i * 3 + k] -= along * normals[v + k]
    }
  }
  return current
}

// Zone in cui il contorno divide la superficie. Restituisce per ogni triangolo
// 1 se va eliminato, oltre al numero di triangoli eliminati.
export function curveCutSelection(mesh, loop, invert = false) {
  if (loop.length < 3) throw new Error('Il contorno deve avere almeno 3 punti.')
  const { indices, positions: P } = mesh
  const { triangleNeighbors } = meshTopology(mesh)
  const triangleCount = indices.length / 3
  const barrier = new Set()
  for (let i = 0; i < loop.length; i++) barrier.add(edgeKey(loop[i], loop[(i + 1) % loop.length]))

  const component = new Int32Array(triangleCount).fill(-1)
  const areas = []
  const touching = []
  const stack = []
  for (let seed = 0; seed < triangleCount; seed++) {
    if (component[seed] !== -1) continue
    const id = areas.length
    let area = 0
    let touches = false
    component[seed] = id
    stack.push(seed)
    while (stack.length > 0) {
      const t = stack.pop()
      const a = indices[t * 3] * 3
      const b = indices[t * 3 + 1] * 3
      const c = indices[t * 3 + 2] * 3
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2]
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
      area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
      for (let k = 0; k < 3; k++) {
        if (barrier.has(edgeKey(indices[t * 3 + k], indices[t * 3 + ((k + 1) % 3)]))) {
          touches = true
          continue
        }
        const other = triangleNeighbors[t * 3 + k]
        if (other !== -1 && component[other] === -1) {
          component[other] = id
          stack.push(other)
        }
      }
    }
    areas.push(area)
    touching.push(touches)
  }

  // zone toccate dal contorno: la più piccola è l'interno
  const sides = areas.map((_, id) => id).filter((id) => touching[id])
  if (sides.length < 2) {
    throw new Error('Il contorno non divide la superficie: chiudi la linea su una zona continua della mesh.')
  }
  const inside = sides.reduce((best, id) => (areas[id] < areas[best] ? id : best), sides[0])
  const removedSides = new Uint8Array(areas.length)
  if (invert) sides.forEach((id) => (removedSides[id] = id === inside ? 0 : 1))
  else removedSides[inside] = 1

  const removed = new Uint8Array(triangleCount)
  let count = 0
  for (let t = 0; t < triangleCount; t++) {
    if (removedSides[component[t]]) {
      removed[t] = 1
      count++
    }
  }
  return { removed, count }
}

// Liscia il bordo del taglio: il contorno segue la curva lisciata e i vertici entro
// `distance` dal contorno vengono rilassati, con effetto che cala allontanandosi.
function smoothBorder(mesh, positions, loop, { strength, distance, normals }) {
  const { offsets, neighbors } = meshTopology(mesh)
  const smoothed = smoothLoopPositions(positions, loop, strength, normals)
  const onLoop = new Set(loop)
  loop.forEach((v, i) => {
    for (let k = 0; k < 3; k++) positions[v * 3 + k] = smoothed[i * 3 + k]
  })
  if (!(distance > 0)) return

  // vertici vicini al contorno, con la distanza dal contorno
  const weight = new Map()
  const nearest = new Map(loop.map((v) => [v, v]))
  let frontier = loop.slice()
  while (frontier.length > 0) {
    const next = []
    for (const v of frontier) {
      const source = nearest.get(v)
      for (let i = offsets[v]; i < offsets[v + 1]; i++) {
        const w = neighbors[i]
        if (nearest.has(w)) continue
        const d = Math.hypot(
          positions[w * 3] - positions[source * 3],
          positions[w * 3 + 1] - positions[source * 3 + 1],
          positions[w * 3 + 2] - positions[source * 3 + 2]
        )
        if (d > distance) continue
        nearest.set(w, source)
        weight.set(w, 0.5 * (1 - d / distance))
        next.push(w)
      }
    }
    frontier = next
  }

  const band = [...weight.keys()].filter((v) => !onLoop.has(v))
  const moved = new Float64Array(band.length * 3)
  for (let it = 0; it < strength; it++) {
    band.forEach((v, j) => {
      let sx = 0, sy = 0, sz = 0
      const count = offsets[v + 1] - offsets[v]
      for (let i = offsets[v]; i < offsets[v + 1]; i++) {
        const w = neighbors[i]
        sx += positions[w * 3]
        sy += positions[w * 3 + 1]
        sz += positions[w * 3 + 2]
      }
      const f = weight.get(v)
      moved[j * 3] = positions[v * 3] + f * (sx / count - positions[v * 3])
      moved[j * 3 + 1] = positions[v * 3 + 1] + f * (sy / count - positions[v * 3 + 1])
      moved[j * 3 + 2] = positions[v * 3 + 2] + f * (sz / count - positions[v * 3 + 2])
    })
    band.forEach((v, j) => {
      positions[v * 3] = moved[j * 3]
      positions[v * 3 + 1] = moved[j * 3 + 1]
      positions[v * 3 + 2] = moved[j * 3 + 2]
    })
  }
}

// Taglia la mesh lungo il contorno. Restituisce la mesh rimasta, la parte tagliata
// (se `keepRemoved`) e il baricentro del bordo, per ritrovare il foro da chiudere.
export function cutByCurve(mesh, loop, { invert = false, keepRemoved = false, smoothing = null } = {}) {
  const { removed, count } = curveCutSelection(mesh, loop, invert)
  const positions = Array.from(mesh.positions)
  if (smoothing) smoothBorder(mesh, positions, loop, smoothing)
  const { indices } = mesh
  const kept = []
  const cut = []
  for (let t = 0; t < indices.length / 3; t++) {
    ;(removed[t] ? cut : kept).push(indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2])
  }
  if (kept.length === 0) throw new Error("L'operazione eliminerebbe tutta la mesh.")
  const borderCentroid = [0, 0, 0]
  for (const v of loop) for (let k = 0; k < 3; k++) borderCentroid[k] += positions[v * 3 + k] / loop.length
  return {
    geometry: buildGeometry(positions, mesh.colors, kept),
    removedGeometry: keepRemoved ? buildGeometry(positions, mesh.colors, cut) : null,
    removedTriangles: count,
    borderCentroid,
  }
}
