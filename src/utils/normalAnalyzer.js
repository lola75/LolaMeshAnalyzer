import * as THREE from 'three'

const MAX_NORMAL_ANALYSIS_FACES = 500000

export function analyzeNormals(geometry) {
  const positionAttribute = geometry.getAttribute('position')
  const normalAttribute = geometry.getAttribute('normal')
  
  if (!positionAttribute || !normalAttribute) {
    return {
      hasIssues: false,
      invertedCount: 0,
      totalFaces: 0,
      invertedFaces: [],
      message: 'Normali non disponibili'
    }
  }

  const positions = positionAttribute.array
  const normals = normalAttribute.array
  const indices = geometry.index ? geometry.index.array : null

  const canonicalVertexMap = new Map()
  const getCanonicalVertexIndex = (vertexIndex) => {
    const offset = vertexIndex * 3
    const key = `${positions[offset]}_${positions[offset + 1]}_${positions[offset + 2]}`
    if (!canonicalVertexMap.has(key)) {
      canonicalVertexMap.set(key, canonicalVertexMap.size)
    }
    return canonicalVertexMap.get(key)
  }

  const invertedFaces = []
  let faceCount = 0
  let invertedCount = 0

  const faceTotal = indices ? indices.length / 3 : positions.length / 9
  if (faceTotal > MAX_NORMAL_ANALYSIS_FACES) {
    // Analisi delle normali saltata per mesh molto grande, ma rileviamo comunque i fori.
    const edgeMap = new Map()
    const getIdx = (faceIdx, corner) => {
      if (indices) return indices[faceIdx * 3 + corner]
      return faceIdx * 3 + corner
    }

    for (let i = 0; i < faceTotal; i++) {
      const a = getCanonicalVertexIndex(getIdx(i, 0))
      const b = getCanonicalVertexIndex(getIdx(i, 1))
      const c = getCanonicalVertexIndex(getIdx(i, 2))
      const edges = [ [a,b], [b,c], [c,a] ]
      for (const e of edges) {
        const [v1, v2] = e
        const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`
        edgeMap.set(key, (edgeMap.get(key) || 0) + 1)
      }
    }

    const boundaryEdges = []
    for (const [key, count] of edgeMap.entries()) {
      if (count === 1) boundaryEdges.push(key)
    }

    let holeCount = 0
    if (boundaryEdges.length > 0) {
      const adj = new Map()
      for (const key of boundaryEdges) {
        const [s, t] = key.split('_').map(n => parseInt(n, 10))
        if (!adj.has(s)) adj.set(s, [])
        if (!adj.has(t)) adj.set(t, [])
        adj.get(s).push(t)
        adj.get(t).push(s)
      }

      const visitedV = new Set()
      for (const start of adj.keys()) {
        if (visitedV.has(start)) continue
        const stack = [start]
        let compSize = 0
        while (stack.length > 0) {
          const v = stack.pop()
          if (visitedV.has(v)) continue
          visitedV.add(v)
          compSize++
          for (const nb of adj.get(v) || []) {
            if (!visitedV.has(nb)) stack.push(nb)
          }
        }
        if (compSize > 0) holeCount++
      }
    }

    return {
      hasIssues: holeCount > 0,
      invertedCount: 0,
      totalFaces: faceTotal,
      invertedFaces: [],
      holeCount,
      boundaryEdgeCount: boundaryEdges.length,
      percentage: '0.00',
      message: holeCount > 0
        ? `⚠️ Analisi normali saltata per mesh molto grande, ma rilevati ${holeCount} fori`
        : '⚠️ Analisi normali saltata per mesh molto grande'
    }
  }

  // Analizza ogni triangolo
  const stride = indices ? 3 : 3

  for (let i = 0; i < faceTotal; i++) {
    faceCount++

    let idx0, idx1, idx2

    if (indices) {
      idx0 = indices[i * 3] * 3
      idx1 = indices[i * 3 + 1] * 3
      idx2 = indices[i * 3 + 2] * 3
    } else {
      idx0 = i * 9
      idx1 = i * 9 + 3
      idx2 = i * 9 + 6
    }

    // Estrai le posizioni dei vertici
    const v0 = new THREE.Vector3(positions[idx0], positions[idx0 + 1], positions[idx0 + 2])
    const v1 = new THREE.Vector3(positions[idx1], positions[idx1 + 1], positions[idx1 + 2])
    const v2 = new THREE.Vector3(positions[idx2], positions[idx2 + 1], positions[idx2 + 2])

    // Calcola il normale calcolato (cross product)
    const edge1 = new THREE.Vector3().subVectors(v1, v0)
    const edge2 = new THREE.Vector3().subVectors(v2, v0)
    const calculatedNormal = new THREE.Vector3().crossVectors(edge1, edge2).normalize()

    // Estrai il normale dal geometry
    const storedNormal = new THREE.Vector3(normals[idx0], normals[idx0 + 1], normals[idx0 + 2]).normalize()

    // Controlla se sono invertite (dot product negativo)
    const dotProduct = calculatedNormal.dot(storedNormal)

    if (dotProduct < 0) {
      invertedCount++
      invertedFaces.push({
        index: i,
        position: v0.clone(),
        severity: Math.abs(dotProduct)
      })
    }
  }

  // Rilevamento fori: contare gli spigoli di confine
  // Costruiamo una mappa di spigoli (undirected) e contiamo quelli usati una sola volta
  const edgeMap = new Map()

  const getIdx = (faceIdx, corner) => {
    if (indices) return indices[faceIdx * 3 + corner]
    // non indicizzato: ogni vertice è implicito
    return faceIdx * 3 + corner
  }

  for (let i = 0; i < faceTotal; i++) {
    const a = getCanonicalVertexIndex(getIdx(i, 0))
    const b = getCanonicalVertexIndex(getIdx(i, 1))
    const c = getCanonicalVertexIndex(getIdx(i, 2))

    const edges = [ [a,b], [b,c], [c,a] ]
    for (const e of edges) {
      const [v1, v2] = e
      const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`
      edgeMap.set(key, (edgeMap.get(key) || 0) + 1)
    }
  }

  const boundaryEdges = []
  for (const [k, count] of edgeMap.entries()) {
    if (count === 1) boundaryEdges.push(k)
  }

  // Raggruppare spigoli di confine in anelli (loops) per contare i fori
  let holeCount = 0
  if (boundaryEdges.length > 0) {
    // crea mappa vertice -> vertici adiacenti per gli spigoli di confine
    const adj = new Map()
    for (const key of boundaryEdges) {
      const [s, t] = key.split('_').map(n => parseInt(n, 10))
      if (!adj.has(s)) adj.set(s, [])
      if (!adj.has(t)) adj.set(t, [])
      adj.get(s).push(t)
      adj.get(t).push(s)
    }

    const visitedV = new Set()
    for (const start of adj.keys()) {
      if (visitedV.has(start)) continue
      // percorri l'anello con DFS
      const stack = [start]
      let compSize = 0
      while (stack.length > 0) {
        const v = stack.pop()
        if (visitedV.has(v)) continue
        visitedV.add(v)
        compSize++
        const neighbors = adj.get(v) || []
        for (const nb of neighbors) {
          if (!visitedV.has(nb)) stack.push(nb)
        }
      }
      if (compSize > 0) holeCount++
    }
  }

  const hasIssuesCombined = invertedCount > 0 || holeCount > 0

  return {
    hasIssues: hasIssuesCombined,
    invertedCount,
    totalFaces: faceCount,
    invertedFaces,
    holeCount,
    boundaryEdgeCount: boundaryEdges.length,
    percentage: ((invertedCount / faceCount) * 100).toFixed(2),
    message: hasIssuesCombined
      ? `⚠️ ${invertedCount} facce con normali invertite, ${holeCount} fori individuati` 
      : '✅ Nessun problema rilevato'
  }
}

export function createNormalVisualization(geometry) {
  const positionAttribute = geometry.getAttribute('position')
  const normalAttribute = geometry.getAttribute('normal')
  
  if (!positionAttribute || !normalAttribute) {
    return null
  }

  const positions = positionAttribute.array
  const normals = normalAttribute.array
  const indices = geometry.index ? geometry.index.array : null

  const geometry_lines = new THREE.BufferGeometry()
  const linePositions = []

  const scale = 0.3

  const faceTotal = indices ? indices.length / 3 : positions.length / 9
  if (faceTotal > MAX_NORMAL_ANALYSIS_FACES) {
    return null
  }

  if (faceTotal > MAX_NORMAL_ANALYSIS_FACES) {
    return {
      hasIssues: false,
      invertedCount: 0,
      totalFaces: faceTotal,
      invertedFaces: [],
      percentage: '0.00',
      message: 'Analisi normali saltata per mesh molto grande'
    }
  }

  for (let i = 0; i < faceTotal; i++) {
    let idx0, idx1, idx2

    if (indices) {
      idx0 = indices[i * 3] * 3
      idx1 = indices[i * 3 + 1] * 3
      idx2 = indices[i * 3 + 2] * 3
    } else {
      idx0 = i * 9
      idx1 = i * 9 + 3
      idx2 = i * 9 + 6
    }

    const v0 = new THREE.Vector3(positions[idx0], positions[idx0 + 1], positions[idx0 + 2])
    const v1 = new THREE.Vector3(positions[idx1], positions[idx1 + 1], positions[idx1 + 2])
    const v2 = new THREE.Vector3(positions[idx2], positions[idx2 + 1], positions[idx2 + 2])
    
    const center = new THREE.Vector3().addVectors(v0, v1).add(v2).divideScalar(3)
    
    const normal = new THREE.Vector3(normals[idx0], normals[idx0 + 1], normals[idx0 + 2]).normalize()
    const end = center.clone().addScaledVector(normal, scale)

    linePositions.push(center.x, center.y, center.z)
    linePositions.push(end.x, end.y, end.z)
  }

  geometry_lines.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePositions), 3))

  const material = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 })
  return new THREE.LineSegments(geometry_lines, material)
}
