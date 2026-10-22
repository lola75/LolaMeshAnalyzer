import * as THREE from 'three'

// Rilevamento e chiusura dei fori di una mesh triangolare.
// Un foro è un anello di spigoli di bordo, cioè spigoli usati da una sola faccia.
// La chiusura segue lo schema di Liepa ("Filling holes in meshes", 2003), usato
// comunemente: triangolazione del contorno, infittimento e levigatura.

const EDGE_KEY_BASE = 67108864 // 2^26: chiave numerica univoca per una coppia di vertici
const MAX_MWT_LOOP = 120 // oltre questa soglia la triangolazione ottima O(n^3) è troppo lenta
const MAX_NEW_VERTICES = 60000

const analysisCache = new WeakMap()

const edgeKey = (a, b) => (a < b ? a * EDGE_KEY_BASE + b : b * EDGE_KEY_BASE + a)
const edgeKeyVertices = (key) => {
  const a = Math.floor(key / EDGE_KEY_BASE)
  return [a, key - a * EDGE_KEY_BASE]
}

const sub = (P, a, b) => [P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]]
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
const norm = (u) => Math.sqrt(dot(u, u))
const dist = (P, a, b) => norm(sub(P, a, b))
const triNormal = (P, a, b, c) => cross(sub(P, b, a), sub(P, c, a)) // lunghezza = 2 * area
const triArea = (P, a, b, c) => norm(triNormal(P, a, b, c)) / 2
const angleAt = (P, apex, u, v) => {
  const e1 = sub(P, u, apex)
  const e2 = sub(P, v, apex)
  return Math.atan2(norm(cross(e1, e2)), dot(e1, e2))
}

// Unisce i vertici con la stessa posizione: negli STL ogni triangolo ha vertici propri.
export function weldGeometry(geometry) {
  const posAttr = geometry.getAttribute('position')
  if (!posAttr || posAttr.count === 0) {
    throw new Error('La mesh non contiene vertici.')
  }
  const colorAttr = geometry.getAttribute('color')
  const srcIndex = geometry.index ? geometry.index.array : null

  const box = new THREE.Box3().setFromBufferAttribute(posAttr)
  const diagonal = box.min.distanceTo(box.max)
  const inv = 1 / (diagonal > 0 ? diagonal * 1e-7 : 1e-9)

  const remap = new Uint32Array(posAttr.count)
  const keyToIndex = new Map()
  const positions = []
  const colors = colorAttr ? [] : null
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i)
    const y = posAttr.getY(i)
    const z = posAttr.getZ(i)
    const key = `${Math.round(x * inv)}_${Math.round(y * inv)}_${Math.round(z * inv)}`
    let index = keyToIndex.get(key)
    if (index === undefined) {
      index = positions.length / 3
      keyToIndex.set(key, index)
      positions.push(x, y, z)
      if (colors) colors.push(colorAttr.getX(i), colorAttr.getY(i), colorAttr.getZ(i))
    }
    remap[i] = index
  }

  const cornerCount = srcIndex ? srcIndex.length : posAttr.count - (posAttr.count % 3)
  const triangles = []
  for (let i = 0; i + 2 < cornerCount; i += 3) {
    const a = remap[srcIndex ? srcIndex[i] : i]
    const b = remap[srcIndex ? srcIndex[i + 1] : i + 1]
    const c = remap[srcIndex ? srcIndex[i + 2] : i + 2]
    if (a === b || b === c || a === c) continue
    triangles.push(a, b, c)
  }

  return {
    positions: new Float32Array(positions),
    colors: colors ? new Float32Array(colors) : null,
    indices: new Uint32Array(triangles),
    diagonal,
  }
}

// Restituisce gli anelli di bordo. Ogni anello è orientato in senso opposto alle
// facce adiacenti, così i triangoli di chiusura hanno un orientamento coerente.
export function findBoundaryLoops(indices) {
  // valore = 2 * numero di facce + 1 se la prima faccia percorre lo spigolo dal vertice maggiore
  const edges = new Map()
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const u = indices[t + k]
      const v = indices[t + ((k + 1) % 3)]
      const key = edgeKey(u, v)
      const previous = edges.get(key)
      edges.set(key, previous === undefined ? (u < v ? 2 : 3) : previous + 2)
    }
  }

  const outgoing = new Map()
  for (const [key, value] of edges) {
    if (value >> 1 !== 1) continue
    const [lo, hi] = edgeKeyVertices(key)
    const [from, to] = (value & 1) === 0 ? [lo, hi] : [hi, lo]
    // il foro percorre lo spigolo della faccia al contrario: to -> from
    const list = outgoing.get(to)
    if (list) list.push(from)
    else outgoing.set(to, [from])
  }

  const loops = []
  for (const start of outgoing.keys()) {
    while (outgoing.get(start).length > 0) {
      const path = [start]
      const where = new Map([[start, 0]])
      let current = start
      for (;;) {
        const next = outgoing.get(current)?.pop()
        if (next === undefined) break // catena aperta (mesh non manifold): scartata
        const k = where.get(next)
        if (k === undefined) {
          where.set(next, path.length)
          path.push(next)
          current = next
          continue
        }
        // anello chiuso; se passa due volte per lo stesso vertice si separa il sotto-anello
        const loop = path.slice(k)
        if (loop.length >= 3) loops.push(loop)
        if (k === 0) break
        for (let i = k + 1; i < path.length; i++) where.delete(path[i])
        path.length = k + 1
        current = next
      }
    }
  }
  return loops
}

function loopNormal(loop, P) {
  // metodo di Newell
  const n = [0, 0, 0]
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i] * 3
    const b = loop[(i + 1) % loop.length] * 3
    n[0] += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2])
    n[1] += (P[a + 2] - P[b + 2]) * (P[a] + P[b])
    n[2] += (P[a] - P[b]) * (P[a + 1] + P[b + 1])
  }
  return n
}

function describeLoop(loop, P) {
  let perimeter = 0
  const centroid = [0, 0, 0]
  for (let i = 0; i < loop.length; i++) {
    perimeter += dist(P, loop[i], loop[(i + 1) % loop.length])
    for (let k = 0; k < 3; k++) centroid[k] += P[loop[i] * 3 + k]
  }
  for (let k = 0; k < 3; k++) centroid[k] /= loop.length
  let radius = 0
  for (const v of loop) {
    radius = Math.max(radius, Math.hypot(P[v * 3] - centroid[0], P[v * 3 + 1] - centroid[1], P[v * 3 + 2] - centroid[2]))
  }
  return {
    loop,
    edgeCount: loop.length,
    perimeter,
    centroid,
    radius,
    area: norm(loopNormal(loop, P)) / 2,
    isOuterBorder: false,
  }
}

/**
 * Trova i fori della mesh. Il risultato è in cache per geometria.
 * holes è ordinato dal più grande al più piccolo; isOuterBorder segnala il bordo
 * esterno di una scansione aperta (es. impronta intraorale), che di norma non va chiuso.
 */
export function analyzeHoles(geometry) {
  const cached = analysisCache.get(geometry)
  if (cached) return cached

  const mesh = weldGeometry(geometry)
  const holes = findBoundaryLoops(mesh.indices).map((loop) => describeLoop(loop, mesh.positions))
  holes.sort((a, b) => b.perimeter - a.perimeter)
  holes.forEach((hole, index) => {
    hole.id = index
  })
  const [largest, second] = holes
  if (largest && largest.perimeter >= 0.5 * mesh.diagonal && (!second || largest.perimeter >= 3 * second.perimeter)) {
    largest.isOuterBorder = true
  }

  const result = { mesh, holes, triangleCount: mesh.indices.length / 3 }
  analysisCache.set(geometry, result)
  return result
}

function originalNeighbors(indices, vertices) {
  const ring = new Map()
  vertices.forEach((v) => ring.set(v, new Set()))
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]
    const b = indices[t + 1]
    const c = indices[t + 2]
    if (ring.has(a)) ring.get(a).add(b).add(c)
    if (ring.has(b)) ring.get(b).add(a).add(c)
    if (ring.has(c)) ring.get(c).add(a).add(b)
  }
  return ring
}

// Triangolazione a peso minimo (area + lunghezza delle diagonali) del contorno.
function minimumWeightTriangulation(loop, P, edgeExists) {
  const n = loop.length
  let boundaryLength = 0
  for (let i = 0; i < n; i++) boundaryLength += dist(P, loop[i], loop[(i + 1) % n])
  const mu = boundaryLength / n

  const W = new Float64Array(n * n)
  const S = new Int32Array(n * n).fill(-1)
  for (let gap = 2; gap < n; gap++) {
    for (let i = 0; i + gap < n; i++) {
      const j = i + gap
      const isLoopEdge = i === 0 && j === n - 1
      // una diagonale non deve duplicare uno spigolo già presente nella mesh
      if (!isLoopEdge && edgeExists(loop[i], loop[j])) {
        W[i * n + j] = Infinity
        continue
      }
      const chord = isLoopEdge ? 0 : mu * dist(P, loop[i], loop[j])
      let best = Infinity
      let bestM = -1
      for (let m = i + 1; m < j; m++) {
        const w = W[i * n + m] + W[m * n + j]
        if (w >= best) continue
        const total = w + triArea(P, loop[i], loop[m], loop[j]) + chord
        if (total < best) {
          best = total
          bestM = m
        }
      }
      W[i * n + j] = best
      S[i * n + j] = bestM
    }
  }
  if (!Number.isFinite(W[n - 1])) return null

  const triangles = []
  const stack = [[0, n - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()
    const m = S[i * n + j]
    triangles.push([loop[i], loop[m], loop[j]])
    if (m - i > 1) stack.push([i, m])
    if (j - m > 1) stack.push([m, j])
  }
  return triangles
}

// Per contorni lunghi: taglio progressivo dell'angolo interno più acuto.
function earClipTriangulation(loop, P, edgeExists) {
  const normal = loopNormal(loop, P)
  const length = norm(normal)
  const unit = length > 0 ? normal.map((c) => c / length) : [0, 0, 1]
  const poly = loop.slice()

  const interiorAngle = (k) => {
    const n = poly.length
    const a = poly[(k - 1 + n) % n]
    const b = poly[k]
    const c = poly[(k + 1) % n]
    const e1 = sub(P, b, a)
    const e2 = sub(P, c, b)
    return Math.PI - Math.atan2(dot(cross(e1, e2), unit), dot(e1, e2))
  }

  const angles = poly.map((_, k) => interiorAngle(k))
  const triangles = []
  while (poly.length > 3) {
    const n = poly.length
    let best = -1
    let fallback = -1
    for (let k = 0; k < n; k++) {
      if (fallback < 0 || angles[k] < angles[fallback]) fallback = k
      if ((best < 0 || angles[k] < angles[best]) && !edgeExists(poly[(k - 1 + n) % n], poly[(k + 1) % n])) best = k
    }
    const k = best >= 0 ? best : fallback
    triangles.push([poly[(k - 1 + n) % n], poly[k], poly[(k + 1) % n]])
    poly.splice(k, 1)
    angles.splice(k, 1)
    const m = poly.length
    angles[(k - 1 + m) % m] = interiorAngle((k - 1 + m) % m)
    angles[k % m] = interiorAngle(k % m)
  }
  triangles.push([poly[0], poly[1], poly[2]])
  return triangles
}

function triangulateLoop(loop, P, edgeExists) {
  if (loop.length === 3) return [[loop[0], loop[1], loop[2]]]
  if (loop.length <= MAX_MWT_LOOP) {
    const triangles = minimumWeightTriangulation(loop, P, edgeExists)
    if (triangles) return triangles
  }
  return earClipTriangulation(loop, P, edgeExists)
}

function buildEdgeMap(triangles) {
  const map = new Map()
  triangles.forEach(([a, b, c], t) => {
    for (const key of [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)]) {
      const list = map.get(key)
      if (list) list.push(t)
      else map.set(key, [t])
    }
  })
  return map
}

// Ruota il triangolo in modo che lo spigolo {a, b} sia il primo: [u, v, terzo].
function rotateToEdge(tri, a, b) {
  for (let k = 0; k < 3; k++) {
    const p = tri[k]
    const q = tri[(k + 1) % 3]
    if ((p === a && q === b) || (p === b && q === a)) return [p, q, tri[(k + 2) % 3]]
  }
  return null
}

// Scambio delle diagonali secondo il criterio di Delaunay (solo spigoli interni alla patch).
function flipEdges(triangles, P, edgeExists) {
  for (let iteration = 0; iteration < 8; iteration++) {
    const edgeTris = buildEdgeMap(triangles)
    const patchEdges = new Set(edgeTris.keys())
    const touched = new Set()
    let flipped = 0
    for (const [key, list] of edgeTris) {
      if (list.length !== 2) continue
      const [t1, t2] = list
      if (touched.has(t1) || touched.has(t2)) continue
      const [a, b] = edgeKeyVertices(key)
      const r1 = rotateToEdge(triangles[t1], a, b)
      const r2 = rotateToEdge(triangles[t2], a, b)
      if (!r1 || !r2) continue
      const [u, v, x] = r1
      if (r2[0] !== v || r2[1] !== u) continue
      const y = r2[2]
      if (x === y) continue
      if (angleAt(P, x, u, v) + angleAt(P, y, v, u) <= Math.PI + 1e-9) continue
      if (patchEdges.has(edgeKey(x, y)) || edgeExists(x, y)) continue
      const n1 = triNormal(P, u, v, x)
      const n2 = triNormal(P, v, u, y)
      const before = [n1[0] + n2[0], n1[1] + n2[1], n1[2] + n2[2]]
      if (dot(triNormal(P, u, y, x), before) <= 0 || dot(triNormal(P, y, v, x), before) <= 0) continue
      triangles[t1] = [u, y, x]
      triangles[t2] = [y, v, x]
      touched.add(t1)
      touched.add(t2)
      patchEdges.add(edgeKey(x, y))
      flipped++
    }
    if (!flipped) break
  }
}

function splitTriangle(triangles, t, a, b, m) {
  const [u, v, w] = rotateToEdge(triangles[t], a, b)
  triangles[t] = [u, m, w]
  triangles.push([m, v, w])
}

// Infittisce la patch finché i triangoli hanno lati simili a quelli del bordo.
function refinePatch(triangles, ctx, targetLength, edgeExists) {
  const P = ctx.positions
  const C = ctx.colors
  const maxLength = targetLength * 1.4
  const newVertices = []

  for (let round = 0; round < 24 && ctx.budget > 0; round++) {
    const candidates = []
    for (const [key, list] of buildEdgeMap(triangles)) {
      if (list.length !== 2) continue // gli spigoli del contorno non si dividono
      const [a, b] = edgeKeyVertices(key)
      const length = dist(P, a, b)
      if (length > maxLength) candidates.push([length, a, b, list[0], list[1]])
    }
    if (!candidates.length) break
    candidates.sort((x, y) => y[0] - x[0])

    const touched = new Set()
    for (const [, a, b, t1, t2] of candidates) {
      if (ctx.budget <= 0) break
      if (touched.has(t1) || touched.has(t2)) continue
      touched.add(t1)
      touched.add(t2)
      const m = P.length / 3
      P.push((P[a * 3] + P[b * 3]) / 2, (P[a * 3 + 1] + P[b * 3 + 1]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2)
      if (C) C.push((C[a * 3] + C[b * 3]) / 2, (C[a * 3 + 1] + C[b * 3 + 1]) / 2, (C[a * 3 + 2] + C[b * 3 + 2]) / 2)
      newVertices.push(m)
      ctx.budget--
      splitTriangle(triangles, t1, a, b, m)
      splitTriangle(triangles, t2, a, b, m)
    }
    flipEdges(triangles, P, edgeExists)
  }
  return newVertices
}

// Levigatura dei vertici nuovi a bordo fisso.
// 'flat': membrana (laplaciano). 'smooth': raccordo con la curvatura della mesh
// circostante (bi-laplaciano che usa anche l'anello di vertici originali attorno al foro).
function fairPatch(triangles, newVertices, ctx, mode) {
  const P = ctx.positions
  const neighbors = new Map()
  const link = (a, b) => {
    const set = neighbors.get(a)
    if (set) set.add(b)
    else neighbors.set(a, new Set([b]))
  }
  for (const [a, b, c] of triangles) {
    link(a, b); link(b, a); link(b, c); link(c, b); link(c, a); link(a, c)
  }

  const local = new Map()
  const vertices = []
  const addLocal = (v) => {
    if (!local.has(v)) {
      local.set(v, vertices.length)
      vertices.push(v)
    }
  }
  newVertices.forEach(addLocal)
  const interiorCount = newVertices.length
  for (const v of neighbors.keys()) addLocal(v)

  // Righe del laplaciano: vertici nuovi (incognite) e vertici del contorno.
  // Per il contorno si usano anche i vicini originali, così la toppa segue la curvatura.
  const rowCount = vertices.length
  const rowInterior = []
  const rowFixed = []
  const degree = new Float64Array(rowCount)
  for (let r = 0; r < rowCount; r++) {
    const v = vertices[r]
    const set = new Set(neighbors.get(v))
    if (r >= interiorCount) ctx.ring.get(v)?.forEach((w) => set.add(w))
    const interiorNbrs = []
    const fixedNbrs = []
    for (const w of set) {
      const j = local.get(w)
      if (j !== undefined && j < interiorCount) interiorNbrs.push(j)
      else fixedNbrs.push(w)
    }
    rowInterior.push(Int32Array.from(interiorNbrs))
    rowFixed.push(fixedNbrs)
    degree[r] = set.size
  }

  const n = interiorCount
  const x = new Float64Array(n)
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < n; i++) x[i] = P[vertices[i] * 3 + k]
    const fixedSum = rowFixed.map((list) => list.reduce((sum, w) => sum + P[w * 3 + k], 0))

    // 1) membrana: L x = 0 sui vertici nuovi, risolto con gradiente coniugato
    const applyK = (input, output) => {
      for (let i = 0; i < n; i++) {
        let s = degree[i] * input[i]
        for (const j of rowInterior[i]) s -= input[j]
        output[i] = s
      }
    }
    conjugateGradient(applyK, Float64Array.from(fixedSum.slice(0, n)), x, 4000)

    if (mode === 'smooth') {
      // 2) raccordo: minimi quadrati di L x su vertici nuovi e contorno (CGLS)
      const constant = new Float64Array(rowCount)
      for (let r = 0; r < rowCount; r++) {
        constant[r] = fixedSum[r] - (r >= n ? degree[r] * P[vertices[r] * 3 + k] : 0)
      }
      const applyA = (input, output) => {
        for (let r = 0; r < rowCount; r++) {
          let s = r < n ? -degree[r] * input[r] : 0
          for (const j of rowInterior[r]) s += input[j]
          output[r] = s
        }
      }
      const applyAt = (input, output) => {
        output.fill(0)
        for (let r = 0; r < rowCount; r++) {
          const value = input[r]
          if (r < n) output[r] -= degree[r] * value
          for (const j of rowInterior[r]) output[j] += value
        }
      }
      leastSquaresCG(applyA, applyAt, constant, x, rowCount, 6000)
    }

    for (let i = 0; i < n; i++) P[vertices[i] * 3 + k] = x[i]
  }
}

function conjugateGradient(apply, rhs, x, maxIterations) {
  const n = x.length
  const r = new Float64Array(n)
  const p = new Float64Array(n)
  const q = new Float64Array(n)
  apply(x, q)
  let rr = 0
  let bb = 0
  for (let i = 0; i < n; i++) {
    r[i] = rhs[i] - q[i]
    p[i] = r[i]
    rr += r[i] * r[i]
    bb += rhs[i] * rhs[i]
  }
  // residuo relativo 1e-7: più che sufficiente per le posizioni; con soglie più strette
  // il metodo arrivava sempre al numero massimo di iterazioni
  const tolerance = 1e-14 * Math.max(bb, 1e-30)
  for (let iteration = 0; iteration < maxIterations && rr > tolerance; iteration++) {
    apply(p, q)
    let pq = 0
    for (let i = 0; i < n; i++) pq += p[i] * q[i]
    if (pq <= 0) break
    const alpha = rr / pq
    let next = 0
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i]
      r[i] -= alpha * q[i]
      next += r[i] * r[i]
    }
    const beta = next / rr
    rr = next
    for (let i = 0; i < n; i++) p[i] = r[i] + beta * p[i]
  }
}

// Minimizza |A x + c|^2 (CGLS), partendo dalla soluzione corrente x.
function leastSquaresCG(applyA, applyAt, c, x, rowCount, maxIterations) {
  const n = x.length
  const residual = new Float64Array(rowCount)
  const q = new Float64Array(rowCount)
  const s = new Float64Array(n)
  const p = new Float64Array(n)
  applyA(x, residual)
  for (let r = 0; r < rowCount; r++) residual[r] = -(residual[r] + c[r])
  applyAt(residual, s)
  p.set(s)
  let gamma = 0
  for (let i = 0; i < n; i++) gamma += s[i] * s[i]
  const tolerance = gamma * 1e-12
  for (let iteration = 0; iteration < maxIterations && gamma > tolerance && gamma > 0; iteration++) {
    applyA(p, q)
    let qq = 0
    for (let r = 0; r < rowCount; r++) qq += q[r] * q[r]
    if (qq <= 0) break
    const alpha = gamma / qq
    for (let i = 0; i < n; i++) x[i] += alpha * p[i]
    for (let r = 0; r < rowCount; r++) residual[r] -= alpha * q[r]
    applyAt(residual, s)
    let next = 0
    for (let i = 0; i < n; i++) next += s[i] * s[i]
    const beta = next / gamma
    gamma = next
    for (let i = 0; i < n; i++) p[i] = s[i] + beta * p[i]
  }
}

function fillLoop(hole, ctx, mode) {
  const { loop } = hole
  const edgeExists = (a, b) => ctx.ring.get(a)?.has(b) ?? false
  const triangles = triangulateLoop(loop, ctx.positions, edgeExists)
  if (mode !== 'minimal' && loop.length > 3) {
    const newVertices = refinePatch(triangles, ctx, hole.perimeter / loop.length, edgeExists)
    if (newVertices.length) fairPatch(triangles, newVertices, ctx, mode)
  }
  // registra i nuovi spigoli tra vertici di bordo (fori che condividono un vertice)
  for (const [a, b, c] of triangles) {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (ctx.ring.has(p) && ctx.ring.has(q)) {
        ctx.ring.get(p).add(q)
        ctx.ring.get(q).add(p)
      }
    }
  }
  return triangles
}

/**
 * Chiude i fori indicati e restituisce una nuova geometria indicizzata.
 * mode: 'smooth' (raccordato), 'flat' (piatto), 'minimal' (solo triangolazione del bordo).
 */
export function fillHoles(analysis, holeIds, mode = 'smooth', onProgress) {
  const { mesh, holes } = analysis
  const selected = holeIds.map((id) => holes.find((hole) => hole.id === id)).filter(Boolean)
  if (!selected.length) throw new Error('Nessun foro selezionato.')

  const boundary = new Set()
  selected.forEach((hole) => hole.loop.forEach((v) => boundary.add(v)))
  const ctx = {
    positions: Array.from(mesh.positions),
    colors: mesh.colors ? Array.from(mesh.colors) : null,
    ring: originalNeighbors(mesh.indices, boundary),
    budget: MAX_NEW_VERTICES,
  }

  const added = []
  selected.forEach((hole, i) => {
    for (const [a, b, c] of fillLoop(hole, ctx, mode)) added.push(a, b, c)
    onProgress?.(i + 1, selected.length)
  })

  const indices = new Uint32Array(mesh.indices.length + added.length)
  indices.set(mesh.indices)
  indices.set(added, mesh.indices.length)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(ctx.positions, 3))
  if (ctx.colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(ctx.colors, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  return {
    geometry,
    filledCount: selected.length,
    addedTriangles: added.length / 3,
    addedVertices: ctx.positions.length / 3 - mesh.positions.length / 3,
  }
}

export function geometryToBinarySTL(geometry) {
  const position = geometry.getAttribute('position')
  const index = geometry.index
  const triangleCount = index ? index.count / 3 : Math.floor(position.count / 3)
  const buffer = new ArrayBuffer(84 + triangleCount * 50)
  const view = new DataView(buffer)
  const header = new TextEncoder().encode('Analizzatore di Mesh - mesh riparata')
  new Uint8Array(buffer, 0, 80).set(header.subarray(0, 80))
  view.setUint32(80, triangleCount, true)

  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const edge = new THREE.Vector3()
  let offset = 84
  for (let t = 0; t < triangleCount; t++) {
    const ia = index ? index.getX(t * 3) : t * 3
    const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1
    const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2
    a.fromBufferAttribute(position, ia)
    b.fromBufferAttribute(position, ib)
    c.fromBufferAttribute(position, ic)
    normal.subVectors(c, b).cross(edge.subVectors(a, b)).normalize()
    for (const vector of [normal, a, b, c]) {
      view.setFloat32(offset, vector.x, true)
      view.setFloat32(offset + 4, vector.y, true)
      view.setFloat32(offset + 8, vector.z, true)
      offset += 12
    }
    view.setUint16(offset, 0, true)
    offset += 2
  }
  return buffer
}
