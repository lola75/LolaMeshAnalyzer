// Sottosquadri rispetto a una direzione di inserzione (Rimozione Sottosquadri, Crea Marker Scan).
//
// Mappa di quota ("dexel") vista dalla direzione di inserzione `up`: per ogni cella del piano
// perpendicolare si tiene la quota piu' alta della superficie (l'involucro visto dall'alto).
// Un punto e' in sottosquadro se sopra di lui c'e' altra superficie (involucro piu' alto).
// La profondita' e' orizzontale, come col parallelometro: distanza nel piano dalla cella piu'
// vicina in cui il punto non sarebbe piu' coperto (involucro alla sua quota o piu' basso).

export const UNDERCUT_MAX_MM = 1.5
const SEARCH_MM = 2.5 // oltre: profondita' "massima" (viola)

// positions: Float32Array [x, y, z...] in mm; indices: triangoli (o null se non indicizzata)
// up: [x, y, z] unitario, verso da cui arriva la guida. Restituisce Float32Array di profondita'
// in mm per vertice (0 = non in sottosquadro).
export function computeUndercuts(positions, indices, up, { cell: cellSize = null } = {}) {
  const n = positions.length / 3
  const [ux, uy, uz] = up
  // base del piano perpendicolare a up
  const helper = Math.abs(ux) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  let ax = uy * helper[2] - uz * helper[1]
  let ay = uz * helper[0] - ux * helper[2]
  let az = ux * helper[1] - uy * helper[0]
  const al = Math.hypot(ax, ay, az)
  ax /= al; ay /= al; az /= al
  const bx = uy * az - uz * ay
  const by = uz * ax - ux * az
  const bz = ux * ay - uy * ax

  const X = new Float32Array(n)
  const Y = new Float32Array(n)
  const H = new Float32Array(n)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2]
    X[i] = px * ax + py * ay + pz * az
    Y[i] = px * bx + py * by + pz * bz
    H[i] = px * ux + py * uy + pz * uz
    if (X[i] < minX) minX = X[i]
    if (X[i] > maxX) maxX = X[i]
    if (Y[i] < minY) minY = Y[i]
    if (Y[i] > maxY) maxY = Y[i]
  }
  const size = Math.max(maxX - minX, maxY - minY, 1e-6)
  const c = cellSize || Math.max(0.05, size / 900)
  const W = Math.ceil((maxX - minX) / c) + 3
  const R = Math.ceil((maxY - minY) / c) + 3
  const top = new Float32Array(W * R).fill(-Infinity)
  const ci = (x) => Math.floor((x - minX) / c) + 1
  const cj = (y) => Math.floor((y - minY) / c) + 1

  // involucro dall'alto: rasterizzazione dei triangoli (quota interpolata nella cella)
  const triangleCount = indices ? indices.length / 3 : n / 3
  for (let t = 0; t < triangleCount; t++) {
    const a = indices ? indices[t * 3] : t * 3
    const b = indices ? indices[t * 3 + 1] : t * 3 + 1
    const d = indices ? indices[t * 3 + 2] : t * 3 + 2
    const x0 = X[a], y0 = Y[a], x1 = X[b], y1 = Y[b], x2 = X[d], y2 = Y[d]
    const i0 = ci(Math.min(x0, x1, x2)), i1 = ci(Math.max(x0, x1, x2))
    const j0 = cj(Math.min(y0, y1, y2)), j1 = cj(Math.max(y0, y1, y2))
    const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    if (Math.abs(det) < 1e-12) {
      // triangolo visto di taglio: conta i soli vertici
      for (const v of [a, b, d]) {
        const k = cj(Y[v]) * W + ci(X[v])
        if (H[v] > top[k]) top[k] = H[v]
      }
      continue
    }
    for (let j = j0; j <= j1; j++) {
      const yc = minY + (j - 0.5) * c
      for (let i = i0; i <= i1; i++) {
        const xc = minX + (i - 0.5) * c
        let l0 = ((y1 - y2) * (xc - x2) + (x2 - x1) * (yc - y2)) / det
        let l1 = ((y2 - y0) * (xc - x2) + (x0 - x2) * (yc - y2)) / det
        let l2 = 1 - l0 - l1
        // centro della cella fuori dal triangolo: si usa il punto del triangolo piu' vicino (bordi)
        if (l0 < -0.05 || l1 < -0.05 || l2 < -0.05) continue
        l0 = Math.max(0, l0); l1 = Math.max(0, l1); l2 = Math.max(0, l2)
        const s = l0 + l1 + l2
        const h = (l0 * H[a] + l1 * H[b] + l2 * H[d]) / s
        const k = j * W + i
        if (h > top[k]) top[k] = h
      }
    }
    for (const v of [a, b, d]) {
      const k = cj(Y[v]) * W + ci(X[v])
      if (H[v] > top[k]) top[k] = H[v]
    }
  }

  // spirale di celle ordinate per distanza (per la ricerca del punto libero piu' vicino)
  const radius = Math.ceil(SEARCH_MM / c)
  const offsets = []
  for (let dj = -radius; dj <= radius; dj++) {
    for (let di = -radius; di <= radius; di++) {
      const dist = Math.hypot(di, dj)
      if (dist <= radius) offsets.push([dist, di, dj])
    }
  }
  offsets.sort((p, q) => p[0] - q[0])

  const depth = new Float32Array(n)
  const tolerance = Math.max(0.05, c * 1.5) // mm: piccole differenze di quota nella stessa cella
  for (let v = 0; v < n; v++) {
    const i = ci(X[v])
    const j = cj(Y[v])
    const h = H[v] + tolerance
    if (top[j * W + i] <= h) continue // visibile dall'alto: nessun sottosquadro
    let found = -1
    for (let o = 1; o < offsets.length; o++) {
      const [dist, di, dj] = offsets[o]
      const ii = i + di
      const jj = j + dj
      if (ii < 0 || jj < 0 || ii >= W || jj >= R) { found = dist; break } // fuori dal modello: libero
      if (top[jj * W + ii] <= h) { found = dist; break }
    }
    depth[v] = found < 0 ? SEARCH_MM : Math.max(0, (found - 0.5) * c)
  }
  return depth
}

// Colori della mappa: blu 0 -> verde -> giallo -> rosso -> viola (>= UNDERCUT_MAX_MM);
// fuori dai sottosquadri il grigio chiaro del modello
const RAMP = [[0.1, 0.3, 1], [0, 0.85, 0.3], [1, 0.9, 0], [1, 0.1, 0.1], [0.85, 0, 0.9]]
export const UNDERCUT_BASE_COLOR = [0.9, 0.9, 0.92]

export function undercutColor(depthMm, out = [0, 0, 0]) {
  if (!(depthMm > 0.01)) {
    out[0] = UNDERCUT_BASE_COLOR[0]; out[1] = UNDERCUT_BASE_COLOR[1]; out[2] = UNDERCUT_BASE_COLOR[2]
    return out
  }
  const t = Math.min(1, depthMm / UNDERCUT_MAX_MM) * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(t))
  const f = t - i
  for (let k = 0; k < 3; k++) out[k] = RAMP[i][k] + (RAMP[i + 1][k] - RAMP[i][k]) * f
  return out
}

// ---------------------------------------------------------------------------------------------
// Genera superficie senza sottosquadri: modello "riempito" lungo la direzione di inserzione.
// Dall'alto la superficie e' l'involucro del modello (i dettagli dei denti restano); sotto, le
// zone in sottosquadro sono riempite in verticale fino a una base piatta (pareti dritte, o
// inclinate con l'angolo laterale). Si costruisce una mappa di quota su griglia e da questa una
// mesh chiusa: superficie superiore, pareti e fondo.

export function basisFor([ux, uy, uz]) {
  const helper = Math.abs(ux) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  let ax = uy * helper[2] - uz * helper[1]
  let ay = uz * helper[0] - ux * helper[2]
  let az = ux * helper[1] - uy * helper[0]
  const al = Math.hypot(ax, ay, az)
  ax /= al; ay /= al; az /= al
  // b = u x a: (a, b, u) destrorsa, cosi' i triangoli antiorari nel piano guardano verso u
  const bx = uy * az - uz * ay
  const by = uz * ax - ux * az
  const bz = ux * ay - uy * ax
  return { a: [ax, ay, az], b: [bx, by, bz], u: [ux, uy, uz] }
}

// mappa di quota: massima altezza della superficie per cella (-Infinity = cella vuota)
export function heightMap(positions, indices, basis, c, margin) {
  const n = positions.length / 3
  const { a, b, u } = basis
  const X = new Float32Array(n)
  const Y = new Float32Array(n)
  const Hh = new Float32Array(n)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, minH = Infinity
  for (let i = 0; i < n; i++) {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2]
    X[i] = px * a[0] + py * a[1] + pz * a[2]
    Y[i] = px * b[0] + py * b[1] + pz * b[2]
    Hh[i] = px * u[0] + py * u[1] + pz * u[2]
    if (X[i] < minX) minX = X[i]
    if (X[i] > maxX) maxX = X[i]
    if (Y[i] < minY) minY = Y[i]
    if (Y[i] > maxY) maxY = Y[i]
    if (Hh[i] < minH) minH = Hh[i]
  }
  const pad = Math.ceil(margin / c) + 2
  minX -= pad * c
  minY -= pad * c
  const W = Math.ceil((maxX - minX) / c) + pad + 2
  const R = Math.ceil((maxY - minY) / c) + pad + 2
  const top = new Float32Array(W * R).fill(-Infinity)
  const triangleCount = indices ? indices.length / 3 : n / 3
  for (let t = 0; t < triangleCount; t++) {
    const p = indices ? indices[t * 3] : t * 3
    const q = indices ? indices[t * 3 + 1] : t * 3 + 1
    const r = indices ? indices[t * 3 + 2] : t * 3 + 2
    const x0 = X[p], y0 = Y[p], x1 = X[q], y1 = Y[q], x2 = X[r], y2 = Y[r]
    const i0 = Math.floor((Math.min(x0, x1, x2) - minX) / c)
    const i1 = Math.floor((Math.max(x0, x1, x2) - minX) / c)
    const j0 = Math.floor((Math.min(y0, y1, y2) - minY) / c)
    const j1 = Math.floor((Math.max(y0, y1, y2) - minY) / c)
    const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    for (let j = j0; j <= j1; j++) {
      const yc = minY + (j + 0.5) * c
      for (let i = i0; i <= i1; i++) {
        const k = j * W + i
        let h
        if (Math.abs(det) < 1e-12) {
          h = Math.max(Hh[p], Hh[q], Hh[r])
        } else {
          const xc = minX + (i + 0.5) * c
          const l0 = ((y1 - y2) * (xc - x2) + (x2 - x1) * (yc - y2)) / det
          const l1 = ((y2 - y0) * (xc - x2) + (x0 - x2) * (yc - y2)) / det
          const l2 = 1 - l0 - l1
          if (l0 < -1e-3 || l1 < -1e-3 || l2 < -1e-3) continue
          h = l0 * Hh[p] + l1 * Hh[q] + l2 * Hh[r]
        }
        if (h > top[k]) top[k] = h
      }
    }
  }
  return { top, W, R, minX, minY, minH }
}

// buchi piccoli nella mappa (celle vuote circondate da celle piene): riempiti con la media
function fillGaps(top, W, R, passes = 2) {
  for (let pass = 0; pass < passes; pass++) {
    const next = top.slice()
    for (let j = 1; j < R - 1; j++) {
      for (let i = 1; i < W - 1; i++) {
        const k = j * W + i
        if (top[k] > -Infinity) continue
        let sum = 0
        let count = 0
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const h = top[k + dj * W + di]
            if (h > -Infinity) { sum += h; count++ }
          }
        }
        if (count >= 5) next[k] = sum / count
      }
    }
    top.set(next)
  }
}

// filtro mediano 3x3 sulle celle piene (Filtro riparazione mesh: numero di passaggi)
function medianFilter(top, W, R, passes) {
  const values = []
  for (let pass = 0; pass < passes; pass++) {
    const next = top.slice()
    for (let j = 1; j < R - 1; j++) {
      for (let i = 1; i < W - 1; i++) {
        const k = j * W + i
        if (!(top[k] > -Infinity)) continue
        values.length = 0
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const h = top[k + dj * W + di]
            if (h > -Infinity) values.push(h)
          }
        }
        values.sort((x, y) => x - y)
        next[k] = values[values.length >> 1]
      }
    }
    top.set(next)
  }
}

// disco di celle entro `radius` celle: [di, dj, distanza]
export function disk(radius) {
  const out = []
  const r = Math.ceil(radius)
  for (let dj = -r; dj <= r; dj++) {
    for (let di = -r; di <= r; di++) {
      const d = Math.hypot(di, dj)
      if (d <= radius) out.push([di, dj, d])
    }
  }
  return out
}

// Offset superficie: dilatazione sferica (il modello cresce di `offset` mm in ogni direzione)
export function offsetSurface(top, W, R, c, offset) {
  const cells = disk(offset / c)
  const next = top.slice()
  for (let j = 0; j < R; j++) {
    for (let i = 0; i < W; i++) {
      let best = top[j * W + i] > -Infinity ? top[j * W + i] + offset : -Infinity
      for (const [di, dj, d] of cells) {
        const ii = i + di
        const jj = j + dj
        if (ii < 0 || jj < 0 || ii >= W || jj >= R) continue
        const h = top[jj * W + ii]
        if (!(h > -Infinity)) continue
        const dm = d * c
        const v = h + Math.sqrt(Math.max(0, offset * offset - dm * dm))
        if (v > best) best = v
      }
      next[j * W + i] = best
    }
  }
  top.set(next)
}

// Ritenzione sottosquadri: erosione orizzontale di `retention` mm (la guida entra di tanto nei
// sottosquadri); si considerano solo le celle piene
function retainUndercuts(top, W, R, c, retention) {
  const cells = disk(retention / c)
  const next = top.slice()
  for (let j = 0; j < R; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i
      if (!(top[k] > -Infinity)) continue
      let low = top[k]
      for (const [di, dj] of cells) {
        const ii = i + di
        const jj = j + dj
        if (ii < 0 || jj < 0 || ii >= W || jj >= R) continue
        const h = top[jj * W + ii]
        if (h > -Infinity && h < low) low = h
      }
      next[k] = low
    }
  }
  top.set(next)
}

// Angolo laterale: pareti inclinate. Da ogni cella la quota scende di 1/tan(angolo) mm per mm di
// distanza orizzontale: due passate (avanti e indietro) con gli 8 vicini
function draftWalls(top, W, R, c, angleDeg, base) {
  const slope = 1 / Math.tan((angleDeg * Math.PI) / 180)
  const s1 = slope * c
  const s2 = slope * c * Math.SQRT2
  const forward = [[-1, 0, s1], [0, -1, s1], [-1, -1, s2], [1, -1, s2]]
  const backward = [[1, 0, s1], [0, 1, s1], [1, 1, s2], [-1, 1, s2]]
  const sweep = (offsets, reverse) => {
    for (let jn = 0; jn < R; jn++) {
      const j = reverse ? R - 1 - jn : jn
      for (let inn = 0; inn < W; inn++) {
        const i = reverse ? W - 1 - inn : inn
        const k = j * W + i
        for (const [di, dj, s] of offsets) {
          const ii = i + di
          const jj = j + dj
          if (ii < 0 || jj < 0 || ii >= W || jj >= R) continue
          const v = top[jj * W + ii] - s
          if (v > top[k] && v > base) top[k] = v
        }
      }
    }
  }
  for (let round = 0; round < 2; round++) {
    sweep(forward, false)
    sweep(backward, true)
  }
}

// Diametro lisciatura: media mobile (due passate) e poi massimo con la quota originale: si
// riempiono solchi e scalini piccoli senza mai scavare nel modello
function smoothSurface(top, W, R, c, diameter) {
  const r = Math.max(1, Math.round(diameter / 2 / c))
  const filled = top.map((h) => (h > -Infinity ? 1 : 0))
  let values = top.map((h) => (h > -Infinity ? h : 0))
  let weights = Float32Array.from(filled)
  const box = (src, horizontal) => {
    const out = new Float32Array(src.length)
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < W; i++) {
        let sum = 0
        for (let d = -r; d <= r; d++) {
          const ii = horizontal ? i + d : i
          const jj = horizontal ? j : j + d
          if (ii < 0 || jj < 0 || ii >= W || jj >= R) continue
          sum += src[jj * W + ii]
        }
        out[j * W + i] = sum
      }
    }
    return out
  }
  for (let pass = 0; pass < 2; pass++) {
    values = box(box(values, true), false)
    weights = box(box(weights, true), false)
  }
  for (let k = 0; k < top.length; k++) {
    if (!filled[k] || weights[k] <= 0) continue
    const blurred = values[k] / weights[k]
    if (blurred > top[k]) top[k] = blurred
  }
}

/**
 * positions, indices: mesh in mm; up: direzione di inserzione (unitaria, verso da cui arriva la guida).
 * params: { surfaceOffset, lateralAngle (gradi), undercutRetention, smoothingDiameter, repairFilter, cell }
 * Restituisce { positions: Float32Array, indices: Uint32Array, cell } della mesh chiusa riempita.
 */
export function buildBlockoutModel(positions, indices, up, params = {}) {
  const {
    surfaceOffset = 0, lateralAngle = 0, undercutRetention = 0, smoothingDiameter = 0.4, repairFilter = 0,
  } = params
  const basis = basisFor(up)
  const n = positions.length / 3
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i * 3 + k]
      if (v < lo[k]) lo[k] = v
      if (v > hi[k]) hi[k] = v
    }
  }
  const span = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
  const c = params.cell || Math.max(0.12, span / 600)
  const margin = surfaceOffset + 15 * Math.tan((Math.max(0, lateralAngle) * Math.PI) / 180) + 1
  const { top, W, R, minX, minY, minH } = heightMap(positions, indices, basis, c, margin)
  const base = minH - surfaceOffset

  fillGaps(top, W, R)
  if (repairFilter > 0) medianFilter(top, W, R, Math.round(repairFilter))
  if (surfaceOffset > 0) offsetSurface(top, W, R, c, surfaceOffset)
  if (undercutRetention > 0) retainUndercuts(top, W, R, c, undercutRetention)
  if (lateralAngle > 0) draftWalls(top, W, R, c, lateralAngle, base)
  if (smoothingDiameter > 0) smoothSurface(top, W, R, c, smoothingDiameter)

  const grid = { W, R, minX, minY, cell: c, basis }
  const solid = heightfieldSolid(grid, top, () => base, (k) => top[k] > base + 1e-4)
  return { ...solid, cell: c }
}

/**
 * Solido chiuso da una mappa di quota: per ogni cella piena un vertice sopra (quota top[k]) e uno
 * sotto (quota bottom(k)); quadrati di 4 celle piene per le due superfici, pareti lungo il contorno.
 * grid: { W, R, minX, minY, cell, basis }. Restituisce { positions, indices }.
 */
export function heightfieldSolid(grid, top, bottom, full) {
  const { W, R, minX, minY, cell: c, basis } = grid
  const { a, b, u } = basis
  const slot = new Int32Array(W * R).fill(-1)
  const verts = []
  const add = (x, y, h) => verts.push(x * a[0] + y * b[0] + h * u[0], x * a[1] + y * b[1] + h * u[1], x * a[2] + y * b[2] + h * u[2])
  // vertice in alto 2n, in basso 2n+1
  const vertexOf = (k) => {
    if (slot[k] < 0) {
      slot[k] = verts.length / 6
      const x = minX + ((k % W) + 0.5) * c
      const y = minY + (Math.floor(k / W) + 0.5) * c
      add(x, y, top[k])
      add(x, y, bottom(k))
    }
    return slot[k] * 2
  }
  const topTris = []
  const tris = []
  for (let j = 0; j < R - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const k00 = j * W + i
      const k10 = k00 + 1
      const k01 = k00 + W
      const k11 = k01 + 1
      if (!(full(k00) && full(k10) && full(k01) && full(k11))) continue
      const v00 = vertexOf(k00), v10 = vertexOf(k10), v01 = vertexOf(k01), v11 = vertexOf(k11)
      topTris.push(v00, v10, v11, v00, v11, v01) // sopra: normale verso u
      tris.push(v00, v10, v11, v00, v11, v01)
      tris.push(v00 + 1, v11 + 1, v10 + 1, v00 + 1, v01 + 1, v11 + 1) // sotto: verso -u
    }
  }
  // pareti: lati della superficie superiore usati da un solo triangolo
  const edges = new Map()
  for (let t = 0; t < topTris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const p = topTris[t + e]
      const q = topTris[t + ((e + 1) % 3)]
      const key = p < q ? p * 4294967296 + q : q * 4294967296 + p
      const entry = edges.get(key)
      if (entry) entry.count++
      else edges.set(key, { count: 1, from: p, to: q })
    }
  }
  for (const { count, from, to } of edges.values()) {
    if (count !== 1) continue
    // lato from -> to della superficie: la parete lo percorre al contrario
    tris.push(to, from, from + 1, to, from + 1, to + 1)
  }
  return { positions: new Float32Array(verts), indices: new Uint32Array(tris) }
}
