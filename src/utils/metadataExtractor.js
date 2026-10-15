import * as THREE from 'three'

export function extractMetadata(geometry, file, fileType) {
  if (!geometry || typeof geometry.getAttribute !== 'function') {
    return {
      fileName: file?.name || 'unknown',
      fileType: (fileType || 'SCONOSCIUTO').toUpperCase(),
      fileSize: file?.size || 0,
      vertices: 0,
      triangles: 0,
      bounds: null,
      author: '',
      description: '',
      tags: '',
      loadedAt: new Date().toLocaleString('it-IT'),
      bitsPerColor: 0
    }
  }

  const positionAttribute = geometry.getAttribute('position')
  const vertices = positionAttribute ? positionAttribute.count : 0
  const triangles = geometry.index ? geometry.index.count / 3 : vertices / 3

  if (!geometry.boundingBox) {
    geometry.computeBoundingBox()
  }

  let bounds = null
  if (geometry.boundingBox) {
    const size = new THREE.Vector3()
    geometry.boundingBox.getSize(size)
    bounds = {
      x: size.x,
      y: size.y,
      z: size.z
    }
  }

  return {
    fileName: file?.name || 'unknown',
    fileType: (fileType || 'SCONOSCIUTO').toUpperCase(),
    fileSize: file?.size || 0,
    vertices: Math.floor(vertices),
    triangles: Math.floor(triangles),
    bounds,
    author: '',
    description: '',
    tags: '',
    loadedAt: new Date().toLocaleString('it-IT'),
    bitsPerColor: positionAttribute ? 32 : 0
  }
}
