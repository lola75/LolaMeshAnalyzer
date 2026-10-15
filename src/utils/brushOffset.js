import * as THREE from 'three'
import { weldGeometry } from './holeFiller'

// Offset con pennello: l'utente colora con un pennello circolare una zona della
// mesh e la sposta (estrusione lineare) di una distanza scelta. I triangoli a
// cavallo del bordo della zona si allungano e formano la parete dell'estrusione.

const GRID_CELLS = 96 // celle della griglia lungo il lato maggiore dell'ingombro
const GRID_KEY = 1024

// Mesh con vertici uniti, normali per vertice e griglia per trovare in fretta
// i vertici sotto il pennello.
export function prepareBrushMesh(geometry) {
  const mesh = weldGeometry(geometry)
  const { positions: P, indices } = mesh
  const vertexCount = P.length / 3

  const normals = new Float32Array(vertexCount * 3)
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3
    const b = indices[t + 1] * 3
    const c = indices[t + 2] * 3
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2]
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
    // prodotto vettoriale non normalizzato: pesato con l'area del triangolo
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    for (const v of [a, b, c]) {
      normals[v] += nx
      normals[v + 1] += ny
      normals[v + 2] += nz
    }
  }
  for (let v = 0; v < normals.length; v += 3) {
    const length = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1
    normals[v] /= length
    normals[v + 1] /= length
    normals[v + 2] /= length
  }

  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < P.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      if (P[i + axis] < min[axis]) min[axis] = P[i + axis]
      if (P[i + axis] > max[axis]) max[axis] = P[i + axis]
    }
  }
  const cellSize = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-9) / GRID_CELLS
  const cells = new Map()
  for (let v = 0; v < vertexCount; v++) {
    const key = cellKey(cellCoord(P[v * 3], min[0], cellSize), cellCoord(P[v * 3 + 1], min[1], cellSize), cellCoord(P[v * 3 + 2], min[2], cellSize))
    let cell = cells.get(key)
    if (!cell) cells.set(key, (cell = []))
    cell.push(v)
  }

  return {
    mesh,
    normals,
    grid: { min, cellSize, cells },
    selected: new Uint8Array(vertexCount),
  }
}

const cellCoord = (value, min, size) => Math.min(GRID_CELLS, Math.max(0, Math.floor((value - min) / size)))
const cellKey = (x, y, z) => x + y * GRID_KEY + z * GRID_KEY * GRID_KEY

// Seleziona (o deseleziona) i vertici entro `radius` dal punto. Restituisce true se qualcosa è cambiato.
export function paintSphere(data, point, radius, erase) {
  const { mesh, grid, selected } = data
  const P = mesh.positions
  const { min, cellSize, cells } = grid
  const r2 = radius * radius
  const lo = [0, 1, 2].map((axis) => cellCoord(point[axis] - radius, min[axis], cellSize))
  const hi = [0, 1, 2].map((axis) => cellCoord(point[axis] + radius, min[axis], cellSize))
  const value = erase ? 0 : 1
  let changed = false
  for (let z = lo[2]; z <= hi[2]; z++) {
    for (let y = lo[1]; y <= hi[1]; y++) {
      for (let x = lo[0]; x <= hi[0]; x++) {
        const cell = cells.get(cellKey(x, y, z))
        if (!cell) continue
        for (const v of cell) {
          if (selected[v] === value) continue
          const dx = P[v * 3] - point[0]
          const dy = P[v * 3 + 1] - point[1]
          const dz = P[v * 3 + 2] - point[2]
          if (dx * dx + dy * dy + dz * dz <= r2) {
            selected[v] = value
            changed = true
          }
        }
      }
    }
  }
  return changed
}

export const countSelected = (data) => data.selected.reduce((sum, value) => sum + value, 0)

export const selectAll = (data) => data.selected.fill(1)

export function invertSelection(data) {
  const { selected } = data
  for (let v = 0; v < selected.length; v++) selected[v] = selected[v] ? 0 : 1
}

// Scrive in `out` gli indici dei triangoli con tutti i vertici selezionati; restituisce quanti indici.
export function fillSelectedTriangles(data, out) {
  const { indices } = data.mesh
  const { selected } = data
  let count = 0
  for (let t = 0; t < indices.length; t += 3) {
    if (selected[indices[t]] && selected[indices[t + 1]] && selected[indices[t + 2]]) {
      out[count++] = indices[t]
      out[count++] = indices[t + 1]
      out[count++] = indices[t + 2]
    }
  }
  return count
}

// Direzione media della zona selezionata (normali pesate con l'area).
function averageDirection(data) {
  const { normals, selected } = data
  const direction = [0, 0, 0]
  for (let v = 0; v < selected.length; v++) {
    if (!selected[v]) continue
    direction[0] += normals[v * 3]
    direction[1] += normals[v * 3 + 1]
    direction[2] += normals[v * 3 + 2]
  }
  const length = Math.hypot(...direction)
  return length > 0 ? direction.map((value) => value / length) : null
}

// Posizioni con la zona selezionata spostata di `distance`. `mode` è 'average'
// (tutti i vertici nella direzione media della zona: estrusione lineare), un
// vettore [x, y, z] (direzione fissa, es. quella della vista) oppure 'normals'
// (ogni vertice lungo la propria normale).
export function offsetPositions(data, distance, mode, out = new Float32Array(data.mesh.positions.length)) {
  const { mesh, normals, selected } = data
  out.set(mesh.positions)
  if (!distance) return out
  const direction = Array.isArray(mode) ? mode : mode === 'average' ? averageDirection(data) : null
  for (let v = 0; v < selected.length; v++) {
    if (!selected[v]) continue
    const i = v * 3
    out[i] += distance * (direction ? direction[0] : normals[i])
    out[i + 1] += distance * (direction ? direction[1] : normals[i + 1])
    out[i + 2] += distance * (direction ? direction[2] : normals[i + 2])
  }
  return out
}

export function buildOffsetGeometry(data, distance, mode) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(offsetPositions(data, distance, mode), 3))
  if (data.mesh.colors) geometry.setAttribute('color', new THREE.BufferAttribute(data.mesh.colors.slice(), 3))
  geometry.setIndex(new THREE.BufferAttribute(data.mesh.indices.slice(), 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

// Solo la zona selezionata, spostata: usata per salvarla come parte separata.
export function buildSelectedPartGeometry(data, distance, mode) {
  const moved = offsetPositions(data, distance, mode)
  const triangles = new Uint32Array(data.mesh.indices.length)
  const count = fillSelectedTriangles(data, triangles)
  if (count === 0) throw new Error('La zona selezionata non contiene triangoli interi.')
  const remap = new Int32Array(data.selected.length).fill(-1)
  const positions = []
  const colors = data.mesh.colors ? [] : null
  const indices = new Uint32Array(count)
  for (let i = 0; i < count; i++) {
    const v = triangles[i]
    if (remap[v] === -1) {
      remap[v] = positions.length / 3
      positions.push(moved[v * 3], moved[v * 3 + 1], moved[v * 3 + 2])
      if (colors) colors.push(data.mesh.colors[v * 3], data.mesh.colors[v * 3 + 1], data.mesh.colors[v * 3 + 2])
    }
    indices[i] = remap[v]
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
