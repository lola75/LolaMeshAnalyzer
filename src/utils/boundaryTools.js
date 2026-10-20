import * as THREE from 'three'
import { weldGeometry, findBoundaryLoops } from './holeFiller'

// Strumenti sui bordi aperti di una mesh (come in Meshmixer):
// - Leviga bordo (Smooth Boundary): ammorbidisce il contorno frastagliato di una scansione;
// - Ponte (Bridge): unisce con una striscia di triangoli due tratti di bordo.
// Lavorano in mm sulle coordinate originali, con vertici uniti; restituiscono una nuova geometria.

// Vertici uniti, anelli di bordo e per ogni vertice di bordo il suo anello e la posizione
export function prepareBoundaries(geometry) {
  const mesh = weldGeometry(geometry)
  const loops = findBoundaryLoops(mesh.indices)
  const where = new Map() // vertice -> [anello, posizione]
  loops.forEach((loop, l) => loop.forEach((v, i) => where.set(v, [l, i])))
  const lengths = loops.map((loop) => {
    let length = 0
    for (let i = 0; i < loop.length; i++) length += distance(mesh.positions, loop[i], loop[(i + 1) % loop.length])
    return length
  })
  return { mesh, loops, where, lengths }
}

const distance = (P, a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2])

function toGeometry(positions, indices, colors) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

// vicini di ogni vertice (dai triangoli)
function neighbors(indices, vertexCount) {
  const sets = Array.from({ length: vertexCount }, () => new Set())
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k]
      const b = indices[t + ((k + 1) % 3)]
      sets[a].add(b)
      sets[b].add(a)
    }
  }
  return sets
}

/**
 * Leviga bordo. data: risultato di prepareBoundaries.
 * options: { iterations (1-50), rings (anelli di vertici interni ammorbiditi, 0-6), loops: 'longest' | 'all' }
 * Il contorno si ammorbidisce lungo se stesso (Taubin: niente restringimento); i vertici vicini al
 * bordo seguono con un peso che cala allontanandosi, cosi' non restano gradini.
 */
export function smoothBoundary(data, { iterations = 10, rings = 2, loops: which = 'longest', loopIndices = null } = {}) {
  const { mesh, loops, lengths } = data
  if (loops.length === 0) throw new Error('La mesh non ha bordi aperti.')
  const P = mesh.positions.slice()
  const selected = loopIndices
    ? loopIndices.map((i) => loops[i])
    : which === 'all' ? loops : [loops[lengths.indexOf(Math.max(...lengths))]]

  // 1. contorno: passo che ammorbidisce (lambda) e passo che ripristina la dimensione (mu)
  const lambda = 0.5
  const mu = -0.53
  for (const loop of selected) {
    const n = loop.length
    const next = new Float32Array(n * 3)
    for (let it = 0; it < iterations; it++) {
      for (const factor of [lambda, mu]) {
        for (let i = 0; i < n; i++) {
          const v = loop[i] * 3
          const a = loop[(i - 1 + n) % n] * 3
          const b = loop[(i + 1) % n] * 3
          for (let k = 0; k < 3; k++) next[i * 3 + k] = P[v + k] + factor * ((P[a + k] + P[b + k]) / 2 - P[v + k])
        }
        for (let i = 0; i < n; i++) P.set(next.subarray(i * 3, i * 3 + 3), loop[i] * 3)
      }
    }
  }

  // 2. anelli interni: distanza (in anelli) dal bordo levigato, poi Laplaciano con peso decrescente
  if (rings > 0) {
    const vertexCount = P.length / 3
    const adjacency = neighbors(mesh.indices, vertexCount)
    const level = new Int32Array(vertexCount).fill(-1)
    let frontier = []
    for (const loop of selected) for (const v of loop) { level[v] = 0; frontier.push(v) }
    for (let r = 1; r <= rings; r++) {
      const nextFrontier = []
      for (const v of frontier) for (const u of adjacency[v]) if (level[u] === -1) { level[u] = r; nextFrontier.push(u) }
      frontier = nextFrontier
    }
    const inner = []
    for (let v = 0; v < vertexCount; v++) if (level[v] > 0) inner.push(v)
    const target = new Float32Array(inner.length * 3)
    for (let it = 0; it < Math.max(2, Math.round(iterations / 2)); it++) {
      inner.forEach((v, i) => {
        let x = 0, y = 0, z = 0
        for (const u of adjacency[v]) { x += P[u * 3]; y += P[u * 3 + 1]; z += P[u * 3 + 2] }
        const count = adjacency[v].size || 1
        target[i * 3] = x / count
        target[i * 3 + 1] = y / count
        target[i * 3 + 2] = z / count
      })
      inner.forEach((v, i) => {
        const w = 0.5 * (1 - (level[v] - 1) / rings) // piu' forte vicino al bordo
        for (let k = 0; k < 3; k++) P[v * 3 + k] += (target[i * 3 + k] - P[v * 3 + k]) * w
      })
    }
  }
  return { geometry: toGeometry(P, mesh.indices.slice(), mesh.colors?.slice()), loopCount: selected.length }
}

// Bordi nati da un taglio: anelli della mesh tagliata con la maggior parte dei vertici che nella
// mesh di partenza (originalMesh: vertici uniti) non erano sul bordo
export function newBoundaryLoops(data, originalMesh) {
  const key = (P, v) => `${P[v * 3].toFixed(4)}_${P[v * 3 + 1].toFixed(4)}_${P[v * 3 + 2].toFixed(4)}`
  const oldBoundary = new Set()
  for (const loop of findBoundaryLoops(originalMesh.indices)) for (const v of loop) oldBoundary.add(key(originalMesh.positions, v))
  const P = data.mesh.positions
  const result = []
  data.loops.forEach((loop, i) => {
    const fresh = loop.filter((v) => !oldBoundary.has(key(P, v))).length
    if (fresh > loop.length / 2) result.push(i)
  })
  return result
}

// vertice di bordo piu' vicino a un punto (mm), entro maxDistance; null se nessuno
export function nearestBoundaryVertex(data, point, maxDistance = Infinity) {
  const P = data.mesh.positions
  let best = null
  let bestDistance = maxDistance
  for (const v of data.where.keys()) {
    const d = Math.hypot(P[v * 3] - point[0], P[v * 3 + 1] - point[1], P[v * 3 + 2] - point[2])
    if (d < bestDistance) {
      bestDistance = d
      best = v
    }
  }
  return best
}

// tratto di anello centrato sul vertice v, lungo circa `length` mm (nell'ordine dell'anello)
export function boundarySegment(data, v, length) {
  const [l, i] = data.where.get(v)
  const loop = data.loops[l]
  const n = loop.length
  const P = data.mesh.positions
  const half = Math.min(length / 2, data.lengths[l] / 2 - 1e-6)
  let back = 0
  let start = i
  while (back < half && (i - start + n) % n < n - 1) {
    const prev = (start - 1 + n) % n
    back += distance(P, loop[prev], loop[start])
    start = prev
  }
  let ahead = 0
  let end = i
  while (ahead < half && (end - start + n) % n < n - 1) {
    const next = (end + 1) % n
    ahead += distance(P, loop[end], loop[next])
    end = next
  }
  const segment = []
  for (let k = start; ; k = (k + 1) % n) {
    segment.push(loop[k])
    if (k === end) break
  }
  return { loop: l, segment }
}

/**
 * Ponte tra due tratti di bordo (attorno ai vertici a e b), lunghi circa `length` mm.
 * La striscia unisce il tratto A (nel verso dell'anello) con il tratto B al contrario: i lati
 * dei nuovi triangoli sul bordo percorrono gli anelli nel loro verso, quindi l'orientamento
 * resta coerente con le facce vicine. Tra i due tratti si scelgono via via le diagonali piu' corte.
 */
export function bridgeBoundaries(data, a, b, length) {
  const A = boundarySegment(data, a, length)
  const B = boundarySegment(data, b, length)
  if (A.loop === B.loop) {
    const shared = A.segment.filter((v) => B.segment.includes(v))
    if (shared.length > 0) throw new Error('I due tratti di bordo si sovrappongono: scegli punti piu\' lontani o riduci la larghezza.')
  }
  if (A.segment.length < 2 || B.segment.length < 2) throw new Error('Tratto di bordo troppo corto: aumenta la larghezza.')
  const P = data.mesh.positions
  const top = A.segment
  const bottom = [...B.segment].reverse()
  const faces = []
  let i = 0
  let j = 0
  while (i < top.length - 1 || j < bottom.length - 1) {
    const advanceTop =
      j >= bottom.length - 1 ||
      (i < top.length - 1 && distance(P, top[i + 1], bottom[j]) <= distance(P, top[i], bottom[j + 1]))
    if (advanceTop) {
      faces.push(top[i], top[i + 1], bottom[j])
      i++
    } else {
      faces.push(bottom[j + 1], bottom[j], top[i])
      j++
    }
  }
  const indices = new Uint32Array(data.mesh.indices.length + faces.length)
  indices.set(data.mesh.indices)
  indices.set(faces, data.mesh.indices.length)
  return {
    geometry: toGeometry(P.slice(), indices, data.mesh.colors?.slice()),
    triangles: faces.length / 3,
    gap: distance(P, a, b),
  }
}

/**
 * Raddrizza bordo (come "Tensione Bordo" di RealGuide).
 * 1. bordo: le onde piu' corte di una scala in mm (forza x 0,25 mm) vengono spianate con un filtro
 *    a compensazione (2*G(x) - G(G(x))): le increspature spariscono, ma il contorno non si
 *    restringe e le curve ampie (es. le estremita' dell'arcata) restano dove sono;
 * 2. fascia: lo spostamento del bordo si propaga sulla superficie entro la distanza scelta (lungo i
 *    triangoli) sfumando a zero, poi viene ammorbidito tra vertici vicini: niente scalini o punte.
 *    La fascia e' larga almeno il doppio dello spostamento locale, cosi' i triangoli non si ripiegano.
 * Restituisce le posizioni di arrivo del bordo e lo spostamento di ogni vertice (anteprima e Applica).
 */
export const STRAIGHTEN_MM_PER_STRENGTH = 0.25
const MAX_DIFFUSION_STEPS = 6000
const FIELD_SMOOTHING_STEPS = 12

function diffuseLoop(values, n, steps) {
  let current = values
  let next = new Float64Array(current.length)
  for (let it = 0; it < steps; it++) {
    for (let i = 0; i < n; i++) {
      const a = ((i - 1 + n) % n) * 3
      const b = ((i + 1) % n) * 3
      for (let k = 0; k < 3; k++) next[i * 3 + k] = 0.5 * current[i * 3 + k] + 0.25 * (current[a + k] + current[b + k])
    }
    ;[current, next] = [next, current]
  }
  return current
}

export function straightenBorderPreview(data, loopIndices, strength, distance) {
  const { mesh, loops } = data
  const P = mesh.positions
  const vertexCount = P.length / 3
  const selected = loopIndices.map((i) => loops[i]).filter(Boolean)

  // 1. bordo: k passi di (vicini - punto)/2 equivalgono a una gaussiana di ampiezza h * sqrt(k / 2)
  const scale = strength * STRAIGHTEN_MM_PER_STRENGTH
  const targets = new Map() // vertice di bordo -> [x, y, z]
  const disp = new Float32Array(vertexCount * 3) // spostamento di ogni vertice
  const fixed = new Uint8Array(vertexCount) // vertici di bordo: spostamento imposto
  let maxBoundary = 0
  for (const loop of selected) {
    const n = loop.length
    let h = 0
    for (let i = 0; i < n; i++) h += distanceBetween(P, loop[i], loop[(i + 1) % n])
    h = Math.max(h / n, 1e-6)
    const steps = Math.min(MAX_DIFFUSION_STEPS, Math.round(2 * (scale / h) ** 2))
    const original = new Float64Array(n * 3)
    loop.forEach((v, i) => original.set([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], i * 3))
    const once = diffuseLoop(original.slice(), n, steps)
    const twice = diffuseLoop(once.slice(), n, steps)
    loop.forEach((v, i) => {
      const target = [0, 1, 2].map((k) => 2 * once[i * 3 + k] - twice[i * 3 + k])
      targets.set(v, target)
      for (let k = 0; k < 3; k++) disp[v * 3 + k] = target[k] - P[v * 3 + k]
      fixed[v] = 1
      maxBoundary = Math.max(maxBoundary, Math.hypot(disp[v * 3], disp[v * 3 + 1], disp[v * 3 + 2]))
    })
  }

  // 2. fascia: distanza lungo la superficie dal bordo (Dijkstra con limite) e vertice di bordo di origine
  const reach = Math.max(distance, 2 * maxBoundary)
  const dist = new Float32Array(vertexCount).fill(Infinity)
  const source = new Int32Array(vertexCount).fill(-1)
  const adjacency = neighbors(mesh.indices, vertexCount)
  if (reach > 0 && targets.size) {
    const heap = [] // [distanza, vertice]
    const push = (d, v) => {
      heap.push([d, v])
      let i = heap.length - 1
      while (i > 0) {
        const parent = (i - 1) >> 1
        if (heap[parent][0] <= heap[i][0]) break
        ;[heap[parent], heap[i]] = [heap[i], heap[parent]]
        i = parent
      }
    }
    const pop = () => {
      const top = heap[0]
      const last = heap.pop()
      if (heap.length) {
        heap[0] = last
        let i = 0
        for (;;) {
          const l = 2 * i + 1
          const r = l + 1
          let m = i
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r
          if (m === i) break
          ;[heap[m], heap[i]] = [heap[i], heap[m]]
          i = m
        }
      }
      return top
    }
    for (const v of targets.keys()) {
      dist[v] = 0
      source[v] = v
      push(0, v)
    }
    while (heap.length) {
      const [d, v] = pop()
      if (d > dist[v]) continue
      for (const u of adjacency[v]) {
        const nd = d + distanceBetween(P, v, u)
        if (nd < dist[u] && nd <= reach) {
          dist[u] = nd
          source[u] = source[v]
          push(nd, u)
        }
      }
    }
  }

  // spostamento iniziale nella fascia: quello del bordo d'origine, sfumato fino a una distanza
  // pari al massimo tra la distanza scelta e il doppio dello spostamento locale
  const band = []
  for (let v = 0; v < vertexCount; v++) {
    if (fixed[v] || source[v] < 0) continue
    const s = source[v]
    const local = Math.hypot(disp[s * 3], disp[s * 3 + 1], disp[s * 3 + 2])
    const w = straightenWeight(dist[v], Math.max(distance, 2 * local))
    if (w <= 0) continue
    for (let k = 0; k < 3; k++) disp[v * 3 + k] = disp[s * 3 + k] * w
    band.push(v)
  }
  // ammorbidimento dello spostamento tra vertici vicini (il bordo resta fisso, fuori fascia = 0)
  const next = new Float32Array(band.length * 3)
  for (let it = 0; it < FIELD_SMOOTHING_STEPS; it++) {
    band.forEach((v, i) => {
      let x = 0, y = 0, z = 0
      for (const u of adjacency[v]) { x += disp[u * 3]; y += disp[u * 3 + 1]; z += disp[u * 3 + 2] }
      const n = adjacency[v].size || 1
      next[i * 3] = 0.5 * disp[v * 3] + 0.5 * (x / n)
      next[i * 3 + 1] = 0.5 * disp[v * 3 + 1] + 0.5 * (y / n)
      next[i * 3 + 2] = 0.5 * disp[v * 3 + 2] + 0.5 * (z / n)
    })
    band.forEach((v, i) => disp.set(next.subarray(i * 3, i * 3 + 3), v * 3))
  }

  const moved = new Float32Array(vertexCount)
  let maxMoved = 0
  for (let v = 0; v < vertexCount; v++) {
    const d = Math.hypot(disp[v * 3], disp[v * 3 + 1], disp[v * 3 + 2])
    moved[v] = d
    if (d > maxMoved) maxMoved = d
  }
  return { targets, disp, dist, distance, moved, maxMoved }
}

const distanceBetween = (P, a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2])

// peso dello spostamento nella fascia: 1 sul bordo, 0 al limite, con raccordo morbido
export const straightenWeight = (d, distance) => {
  if (!Number.isFinite(d)) return 0
  if (distance <= 0) return d === 0 ? 1 : 0
  const t = Math.min(1, d / distance)
  return 1 - t * t * (3 - 2 * t)
}

export function applyStraightenBorder(data, preview) {
  const P = data.mesh.positions.slice()
  const { disp } = preview
  for (let i = 0; i < P.length; i++) P[i] += disp[i]
  return toGeometry(P, data.mesh.indices.slice(), data.mesh.colors?.slice())
}
