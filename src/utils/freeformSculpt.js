import * as THREE from 'three'
import { MeshBVH, CONTAINED, INTERSECTED, NOT_INTERSECTED } from 'three-mesh-bvh'
import { weldGeometry } from './holeFiller'

// Free Form: modellazione a mano libera di una mesh con pennelli (aggiungi, togli, leviga,
// appiattisci, sposta). Lavora in mm sulle coordinate originali della mesh, con vertici uniti.
// three-mesh-bvh (MIT) accelera il raggio del mouse e la ricerca dei vertici sotto il pennello:
// dopo ogni pennellata la struttura viene solo riadattata (refit), non ricostruita.

export const FREEFORM_BRUSHES = [
  { id: 'add', label: 'Aggiungi', hint: 'Aggiunge materiale (Shift: toglie)' },
  { id: 'remove', label: 'Togli', hint: 'Toglie materiale (Shift: aggiunge)' },
  { id: 'smooth', label: 'Leviga', hint: 'Ammorbidisce la superficie' },
  { id: 'flatten', label: 'Appiattisci', hint: 'Porta la zona su un piano' },
  { id: 'grab', label: 'Sposta', hint: 'Trascina la zona col mouse' },
  { id: 'inflate', label: 'Gonfia', hint: 'Gonfia la zona lungo le sue normali (Shift: sgonfia)' },
  { id: 'pinch', label: 'Pizzica', hint: 'Stringe la zona verso il centro del pennello: spigoli più netti (Shift: allarga)' },
  { id: 'crease', label: 'Solco', hint: 'Incide un solco stretto (Shift: crea una cresta)' },
]

const MAX_UNDO = 20

// peso del pennello: 1 al centro, 0 al bordo, raccordato
const falloff = (t) => {
  const u = 1 - t * t
  return u > 0 ? u * u : 0
}

export function createSculptSession(geometry) {
  const welded = weldGeometry(geometry)
  const P = welded.positions // mm, modificati dai pennelli
  const vertexCount = P.length / 3

  // BVH sulla stessa memoria dei vertici: riordina l'indice dei triangoli, che resta quello di lavoro
  const bvhGeometry = new THREE.BufferGeometry()
  bvhGeometry.setAttribute('position', new THREE.BufferAttribute(P, 3))
  bvhGeometry.setIndex(new THREE.BufferAttribute(welded.indices, 1))
  const bvh = new MeshBVH(bvhGeometry, { maxLeafTris: 8 })
  const indices = bvhGeometry.index.array
  const triangleCount = indices.length / 3

  // vertice -> triangoli e vertice -> vicini (formato compresso)
  const triStart = new Uint32Array(vertexCount + 1)
  for (let i = 0; i < indices.length; i++) triStart[indices[i] + 1]++
  for (let v = 0; v < vertexCount; v++) triStart[v + 1] += triStart[v]
  const triList = new Uint32Array(indices.length)
  const fill = triStart.slice(0, vertexCount)
  for (let t = 0; t < triangleCount; t++) {
    for (let k = 0; k < 3; k++) triList[fill[indices[t * 3 + k]]++] = t
  }

  const normals = new Float32Array(P.length)
  const faceNormal = (t, out) => {
    const a = indices[t * 3] * 3
    const b = indices[t * 3 + 1] * 3
    const c = indices[t * 3 + 2] * 3
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2]
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
    out[0] = uy * vz - uz * vy
    out[1] = uz * vx - ux * vz
    out[2] = ux * vy - uy * vx
  }
  const fn = [0, 0, 0]
  const updateVertexNormal = (v) => {
    let nx = 0, ny = 0, nz = 0
    for (let i = triStart[v]; i < triStart[v + 1]; i++) {
      faceNormal(triList[i], fn)
      nx += fn[0]
      ny += fn[1]
      nz += fn[2]
    }
    const length = Math.hypot(nx, ny, nz) || 1
    normals[v * 3] = nx / length
    normals[v * 3 + 1] = ny / length
    normals[v * 3 + 2] = nz / length
  }
  for (let v = 0; v < vertexCount; v++) updateVertexNormal(v)

  // vertici entro `radius` da `center` (mm), con i pesi del pennello
  const mark = new Uint32Array(vertexCount)
  let markId = 0
  const sphere = new THREE.Sphere()
  const queryRegion = (center, radius) => {
    markId++
    sphere.center.copy(center)
    sphere.radius = radius
    const found = []
    const r2 = radius * radius
    bvh.shapecast({
      intersectsBounds: (box) => {
        if (!sphere.intersectsBox(box)) return NOT_INTERSECTED
        const { min, max } = box
        // box tutto dentro la sfera: i suoi triangoli si prendono senza controlli sul box
        for (let corner = 0; corner < 8; corner++) {
          const x = corner & 1 ? max.x : min.x
          const y = corner & 2 ? max.y : min.y
          const z = corner & 4 ? max.z : min.z
          if ((x - center.x) ** 2 + (y - center.y) ** 2 + (z - center.z) ** 2 > r2) return INTERSECTED
        }
        return CONTAINED
      },
      intersectsTriangle: (_triangle, t) => {
        for (let k = 0; k < 3; k++) {
          const v = indices[t * 3 + k]
          if (mark[v] === markId) continue
          mark[v] = markId
          const dx = P[v * 3] - center.x
          const dy = P[v * 3 + 1] - center.y
          const dz = P[v * 3 + 2] - center.z
          const d2 = dx * dx + dy * dy + dz * dz
          if (d2 <= r2) found.push(v, falloff(Math.sqrt(d2) / radius))
        }
        return false
      },
    })
    return found // [v0, w0, v1, w1, ...]
  }

  // vertici modificati + i loro vicini: normali da ricalcolare e da ridisegnare
  const touched = (region) => {
    markId++
    const list = []
    for (let i = 0; i < region.length; i += 2) {
      const v = region[i]
      for (let j = triStart[v]; j < triStart[v + 1]; j++) {
        const t = triList[j]
        for (let k = 0; k < 3; k++) {
          const u = indices[t * 3 + k]
          if (mark[u] !== markId) {
            mark[u] = markId
            list.push(u)
          }
        }
      }
    }
    for (const v of list) updateVertexNormal(v)
    return list
  }

  // media dei vicini di v (per Leviga)
  const neighborMean = (v, out) => {
    let x = 0, y = 0, z = 0, n = 0
    for (let j = triStart[v]; j < triStart[v + 1]; j++) {
      const t = triList[j]
      for (let k = 0; k < 3; k++) {
        const u = indices[t * 3 + k]
        if (u === v) continue
        x += P[u * 3]
        y += P[u * 3 + 1]
        z += P[u * 3 + 2]
        n++
      }
    }
    if (n === 0) {
      out[0] = P[v * 3]; out[1] = P[v * 3 + 1]; out[2] = P[v * 3 + 2]
    } else {
      out[0] = x / n; out[1] = y / n; out[2] = z / n
    }
  }

  const ray = new THREE.Ray()
  const undoStack = []
  const saved = P.slice() // stato all'apertura o all'ultimo Applica (per "Annulla tutto")
  let stroke = null

  const session = {
    positions: P,
    normals,
    indices,
    colors: welded.colors || null,
    vertexCount,
    diagonal: welded.diagonal,
    sourceGeometry: geometry,
    strokes: 0,
    canUndo: () => undoStack.length > 0,

    // primo punto colpito dal raggio (origine e direzione in mm), oppure null
    raycast(origin, direction) {
      ray.origin.copy(origin)
      ray.direction.copy(direction).normalize()
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide)
      if (!hit) return null
      const t = hit.faceIndex
      const n = new THREE.Vector3()
      faceNormal(t, fn)
      n.set(fn[0], fn[1], fn[2]).normalize()
      return { point: hit.point.clone(), normal: n }
    },

    beginStroke(brush, hit, radius, strength, invert) {
      undoStack.push(P.slice())
      if (undoStack.length > MAX_UNDO) undoStack.shift()
      stroke = { brush, radius, strength, invert, start: hit.point.clone(), last: null }
      if (brush === 'grab') {
        stroke.region = queryRegion(hit.point, radius)
        stroke.origin = new Float32Array(stroke.region.length / 2 * 3)
        for (let i = 0; i < stroke.region.length; i += 2) {
          const v = stroke.region[i]
          stroke.origin.set(P.subarray(v * 3, v * 3 + 3), (i / 2) * 3)
        }
        return []
      }
      return this.stamp(hit)
    },

    // una "timbratura" del pennello nel punto colpito; restituisce i vertici da ridisegnare
    stamp(hit) {
      if (!stroke || stroke.brush === 'grab') return []
      // timbri distanziati: niente accumuli quando il mouse e' fermo
      if (stroke.last && stroke.last.distanceTo(hit.point) < stroke.radius * 0.15) return []
      stroke.last = hit.point.clone()
      const { radius, strength, invert } = stroke
      const region = queryRegion(hit.point, radius)
      if (region.length === 0) return []

      // normale e baricentro pesati della zona
      let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0, wsum = 0
      for (let i = 0; i < region.length; i += 2) {
        const v = region[i]
        const w = region[i + 1]
        nx += normals[v * 3] * w
        ny += normals[v * 3 + 1] * w
        nz += normals[v * 3 + 2] * w
        cx += P[v * 3] * w
        cy += P[v * 3 + 1] * w
        cz += P[v * 3 + 2] * w
        wsum += w
      }
      const nl = Math.hypot(nx, ny, nz) || 1
      nx /= nl; ny /= nl; nz /= nl
      cx /= wsum; cy /= wsum; cz /= wsum

      let brush = stroke.brush
      if (invert && brush === 'add') brush = 'remove'
      else if (invert && brush === 'remove') brush = 'add'

      if (brush === 'add' || brush === 'remove') {
        const amount = (brush === 'add' ? 1 : -1) * strength * radius * 0.12
        for (let i = 0; i < region.length; i += 2) {
          const v = region[i] * 3
          const d = amount * region[i + 1]
          P[v] += nx * d
          P[v + 1] += ny * d
          P[v + 2] += nz * d
        }
      } else if (brush === 'smooth') {
        const targets = new Float32Array(region.length / 2 * 3)
        const m = [0, 0, 0]
        for (let i = 0; i < region.length; i += 2) {
          neighborMean(region[i], m)
          targets.set(m, (i / 2) * 3)
        }
        const k = Math.min(1, strength * 0.8)
        for (let i = 0; i < region.length; i += 2) {
          const v = region[i] * 3
          const f = k * region[i + 1]
          const j = (i / 2) * 3
          P[v] += (targets[j] - P[v]) * f
          P[v + 1] += (targets[j + 1] - P[v + 1]) * f
          P[v + 2] += (targets[j + 2] - P[v + 2]) * f
        }
      } else if (brush === 'flatten') {
        const k = Math.min(1, strength * 0.5)
        for (let i = 0; i < region.length; i += 2) {
          const v = region[i] * 3
          const d = ((P[v] - cx) * nx + (P[v + 1] - cy) * ny + (P[v + 2] - cz) * nz) * k * region[i + 1]
          P[v] -= nx * d
          P[v + 1] -= ny * d
          P[v + 2] -= nz * d
        }
      } else if (brush === 'inflate') {
        // ogni vertice lungo la propria normale: la zona si gonfia senza appiattirsi
        const amount = (invert ? -1 : 1) * strength * radius * 0.08
        for (let i = 0; i < region.length; i += 2) {
          const v = region[i] * 3
          const d = amount * region[i + 1]
          P[v] += normals[v] * d
          P[v + 1] += normals[v + 1] * d
          P[v + 2] += normals[v + 2] * d
        }
      } else if (brush === 'pinch' || brush === 'crease') {
        // verso il centro del pennello solo nel piano tangente (Pizzica); Solco in piu' affonda
        const px = hit.point.x
        const py = hit.point.y
        const pz = hit.point.z
        const k = (brush === 'pinch' && invert ? -1 : 1) * Math.min(1, strength * 0.25)
        const depth = brush === 'crease' ? (invert ? 1 : -1) * strength * radius * 0.06 : 0
        for (let i = 0; i < region.length; i += 2) {
          const v = region[i] * 3
          const w = region[i + 1]
          let dx = px - P[v]
          let dy = py - P[v + 1]
          let dz = pz - P[v + 2]
          const along = dx * nx + dy * ny + dz * nz
          dx -= nx * along
          dy -= ny * along
          dz -= nz * along
          P[v] += dx * k * w + nx * depth * w
          P[v + 1] += dy * k * w + ny * depth * w
          P[v + 2] += dz * k * w + nz * depth * w
        }
      }
      bvh.refit()
      return touched(region)
    },

    // Sposta: spostamento (mm) rispetto alla posizione di inizio trascinamento
    grab(delta) {
      if (!stroke || stroke.brush !== 'grab' || !stroke.region.length) return []
      const { region, origin } = stroke
      const k = Math.min(1, stroke.strength * 1.5)
      for (let i = 0; i < region.length; i += 2) {
        const v = region[i] * 3
        const j = (i / 2) * 3
        const w = region[i + 1] * k
        P[v] = origin[j] + delta.x * w
        P[v + 1] = origin[j + 1] + delta.y * w
        P[v + 2] = origin[j + 2] + delta.z * w
      }
      bvh.refit()
      return touched(region)
    },

    endStroke() {
      if (!stroke) return
      stroke = null
      session.strokes++
    },

    // annulla l'ultima pennellata: tutti i vertici tornano come prima
    undo() {
      const previous = undoStack.pop()
      if (!previous) return false
      P.set(previous)
      for (let v = 0; v < vertexCount; v++) updateVertexNormal(v)
      bvh.refit()
      session.strokes = Math.max(0, session.strokes - 1)
      return true
    },

    // dopo Applica: la copia di lavoro diventa il nuovo punto di partenza
    markSaved() {
      saved.set(P)
      undoStack.length = 0
      session.strokes = 0
    },

    // annulla tutte le pennellate dall'apertura o dall'ultimo Applica
    restoreSaved() {
      P.set(saved)
      for (let v = 0; v < vertexCount; v++) updateVertexNormal(v)
      bvh.refit()
      undoStack.length = 0
      session.strokes = 0
    },

    // mesh risultato (mm), indicizzata
    toGeometry() {
      const result = new THREE.BufferGeometry()
      result.setAttribute('position', new THREE.BufferAttribute(P.slice(), 3))
      if (welded.colors) result.setAttribute('color', new THREE.BufferAttribute(welded.colors.slice(), 3))
      result.setIndex(new THREE.BufferAttribute(indices.slice(), 1))
      result.computeVertexNormals()
      result.computeBoundingBox()
      result.computeBoundingSphere()
      return result
    },

    dispose() {
      bvhGeometry.dispose()
      undoStack.length = 0
    },
  }
  return session
}
