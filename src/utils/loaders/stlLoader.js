import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

const loader = new STLLoader()

export function loadSTL(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    throw new Error('STL: arrayBuffer non valido')
  }

  const geometry = loader.parse(arrayBuffer)
  if (!geometry || typeof geometry.getAttribute !== 'function') {
    throw new Error('STL: parser fallito')
  }

  if (!geometry.getAttribute('normal')) {
    geometry.computeVertexNormals()
  }
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox()
  }

  return geometry
}

function loadBinarySTL(view, length) {
  const faces = view.getUint32(80, true)
  const expectedLength = 84 + faces * 50
  if (length < expectedLength) {
    throw new Error('STL binario incompleto o corrotto')
  }

  const geometry = new THREE.BufferGeometry()
  const vertices = []
  const normals = []

  let offset = 84
  for (let i = 0; i < faces; i++) {
    if (offset + 50 > length) {
      throw new Error(`STL binario: record faccia ${i} incompleto`)
    }

    const nx = view.getFloat32(offset, true)
    const ny = view.getFloat32(offset + 4, true)
    const nz = view.getFloat32(offset + 8, true)
    offset += 12

    for (let j = 0; j < 3; j++) {
      vertices.push(
        view.getFloat32(offset, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true)
      )
      normals.push(nx, ny, nz)
      offset += 12
    }

    offset += 2 // attribute byte count
  }

  validateGeometryArrays(vertices, normals)
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3))
  geometry.computeBoundingBox()

  return geometry
}

function loadASCIISTL(data) {
  if (!data || typeof data !== 'string') {
    throw new Error('STL ASCII: contenuto non valido')
  }

  const vertices = []
  const normals = []
  const vertexPattern = /vertex\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/gi
  const normalPattern = /facet\s+normal\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/gi

  let normalMatch
  let currentNormal = [0, 0, 0]

  while ((normalMatch = normalPattern.exec(data))) {
    currentNormal = [parseFloat(normalMatch[1]), parseFloat(normalMatch[2]), parseFloat(normalMatch[3])]

    const faceStart = normalMatch.index
    const faceEnd = data.indexOf('endfacet', faceStart)
    if (faceEnd === -1) continue

    const faceData = data.substring(faceStart, faceEnd)
    let vertexMatch
    vertexPattern.lastIndex = 0

    while ((vertexMatch = vertexPattern.exec(faceData))) {
      vertices.push(parseFloat(vertexMatch[1]), parseFloat(vertexMatch[2]), parseFloat(vertexMatch[3]))
      normals.push(...currentNormal)
    }
  }

  if (vertices.length === 0) {
    throw new Error('STL ASCII privo di vertici validi')
  }

  validateGeometryArrays(vertices, normals)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3))
  geometry.computeBoundingBox()

  return geometry
}

function validateGeometryArrays(vertices, normals) {
  if (vertices.length % 3 !== 0) {
    throw new Error('STL: numero di coordinate vertice non valido')
  }
  if (normals.length !== vertices.length) {
    throw new Error('STL: numero di normali non coincide con il numero di vertici')
  }
}
