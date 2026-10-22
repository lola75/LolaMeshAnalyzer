import * as THREE from 'three'
import { loadSTL } from './loaders/stlLoader'
import cubeUpUrl from '../assets/articulator/cubo-sup.stl?url'
import pinUpUrl from '../assets/articulator/cilindro-sup.stl?url'
import pinDownUrl from '../assets/articulator/cilindro-inf.stl?url'
import cubeDownUrl from '../assets/articulator/cubo-inf.stl?url'

// Supporti del modello articolato (Utilita' di stampa 3D, passo "Supporto"): pilastri che tengono in
// posizione le due arcate dopo la stampa. Ogni supporto ha quattro pezzi (file STL dell'utente, in mm,
// gia' nella posizione in cui si ricompongono):
// - cubo superiore + cilindro superiore (punta a cupola): vanno uniti al modello superiore;
// - cilindro inferiore (sede concava) + cubo inferiore: vanno uniti al modello inferiore.
// La cupola entra nella sede sul piano occlusale. L'altezza si adatta alla base di ciascun modello
// allungando solo il tratto dritto del cilindro; il cubo si allunga in orizzontale verso l'arcata finche'
// entra nella parete dell'estrusione.

const EMBED = 1.5 // mm del cubo dentro la parete dell'estrusione
const PIN_INTO_CUBE = 1 // mm del cilindro dentro il cubo (i due pezzi si uniscono senza facce coincidenti)
const TIP_REACH = 1 // mm attorno all'incastro che restano fermi (cupola e sede)
const CLEARANCE = 3 // mm tra il cilindro e la parete nella posizione automatica

let partsPromise = null

// pezzi nel riferimento del supporto: asse del cilindro su x = y = 0, incastro (bordo della sede) a z = 0
export function loadSupportParts() {
  if (!partsPromise) {
    partsPromise = Promise.all([cubeUpUrl, pinUpUrl, pinDownUrl, cubeDownUrl].map(async (url) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error('pezzi del supporto non trovati')
      return loadSTL(await response.arrayBuffer())
    })).then(([cubeUp, pinUp, pinDown, cubeDown]) => {
      const boxOf = (g) => new THREE.Box3().setFromBufferAttribute(g.getAttribute('position'))
      const pinBox = boxOf(pinDown)
      const axis = pinBox.getCenter(new THREE.Vector3())
      const joint = pinBox.max.z
      const local = (g) => {
        const p = g.getAttribute('position').array
        const out = new Float32Array(p.length)
        for (let i = 0; i < p.length; i += 3) {
          out[i] = p[i] - axis.x
          out[i + 1] = p[i + 1] - axis.y
          out[i + 2] = p[i + 2] - joint
        }
        return out
      }
      const parts = { cubeUp: local(cubeUp), pinUp: local(pinUp), pinDown: local(pinDown), cubeDown: local(cubeDown) }
      const range = (array, k) => {
        let lo = Infinity, hi = -Infinity
        for (let i = k; i < array.length; i += 3) { lo = Math.min(lo, array[i]); hi = Math.max(hi, array[i]) }
        return [lo, hi]
      }
      return {
        ...parts,
        cubeUpTop: range(parts.cubeUp, 2)[1],
        cubeDownBottom: range(parts.cubeDown, 2)[0],
        pinUpTop: range(parts.pinUp, 2)[1],
        pinDownBottom: range(parts.pinDown, 2)[0],
        cubeReach: range(parts.cubeUp, 1)[1], // lato +y del cubo: quello che si allunga verso l'arcata
        pinRadius: (pinBox.max.x - pinBox.min.x) / 2,
      }
    }).catch((error) => {
      partsPromise = null
      throw error
    })
  }
  return partsPromise
}

// riferimento del piano occlusale: x a destra, y verso gli incisivi, z in alto (mm della mesh)
export function planeBasis(plane) {
  const ez = new THREE.Vector3(...plane.normal).normalize()
  const front = new THREE.Vector3(...plane.front)
  const ex = new THREE.Vector3().crossVectors(front, ez).normalize()
  const ey = new THREE.Vector3().crossVectors(ez, ex).normalize()
  return { origin: new THREE.Vector3(...plane.origin), ex, ey, ez }
}
export const toPlane = (basis, x, y, z) => {
  const dx = x - basis.origin.x, dy = y - basis.origin.y, dz = z - basis.origin.z
  return [
    dx * basis.ex.x + dy * basis.ex.y + dz * basis.ex.z,
    dx * basis.ey.x + dy * basis.ey.y + dz * basis.ey.z,
    dx * basis.ez.x + dy * basis.ez.y + dz * basis.ez.z,
  ]
}

// punti del bordo (la parete dell'estrusione e' il bordo spinto lungo la verticale) sul piano
export function outlineOnPlane(basis, prepared) {
  const P = prepared.mesh.positions
  return prepared.loop.map((v) => toPlane(basis, P[v * 3], P[v * 3 + 1], P[v * 3 + 2]).slice(0, 2))
}

// posizione automatica: uno davanti agli incisivi sulla linea mediana, due dietro gli ultimi denti
// verso l'esterno (coordinate del piano, mm)
export function autoPlaceSupports(outline, parts) {
  if (outline.length === 0) return []
  const gap = parts.pinRadius + CLEARANCE
  const middle = outline.filter(([x]) => Math.abs(x) < 5)
  const front = Math.max(...(middle.length ? middle : outline).map(([, y]) => y))
  const supports = [{ x: 0, y: front + gap, midline: true }] // anteriore: sulla linea mediana
  for (const side of [-1, 1]) {
    const half = outline.filter(([x]) => side * x > 5)
    if (half.length === 0) continue
    const back = half.reduce((best, p) => (p[1] < best[1] ? p : best))
    const k = (gap + 1) / Math.SQRT2
    supports.push({ x: back[0] + side * k, y: back[1] - k })
  }
  return supports
}

// meta' di un supporto (side 'up': cubo e cilindro superiori; 'down': inferiori) nelle coordinate della
// mesh, come Float32Array di triangoli. height: distanza dal piano alla base del modello (mm);
// outline: bordo del modello sul piano, per attaccare il cubo alla parete.
export function buildSupportHalf(parts, basis, support, side, height, outline) {
  const up = side === 'up'
  const cube = up ? parts.cubeUp : parts.cubeDown
  const pin = up ? parts.pinUp : parts.pinDown
  // altezza: il cubo arriva alla base, il tratto dritto del cilindro si allunga o si accorcia
  // (almeno 2 mm di tratto dritto oltre la cupola o la sede)
  const delta = up
    ? Math.max(height - parts.cubeUpTop, -(parts.pinUpTop - TIP_REACH - 2))
    : Math.min(-height - parts.cubeDownBottom, -parts.pinDownBottom - TIP_REACH - 2 - 2)
  // braccio: il lato +y del cubo verso il punto piu' vicino della parete
  let nearest = null
  let best = Infinity
  for (const [x, y] of outline) {
    const d = Math.hypot(x - support.x, y - support.y)
    if (d < best) { best = d; nearest = [x, y] }
  }
  const angle = nearest ? Math.atan2(nearest[1] - support.y, nearest[0] - support.x) - Math.PI / 2 : 0
  const stretch = nearest ? Math.max(0, best + EMBED - parts.cubeReach) : 0
  const cos = Math.cos(angle), sin = Math.sin(angle)

  const out = new Float32Array(cube.length + pin.length)
  const { origin, ex, ey, ez } = basis
  const put = (offset, x, y, z) => {
    const px = support.x + x * cos - y * sin
    const py = support.y + x * sin + y * cos
    out[offset] = origin.x + ex.x * px + ey.x * py + ez.x * z
    out[offset + 1] = origin.y + ex.y * px + ey.y * py + ez.y * z
    out[offset + 2] = origin.z + ex.z * px + ey.z * py + ez.z * z
  }
  for (let i = 0; i < cube.length; i += 3) {
    put(i, cube[i], cube[i + 1] > 0 ? cube[i + 1] + stretch : cube[i + 1], cube[i + 2] + delta)
  }
  for (let i = 0; i < pin.length; i += 3) {
    let z = pin[i + 2]
    if (up && z > TIP_REACH) z += delta + PIN_INTO_CUBE
    if (!up && z < -TIP_REACH - 2) z += delta - PIN_INTO_CUBE // la sede scende fino a circa -2,4 mm
    put(cube.length + i, pin[i], pin[i + 1], z)
  }
  return { positions: out, cubeTriangles: cube.length / 9 }
}

// geometria (non indicizzata) dai triangoli
export function geometryFromPositions(positions) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}
