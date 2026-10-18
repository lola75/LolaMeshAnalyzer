import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Niivue, NVMesh, DRAG_MODE, SLICE_TYPE, MULTIPLANAR_TYPE, SHOW_RENDER } from '@niivue/niivue'
import { apiUrl, checkServerHealth } from '../utils/meshLibBackend'
import { attachRenderWheelZoom } from '../utils/niivueWheelZoom'
import { fixRenderDepthRange } from '../utils/niivueRenderDepth'
import { enableTwoSidedMeshes } from '../utils/niivueTwoSidedMeshes'
import { attachRenderPointPicker } from '../utils/niivuePicking'
import CbctVolumeWizard, { Switch } from './CbctVolumeWizard'
import CbctBoxOverlay, { FULL_BOX, NO_CLIP_PLANES, boxClipPlanes, boxCornersMm } from './CbctBoxOverlay'
import CbctCropOverlay from './CbctCropOverlay'
import CbctLoadingProgress from './CbctLoadingProgress'
import CbctMeshStep from './CbctMeshStep'
import CbctImportObjectDialog, { OBJECT_TYPES, POSITION_MATCHING } from './CbctImportObjectDialog'
import CbctMatchingPanel, { MATCHING_ASSISTED, MATCHING_POINTS, MAX_POINT_PAIRS } from './CbctMatchingPanel'
import CbctMeshPreview from './CbctMeshPreview'
import CbctContrastControls from './CbctContrastControls'
import CbctPointMarkers from './CbctPointMarkers'
import MeshModifier from './MeshModifier'
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const CBCT_SERVER_URL = 'http://127.0.0.1:8002'

const VIEWS = [
  { id: 'multi', label: '4 viste', sliceType: SLICE_TYPE.MULTIPLANAR },
  { id: 'axial', label: 'Assiale', sliceType: SLICE_TYPE.AXIAL },
  { id: 'coronal', label: 'Coronale', sliceType: SLICE_TYPE.CORONAL },
  { id: 'sagittal', label: 'Sagittale', sliceType: SLICE_TYPE.SAGITTAL },
  { id: 'render', label: '3D', sliceType: SLICE_TYPE.RENDER },
]

// Impostazioni applicate a ogni nuova CBCT caricata
const DEFAULT_VIEW = 'render'
const DEFAULT_WINDOW = [432, 2340]

// Le CBCT non sono calibrate in Hounsfield: i preset sono relativi alla finestra automatica
const WINDOW_PRESETS = [
  { id: 'auto', label: 'Auto', range: (lo) => [lo, null] },
  { id: 'bone', label: 'Osso e denti', range: (lo, hi) => [lo + 0.35 * (hi - lo), hi] },
  { id: 'soft', label: 'Tessuti molli', range: (lo, hi) => [lo, lo + 0.5 * (hi - lo)] },
]

const WIZARD_STEPS = ['Volume', 'Allineamento mesh', 'Segmentazione']
const STEP_VOLUME = 0
const STEP_MESH = 1
const MESH_FILE_TYPES = '.stl,.ply,.obj'
// Colore di ogni tipo di oggetto 3D nel visualizzatore (stesso ordine di OBJECT_TYPES)
const OBJECT_COLORS = [
  [236, 196, 164], [250, 204, 21], [244, 114, 182], [96, 165, 250], [251, 146, 60], [167, 139, 250],
  [226, 232, 240], [74, 222, 128], [45, 212, 191], [248, 113, 113], [192, 132, 252], [148, 163, 184], [56, 189, 248],
]
const objectColor = (type) => OBJECT_COLORS[Math.max(OBJECT_TYPES.indexOf(type), 0) % OBJECT_COLORS.length]

// Matching STL su DICOM: in alto 3D della CBCT (sinistra) e mesh da sola (destra, canvas separato),
// in basso le tre slice con il contorno della mesh
const MATCH_TOP = 0.56
const MATCH_LAYOUT = [
  { sliceType: SLICE_TYPE.RENDER, position: [0, 0, 0.5, MATCH_TOP] },
  { sliceType: SLICE_TYPE.AXIAL, position: [0, MATCH_TOP, 1 / 3, 1 - MATCH_TOP] },
  { sliceType: SLICE_TYPE.CORONAL, position: [1 / 3, MATCH_TOP, 1 / 3, 1 - MATCH_TOP] },
  { sliceType: SLICE_TYPE.SAGITTAL, position: [2 / 3, MATCH_TOP, 1 / 3, 1 - MATCH_TOP] },
]
const MESH_CONTOUR_MM = 0.6 // spessore della mesh mostrata sulle slice 2D (effetto contorno)

const IDENTITY = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]

// Mesh NiiVue -> geometria three.js per il Modificatore mesh (stesse coordinate: quelle nella CBCT)
const meshToGeometry = (mesh) => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.pts), 3))
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.tris), 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}

// Geometria three.js -> vertici e triangoli per NiiVue. Le geometrie da STL non hanno indici:
// si uniscono i vertici coincidenti (senza normali, che li renderebbero diversi) per l'ombreggiatura liscia.
const geometryToMeshData = (geometry) => {
  let source = geometry
  if (!source.index) {
    source = new THREE.BufferGeometry()
    source.setAttribute('position', geometry.getAttribute('position').clone())
    source = mergeVertices(source, 1e-5)
  }
  const position = source.getAttribute('position')
  const pts = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    pts[i * 3] = position.getX(i)
    pts[i * 3 + 1] = position.getY(i)
    pts[i * 3 + 2] = position.getZ(i)
  }
  return { pts, tris: new Uint32Array(source.index.array) }
}

// Applica una matrice 4x4 (righe) ai vertici di una mesh NiiVue
const transformMesh = (mesh, matrix, gl) => {
  const p = mesh.pts
  const [r0, r1, r2] = matrix
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]
    const y = p[i + 1]
    const z = p[i + 2]
    p[i] = r0[0] * x + r0[1] * y + r0[2] * z + r0[3]
    p[i + 1] = r1[0] * x + r1[1] * y + r1[2] * z + r1[3]
    p[i + 2] = r2[0] * x + r2[1] * y + r2[2] * z + r2[3]
  }
  mesh.updateMesh(gl)
}

const CROP_IDLE = { active: false, points: [], closed: false, keepInside: false }
const ORIENT_IDLE = { active: false, rx: 0, ry: 0, rz: 0 }
const BOX_IDLE = { active: false, changed: false, ...FULL_BOX }

// --- matrici 4x4 per righe (come getVolumeAffine/setVolumeAffine di NiiVue) ---
const matMul = (a, b) => a.map((row) => b[0].map((_, j) => row.reduce((sum, v, k) => sum + v * b[k][j], 0)))
const matVec = (m, v) => m.map((row) => row.reduce((sum, x, k) => sum + x * v[k], 0))
const translation = ([x, y, z]) => [[1, 0, 0, x], [0, 1, 0, y], [0, 0, 1, z], [0, 0, 0, 1]]
const rotationX = (deg) => {
  const r = (deg * Math.PI) / 180
  return [[1, 0, 0, 0], [0, Math.cos(r), -Math.sin(r), 0], [0, Math.sin(r), Math.cos(r), 0], [0, 0, 0, 1]]
}
const rotationY = (deg) => {
  const r = (deg * Math.PI) / 180
  return [[Math.cos(r), 0, Math.sin(r), 0], [0, 1, 0, 0], [-Math.sin(r), 0, Math.cos(r), 0], [0, 0, 0, 1]]
}
const rotationZ = (deg) => {
  const r = (deg * Math.PI) / 180
  return [[Math.cos(r), -Math.sin(r), 0, 0], [Math.sin(r), Math.cos(r), 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
}
// Rotazione attorno al centro del volume, in coordinate RAS (mm)
const rotationAboutCenter = ({ rx, ry, rz }, center) =>
  matMul(translation(center), matMul(rotationX(rx), matMul(rotationY(ry), matMul(rotationZ(rz), translation(center.map((c) => -c))))))

const readErrorDetail = async (response) => {
  try {
    const body = await response.json()
    return body?.detail || `Errore ${response.status}`
  } catch {
    return `Errore ${response.status}`
  }
}

const newProgressId = () => (window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)

// Scarica il corpo della risposta segnalando la frazione ricevuta (0-1)
const readBodyWithProgress = async (response, onProgress) => {
  const total = Number(response.headers.get('Content-Length')) || 0
  if (!response.body || !total) return response.arrayBuffer()
  const reader = response.body.getReader()
  const chunks = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress(Math.min(received / total, 1))
  }
  const buffer = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.length
  }
  return buffer.buffer
}

// POST con avanzamento dell'invio (fetch non lo fornisce). Restituisce una Response come fetch.
const postFormWithProgress = (url, form, onProgress) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest()
  xhr.open('POST', url)
  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) onProgress(event.loaded / event.total)
  }
  xhr.onload = () => resolve(new Response(xhr.responseText, {
    status: xhr.status,
    headers: { 'Content-Type': xhr.getResponseHeader('Content-Type') || 'application/json' },
  }))
  xhr.onerror = () => reject(new TypeError('Failed to fetch'))
  xhr.send(form)
})

export default function CbctPage({ onClose }) {
  const canvasRef = useRef(null)
  const nvRef = useRef(null)
  const folderInputRef = useRef(null)
  const zipInputRef = useRef(null)
  const sessionIdRef = useRef(null)
  const meshInputRef = useRef(null)
  const pendingImportRef = useRef(null)
  const orientBaseRef = useRef(null)

  const [serverStatus, setServerStatus] = useState('checking')
  const [loadingMessage, setLoadingMessage] = useState(null)
  // 0-100, oppure null quando la durata non e' nota (barra indeterminata)
  const [loadingProgress, setLoadingProgress] = useState(null)
  const [showAxes, setShowAxes] = useState(true)
  // Volume CBCT nascosto dal rendering (restano visibili gli oggetti 3D importati)
  const [volumeVisible, setVolumeVisible] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [meta, setMeta] = useState(null)
  const [view, setView] = useState(DEFAULT_VIEW)
  const [windowRange, setWindowRange] = useState(null)
  const [useReduced, setUseReduced] = useState(true)
  const [crop, setCrop] = useState(CROP_IDLE)
  const [box, setBox] = useState(BOX_IDLE)
  const [step, setStep] = useState(STEP_VOLUME)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  // Oggetti 3D importati nel passo "Allineamento mesh": { id, type, fileName, color, position, mesh }
  const [objects, setObjects] = useState([])
  const [selectedObjectId, setSelectedObjectId] = useState(null)
  // Matching in corso: { type, fileName, file, buffer, color, method, result, previewMesh }
  const [matching, setMatching] = useState(null)
  const [matchingError, setMatchingError] = useState(null)
  // Nel Matching contrasto e luminosita' sono bloccati finche' l'utente non li riattiva dal tastino
  const [matchingContrast, setMatchingContrast] = useState(false)
  // Oggetto aperto nel Modificatore mesh: { id, geometry }
  const [editingObject, setEditingObject] = useState(null)
  const getMainNv = useCallback(() => nvRef.current, [])
  const getMainCanvas = useCallback(() => canvasRef.current, [])
  const [orient, setOrient] = useState(ORIENT_IDLE)
  const [speckSize, setSpeckSize] = useState(5)

  const isDesktop = typeof window.electron?.selectCbctSource === 'function'

  useEffect(() => {
    const nv = new Niivue({
      backColor: [0.05, 0.08, 0.14, 1],
      show3Dcrosshair: true,
      isOrientCube: true,
      multiplanarShowRender: SHOW_RENDER.ALWAYS,
      multiplanarLayout: MULTIPLANAR_TYPE.GRID,
      loadingText: '',
      // superfici tagliate dal box di "Riduci volume" mostrate come l'osso, senza colore
      clipPlaneColor: [0, 0, 0, 0],
    })
    nv.attachToCanvas(canvasRef.current)
    fixRenderDepthRange(nv) // lo zoom non deve tagliare gli oggetti vicini alla camera
    enableTwoSidedMeshes(nv) // scansioni aperte visibili anche dal retro
    nv.setSliceType(VIEWS.find((v) => v.id === DEFAULT_VIEW).sliceType)
    // Contrasto cambiato col tasto destro nel visualizzatore: aggiorna i cursori
    nv.onIntensityChange = (volume) => setWindowRange([volume.cal_min, volume.cal_max])
    nvRef.current = nv
    const detachWheelZoom = attachRenderWheelZoom(nv, canvasRef.current)
    return () => {
      detachWheelZoom()
      nvRef.current = null
      try {
        nv.cleanup()
      } catch (err) {
        console.warn('Pulizia NiiVue non riuscita:', err)
      }
    }
  }, [])

  const checkServer = async () => {
    setServerStatus('checking')
    try {
      if (typeof window.electron?.startCbctServer === 'function') {
        const result = await window.electron.startCbctServer()
        if (!result?.success) throw new Error(result?.error || 'Avvio del server CBCT non riuscito.')
      }
      const online = await checkServerHealth(CBCT_SERVER_URL)
      setServerStatus(online ? 'online' : 'offline')
      if (!online && !isDesktop) {
        setError('Server CBCT offline. Avvialo con "mio server\\run_cbct_server.bat".')
      }
    } catch (err) {
      setServerStatus('offline')
      setError(err.message)
    }
  }

  // Libera il volume temporaneo sul server. Si chiama solo alla chiusura vera (pulsante Chiudi o
  // finestra chiusa), non nella pulizia di useEffect: l'aggiornamento automatico di Vite in sviluppo
  // riesegue quella pulizia lasciando la pagina aperta, e il volume sparirebbe dal server.
  const releaseSession = () => {
    if (!sessionIdRef.current) return
    fetch(apiUrl(CBCT_SERVER_URL, `/cbct/${sessionIdRef.current}`), { method: 'DELETE', keepalive: true }).catch(() => {})
    sessionIdRef.current = null
  }

  const closePage = () => {
    releaseSession()
    onClose()
  }

  useEffect(() => {
    checkServer()
    window.addEventListener('pagehide', releaseSession)
    return () => window.removeEventListener('pagehide', releaseSession)
  }, [])

  const applyWindow = (low, high) => {
    const volume = nvRef.current?.volumes?.[0]
    if (!volume) return
    volume.cal_min = low
    volume.cal_max = high
    nvRef.current.updateGLVolume()
    setWindowRange([low, high])
  }

  const startLoading = (message, progress = null) => {
    setLoadingMessage(message)
    setLoadingProgress(progress)
  }

  const stopLoading = () => {
    setLoadingMessage(null)
    setLoadingProgress(null)
  }

  // Interroga il server sull'avanzamento del caricamento e lo riporta nell'intervallo [from, to]
  const pollServerProgress = (progressId, from, to) => {
    let stopped = false
    let timer = null
    const tick = async () => {
      try {
        const response = await fetch(apiUrl(CBCT_SERVER_URL, `/cbct/progress/${progressId}`))
        const status = response.ok ? await response.json() : null
        if (!stopped && typeof status?.value === 'number') {
          setLoadingProgress((current) => Math.max(current ?? 0, from + ((to - from) * status.value) / 100))
          if (status.message) setLoadingMessage(status.message)
        }
      } catch {
        // il prossimo controllo riprova
      }
      if (!stopped) timer = setTimeout(tick, 250)
    }
    timer = setTimeout(tick, 150)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }

  // progressRange: parte della barra (0-100) occupata da download e apertura del volume
  const showVolume = async (volumeMeta, reduced, keepWindow = null, viewId = view, progressRange = [0, 100]) => {
    const [from, to] = progressRange
    const openAt = from + (to - from) * 0.9
    startLoading(reduced ? 'Download del volume ridotto...' : 'Download del volume completo...', from)
    // version nella query: ogni modifica produce un volume nuovo, niente cache
    const query = `?v=${volumeMeta.version}${reduced ? '&reduced=true' : ''}`
    const response = await fetch(apiUrl(CBCT_SERVER_URL, `/cbct/${volumeMeta.id}/volume.nii${query}`))
    if (!response.ok) throw new Error(await readErrorDetail(response))
    const buffer = await readBodyWithProgress(response, (fraction) => setLoadingProgress(from + (openAt - from) * fraction))

    const nv = nvRef.current
    if (!nv) return
    startLoading('Apertura nel visualizzatore 3D...', openAt)
    // lascia disegnare la barra prima del caricamento sulla GPU, che blocca la pagina
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
    // Dopo una modifica la vista 3D resta come l'ha lasciata l'utente (rotazione e dimensione
    // apparente); una CBCT nuova parte invece dalla vista predefinita
    const camera = keepWindow && nv.volumes.length
      ? { azimuth: nv.scene.renderAzimuth, elevation: nv.scene.renderElevation, scale: nv.scene.volScaleMultiplier, size: nv.furthestFromPivot }
      : null
    for (const volume of [...nv.volumes]) nv.removeVolume(volume)
    nv.gl.getError() // azzera eventuali errori precedenti
    await nv.loadFromArrayBuffer(buffer, 'cbct.nii')
    if (nv.gl.getError() === nv.gl.OUT_OF_MEMORY) {
      for (const volume of [...nv.volumes]) nv.removeVolume(volume)
      throw new Error(reduced
        ? 'Memoria della scheda video insufficiente anche per il volume ridotto.'
        : 'Memoria della scheda video insufficiente per il volume completo. Riattiva "Riduci volume".')
    }

    const previousSession = sessionIdRef.current
    sessionIdRef.current = volumeMeta.id
    if (previousSession && previousSession !== volumeMeta.id) {
      fetch(apiUrl(CBCT_SERVER_URL, `/cbct/${previousSession}`), { method: 'DELETE' }).catch(() => {})
    }

    setMeta(volumeMeta)
    const [low, high] = keepWindow || DEFAULT_WINDOW
    applyWindow(low, high)
    nv.setSliceType(VIEWS.find((v) => v.id === viewId).sliceType)
    if (camera) {
      nv.setRenderAzimuthElevation(camera.azimuth, camera.elevation)
      // volume ritagliato: senza correzione NiiVue lo ingrandirebbe a tutto schermo
      if (camera.size > 0 && nv.furthestFromPivot > 0) nv.setScale(camera.scale * (nv.furthestFromPivot / camera.size))
    }
    if (!volumeVisible && keepWindow) nv.setOpacity(0, 0)
    setLoadingProgress(to)
  }

  const toggleReduced = async () => {
    if (!meta || !meta.reduced) return
    const next = !useReduced
    setError(null)
    try {
      await showVolume(meta, next, windowRange)
      setUseReduced(next)
    } catch (err) {
      setError(err.message)
      // Torna alla versione che funzionava
      try {
        await showVolume(meta, useReduced, windowRange)
      } catch {
        // l'errore originale e' gia' mostrato
      }
    } finally {
      stopLoading()
    }
  }

  const describeError = (err) => (err.message === 'Failed to fetch'
    ? 'Il server CBCT non risponde. Premi "Riprova" in alto.'
    : err.message)

  // Barra di caricamento: invio file (solo browser) -> lettura DICOM sul server -> download -> apertura.
  // serverFrom: punto della barra da cui parte il lavoro del server (dopo l'eventuale invio).
  const SERVER_PROGRESS_END = 75

  const runLoad = async (request, serverFrom = 0) => {
    setError(null)
    setNotice(null)
    setCrop(CROP_IDLE)
    setOrient(ORIENT_IDLE)
    closeBox()
    removeAllObjects()
    setStep(STEP_VOLUME)
    setVolumeVisible(true)
    startLoading(serverFrom > 0 ? 'Invio dei file al server...' : 'Lettura della serie DICOM...', 0)
    const progressId = newProgressId()
    const stopPolling = pollServerProgress(progressId, serverFrom, SERVER_PROGRESS_END)
    try {
      const response = await request(progressId)
      stopPolling()
      if (!response.ok) throw new Error(await readErrorDetail(response))
      setUseReduced(true)
      setView(DEFAULT_VIEW)
      await showVolume(await response.json(), true, null, DEFAULT_VIEW, [SERVER_PROGRESS_END, 100])
    } catch (err) {
      setError(describeError(err))
    } finally {
      stopPolling()
      stopLoading()
    }
  }

  const loadFromPath = (sourcePath) => runLoad((progressId) =>
    fetch(apiUrl(CBCT_SERVER_URL, '/cbct/load-path'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: sourcePath, progressId }),
    })
  )

  const UPLOAD_PROGRESS_END = 30

  const loadFromFiles = (fileList) => {
    const files = Array.from(fileList || [])
    if (files.length === 0) return
    runLoad((progressId) => {
      const form = new FormData()
      files.forEach((file) => form.append('files', file, file.name))
      const url = apiUrl(CBCT_SERVER_URL, `/cbct/load-upload?progressId=${encodeURIComponent(progressId)}`)
      return postFormWithProgress(url, form, (fraction) => {
        setLoadingProgress((current) => Math.max(current ?? 0, UPLOAD_PROGRESS_END * fraction))
        if (fraction >= 1) setLoadingMessage('Lettura della serie DICOM...')
      })
    }, UPLOAD_PROGRESS_END)
  }

  const openSource = async (kind) => {
    if (isDesktop) {
      const result = await window.electron.selectCbctSource({ kind })
      if (!result?.canceled && result?.path) loadFromPath(result.path)
      return
    }
    const input = kind === 'zip' ? zipInputRef.current : folderInputRef.current
    input.value = ''
    input.click()
  }

  // Assi rossi (mirino) nella vista 3D e nelle slice
  const toggleAxes = () => {
    const nv = nvRef.current
    const next = !showAxes
    setShowAxes(next)
    if (!nv) return
    nv.opts.show3Dcrosshair = next
    nv.setCrosshairWidth(next ? 1 : 0)
  }

  const toggleVolumeVisible = () => {
    const next = !volumeVisible
    setVolumeVisible(next)
    if (nvRef.current?.volumes?.length) nvRef.current.setOpacity(0, next ? 1 : 0)
  }

  const changeView = (viewId) => {
    setView(viewId)
    nvRef.current?.setSliceType(VIEWS.find((v) => v.id === viewId).sliceType)
  }

  const applyPreset = (preset) => {
    if (!meta) return
    const [lo, hi] = meta.suggestedWindow
    const [low, high] = preset.range(lo, hi)
    applyWindow(low, high ?? hi)
  }

  // --- Operazioni del Wizard volume (eseguite dal server sul volume completo) ---

  const applyServerResult = async (next, beforeShow) => {
    beforeShow?.()
    if (next.version !== meta.version) await showVolume(next, useReduced, windowRange)
    else setMeta(next)
    if (next.summary?.message) setNotice(next.summary.message)
  }

  // beforeShow: eseguita a operazione riuscita, prima di mostrare il volume nuovo
  const runOperation = async (op, params, label, beforeShow) => {
    if (!meta) return false
    setError(null)
    setNotice(null)
    startLoading(label)
    try {
      const response = await fetch(apiUrl(CBCT_SERVER_URL, `/cbct/${meta.id}/ops`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, params }),
      })
      if (!response.ok) throw new Error(await readErrorDetail(response))
      await applyServerResult(await response.json(), beforeShow)
      return true
    } catch (err) {
      setError(describeError(err))
      return false
    } finally {
      stopLoading()
    }
  }

  const undo = async () => {
    if (!meta) return
    setError(null)
    setNotice(null)
    startLoading('Annullamento dell’ultima modifica...')
    try {
      const response = await fetch(apiUrl(CBCT_SERVER_URL, `/cbct/${meta.id}/undo`), { method: 'POST' })
      if (!response.ok) throw new Error(await readErrorDetail(response))
      await applyServerResult(await response.json())
    } catch (err) {
      setError(describeError(err))
    } finally {
      stopLoading()
    }
  }

  // Riduci volume (come RealGuide): box con 6 maniglie sulla vista 3D, il volume fuori dal box
  // si nasconde dal vivo con i piani di taglio di NiiVue; "Riduzione permanente" ritaglia sul server.
  const updateBox = (next) => {
    setBox(next)
    nvRef.current?.setClipPlanes(next.active ? boxClipPlanes(next) : NO_CLIP_PLANES)
  }

  const closeBox = () => updateBox(BOX_IDLE)

  const toggleBox = () => {
    if (box.active) {
      closeBox()
      return
    }
    setNotice(null)
    changeView('render')
    updateBox({ ...BOX_IDLE, active: true })
  }

  const changeBox = ({ min, max }) => updateBox({ active: true, changed: true, min, max })

  const applyBox = async () => {
    const volume = nvRef.current?.volumes?.[0]
    if (!volume) return
    // Il box sparisce prima di caricare il volume ritagliato: il 3D resta come l'ha tagliato l'utente
    await runOperation('cropBox', { cornersRas: boxCornersMm(volume, box) }, 'Riduzione del volume al box...', closeBox)
  }

  // Ritaglio: il contorno si disegna sulla vista 3D; il server proietta i voxel con la stessa
  // matrice di vista usata da NiiVue e rimuove quelli che cadono dentro (o fuori) dal contorno.
  const startCrop = () => {
    setNotice(null)
    changeView('render')
    setCrop({ ...CROP_IDLE, active: true })
  }

  const applyCrop = async () => {
    const nv = nvRef.current
    const canvas = canvasRef.current
    const tile = nv?.screenSlices?.find((slice) => slice.axCorSag === SLICE_TYPE.RENDER)
    if (!tile) {
      setError('Vista 3D non disponibile: riprova dopo aver selezionato la vista 3D.')
      return
    }
    const viewport = [...tile.leftTopWidthHeight]
    const [mvp] = nv.calculateMvpMatrix(null, viewport, nv.scene.renderAzimuth, nv.scene.renderElevation)
    const scale = canvas.width / canvas.getBoundingClientRect().width
    const ok = await runOperation('crop', {
      polygon: crop.points.map(([x, y]) => [x * scale, y * scale]),
      mvp: Array.from(mvp),
      viewport,
      canvasSize: [canvas.width, canvas.height],
      keepInside: crop.keepInside,
    }, 'Ritaglio del volume...')
    if (ok) setCrop(CROP_IDLE)
  }

  // Regola orientamento assi: anteprima dal vivo spostando l'affine del volume in NiiVue,
  // poi il server ricampiona il volume completo con la stessa matrice.
  const startOrient = () => {
    const nv = nvRef.current
    const volume = nv?.volumes?.[0]
    if (!volume) return
    const affine = nv.getVolumeAffine(0).map((row) => [...row])
    const dims = volume.hdr.dims
    const center = matVec(affine, [(dims[1] - 1) / 2, (dims[2] - 1) / 2, (dims[3] - 1) / 2, 1]).slice(0, 3)
    orientBaseRef.current = { affine, center }
    setNotice(null)
    setOrient({ ...ORIENT_IDLE, active: true })
  }

  const changeOrient = (key, value) => {
    const next = { ...orient, [key]: value }
    setOrient(next)
    const base = orientBaseRef.current
    if (!base) return
    nvRef.current.setVolumeAffine(0, matMul(rotationAboutCenter(next, base.center), base.affine))
  }

  const cancelOrient = () => {
    const base = orientBaseRef.current
    if (base && nvRef.current?.volumes?.length) nvRef.current.setVolumeAffine(0, base.affine)
    orientBaseRef.current = null
    setOrient(ORIENT_IDLE)
  }

  const applyOrient = async () => {
    const base = orientBaseRef.current
    if (!base) return
    const ok = await runOperation('reorient', { matrix: rotationAboutCenter(orient, base.center) }, 'Applicazione dell’orientamento...')
    if (ok) {
      orientBaseRef.current = null
      setOrient(ORIENT_IDLE)
    }
  }

  // --- Passo 2: Allineamento mesh (importazione oggetti 3D) ---

  const goToStep = (index) => {
    if (index === STEP_MESH) changeView('render')
    setError(null)
    setNotice(null)
    setStep(index)
  }

  // Pulsanti "Matching" e "Mantieni posizione originale" della finestra Importa oggetto:
  // funzioni da progettare, chiamate a ogni clic con il tipo di oggetto scelto in quel momento.
  const onMatchingClick = (objectType) => {
    // TODO: funzione Matching (da progettare)
    console.info('Matching selezionato per', objectType)
  }

  const onOriginalPositionClick = (objectType) => {
    // TODO: funzione Mantieni posizione originale (da progettare)
    console.info('Mantieni posizione originale selezionato per', objectType)
  }

  const confirmImport = (choice) => {
    pendingImportRef.current = choice
    setImportDialogOpen(false)
    // stesso clic dell'utente: il browser permette di aprire la scelta del file
    meshInputRef.current.value = ''
    meshInputRef.current.click()
  }

  const importObjectFile = async (file) => {
    const choice = pendingImportRef.current
    pendingImportRef.current = null
    const nv = nvRef.current
    if (!file || !choice || !nv) return
    setError(null)
    setNotice(null)
    if (choice.position === POSITION_MATCHING) {
      await startMatchingTool(file, choice.type)
      return
    }
    // Oggetto di riferimento scelto nel menu: il nuovo oggetto riceve il suo stesso spostamento
    // (es. antagonista o ceratura dallo stesso scanner dell'Anatomy gia' allineata)
    const reference = objects.find((o) => String(o.id) === choice.referenceId)
    startLoading(`Importazione di ${file.name}...`)
    try {
      const color = objectColor(choice.type)
      const matrix = reference ? reference.matrix : IDENTITY
      const mesh = await NVMesh.loadFromFile({ file, gl: nv.gl, name: file.name, rgba255: new Uint8Array([...color, 255]) })
      if (reference) transformMesh(mesh, matrix, nv.gl)
      nv.addMesh(mesh)
      const object = { id: mesh.id, type: choice.type, fileName: file.name, color, position: choice.position, matrix, mesh, visible: true }
      setObjects((current) => [...current, object])
      setSelectedObjectId(object.id)
      setNotice(reference
        ? `${choice.type} importato nella posizione di ${reference.type}.`
        : `${choice.type} importato nella posizione originale.`)
    } catch (err) {
      setError(`Impossibile leggere ${file.name}: ${err.message || 'formato non supportato'}. Usa un file STL, PLY o OBJ.`)
    } finally {
      stopLoading()
    }
  }

  // --- Matching STL su DICOM ---

  const startMatchingTool = async (file, type) => {
    const nv = nvRef.current
    let buffer
    try {
      buffer = await file.arrayBuffer()
    } catch (err) {
      setError(`Impossibile leggere ${file.name}: ${err.message}`)
      return
    }
    setMatchingError(null)
    setMatching({
      type, fileName: file.name, file, buffer, color: objectColor(type), method: null, result: null, previewMesh: null,
      cbctPoints: [], meshPoints: [], pickOrder: [],
    })
    // Il Matching si fa guardando la CBCT: se era nascosta torna visibile
    if (!volumeVisible) {
      nv.setOpacity(0, 1)
      setVolumeVisible(true)
    }
    nv.opts.dragMode = DRAG_MODE.none // tasto destro: niente cambi di contrasto
    setMatchingContrast(false)
    nv.setSliceType(SLICE_TYPE.MULTIPLANAR)
    nv.setCustomLayout(MATCH_LAYOUT)
    nv.setSliceMM(true)
    nv.setMeshThicknessOn2D(MESH_CONTOUR_MM)
  }

  const closeMatchingTool = () => {
    const nv = nvRef.current
    if (nv) {
      nv.opts.dragMode = DRAG_MODE.contrast
      nv.clearCustomLayout()
      nv.setSliceMM(false)
      nv.setMeshThicknessOn2D(Infinity)
      nv.setSliceType(VIEWS.find((v) => v.id === view).sliceType)
    }
    setMatching(null)
    setMatchingError(null)
    setMatchingContrast(false)
  }

  const toggleMatchingContrast = () => {
    const next = !matchingContrast
    setMatchingContrast(next)
    if (nvRef.current) nvRef.current.opts.dragMode = next ? DRAG_MODE.contrast : DRAG_MODE.none
  }

  // method: MATCHING_ASSISTED oppure MATCHING_POINTS (con le coppie di punti cliccate)
  const runMatching = async (method) => {
    const nv = nvRef.current
    if (!matching || !meta || !nv) return
    const current = matching
    setMatching({ ...current, method })
    setMatchingError(null)
    startLoading(method === MATCHING_POINTS ? 'Calcolo dai punti...' : 'Estrazione denti da volume...', 0)
    const progressId = newProgressId()
    const stopPolling = pollServerProgress(progressId, 0, 95)
    try {
      const form = new FormData()
      form.append('mesh', current.file, current.fileName)
      form.append('boneThreshold', String(windowRange?.[0] ?? DEFAULT_WINDOW[0]))
      form.append('progressId', progressId)
      form.append('method', method === MATCHING_POINTS ? 'points' : 'assisted')
      if (method === MATCHING_POINTS) {
        form.append('pairs', JSON.stringify({ mesh: current.meshPoints, cbct: current.cbctPoints }))
      }
      const response = await fetch(apiUrl(CBCT_SERVER_URL, `/cbct/${meta.id}/match`), { method: 'POST', body: form })
      stopPolling()
      if (!response.ok) throw new Error(await readErrorDetail(response))
      const result = await response.json()
      startLoading('Posizionamento della mesh sulla CBCT...', 97)
      // La mesh allineata compare sulla CBCT (3D e contorno sulle slice)
      if (current.previewMesh) nv.removeMesh(current.previewMesh)
      const mesh = await NVMesh.readMesh(current.buffer.slice(0), current.fileName, nv.gl, 1, new Uint8Array([...current.color, 255]))
      transformMesh(mesh, result.matrix, nv.gl)
      nv.addMesh(mesh)
      setMatching({ ...current, method, result, previewMesh: mesh })
    } catch (err) {
      setMatchingError(describeError(err))
    } finally {
      stopPolling()
      stopLoading()
    }
  }

  // Per Punti: la mesh gia' allineata (se c'e') si toglie, altrimenti i clic sulla CBCT la colpirebbero
  const selectPointsMatching = () => {
    if (matching?.previewMesh) nvRef.current?.removeMesh(matching.previewMesh)
    setMatchingError(null)
    setMatching((m) => ({ ...m, method: MATCHING_POINTS, result: null, previewMesh: null }))
  }

  const addMatchingPoint = (side, mm) => {
    setMatching((m) => {
      if (!m || m.method !== MATCHING_POINTS) return m
      const key = side === 'cbct' ? 'cbctPoints' : 'meshPoints'
      if (m[key].length >= MAX_POINT_PAIRS) return m // massimo 6 punti per vista
      return { ...m, [key]: [...m[key], mm], pickOrder: [...m.pickOrder, side] }
    })
  }

  const undoMatchingPoint = () => {
    setMatching((m) => {
      const side = m.pickOrder[m.pickOrder.length - 1]
      if (!side) return m
      const key = side === 'cbct' ? 'cbctPoints' : 'meshPoints'
      return { ...m, [key]: m[key].slice(0, -1), pickOrder: m.pickOrder.slice(0, -1) }
    })
  }

  const clearMatchingPoints = () => {
    setMatching((m) => ({ ...m, cbctPoints: [], meshPoints: [], pickOrder: [] }))
  }

  // Clic sulla vista 3D della CBCT durante il Matching Per Punti
  const pointsMode = matching?.method === MATCHING_POINTS
  useEffect(() => {
    const nv = nvRef.current
    if (!pointsMode || !nv || !canvasRef.current) return undefined
    return attachRenderPointPicker(nv, canvasRef.current, (mm) => addMatchingPoint('cbct', mm))
  }, [pointsMode])

  const cancelMatching = () => {
    if (matching?.previewMesh) nvRef.current?.removeMesh(matching.previewMesh)
    closeMatchingTool()
  }

  const applyMatching = () => {
    if (!matching?.result || !matching.previewMesh) return
    const { type, fileName, color, result, previewMesh } = matching
    const object = { id: previewMesh.id, type, fileName, color, position: POSITION_MATCHING, matrix: result.matrix, mesh: previewMesh, visible: true }
    setObjects((list) => [...list, object])
    setSelectedObjectId(object.id)
    closeMatchingTool()
    setNotice(`${type} allineato alla CBCT (variazione ${result.rms.toFixed(3)} mm).`)
  }

  // Spunta nella lista "Oggetti 3D": mostra/nasconde la mesh nel 3D e nelle slice
  const toggleObjectVisible = (id) => {
    const object = objects.find((o) => o.id === id)
    if (!object) return
    const visible = !object.visible
    nvRef.current?.setMeshProperty(object.mesh.id, 'visible', visible)
    setObjects((list) => list.map((o) => (o.id === id ? { ...o, visible } : o)))
  }

  // Modifica di un oggetto con il Modificatore mesh: la geometria entra e torna nelle coordinate
  // della CBCT, quindi l'oggetto resta dov'e' (nome, colore, visibilita' e spostamento invariati)
  const editObject = (id) => {
    const object = objects.find((o) => o.id === id)
    if (!object) return
    setSelectedObjectId(id)
    setEditingObject({ id, geometry: meshToGeometry(object.mesh) })
  }

  const applyObjectEdit = (geometry) => {
    const nv = nvRef.current
    const object = objects.find((o) => o.id === editingObject?.id)
    setEditingObject(null)
    if (!nv || !object) return
    try {
      const { pts, tris } = geometryToMeshData(geometry)
      if (tris.length < 3) throw new Error('la mesh modificata è vuota')
      const mesh = new NVMesh(pts, tris, object.fileName, new Uint8Array([...object.color, 255]), 1, object.visible, nv.gl)
      nv.removeMesh(object.mesh)
      nv.addMesh(mesh)
      setObjects((list) => list.map((o) => (o.id === object.id ? { ...o, mesh, edited: true } : o)))
      setNotice(`${object.type} modificato.`)
    } catch (err) {
      setError(`Modifica di ${object.type} non applicata: ${err.message}`)
    }
  }

  const removeObject = (id) => {
    const object = objects.find((o) => o.id === id)
    if (object) nvRef.current?.removeMesh(object.mesh)
    setObjects((current) => current.filter((o) => o.id !== id))
    if (selectedObjectId === id) setSelectedObjectId(null)
  }

  const removeAllObjects = () => {
    for (const object of objects) nvRef.current?.removeMesh(object.mesh)
    setObjects([])
    setSelectedObjectId(null)
  }

  const busy = Boolean(loadingMessage)
  const editing = crop.active || orient.active || box.active
  const canGoToMesh = Boolean(meta) && !busy && !editing
  const canLoad = serverStatus === 'online' && !busy && !crop.active && !orient.active && !box.active
  const sliderStep = meta && meta.max - meta.min > 100 ? 1 : 0.01

  return (
    <div className="alignment-workspace fixed inset-0 z-50 flex flex-col">
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200 p-4">
        <div className="mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">CBCT</h1>
            <p className="text-sm text-slate-600 mt-1">Carica una CBCT DICOM da cartella o ZIP e preparala per allineamento e segmentazione</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-block px-3 py-1 text-sm font-medium rounded-full ${serverStatus === 'online' ? 'bg-emerald-100 text-emerald-800' : 'bg-yellow-100 text-yellow-800'}`}>
              {serverStatus === 'checking' ? '⏳ Avvio server CBCT...' : serverStatus === 'online' ? '✓ Server CBCT online' : '⚠ Server CBCT offline'}
            </span>
            <button
              onClick={checkServer}
              disabled={serverStatus === 'checking' || busy}
              className="px-3 py-1 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Riprova
            </button>
            <button
              onClick={closePage}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700"
            >
              Chiudi
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex gap-4 p-4">
        {matching && (
          <aside className="alignment-card border w-80 shrink-0 flex flex-col min-h-0">
            <CbctMatchingPanel
              matching={matching}
              busy={busy}
              error={matchingError}
              onAssisted={() => runMatching(MATCHING_ASSISTED)}
              onPoints={selectPointsMatching}
              onUndoPoint={undoMatchingPoint}
              onClearPoints={clearMatchingPoints}
              onComputePoints={() => runMatching(MATCHING_POINTS)}
              onCancel={cancelMatching}
              onApply={applyMatching}
            />
          </aside>
        )}
        <aside className={`alignment-card border w-80 shrink-0 flex flex-col min-h-0 ${matching ? 'hidden' : ''}`}>
          <div className="px-4 pt-4 pb-3 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">Wizard volume</h2>
            <ol className="flex gap-1 mt-2">
              {WIZARD_STEPS.map((label, index) => {
                const enabled = index === step || (index === STEP_VOLUME && !busy) || (index === STEP_MESH && canGoToMesh)
                return (
                  <li key={label} className="flex-1">
                    <button
                      onClick={() => goToStep(index)}
                      disabled={!enabled || index === step}
                      aria-current={index === step ? 'step' : undefined}
                      title={index > STEP_MESH ? 'Prossima fase in sviluppo' : undefined}
                      className={`w-full h-full text-center text-[11px] leading-tight px-1 py-1 rounded transition-colors ${index === step ? 'bg-sky-600 text-white' : enabled ? 'bg-slate-100 text-slate-700 hover:bg-sky-100' : 'bg-slate-100 text-slate-400'}`}
                    >
                      {index + 1}. {label}
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-5">
            <input
              ref={meshInputRef}
              type="file"
              accept={MESH_FILE_TYPES}
              className="hidden"
              onChange={(e) => importObjectFile(e.target.files?.[0])}
            />
            {step === STEP_MESH ? (
              <>
                {error && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
                )}
                {notice && !error && (
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">{notice}</div>
                )}
                <CbctMeshStep
                  busy={busy}
                  objects={objects}
                  selectedId={selectedObjectId}
                  onSelect={setSelectedObjectId}
                  onImport={() => setImportDialogOpen(true)}
                  onRemove={removeObject}
                  onToggleVisible={toggleObjectVisible}
                  onEdit={editObject}
                />
              </>
            ) : (
            <>
            <section>
              <h2 className="text-sm font-semibold text-slate-900 mb-2">Carica CBCT</h2>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => openSource('folder')}
                  disabled={!canLoad}
                  className="px-3 py-2 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 disabled:bg-slate-300"
                >
                  Cartella DICOM
                </button>
                <button
                  onClick={() => openSource('zip')}
                  disabled={!canLoad}
                  className="px-3 py-2 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 disabled:bg-slate-300"
                >
                  File ZIP
                </button>
              </div>
              <input
                ref={folderInputRef}
                type="file"
                webkitdirectory=""
                multiple
                className="hidden"
                onChange={(e) => loadFromFiles(e.target.files)}
              />
              <input
                ref={zipInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => loadFromFiles(e.target.files)}
              />
              <p className="text-xs text-slate-500 mt-2">Si carica solo la serie assiale originale. I file originali non vengono modificati.</p>
            </section>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
            )}
            {notice && !error && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">{notice}</div>
            )}

            {meta && (
              <CbctVolumeWizard
                meta={meta}
                busy={busy}
                box={box}
                onBoxToggle={toggleBox}
                onBoxApply={applyBox}
                onOperation={runOperation}
                onUndo={undo}
                crop={crop}
                onCropStart={startCrop}
                onCropInvert={() => setCrop((c) => ({ ...c, keepInside: !c.keepInside }))}
                onCropApply={applyCrop}
                onCropCancel={() => setCrop(CROP_IDLE)}
                orient={orient}
                onOrientStart={startOrient}
                onOrientChange={changeOrient}
                onOrientApply={applyOrient}
                onOrientCancel={cancelOrient}
                speckSize={speckSize}
                onSpeckSizeChange={setSpeckSize}
                speckThreshold={windowRange ? windowRange[0] : null}
              />
            )}
            </>
            )}
          </div>

          <div className="p-3 border-t border-slate-200 grid grid-cols-2 gap-2">
            <button
              onClick={() => goToStep(step - 1)}
              disabled={step === STEP_VOLUME || busy}
              className="px-3 py-2 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Passo precedente
            </button>
            <button
              onClick={() => goToStep(step + 1)}
              disabled={step !== STEP_VOLUME || !canGoToMesh}
              title={step === STEP_MESH ? 'Segmentazione: prossima fase in sviluppo' : undefined}
              className="px-3 py-2 rounded-lg text-sm bg-sky-600 text-white hover:bg-sky-700 disabled:bg-slate-300"
            >
              Passo successivo
            </button>
          </div>
        </aside>

        <section className="alignment-card border flex-1 min-w-0 relative overflow-hidden">
          <div className="alignment-viewer-stage absolute inset-0">
            <canvas ref={canvasRef} className="w-full h-full block" />
          </div>
          {box.active && !busy && (
            <CbctBoxOverlay nvRef={nvRef} canvasRef={canvasRef} box={box} onChange={changeBox} />
          )}
          {crop.active && (
            <CbctCropOverlay
              points={crop.points}
              closed={crop.closed}
              keepInside={crop.keepInside}
              onAddPoint={(point) => setCrop((c) => ({ ...c, points: [...c.points, point] }))}
              onRemoveLastPoint={() => setCrop((c) => ({ ...c, closed: false, points: c.points.slice(0, -1) }))}
              onClose={() => setCrop((c) => (c.points.length >= 3 ? { ...c, closed: true } : c))}
              onCancel={() => setCrop(CROP_IDLE)}
            />
          )}
          {!meta && !busy && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 pointer-events-none">
              <div className="text-4xl mb-3" aria-hidden="true">◫</div>
              <h3 className="text-lg font-semibold">Nessuna CBCT aperta</h3>
              <p className="text-sm text-white/60">Apri una cartella DICOM o un file ZIP dal pannello a sinistra.</p>
            </div>
          )}
          {pointsMode && matching.cbctPoints.length > 0 && (
            <CbctPointMarkers getNv={getMainNv} getCanvas={getMainCanvas} points={matching.cbctPoints} color="#f59e0b" />
          )}
          {matching && (
            <div
              className="absolute right-0 top-0 w-1/2 border-l border-b border-slate-700/60"
              style={{ height: `${MATCH_TOP * 100}%` }}
            >
              <CbctMeshPreview
                buffer={matching.buffer}
                fileName={matching.fileName}
                color={matching.color}
                onPick={pointsMode ? (mm) => addMatchingPoint('mesh', mm) : undefined}
                points={pointsMode ? matching.meshPoints : undefined}
              />
              <span className="absolute top-2 left-3 text-xs text-white/70 pointer-events-none">{matching.type}</span>
            </div>
          )}
          {matching && !busy && (
            <div className="absolute top-3 left-3 z-10 flex flex-col items-start gap-2">
              <button
                onClick={toggleMatchingContrast}
                aria-pressed={matchingContrast}
                aria-label={matchingContrast ? 'Disattiva contrasto e luminosità' : 'Attiva contrasto e luminosità'}
                title={matchingContrast ? 'Disattiva contrasto e luminosità' : 'Attiva contrasto e luminosità'}
                className={`w-9 h-9 flex items-center justify-center rounded-lg border backdrop-blur transition-colors ${matchingContrast ? 'bg-sky-600 border-sky-400 text-white' : 'bg-slate-900/60 border-white/20 text-white/60 hover:text-white hover:bg-slate-800/70'}`}
              >
                <svg viewBox="0 0 20 20" className="w-5 h-5" aria-hidden="true">
                  <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" />
                  {!matchingContrast && <path d="M3.5 16.5L16.5 3.5" stroke="currentColor" strokeWidth="1.6" />}
                </svg>
              </button>
              {matchingContrast && meta && (
                <div className="w-56 p-3 rounded-xl bg-white/95 border border-slate-200 shadow-xl">
                  <p className="text-xs font-semibold text-slate-900 mb-2">Contrasto e luminosità</p>
                  <CbctContrastControls
                    meta={meta}
                    presets={WINDOW_PRESETS}
                    windowRange={windowRange}
                    step={sliderStep}
                    onPreset={applyPreset}
                    onWindow={applyWindow}
                  />
                  <p className="text-[11px] text-slate-500 mt-2">Anche col tasto destro trascinato sulla CBCT.</p>
                </div>
              )}
            </div>
          )}
          {meta && !busy && !matching && (
            <div className="absolute top-3 right-3 z-10 flex gap-2">
            <button
              onClick={toggleVolumeVisible}
              aria-pressed={!volumeVisible}
              title={volumeVisible ? 'Nascondi il volume CBCT dal rendering' : 'Mostra il volume CBCT'}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border backdrop-blur transition-colors ${volumeVisible ? 'bg-slate-900/70 border-amber-300/60 text-white hover:bg-slate-800/80' : 'bg-slate-900/50 border-white/20 text-white/60 hover:text-white hover:bg-slate-800/70'}`}
            >
              <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M10 2.5l6.5 3.5v8L10 17.5 3.5 14V6z" className={volumeVisible ? 'text-amber-300' : ''} stroke="currentColor" />
                <path d="M3.5 6L10 9.5l6.5-3.5M10 9.5v8" />
                {!volumeVisible && <path d="M3 17L17 3" />}
              </svg>
              {volumeVisible ? 'Nascondi volume' : 'Mostra volume'}
            </button>
            <button
              onClick={toggleAxes}
              aria-pressed={showAxes}
              title={showAxes ? 'Nascondi gli assi rossi' : 'Mostra gli assi rossi'}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border backdrop-blur transition-colors ${showAxes ? 'bg-slate-900/70 border-red-400/60 text-white hover:bg-slate-800/80' : 'bg-slate-900/50 border-white/20 text-white/60 hover:text-white hover:bg-slate-800/70'}`}
            >
              <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M10 2v16M2 10h16" className={showAxes ? 'text-red-400' : ''} stroke="currentColor" />
                <circle cx="10" cy="10" r="3.5" />
                {!showAxes && <path d="M3 17L17 3" />}
              </svg>
              {showAxes ? 'Nascondi assi' : 'Mostra assi'}
            </button>
            </div>
          )}
          {busy && <CbctLoadingProgress message={loadingMessage} progress={loadingProgress} />}
          {importDialogOpen && (
            <CbctImportObjectDialog
              objects={objects}
              onConfirm={confirmImport}
              onCancel={() => setImportDialogOpen(false)}
              onMatchingClick={onMatchingClick}
              onOriginalPositionClick={onOriginalPositionClick}
            />
          )}
          {meta && (
            <div className="absolute bottom-2 left-3 text-xs text-white/70 pointer-events-none">
              {crop.active
                ? 'Ritaglio: clic per aggiungere punti · doppio clic per chiudere · Esc per annullare'
                : 'Clic per spostare il cursore · Rotella: zoom sul 3D, scorrimento sulle slice · Tasto destro trascinato per il contrasto'}
            </div>
          )}
        </section>

        {meta && !matching && (
          <aside className="alignment-card border w-64 shrink-0 overflow-y-auto p-4 flex flex-col gap-5">
            <section>
              <h2 className="text-sm font-semibold text-slate-900 mb-2">Vista</h2>
              <div className="grid grid-cols-2 gap-2">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => changeView(v.id)}
                    disabled={crop.active}
                    className={`px-2 py-1.5 rounded-lg text-sm border disabled:opacity-40 ${view === v.id ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300 text-slate-700 hover:bg-slate-100'}`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              {meta.reduced && (
                <div className="mt-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-700">Visualizzazione leggera</span>
                    <Switch checked={useReduced} onChange={toggleReduced} disabled={busy || crop.active || orient.active} />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {useReduced
                      ? `Mostra una copia a ${meta.reduced.spacing[0]} mm per non saturare la scheda video. Le modifiche usano sempre il volume completo.`
                      : `Volume completo a ${meta.spacing[0]} mm: richiede molta memoria video e può essere lento.`}
                  </p>
                </div>
              )}
            </section>

            <section>
              <h2 className="text-sm font-semibold text-slate-900 mb-2">Contrasto</h2>
              <CbctContrastControls
                meta={meta}
                presets={WINDOW_PRESETS}
                windowRange={windowRange}
                step={sliderStep}
                onPreset={applyPreset}
                onWindow={applyWindow}
              />
            </section>

            <section>
              <h2 className="text-sm font-semibold text-slate-900 mb-2">Informazioni volume</h2>
              <dl className="text-xs text-slate-600 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt>Dimensioni</dt><dd>{meta.size.join(' × ')} voxel</dd>
                <dt>Voxel</dt><dd>{meta.spacing.join(' × ')} mm</dd>
                <dt>Campo</dt><dd>{meta.physicalSizeMm.join(' × ')} mm</dd>
                <dt>File</dt><dd>{meta.fileCount}{meta.seriesCount > 1 ? ` (1 di ${meta.seriesCount} serie)` : ''}</dd>
                {meta.modality && (<><dt>Modalità</dt><dd>{meta.modality}</dd></>)}
                {meta.manufacturer && (<><dt>Produttore</dt><dd>{meta.manufacturer}{meta.model ? ` ${meta.model}` : ''}</dd></>)}
                {meta.seriesDescription && (<><dt>Serie</dt><dd>{meta.seriesDescription}</dd></>)}
              </dl>
            </section>
          </aside>
        )}
      </div>

      {editingObject && (
        <MeshModifier
          geometry={editingObject.geometry}
          onClose={() => setEditingObject(null)}
          onApply={applyObjectEdit}
          requireEditConsent={false}
        />
      )}
    </div>
  )
}
