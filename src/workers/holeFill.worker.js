import * as THREE from 'three'
import { analyzeHoles, fillHoles } from '../utils/holeFiller'

// Chiusura dei fori fuori dal thread della pagina: con fori grandi il calcolo
// dura anche decine di secondi e altrimenti bloccherebbe l'interfaccia.
self.onmessage = ({ data }) => {
  const { positions, colors, indices, holeIds, mode } = data
  try {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    if (indices) geometry.setIndex(new THREE.BufferAttribute(indices, 1))

    const analysis = analyzeHoles(geometry)
    const result = fillHoles(analysis, holeIds, mode, (done, total) => self.postMessage({ type: 'progress', done, total }))

    const out = result.geometry
    const outPositions = out.getAttribute('position').array
    const outColors = out.getAttribute('color')?.array ?? null
    const outIndices = out.index.array
    const transfer = [outPositions.buffer, outIndices.buffer]
    if (outColors) transfer.push(outColors.buffer)
    self.postMessage(
      {
        type: 'done',
        positions: outPositions,
        colors: outColors,
        indices: outIndices,
        filledCount: result.filledCount,
        addedTriangles: result.addedTriangles,
        addedVertices: result.addedVertices,
      },
      transfer
    )
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message })
  }
}
