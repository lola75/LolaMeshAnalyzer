import * as THREE from 'three'

export function loadOBJ(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('OBJ: contenuto non valido')
  }

  const rawVertices = []
  const rawNormals = []
  const positions = []
  const normals = []

  const lines = text.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const parts = trimmed.split(/\s+/)
    const header = parts[0]

    if (header === 'v' && parts.length >= 4) {
      rawVertices.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]))
    } else if (header === 'vn' && parts.length >= 4) {
      rawNormals.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]))
    } else if (header === 'f' && parts.length >= 4) {
      const faceVertices = parts.slice(1)
      for (let i = 1; i < faceVertices.length - 1; i++) {
        const faceTriangle = [faceVertices[0], faceVertices[i], faceVertices[i + 1]]
        for (const vertex of faceTriangle) {
          const [vIndex, , nIndex] = vertex.split('/').map((value) => value.trim())
          const vertexCoords = getOBJComponent(rawVertices, vIndex, 3, 'vertice')
          positions.push(...vertexCoords)

          if (nIndex) {
            const normalCoords = getOBJComponent(rawNormals, nIndex, 3, 'normale')
            normals.push(...normalCoords)
          }
        }
      }
    }
  }

  if (rawVertices.length === 0) {
    throw new Error('OBJ: nessun vertice trovato')
  }
  if (positions.length === 0) {
    throw new Error('OBJ: nessuna faccia valida trovata')
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))

  if (normals.length === positions.length) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3))
  }

  geometry.computeVertexNormals()
  geometry.computeBoundingBox()

  return geometry
}

function getOBJComponent(array, indexToken, size, label) {
  const index = parseInt(indexToken, 10)
  if (Number.isNaN(index)) {
    throw new Error(`OBJ: indice ${label} non valido (${indexToken})`)
  }

  const count = array.length / size
  let normalizedIndex = index >= 0 ? index - 1 : count + index
  if (normalizedIndex < 0 || normalizedIndex >= count) {
    throw new Error(`OBJ: indice ${label} fuori intervallo (${indexToken})`)
  }

  const start = normalizedIndex * size
  return array.slice(start, start + size)
}
