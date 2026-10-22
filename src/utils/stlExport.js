import * as THREE from 'three'
import { geometryToBinarySTL } from './holeFiller'

// Salvataggio delle mesh modificate in STL binario o STL ASCII (testo).

export { geometryToBinarySTL }

const formatNumber = (value) => (Number.isFinite(value) ? value.toExponential(6) : '0.000000e+00')

export function geometryToAsciiSTL(geometry, name = 'mesh') {
  const position = geometry.getAttribute('position')
  const index = geometry.index
  const triangleCount = index ? index.count / 3 : Math.floor(position.count / 3)
  const solidName = String(name).replace(/\s+/g, '_') || 'mesh'
  const lines = [`solid ${solidName}`]
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const edge = new THREE.Vector3()
  const vertex = (v) => `      vertex ${formatNumber(v.x)} ${formatNumber(v.y)} ${formatNumber(v.z)}`
  for (let t = 0; t < triangleCount; t++) {
    a.fromBufferAttribute(position, index ? index.getX(t * 3) : t * 3)
    b.fromBufferAttribute(position, index ? index.getX(t * 3 + 1) : t * 3 + 1)
    c.fromBufferAttribute(position, index ? index.getX(t * 3 + 2) : t * 3 + 2)
    normal.subVectors(c, b).cross(edge.subVectors(a, b)).normalize()
    lines.push(
      `  facet normal ${formatNumber(normal.x)} ${formatNumber(normal.y)} ${formatNumber(normal.z)}`,
      '    outer loop',
      vertex(a),
      vertex(b),
      vertex(c),
      '    endloop',
      '  endfacet'
    )
  }
  lines.push(`endsolid ${solidName}`, '')
  return lines.join('\n')
}

// Unisce più mesh in una sola (solo posizioni e triangoli).
export function mergeGeometries(geometries) {
  if (geometries.length === 1) return geometries[0]
  const positions = []
  const indices = []
  for (const geometry of geometries) {
    const position = geometry.getAttribute('position')
    const base = positions.length / 3
    for (let i = 0; i < position.count; i++) positions.push(position.getX(i), position.getY(i), position.getZ(i))
    if (geometry.index) {
      for (let i = 0; i < geometry.index.count; i++) indices.push(base + geometry.index.getX(i))
    } else {
      for (let i = 0; i + 2 < position.count; i += 3) indices.push(base + i, base + i + 1, base + i + 2)
    }
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setIndex(indices)
  merged.computeVertexNormals()
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

// Salva il file: in Electron con la finestra "Salva con nome", nel browser come download.
export async function saveMeshFile(geometry, fileName, format) {
  const baseName = (fileName || 'mesh').trim().replace(/\.stl$/i, '') || 'mesh'
  const fullName = `${baseName}.stl`
  const data = format === 'ascii' ? geometryToAsciiSTL(geometry, baseName) : new Uint8Array(geometryToBinarySTL(geometry))

  const saveMesh = window.electron?.saveMeshFile
  if (typeof saveMesh === 'function') {
    const result = await saveMesh({ defaultPath: fullName, data })
    if (result?.error) throw new Error(result.error)
    return result?.success ? result.filePath : null
  }

  const blob = new Blob([data], { type: format === 'ascii' ? 'text/plain' : 'model/stl' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fullName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return fullName
}

// Piu' mesh in file separati (es. modelli articolati superiore e inferiore): in Electron si sceglie la
// cartella di destinazione, nel browser ogni file viene scaricato. files: [{ geometry, name }].
// Restituisce la cartella (o i nomi) oppure null se annullato.
export async function saveMeshFiles(files, format, title = 'Scegli la cartella dove salvare i modelli') {
  const items = files.map(({ geometry, name }) => {
    const baseName = (name || 'mesh').trim().replace(/\.stl$/i, '') || 'mesh'
    return {
      name: `${baseName}.stl`,
      data: format === 'ascii' ? geometryToAsciiSTL(geometry, baseName) : new Uint8Array(geometryToBinarySTL(geometry)),
    }
  })
  const saveFiles = window.electron?.saveMeshFiles
  if (typeof saveFiles === 'function') {
    const result = await saveFiles({ title, files: items })
    if (result?.error) throw new Error(result.error)
    return result?.success ? result.folder : null
  }
  for (const { name, data } of items) {
    const blob = new Blob([data], { type: format === 'ascii' ? 'text/plain' : 'model/stl' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return items.map((item) => item.name).join(', ')
}
