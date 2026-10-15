import * as THREE from 'three'

const PLY_TYPE_MAP = {
  char: { method: 'getInt8', size: 1 },
  uchar: { method: 'getUint8', size: 1 },
  int8: { method: 'getInt8', size: 1 },
  uint8: { method: 'getUint8', size: 1 },
  short: { method: 'getInt16', size: 2 },
  ushort: { method: 'getUint16', size: 2 },
  int16: { method: 'getInt16', size: 2 },
  uint16: { method: 'getUint16', size: 2 },
  int: { method: 'getInt32', size: 4 },
  uint: { method: 'getUint32', size: 4 },
  int32: { method: 'getInt32', size: 4 },
  uint32: { method: 'getUint32', size: 4 },
  float: { method: 'getFloat32', size: 4 },
  float32: { method: 'getFloat32', size: 4 },
  double: { method: 'getFloat64', size: 8 },
  float64: { method: 'getFloat64', size: 8 }
}

function readScalar(dataView, offset, type, littleEndian) {
  const typeInfo = PLY_TYPE_MAP[type]
  if (!typeInfo) {
    throw new Error(`PLY: tipo dato non supportato '${type}'`)
  }
  return dataView[typeInfo.method](offset, littleEndian)
}

function getHeaderLinesFromBytes(uint8) {
  const needle = new TextEncoder().encode('end_header')
  // search for sequence
  let found = -1
  for (let i = 0; i <= uint8.length - needle.length; i++) {
    let ok = true
    for (let j = 0; j < needle.length; j++) {
      if (uint8[i + j] !== needle[j]) { ok = false; break }
    }
    if (ok) { found = i; break }
  }
  if (found === -1) {
    throw new Error('PLY: intestazione mancante o corrotto')
  }

  // Il terminatore dopo end_header è uno solo, uguale a quello usato
  // nel resto dell'header: "\n" (Unix), "\r\n" (Windows) o "\r" (vecchio Mac).
  // Non va mai consumato più di un terminatore: nei PLY binari i byte
  // successivi sono dati e possono valere 0x0A/0x0D.
  let start = found + needle.length
  const crlfHeader = uint8[3] === 0x0d && uint8[4] === 0x0a
  if (crlfHeader) {
    if (uint8[start] === 0x0d && uint8[start + 1] === 0x0a) start += 2
  } else if (uint8[start] === 0x0a || uint8[start] === 0x0d) {
    start += 1
  }

  const headerText = new TextDecoder().decode(uint8.subarray(0, found))
  return { headerText, headerEndByte: found, bodyStartByte: start }
}

function normalizeColorValue(value, dataType) {
  // Determine if value needs normalization from 0-255 to 0-1
  if (['uchar', 'uint8', 'char', 'int8'].includes(dataType)) {
    return value / 255
  } else if (['ushort', 'uint16', 'short', 'int16'].includes(dataType)) {
    return value / 65535
  } else if (['uint', 'uint32', 'int', 'int32'].includes(dataType)) {
    return value / 4294967295
  }
  // Assume float/double are already in 0-1 range
  return Math.max(0, Math.min(1, value))
}

export function loadPLY(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    throw new Error('PLY: arrayBuffer non valido')
  }

  const uint8 = new Uint8Array(arrayBuffer)
  const { headerText, bodyStartByte } = getHeaderLinesFromBytes(uint8)
  const headerLines = headerText.split(/\r?\n/)

  let vertexCount = 0
  let faceCount = 0
  let format = 'ascii'
  let littleEndian = true
  let inVertexSection = false
  const vertexProperties = []
  const facePropertyDefs = []
  let xIndex = -1
  let yIndex = -1
  let zIndex = -1
  let colorPropertyIndexes = { r: -1, g: -1, b: -1 }
  let colorPropertyTypes = { r: 'uchar', g: 'uchar', b: 'uchar' }

  for (const line of headerLines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('format')) {
      if (trimmed.includes('ascii')) {
        format = 'ascii'
      } else if (trimmed.includes('binary_little_endian')) {
        format = 'binary'
        littleEndian = true
      } else if (trimmed.includes('binary_big_endian')) {
        format = 'binary'
        littleEndian = false
      }
      continue
    }

    if (trimmed.startsWith('element vertex')) {
      vertexCount = parseInt(trimmed.split(/\s+/)[2], 10)
      inVertexSection = true
      continue
    }

    if (trimmed.startsWith('element face')) {
      faceCount = parseInt(trimmed.split(/\s+/)[2], 10)
      inVertexSection = false
      continue
    }

    if (trimmed.startsWith('property')) {
      const parts = trimmed.split(/\s+/)
      if (parts.length >= 3) {
        if (parts[1] === 'list') {
          if (!inVertexSection) {
            const countType = parts[2].toLowerCase()
            const itemType = parts[3].toLowerCase()
            const propertyName = parts[4]?.toLowerCase() || 'vertex_indices'
            facePropertyDefs.push({ type: 'list', countType, itemType, name: propertyName })
          }
        } else if (inVertexSection) {
          const propertyType = parts[1].toLowerCase()
          const propertyName = parts[2].toLowerCase()
          vertexProperties.push({ type: propertyType, name: propertyName })
          const index = vertexProperties.length - 1
          if (propertyName === 'x') xIndex = index
          if (propertyName === 'y') yIndex = index
          if (propertyName === 'z') zIndex = index
          if (propertyName === 'red' || propertyName === 'r') {
            colorPropertyIndexes.r = index
            colorPropertyTypes.r = propertyType
          }
          if (propertyName === 'green' || propertyName === 'g') {
            colorPropertyIndexes.g = index
            colorPropertyTypes.g = propertyType
          }
          if (propertyName === 'blue' || propertyName === 'b') {
            colorPropertyIndexes.b = index
            colorPropertyTypes.b = propertyType
          }
        } else {
          // Property non-vertex e non-list nel face section
          facePropertyDefs.push({ type: 'scalar', dataType: parts[1].toLowerCase(), name: parts[2]?.toLowerCase() || 'unknown' })
        }
      }
    }
  }

  if (!vertexCount || vertexCount <= 0) {
    throw new Error('PLY: conteggio vertici non valido')
  }

  const positions = []
  const colors = []
  const indices = []

  if (xIndex === -1 || yIndex === -1 || zIndex === -1) {
    throw new Error('PLY: intestazione vertici non contiene x/y/z')
  }

  if (format === 'ascii') {
    const dataText = new TextDecoder().decode(uint8.subarray(bodyStartByte))
    const allLines = dataText.split(/\r?\n/)
    const vertexLines = []
    const faceLines = []

    for (const line of allLines) {
      if (!line.trim()) continue
      if (vertexLines.length < vertexCount) {
        vertexLines.push(line.trim())
        continue
      }
      if (faceLines.length < faceCount) {
        faceLines.push(line.trim())
      }
    }

    if (vertexLines.length !== vertexCount) {
      throw new Error("PLY: il numero di righe vertice non corrisponde all'intestazione")
    }

    for (const line of vertexLines) {
      const values = line.split(/\s+/)
      if (values.length <= Math.max(xIndex, yIndex, zIndex)) {
        throw new Error('PLY: riga vertice malformata')
      }
      positions.push(
        parseFloat(values[xIndex]),
        parseFloat(values[yIndex]),
        parseFloat(values[zIndex])
      )

      if (colorPropertyIndexes.r >= 0 && colorPropertyIndexes.g >= 0 && colorPropertyIndexes.b >= 0) {
        if (values.length > Math.max(colorPropertyIndexes.r, colorPropertyIndexes.g, colorPropertyIndexes.b)) {
          const r = parseFloat(values[colorPropertyIndexes.r])
          const g = parseFloat(values[colorPropertyIndexes.g])
          const b = parseFloat(values[colorPropertyIndexes.b])
          colors.push(
            normalizeColorValue(r, colorPropertyTypes.r),
            normalizeColorValue(g, colorPropertyTypes.g),
            normalizeColorValue(b, colorPropertyTypes.b)
          )
        }
      }
    }

    for (const line of faceLines) {
      if (!line.trim()) continue
      const values = line.split(/\s+/)
      if (values.length < 4) continue
      const count = parseInt(values[0], 10)
      if (count < 3) continue
      const faceIndices = values.slice(1, 1 + count).map((v) => parseInt(v, 10))
      if (faceIndices.some((v) => Number.isNaN(v))) continue
      for (let i = 1; i < faceIndices.length - 1; i++) {
        indices.push(faceIndices[0], faceIndices[i], faceIndices[i + 1])
      }
    }
  } else {
    const binaryStart = bodyStartByte
    const dataView = new DataView(arrayBuffer, binaryStart)
    let offset = 0

    for (let i = 0; i < vertexCount; i += 1) {
      const values = []
      for (const prop of vertexProperties) {
        const value = readScalar(dataView, offset, prop.type, littleEndian)
        values.push(value)
        offset += PLY_TYPE_MAP[prop.type]?.size || 0
      }
      positions.push(values[xIndex], values[yIndex], values[zIndex])

      if (colorPropertyIndexes.r >= 0 && colorPropertyIndexes.g >= 0 && colorPropertyIndexes.b >= 0) {
        if (values.length > Math.max(colorPropertyIndexes.r, colorPropertyIndexes.g, colorPropertyIndexes.b)) {
          const r = values[colorPropertyIndexes.r]
          const g = values[colorPropertyIndexes.g]
          const b = values[colorPropertyIndexes.b]
          colors.push(
            normalizeColorValue(r, colorPropertyTypes.r),
            normalizeColorValue(g, colorPropertyTypes.g),
            normalizeColorValue(b, colorPropertyTypes.b)
          )
        }
      }
    }

    for (let i = 0; i < faceCount; i += 1) {
      let faceIndices = []
      for (const prop of facePropertyDefs) {
        if (prop.type === 'list') {
          try {
            const count = readScalar(dataView, offset, prop.countType, littleEndian)
            offset += PLY_TYPE_MAP[prop.countType]?.size || 0
            for (let j = 0; j < count; j += 1) {
              const indexValue = readScalar(dataView, offset, prop.itemType, littleEndian)
              offset += PLY_TYPE_MAP[prop.itemType]?.size || 0
              faceIndices.push(indexValue)
            }
          } catch (e) {
            console.error(`PLY binary: errore lettura faccia ${i}:`, e.message)
            break
          }
        } else if (prop.type === 'scalar') {
          offset += PLY_TYPE_MAP[prop.dataType]?.size || 0
        }
      }
      if (faceIndices.length < 3) continue
      for (let j = 1; j < faceIndices.length - 1; j += 1) {
        indices.push(faceIndices[0], faceIndices[j], faceIndices[j + 1])
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  if (colors.length === positions.length) {
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3))
  }
  
  // Se ci sono facce, usale come indici
  if (indices.length > 0) {
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1))
    console.log(`PLY: caricato con ${positions.length / 3} vertici e ${indices.length / 3} facce`)
  } else {
    // Se non ci sono facce, crea triangoli connettendo vertici adiacenti in modo semplice
    // Questo è un fallback per PLY point clouds
    console.warn(`PLY: file caricato senza facce triangolate. Vertici: ${positions.length / 3}, Elemento facce: ${faceCount}`)
    if (facePropertyDefs.length > 0) {
      console.warn(`PLY: proprieta facce trovate: ${facePropertyDefs.map(p => `${p.name}(${p.type})`).join(', ')}`)
    } else {
      console.warn(`PLY: nessuna proprieta facce nell'header`)
    }
    
    if (positions.length > 9) {
      // Crea triangoli da vertici adiacenti (very simple triangulation)
      const simpleIndices = []
      const vertexCount = positions.length / 3
      
      // Crea una semplice "fan triangulation" dai vertici disponibili
      for (let i = 2; i < Math.min(vertexCount, 5000); i += 1) {
        simpleIndices.push(0, i - 1, i)
      }
      
      if (simpleIndices.length > 0) {
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(simpleIndices), 1))
      }
    }
  }

  geometry.computeVertexNormals()
  geometry.computeBoundingBox()

  return geometry
}
