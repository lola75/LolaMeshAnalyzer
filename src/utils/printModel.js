import * as THREE from 'three'
import { weldGeometry, findBoundaryLoops } from './holeFiller'
import { buildGeometry } from './meshEditing'
import { prepareBoundaries, smoothBoundary } from './boundaryTools'

// Crea modello da stampare (Utilita' di stampa 3D), "Estrudi bordo": il bordo aperto della
// scansione viene esteso lungo la direzione di estrusione fino a una base piatta perpendicolare,
// che chiude il modello. I colori della scansione restano; le pareti nuove prendono il colore del
// punto di bordo da cui partono.

const dot = (P, i, d) => P[i * 3] * d[0] + P[i * 3 + 1] * d[1] + P[i * 3 + 2] * d[2]

// Dati che non cambiano con i cursori (bordo levigato, vertici uniti, bordo esterno): una volta per
// geometria e intensita' di levigatura.
// Primo passo: il bordo esterno viene levigato come con "Leviga bordo" (intensita' = passate, 0-100):
// le irregolarita' del bordo della scansione non diventano strisce sulle pareti dell'estrusione.
const prepared = new WeakMap()
export function preparePrintSource(geometry, { borderSmoothing = 50 } = {}) {
  let byIntensity = prepared.get(geometry)
  if (!byIntensity) {
    byIntensity = new Map()
    prepared.set(geometry, byIntensity)
  }
  let data = byIntensity.get(borderSmoothing)
  if (!data) {
    const smoothed = borderSmoothing > 0
      ? smoothBoundary(prepareBoundaries(geometry), { iterations: Math.round(borderSmoothing), rings: 2, loops: 'longest' }).geometry
      : geometry
    const mesh = weldGeometry(smoothed)
    const loops = findBoundaryLoops(mesh.indices)
    if (loops.length === 0) throw new Error('La mesh non ha un bordo aperto: è già chiusa.')
    const P = mesh.positions
    const perimeter = (loop) => loop.reduce((sum, v, i) => {
      const w = loop[(i + 1) % loop.length]
      return sum + Math.hypot(P[v * 3] - P[w * 3], P[v * 3 + 1] - P[w * 3 + 1], P[v * 3 + 2] - P[w * 3 + 2])
    }, 0)
    const loop = loops.reduce((best, l) => (perimeter(l) > perimeter(best) ? l : best))
    data = { mesh, loop, otherHoles: loops.length - 1 }
    byIntensity.set(borderSmoothing, data)
  }
  return data
}

// Verso dell'estrusione per questo modello: dalla dentatura verso il suo bordo aperto. Con le due
// arcate insieme la base della superiore va in alto e quella dell'inferiore in basso, con la stessa
// direzione scelta.
export function orientTowardBorder(source, direction) {
  const { mesh, loop } = source
  const P = mesh.positions
  const n = P.length / 3
  let bx = 0, by = 0, bz = 0
  for (const v of loop) { bx += P[v * 3]; by += P[v * 3 + 1]; bz += P[v * 3 + 2] }
  bx /= loop.length; by /= loop.length; bz /= loop.length
  let cx = 0, cy = 0, cz = 0
  for (let v = 0; v < n; v++) { cx += P[v * 3]; cy += P[v * 3 + 1]; cz += P[v * 3 + 2] }
  cx /= n; cy /= n; cz /= n
  const side = (bx - cx) * direction[0] + (by - cy) * direction[1] + (bz - cz) * direction[2]
  return side >= 0 ? direction : direction.map((v) => -v)
}

/**
 * source: preparePrintSource(geometry); direction: [x, y, z] verso la base (mm della mesh).
 * height (mm): con autoHeight la base sta `height` sotto il punto piu' basso del bordo, altrimenti
 * `height` e' l'altezza totale del modello (dalla cima alla base). extraDepth: base ancora piu' in
 * basso (per il guscio cavo). cap: false lascia aperta la base (estrusione ferma prima della chiusura,
 * solo per l'anteprima). Restituisce { geometry, addedFrom (primo indice dei triangoli nuovi), baseDepth }.
 */
export function buildPrintSolid(source, direction, { height = 10, autoHeight = true, extraDepth = 0, rowLength = 1, cap = true } = {}) {
  const { mesh, loop } = source
  const { positions: P, colors: C, indices } = mesh
  const length = Math.hypot(...direction) || 1
  const d = direction.map((v) => v / length)
  let lowestBorder = -Infinity
  let highestBorder = Infinity
  for (const v of loop) {
    const h = dot(P, v, d)
    lowestBorder = Math.max(lowestBorder, h)
    highestBorder = Math.min(highestBorder, h)
  }
  let top = Infinity
  for (let v = 0; v < P.length / 3; v++) top = Math.min(top, dot(P, v, d))
  const base = (autoHeight ? lowestBorder + height : Math.max(top + height, lowestBorder + 0.5)) + extraDepth

  const positions = Array.from(P)
  const colors = C ? Array.from(C) : null
  const triangles = Array.from(indices)
  const addedFrom = triangles.length

  // pareti: anelli dal bordo alla base, a passi di circa rowLength mm
  const rows = Math.min(80, Math.max(1, Math.ceil((base - highestBorder) / rowLength)))
  let ring = loop.slice()
  const n = loop.length
  for (let r = 1; r <= rows; r++) {
    const t = r / rows
    const next = loop.map((v) => {
      const shift = (base - dot(P, v, d)) * t
      const index = positions.length / 3
      positions.push(P[v * 3] + d[0] * shift, P[v * 3 + 1] + d[1] * shift, P[v * 3 + 2] + d[2] * shift)
      if (colors) colors.push(C[v * 3], C[v * 3 + 1], C[v * 3 + 2])
      return index
    })
    // l'anello percorre il bordo al contrario delle facce: (a, b, b') e (a, b', a') hanno l'orientamento giusto
    for (let i = 0; i < n; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % n]
      const a2 = next[i]
      const b2 = next[(i + 1) % n]
      triangles.push(a, b, b2, a, b2, a2)
    }
    ring = next
  }

  if (!cap) return { geometry: buildGeometry(positions, colors, triangles), addedFrom, baseDepth: base, volume: 0 }

  // fondo piatto: poligono dell'ultimo anello nel piano della base, con lo stesso verso dell'anello
  const helper = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const u = new THREE.Vector3(...helper).cross(new THREE.Vector3(...d)).normalize()
  const w = new THREE.Vector3(...d).cross(u)
  const outline = ring.map((v) => {
    const p = new THREE.Vector3(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])
    return new THREE.Vector2(p.dot(u), p.dot(w))
  })
  const ringArea = THREE.ShapeUtils.area(outline)
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(outline, [])) {
    const area = THREE.ShapeUtils.area([outline[i], outline[j], outline[k]])
    // i lati dell'anello vanno percorsi nello stesso verso delle pareti (a' -> b')
    if (Math.sign(area) === Math.sign(ringArea)) triangles.push(ring[i], ring[j], ring[k])
    else triangles.push(ring[i], ring[k], ring[j])
  }

  // scansione con le normali verso l'interno: si gira tutto, cosi' il solido ha volume positivo
  let volume = 0
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3
    volume += positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])
  }
  if (volume < 0) {
    for (let t = 0; t < triangles.length; t += 3) {
      const swap = triangles[t + 1]
      triangles[t + 1] = triangles[t + 2]
      triangles[t + 2] = swap
    }
  }
  return { geometry: buildGeometry(positions, colors, triangles), addedFrom, baseDepth: base, volume: Math.abs(volume) / 6 }
}
