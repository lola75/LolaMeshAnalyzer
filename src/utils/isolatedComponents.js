import * as THREE from 'three'
import { weldGeometry } from './holeFiller'

// Componenti isolati: gruppi di triangoli non collegati al resto della mesh
// (frammenti, "isole" di scansione). Due triangoli appartengono allo stesso
// componente se condividono almeno un vertice.

const analysisCache = new WeakMap()

const findRoot = (parent, i) => {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]]
    i = parent[i]
  }
  return i
}

// Restituisce i componenti della mesh. La dimensione di ogni componente è la
// diagonale del suo ingombro; `ratio` è la stessa misura in percentuale della
// diagonale della mesh intera. Ordinati dal più grande.
export function analyzeComponents(geometry) {
  const cached = analysisCache.get(geometry)
  if (cached) return cached

  const mesh = weldGeometry(geometry)
  const { positions: P, indices } = mesh
  const vertexCount = P.length / 3
  const triangleCount = indices.length / 3

  const parent = new Uint32Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) parent[i] = i
  for (let t = 0; t < triangleCount; t++) {
    const ra = findRoot(parent, indices[t * 3])
    const rb = findRoot(parent, indices[t * 3 + 1])
    const rc = findRoot(parent, indices[t * 3 + 2])
    if (rb !== ra) parent[rb] = ra
    if (rc !== ra) parent[rc] = ra
  }

  const byRoot = new Map()
  const triangleComponent = new Int32Array(triangleCount)
  const components = []
  for (let t = 0; t < triangleCount; t++) {
    const root = findRoot(parent, indices[t * 3])
    let component = byRoot.get(root)
    if (!component) {
      component = {
        triangles: [],
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
      }
      byRoot.set(root, component)
      components.push(component)
    }
    component.triangles.push(t)
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k]
      for (let axis = 0; axis < 3; axis++) {
        const value = P[v * 3 + axis]
        if (value < component.min[axis]) component.min[axis] = value
        if (value > component.max[axis]) component.max[axis] = value
      }
    }
  }

  const diagonal = Math.max(mesh.diagonal, 1e-12)
  components.forEach((component) => {
    component.size = Math.hypot(
      component.max[0] - component.min[0],
      component.max[1] - component.min[1],
      component.max[2] - component.min[2]
    )
    component.ratio = (component.size / diagonal) * 100
  })
  components.sort((a, b) => b.size - a.size || b.triangles.length - a.triangles.length)
  components.forEach((component, id) => {
    component.id = id
    component.triangles.forEach((t) => {
      triangleComponent[t] = id
    })
  })

  const analysis = { mesh, components, triangleComponent }
  analysisCache.set(geometry, analysis)
  return analysis
}

// Componenti con rapporto dimensione fino alla soglia (in %). Il componente
// più grande (la mesh principale) non viene mai selezionato.
export function selectComponentsByRatio(analysis, ratioPercent) {
  if (ratioPercent <= 0) return []
  return analysis.components.filter((c) => c.id !== 0 && c.ratio <= ratioPercent).map((c) => c.id)
}

const buildGeometry = (mesh, triangles) => {
  const { positions: P, colors: C, indices } = mesh
  const remap = new Int32Array(P.length / 3).fill(-1)
  const positions = []
  const colors = C ? [] : null
  const newIndices = new Uint32Array(triangles.length * 3)
  triangles.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k]
      if (remap[v] === -1) {
        remap[v] = positions.length / 3
        positions.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2])
        if (colors) colors.push(C[v * 3], C[v * 3 + 1], C[v * 3 + 2])
      }
      newIndices[i * 3 + k] = remap[v]
    }
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(new THREE.BufferAttribute(newIndices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

// Triangoli dentro (inside = true) o fuori dai componenti indicati
const trianglesOf = (analysis, componentIds, inside) => {
  const ids = new Set(componentIds)
  const result = []
  const { triangleComponent } = analysis
  for (let t = 0; t < triangleComponent.length; t++) {
    if (ids.has(triangleComponent[t]) === inside) result.push(t)
  }
  return result
}

// Geometria dei soli componenti indicati, usata per evidenziarli nella vista.
export function componentsGeometry(analysis, componentIds) {
  return buildGeometry(analysis.mesh, trianglesOf(analysis, componentIds, true))
}

// Nuova geometria senza i componenti indicati.
export function removeComponents(analysis, componentIds) {
  const triangles = trianglesOf(analysis, componentIds, false)
  if (triangles.length === 0) throw new Error('La rimozione eliminerebbe tutta la mesh.')
  return {
    geometry: buildGeometry(analysis.mesh, triangles),
    removedComponents: new Set(componentIds).size,
    removedTriangles: analysis.triangleComponent.length - triangles.length,
  }
}
