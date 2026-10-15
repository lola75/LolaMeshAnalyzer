import * as THREE from 'three'
import { analyzeHoles, fillHoles } from './holeFiller'
// worker incorporato nel bundle: funziona anche quando l'app è caricata da file:// (Electron)
import HoleFillWorker from '../workers/holeFill.worker.js?worker&inline'

let activeWorker = null

const toGeometry = ({ positions, colors, indices }) => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

// Chiude i fori `holeIds` (gli id di analyzeHoles(geometry)) senza bloccare la pagina.
// onProgress(done, total) viene chiamata dopo ogni foro. Se il worker non è
// disponibile il calcolo avviene nella pagina.
export function fillHolesAsync(geometry, holeIds, mode, onProgress) {
  let worker
  try {
    worker = new HoleFillWorker()
  } catch (err) {
    console.warn('Worker non disponibile, chiusura fori nella pagina:', err)
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          resolve(fillHoles(analyzeHoles(geometry), holeIds, mode, onProgress))
        } catch (fillErr) {
          reject(fillErr)
        }
      }, 30)
    })
  }

  cancelHoleFill()
  activeWorker = worker
  const position = geometry.getAttribute('position')
  const color = geometry.getAttribute('color')
  // copie: gli array originali restano alla geometria della pagina
  const message = {
    positions: new Float32Array(position.array),
    colors: color ? new Float32Array(color.array) : null,
    indices: geometry.index ? new Uint32Array(geometry.index.array) : null,
    holeIds,
    mode,
  }

  return new Promise((resolve, reject) => {
    const finish = () => {
      worker.terminate()
      if (activeWorker === worker) activeWorker = null
    }
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        onProgress?.(data.done, data.total)
      } else if (data.type === 'done') {
        finish()
        resolve({ ...data, geometry: toGeometry(data) })
      } else if (data.type === 'error') {
        finish()
        reject(new Error(data.message))
      }
    }
    worker.onerror = (event) => {
      finish()
      reject(new Error(event.message || 'errore nel calcolo in background'))
    }
    worker.__reject = (err) => {
      finish()
      reject(err)
    }
    const transfer = [message.positions.buffer]
    if (message.colors) transfer.push(message.colors.buffer)
    if (message.indices) transfer.push(message.indices.buffer)
    worker.postMessage(message, transfer)
  })
}

// Interrompe la chiusura in corso (il risultato non viene applicato)
export function cancelHoleFill() {
  const worker = activeWorker
  if (!worker) return
  activeWorker = null
  worker.__reject?.(new Error('Operazione interrotta.'))
}
