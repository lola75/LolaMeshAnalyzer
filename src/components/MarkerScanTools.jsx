import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'
import useUndercutPreview from './useUndercutPreview'
import { buildBlockoutModel } from '../utils/undercuts'
import useGuideRegion from './useGuideRegion'
import useMeshFreeform from './useMeshFreeform'
import MeshFreeformPanel from './MeshFreeformPanel'
import ProgressOverlay from './ProgressOverlay'

// Strumenti della pagina "Crea Marker Scan" (guida chirurgica), ricostruiti dal video di RealGuide:
// Passo 1 "Rimozione Sottosquadri" e Passo 2 "Generazione Guida" con le "Opzioni avanzate".
// Per ora sono pulsanti e cursori con i valori del video: le funzioni si aggiungono una alla volta.

const STEPS = ['Rimozione Sottosquadri', 'Generazione Guida']
const BLOCKOUT_EDGE_MM = 0.3 // lato dei triangoli della superficie senza sottosquadri
// colore della guida: tavolozza, colore di fabbrica e colore predefinito scelto dall'utente
const GUIDE_FACTORY_COLOR = '#f2c200'
const GUIDE_PALETTE = ['#f2c200', '#f59e0b', '#ef4444', '#ec4899', '#a855f7', '#3b82f6', '#06b6d4', '#22c55e', '#84cc16', '#f8fafc', '#94a3b8', '#334155']
const GUIDE_COLOR_KEY = 'lolamesh.guideColor'
const readDefaultGuideColor = () => {
  try {
    const saved = window.localStorage.getItem(GUIDE_COLOR_KEY)
    return /^#[0-9a-f]{6}$/i.test(saved || '') ? saved : GUIDE_FACTORY_COLOR
  } catch {
    return GUIDE_FACTORY_COLOR
  }
}

const UNDERCUT_DEFAULTS = { surfaceOffset: 0, lateralAngle: 0, undercutRetention: 0, smoothingDiameter: 0.4, repairFilter: 0 }
const GUIDE_DEFAULTS = {
  cursorSize: 5,
  guideOffset: 0.15,
  occlusalThickness: 3.5,
  perimeterThickness: 3,
  implantSleeveSupport: 10,
  implantSupportAngle: 10,
  pinSleeveSupport: 5,
  pinSupportAngle: 10,
  extrusionAngle: 20,
  sleeveTolerance: 0.12,
  sleevesTopProtection: false,
  optimizeFor3DPrinting: false,
}
const WINDOW_DEFAULTS = { depth: 50, size: 6.79, normalToSurface: false }
const TEXT_DEFAULTS = { text: '', size: 2.98, depth: 1, distance: 1, engrave: true, text3D: false }

const button = 'w-full rounded-xl border px-3 py-2 text-sm font-medium shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed'
const plainButton = `${button} border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800`
const activeButton = `${button} border-sky-400 bg-sky-50 text-sky-800`

function Slider({ label, value, min, max, step, unit, onChange, disabled }) {
  const decimals = step < 1 ? 2 : 0
  return (
    <label className={`grid grid-cols-[1fr_96px_64px] items-center gap-2 text-xs ${disabled ? 'opacity-50' : ''}`}>
      <span className="text-slate-600">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-sky-600"
      />
      <span className="text-right tabular-nums text-slate-700">{value.toFixed(decimals)}{unit ? ` ${unit}` : ''}</span>
    </label>
  )
}

function Switch({ label, checked, onChange, disabled }) {
  return (
    <label className={`flex items-center gap-2 text-xs text-slate-700 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      {label}
    </label>
  )
}

// Riquadro che si apre sotto il suo pulsante (come in RealGuide)
function Expandable({ label, open, onToggle, children }) {
  return (
    <div className={`rounded-xl border ${open ? 'border-sky-300' : 'border-transparent'}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className={open ? activeButton : plainButton}>
        {label}
      </button>
      {open && <div className="space-y-2.5 px-2.5 py-3">{children}</div>}
    </div>
  )
}

export default function MarkerScanTools({ meshes = [], setMeshes, canvasHandlersRef, viewportOverlay, callMeshServer, rendererRef, meshesRef, sceneRef, cameraRef, onAction, showMessage }) {
  const [step, setStep] = useState(0)
  const [modelIndex, setModelIndex] = useState(-1)
  const [direction, setDirection] = useState(null) // direzione di inserzione (scena), verso la guida
  const [undercut, setUndercut] = useState(UNDERCUT_DEFAULTS)
  const [guide, setGuide] = useState(GUIDE_DEFAULTS)
  const [regionTool, setRegionTool] = useState('Curva')
  const [openPanel, setOpenPanel] = useState(null) // 'milling' | 'smooth' | 'window' | 'cut' | 'text'
  // Free Form sulla guida: si apre con il pennello Leviga
  const [smoothSettings, setSmoothSettings] = useState({ brush: 'smooth', radius: 2, strength: 0.5 })
  const [windowOptions, setWindowOptions] = useState(WINDOW_DEFAULTS)
  const [cutDepth, setCutDepth] = useState(141.4)
  const [textOptions, setTextOptions] = useState(TEXT_DEFAULTS)
  const [generating, setGenerating] = useState(false)
  const [progressTask, setProgressTask] = useState(null) // barra di avanzamento sopra la vista 3D
  const [guideEdge, setGuideEdge] = useState(0.3) // lato dei triangoli per il remesh della guida (mm)
  const [defaultGuideColor, setDefaultGuideColor] = useState(readDefaultGuideColor)
  const [guideColor, setGuideColor] = useState(defaultGuideColor)
  const setU = (patch) => setUndercut((s) => ({ ...s, ...patch }))
  const setG = (patch) => setGuide((s) => ({ ...s, ...patch }))
  const setW = (patch) => setWindowOptions((s) => ({ ...s, ...patch }))
  const setT = (patch) => setTextOptions((s) => ({ ...s, ...patch }))
  const toggle = (panel) => setOpenPanel((current) => (current === panel ? null : panel))
  // azione richiesta: per ora la pagina mostra "in preparazione"
  const act = (name) => onAction?.(name)

  // direzione di inserzione = dalla vista attuale (la guida arriva dalla parte di chi guarda)
  const directionFromView = () => {
    const camera = cameraRef?.current
    if (!camera) return
    const view = new THREE.Vector3()
    camera.getWorldDirection(view)
    setDirection(view.negate().toArray())
  }

  // mesh caricata: si sceglie da sola e la mappa parte con la vista attuale
  useEffect(() => {
    if (meshes.length === 0) {
      setModelIndex(-1)
      setDirection(null)
      return
    }
    if (modelIndex < 0 || modelIndex >= meshes.length) {
      setModelIndex(0)
      setTimeout(directionFromView, 0)
    }
  }, [meshes.length])

  // modello originale del modello scelto (se e' scelta una mesh generata, quello da cui deriva)
  const sourceIndexOf = (index) => meshes[index]?.blockoutOf ?? meshes[index]?.guideOf ?? index
  const sourceIndex = modelIndex >= 0 ? sourceIndexOf(modelIndex) : -1
  const blockoutIndex = meshes.findIndex((m) => m.blockoutOf === sourceIndex && sourceIndex >= 0)
  const guideIndex = meshes.findIndex((m) => m.guideOf === sourceIndex && sourceIndex >= 0)

  // Genera superficie senza sottosquadri: riempimento del modello originale lungo la direzione di
  // inserzione con i parametri dei cursori; il risultato e' una nuova mesh nella stessa posizione
  // (sostituisce quella generata prima) e il modello originale viene nascosto
  const generateBlockout = () => {
    const source = meshes[sourceIndex]
    const sceneMesh = meshesRef.current[sourceIndex]
    const normalization = sceneMesh?.userData.normalization
    if (!source || !sceneMesh || !normalization || !direction) return
    sceneMesh.updateMatrixWorld(true)
    const up = new THREE.Vector3(...direction).transformDirection(new THREE.Matrix4().copy(sceneMesh.matrixWorld).invert()).normalize()
    const params = { ...undercut }
    setGenerating(true)
    setProgressTask({
      title: 'Superficie senza sottosquadri',
      stages: ['Mappa dei sottosquadri', 'Riempimento lungo la direzione di inserzione', 'Maglia regolare (server mesh)', 'Caricamento'],
      expectedMs: 1500 + (source.geometry.getAttribute('position').count / 170000) * 3500,
    })
    // dopo il disegno del messaggio: il calcolo richiede qualche istante
    setTimeout(async () => {
      try {
        const t0 = performance.now()
        const position = source.geometry.getAttribute('position')
        const index = source.geometry.index
        const result = buildBlockoutModel(position.array, index ? index.array : null, up.toArray(), params)
        let geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(result.positions, 3))
        geometry.setIndex(new THREE.BufferAttribute(result.indices, 1))
        // maglia regolare (server mesh): le pareti dei sottosquadri riempiti sono fatte di triangoli
        // lunghi e sottili, su cui la linea del perimetro della guida non potrebbe passare a meta'
        let remeshed = false
        if (callMeshServer) {
          showMessage?.('⏳ Superficie senza sottosquadri: maglia regolare (server mesh)...')
          try {
            geometry = (await callMeshServer('/remesh-isotropic', { file: geometry }, { target_edge_len: BLOCKOUT_EDGE_MM })).geometry
            remeshed = true
          } catch (error) {
            console.warn('Remesh della superficie senza sottosquadri non riuscito:', error)
          }
        }
        geometry.computeVertexNormals()
        const derived = {
          geometry,
          name: `${source.name || 'Mesh'} - senza sottosquadri`,
          visible: true,
          color: '#e8c547',
          blockoutOf: sourceIndex,
          blockoutUp: up.toArray(), // direzione di inserzione nelle coordinate della mesh
          blockoutCell: result.cell,
          displayFrame: { center: normalization.center.toArray(), scale: normalization.scale, sourceIndex },
        }
        // la superficie generata prima viene sostituita, altrimenti si aggiunge in coda
        const newIndex = blockoutIndex >= 0 ? blockoutIndex : meshes.length
        setMeshes((prev) => {
          const next = prev.map((m, i) => (i === sourceIndex ? { ...m, visible: false } : m))
          next[newIndex] = derived
          return next
        })
        setModelIndex(newIndex)
        const seconds = ((performance.now() - t0) / 1000).toFixed(1)
        const triangles = (geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3).toLocaleString('it-IT')
        showMessage?.(remeshed
          ? `✅ Superficie senza sottosquadri generata (${triangles} triangoli, ${seconds} s).`
          : `⚠️ Superficie senza sottosquadri generata senza maglia regolare (server mesh non raggiungibile): la linea del perimetro non potrà passare a metà delle pareti.`)
      } catch (error) {
        console.error(error)
        showMessage?.(`⚠️ Generazione non riuscita: ${error.message}`)
      } finally {
        setGenerating(false)
        setProgressTask(null)
      }
    }, 30)
  }

  // Ripristina modello originale: si tolgono la superficie generata (e la guida costruita su di
  // essa) e si rimostra l'originale
  const restoreOriginal = () => {
    if (blockoutIndex < 0) {
      showMessage?.('ℹ️ Nessuna superficie generata da togliere.')
      return
    }
    const keep = sourceIndex
    setMeshes((prev) => prev.filter((m, i) => i !== blockoutIndex && i !== guideIndex).map((m, i) => (i === keep ? { ...m, visible: true } : m)))
    setModelIndex(keep)
  }

  // Generazione Guida: regione scelta sul modello senza sottosquadri
  const blockout = meshes[blockoutIndex]
  const region = useGuideRegion({
    active: step === 1 && blockoutIndex >= 0 && openPanel !== 'smooth' && openPanel !== 'window',
    tool: regionTool,
    meshIndex: blockoutIndex,
    meshes,
    meshesRef,
    sceneRef,
    cameraRef,
    canvasHandlersRef,
    up: blockout?.blockoutUp || null,
    cursorSize: guide.cursorSize,
    onCursorSize: (v) => setG({ cursorSize: v }),
  })

  // Crea guida (server mesh): guscio costruito sulla superficie della regione, come in Meshmixer
  // (levigatura, offset interno di "Offset guida", offset esterno dello spessore occlusale sopra e
  // perimetrale sui lati, bordi uniti da una fascia). Sostituisce la guida creata prima.
  const createGuide = async () => {
    const flags = region.flags()
    const sceneMesh = meshesRef.current[blockoutIndex]
    const normalization = sceneMesh?.userData.normalization
    if (!blockout || !flags || !normalization || !callMeshServer) return
    if (region.selected === 0) {
      showMessage?.('ℹ️ Scegli prima la regione della guida (Curva chiusa, Pennello o Lazo).')
      return
    }
    // triangoli della regione: quelli con tutti i vertici scelti
    const source = sourceIndex
    const frameIndex = blockoutIndex
    const position = blockout.geometry.getAttribute('position')
    const index = blockout.geometry.index
    const corner = (t, k) => (index ? index.getX(t * 3 + k) : t * 3 + k)
    const triangles = []
    const triangleCount = index ? index.count / 3 : position.count / 3
    for (let t = 0; t < triangleCount; t++) {
      if (flags[corner(t, 0)] && flags[corner(t, 1)] && flags[corner(t, 2)]) triangles.push(corner(t, 0), corner(t, 1), corner(t, 2))
    }
    if (triangles.length === 0) {
      showMessage?.('ℹ️ La regione scelta è troppo piccola: allargala.')
      return
    }
    const regionGeometry = new THREE.BufferGeometry()
    regionGeometry.setAttribute('position', position)
    regionGeometry.setIndex(triangles)
    setGenerating(true)
    showMessage?.('⏳ Creazione della guida (server mesh)...')
    setProgressTask({
      title: 'Creazione Marker Scan',
      stages: [
        'Preparazione della regione',
        'Maglia regolare e levigatura',
        'Superficie interna (offset guida)',
        'Superficie esterna (spessori)',
        'Lisciatura del bordo',
        'Unione dei margini',
        'Controllo della mesh',
      ],
      expectedMs: 1500 + (triangles.length / 3 / 135000) * 10500,
    })
    try {
      const t0 = performance.now()
      const { geometry, stats } = await callMeshServer('/make-guide', { file: regionGeometry }, {
        up: JSON.stringify(blockout.blockoutUp),
        offset: guide.guideOffset,
        occlusal: guide.occlusalThickness,
        perimeter: guide.perimeterThickness,
      })
      geometry.computeVertexNormals()
      const guideMesh = {
        geometry,
        name: `${meshes[source]?.name || 'Mesh'} - guida chirurgica`,
        visible: true,
        color: guideColor,
        guideOf: source,
        displayFrame: { center: normalization.center.toArray(), scale: normalization.scale, sourceIndex: frameIndex },
      }
      setMeshes((prev) => {
        const existing = prev.findIndex((m) => m.guideOf === source)
        const next = [...prev]
        next[existing >= 0 ? existing : next.length] = guideMesh
        return next
      })
      const seconds = ((performance.now() - t0) / 1000).toFixed(1)
      showMessage?.(`✅ Guida creata: ${stats.triangles.toLocaleString('it-IT')} triangoli, volume ${(stats.volumeMm3 / 1000).toFixed(2)} cm³ (${seconds} s).`)
    } catch (error) {
      console.error(error)
      showMessage?.(`⚠️ Creazione della guida non riuscita: ${error.message}`)
    } finally {
      setGenerating(false)
      setProgressTask(null)
    }
  }

  const deleteGuide = () => {
    if (guideIndex < 0) return
    setMeshes((prev) => prev.filter((m, i) => i !== guideIndex))
  }

  // Leviga guida: lo strumento Free Form del Modificatore sulla guida creata, aperto con il pennello
  // Leviga (come la lisciatura a pennello di Meshmixer). Tutto a mano: le pennellate restano sulla
  // copia di lavoro finche' l'utente non preme Applica.
  const smoothing = step === 1 && openPanel === 'smooth' && guideIndex >= 0
  const smoothStateRef = useRef({ active: false, painting: false })
  const freeform = useMeshFreeform({
    active: smoothing,
    meshIndex: guideIndex,
    meshes,
    meshesRef,
    sceneRef,
    cameraRef,
    rendererRef,
    brushStateRef: smoothStateRef,
    settings: smoothSettings,
  })
  useEffect(() => {
    if (!smoothing || !freeform.ready || !canvasHandlersRef) return undefined
    const brush = freeform.handlers
    const handlers = {
      down: (event) => {
        const captured = brush.down(event)
        if (captured) smoothStateRef.current.painting = true
        return captured
      },
      move: brush.move,
      up: () => {
        smoothStateRef.current.painting = false
        brush.up()
      },
      leave: brush.leave,
      // Ctrl + rotella: diametro del pennello
      wheel: (deltaY) => {
        if (deltaY === 0) return false
        setSmoothSettings((s) => ({ ...s, radius: Math.min(guideMaxRadius, Math.max(0.1, Math.round(s.radius * (deltaY < 0 ? 1.1 : 1 / 1.1) * 10) / 10)) }))
        return true
      },
    }
    canvasHandlersRef.current = handlers
    return () => {
      if (canvasHandlersRef.current === handlers) canvasHandlersRef.current = null
    }
  })
  // Ctrl+Z: annulla l'ultima pennellata
  useEffect(() => {
    if (!smoothing) return undefined
    const onKey = (event) => {
      if (!((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') || !freeform.canUndo) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return
      event.preventDefault()
      event.stopImmediatePropagation()
      freeform.undo()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [smoothing, freeform.canUndo])
  const applySmoothing = () => {
    const geometry = freeform.result()
    if (!geometry) return
    const index = guideIndex
    setMeshes((prev) => prev.map((m, i) => (i === index ? { ...m, geometry } : m)))
    freeform.adopt(geometry)
    showMessage?.('✅ Modifiche Free Form della guida applicate.')
  }
  // colore della guida: cambia subito quella creata e vale per le prossime
  const changeGuideColor = (color) => {
    setGuideColor(color)
    if (guideIndex < 0) return
    const index = guideIndex
    setMeshes((prev) => prev.map((m, i) => (i === index ? { ...m, color } : m)))
  }
  const saveDefaultGuideColor = () => {
    setDefaultGuideColor(guideColor)
    try {
      window.localStorage.setItem(GUIDE_COLOR_KEY, guideColor)
    } catch {
      // archivio del browser non disponibile: il predefinito vale solo per questa sessione
    }
    showMessage?.('✅ Colore predefinito della guida salvato.')
  }

  // Remesh isotropico della guida (server mesh): triangoli regolari del lato scelto
  const remeshGuide = async () => {
    const target = meshes[guideIndex]
    if (!target || !callMeshServer) return
    const index = guideIndex
    setGenerating(true)
    showMessage?.('⏳ Remesh isotropico della guida (server mesh)...')
    setProgressTask({ title: 'Remesh isotropico della guida', stages: ['Remesh isotropico (server mesh)', 'Caricamento'], expectedMs: 2500 })
    try {
      const t0 = performance.now()
      const { geometry, stats } = await callMeshServer('/remesh-isotropic', { file: target.geometry }, { target_edge_len: guideEdge })
      geometry.computeVertexNormals()
      setMeshes((prev) => prev.map((m, i) => (i === index ? { ...m, geometry } : m)))
      const triangles = stats.after?.triangles ?? (geometry.index ? geometry.index.count / 3 : 0)
      showMessage?.(`✅ Remesh della guida: ${triangles.toLocaleString('it-IT')} triangoli, lato medio ${(stats.after?.edgeMean ?? guideEdge).toFixed(2)} mm (${((performance.now() - t0) / 1000).toFixed(1)} s).`)
    } catch (error) {
      console.error(error)
      showMessage?.(`⚠️ Remesh della guida non riuscito: ${error.message}`)
    } finally {
      setGenerating(false)
      setProgressTask(null)
    }
  }

  // Finestra rotonda: con il pannello aperto, anteprima del cilindro sotto il mouse e clic sulla guida
  // per forarla (server mesh). Il foro segue la vista (perpendicolare allo schermo) oppure la
  // perpendicolare alla guida; Ctrl + rotella cambia il diametro. Ogni finestra si puo' annullare.
  const windowActive = step === 1 && openPanel === 'window' && guideIndex >= 0
  const windowHistoryRef = useRef([]) // [{ before, after }] geometrie della guida
  const [windowUndoCount, setWindowUndoCount] = useState(0)
  const windowStateRef = useRef({})
  windowStateRef.current = { options: windowOptions, generating }
  const cutWindow = async (centerMm, axis) => {
    const target = meshes[guideIndex]
    if (!target || !callMeshServer || generating) return
    const index = guideIndex
    const before = target.geometry
    const { size, depth } = windowOptions
    setGenerating(true)
    setProgressTask({ title: 'Finestra rotonda', stages: ['Foro cilindrico (server mesh)', 'Caricamento'], expectedMs: 1500 })
    try {
      const { geometry, stats } = await callMeshServer('/cut-window', { file: before }, {
        center: JSON.stringify(centerMm),
        axis: JSON.stringify(axis),
        diameter: size,
        depth,
      })
      geometry.computeVertexNormals()
      windowHistoryRef.current.push({ before, after: geometry })
      setWindowUndoCount(windowHistoryRef.current.length)
      setMeshes((prev) => prev.map((m, i) => (i === index ? { ...m, geometry } : m)))
      showMessage?.(`✅ Finestra rotonda aperta (Ø ${size.toFixed(2)} mm, ${stats.removedVolumeMm3.toFixed(1)} mm³ tolti).`)
    } catch (error) {
      console.error(error)
      showMessage?.(`⚠️ Finestra non riuscita: ${error.message}`)
    } finally {
      setGenerating(false)
      setProgressTask(null)
    }
  }
  const undoWindow = () => {
    const last = windowHistoryRef.current[windowHistoryRef.current.length - 1]
    const index = guideIndex
    if (!last || meshes[index]?.geometry !== last.after) return
    windowHistoryRef.current.pop()
    setWindowUndoCount(windowHistoryRef.current.length)
    setMeshes((prev) => prev.map((m, i) => (i === index ? { ...m, geometry: last.before } : m)))
  }
  const canUndoWindow = windowUndoCount > 0 && meshes[guideIndex]?.geometry === windowHistoryRef.current[windowHistoryRef.current.length - 1]?.after
  // Ctrl+Z con il pannello aperto: annulla l'ultima finestra
  useEffect(() => {
    if (!windowActive || !canUndoWindow) return undefined
    const onKey = (event) => {
      if (!((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z')) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return
      if (windowStateRef.current.generating) return
      event.preventDefault()
      // il tasto non deve far scattare anche l'annulla del Modificatore
      event.stopImmediatePropagation()
      undoWindow()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [windowActive, canUndoWindow, meshes, guideIndex])

  useEffect(() => {
    if (!windowActive || !canvasHandlersRef) return undefined
    // la scena viene ricostruita dal Modificatore nello stesso aggiornamento: si aspetta
    let teardown = null
    const start = setTimeout(() => { teardown = setupWindowTool() }, 0)
    return () => {
      clearTimeout(start)
      teardown?.()
    }
  }, [windowActive, guideIndex, meshes])

  const setupWindowTool = () => {
    const sceneMesh = meshesRef.current[guideIndex]
    const normalization = sceneMesh?.userData.normalization
    if (!sceneMesh || !normalization) return null
    const { center, scale } = normalization
    // anteprima: solo il cerchio rosso del foro (raggio 1, scalato con il diametro)
    const preview = new THREE.Group()
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.03, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0xef4444, depthTest: false, transparent: true }),
    )
    rim.rotation.x = Math.PI / 2
    rim.renderOrder = 999
    preview.add(rim)
    preview.visible = false
    preview.traverse((object) => { object.raycast = () => {} })
    sceneMesh.add(preview)

    const raycaster = new THREE.Raycaster()
    const pick = (event) => {
      const rect = event.target.getBoundingClientRect()
      const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, cameraRef.current)
      const hit = raycaster.intersectObject(sceneMesh, false)[0]
      if (!hit) return null
      const local = sceneMesh.worldToLocal(hit.point.clone())
      const { normalToSurface } = windowStateRef.current.options
      let axis
      if (normalToSurface) {
        axis = hit.face.normal.clone()
      } else {
        // direzione della vista nelle coordinate della mesh (la mesh puo' essere ruotata)
        sceneMesh.updateMatrixWorld(true)
        axis = raycaster.ray.direction.clone().transformDirection(new THREE.Matrix4().copy(sceneMesh.matrixWorld).invert())
      }
      return { local, axis: axis.normalize(), mm: [local.x / scale + center.x, local.y / scale + center.y, local.z / scale + center.z] }
    }
    const show = (hit) => {
      preview.visible = !!hit
      if (!hit) return
      const radius = (windowStateRef.current.options.size / 2) * scale
      rim.scale.setScalar(radius)
      preview.position.copy(hit.local)
      preview.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hit.axis)
    }
    let frame = 0
    let lastEvent = null
    const handlers = {
      down: () => false, // il trascinamento ruota la vista
      move: (event) => {
        lastEvent = event
        if (frame) return
        frame = requestAnimationFrame(() => {
          frame = 0
          show(event.buttons === 0 ? pick(event) : null)
        })
      },
      // Ctrl + rotella: diametro della finestra (su aumenta, giu' diminuisce)
      wheel: (deltaY) => {
        if (deltaY === 0) return false
        const current = windowStateRef.current.options.size
        const next = Math.min(15, Math.max(1, Math.round((current + (deltaY < 0 ? 0.25 : -0.25)) * 100) / 100))
        setW({ size: next })
        windowStateRef.current.options = { ...windowStateRef.current.options, size: next }
        if (lastEvent) show(pick(lastEvent))
        return true
      },
      click: (event) => {
        if (windowStateRef.current.generating) return
        const hit = pick(event)
        if (!hit) return
        cutWindow(hit.mm, hit.axis.toArray())
      },
      leave: () => show(null),
    }
    canvasHandlersRef.current = handlers
    return () => {
      if (frame) cancelAnimationFrame(frame)
      if (canvasHandlersRef.current === handlers) canvasHandlersRef.current = null
      preview.removeFromParent()
      preview.traverse((object) => {
        object.geometry?.dispose()
        object.material?.dispose()
      })
    }
  }

  // chiudendo con pennellate non applicate si chiede cosa farne (come il Free Form del Modificatore)
  const toggleSmoothing = () => {
    if (openPanel === 'smooth' && freeform.strokes > 0) {
      if (window.confirm('Applicare le modifiche del Free Form alla guida?\nOK = applica, Annulla = scarta le pennellate.')) applySmoothing()
      else freeform.discard()
    }
    toggle('smooth')
  }
  // diametro massimo del pennello, come nel Free Form del Modificatore (15% della diagonale)
  const guideGeometry = meshes[guideIndex]?.geometry
  if (guideGeometry && !guideGeometry.boundingSphere) guideGeometry.computeBoundingSphere()
  const guideDiagonal = guideGeometry ? guideGeometry.boundingSphere.radius * 2 : 50
  const guideMaxRadius = Math.max(1, Math.round(guideDiagonal * 0.15))
  const freeformPanel = smoothing && viewportOverlay && createPortal(
    <div className="pointer-events-auto">
      <MeshFreeformPanel
        meshName={meshes[guideIndex]?.name || 'Guida'}
        diagonal={guideDiagonal}
        settings={smoothSettings}
        onSettings={(patch) => setSmoothSettings((s) => ({ ...s, ...patch }))}
        freeform={freeform}
        onApply={applySmoothing}
        onClose={toggleSmoothing}
      />
    </div>,
    viewportOverlay,
  )

  const undercuts = useUndercutPreview({
    active: step === 0 && modelIndex >= 0,
    meshIndex: modelIndex,
    meshes,
    meshesRef,
    sceneRef,
    direction,
  })

  // Annulla / Ripeti della regione della guida, sopra la vista 3D
  const regionArrows = step === 1 && blockoutIndex >= 0 && viewportOverlay && createPortal(
    <div className="pointer-events-auto absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-2">
      {[
        { label: 'Annulla', icon: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3', onClick: region.undo, enabled: region.canUndo, hint: 'Annulla l\'ultimo punto o tratto della regione (Ctrl+Z)' },
        { label: 'Ripeti', icon: 'm15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3', onClick: region.redo, enabled: region.canRedo, hint: 'Ripeti il punto o tratto annullato (Ctrl+Y)' },
      ].map(({ label, icon, onClick, enabled, hint }) => (
        <button
          key={label}
          type="button"
          onClick={onClick}
          disabled={!enabled}
          title={hint}
          aria-label={label}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white/90 text-slate-700 shadow-md transition hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={icon} />
          </svg>
        </button>
      ))}
    </div>,
    viewportOverlay,
  )

  return (
    <div className="mt-2 space-y-4">
      {regionArrows}
      {freeformPanel}
      {viewportOverlay && createPortal(<ProgressOverlay task={progressTask} />, viewportOverlay)}
      {/* passi */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
        {STEPS.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(index)}
            aria-current={step === index ? 'step' : undefined}
            className={`rounded-lg px-2 py-1.5 text-xs font-medium transition ${step === index ? 'bg-white text-sky-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            {index + 1}. {label}
          </button>
        ))}
      </div>

      {step === 0 && (
        <section className="space-y-3">
          <h4 className="text-[15px] font-semibold text-slate-900">Rimozione Sottosquadri</h4>
          <select
            value={modelIndex}
            onChange={(e) => setModelIndex(Number(e.target.value))}
            disabled={meshes.length === 0}
            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
            aria-label="Modello su cui lavorare"
          >
            {meshes.length === 0 && <option value={-1}>Carica prima una mesh</option>}
            {meshes.map((m, i) => <option key={i} value={i}>{m.name}</option>)}
          </select>
          <button type="button" className={plainButton} disabled={modelIndex < 0} onClick={directionFromView}>
            Imposta direzione di inserzione dalla vista
          </button>
          {modelIndex >= 0 && (
            <p className="text-[11px] text-slate-500">
              {undercuts.computing
                ? '⏳ Calcolo dei sottosquadri...'
                : `Ruota la vista per scegliere da dove si inserisce la guida (freccia gialla), poi premi il pulsante. Sottosquadri: ${undercuts.undercutPercent.toFixed(1)}% della superficie, massimo ${undercuts.maxDepth >= 2.5 ? 'oltre 2,5' : undercuts.maxDepth.toFixed(2)} mm.`}
            </p>
          )}
          <div className="space-y-2 rounded-xl border border-slate-200 p-2.5">
            <Slider label="Offset superficie" value={undercut.surfaceOffset} min={0} max={1} step={0.01} unit="mm" onChange={(v) => setU({ surfaceOffset: v })} />
            <Slider label="Angolo laterale" value={undercut.lateralAngle} min={0} max={15} step={0.5} unit="°" onChange={(v) => setU({ lateralAngle: v })} />
            <Slider label="Ritenzione sottosquadri" value={undercut.undercutRetention} min={0} max={1} step={0.01} unit="mm" onChange={(v) => setU({ undercutRetention: v })} />
            <Slider label="Diametro lisciatura" value={undercut.smoothingDiameter} min={0} max={2} step={0.05} unit="mm" onChange={(v) => setU({ smoothingDiameter: v })} />
            <Slider label="Filtro riparazione mesh" value={undercut.repairFilter} min={0} max={10} step={1} onChange={(v) => setU({ repairFilter: v })} />
          </div>
          {/* legenda della mappa dei sottosquadri (0 - 1,5 mm) */}
          <div className="rounded-xl border border-slate-200 p-2.5">
            <div className="mb-1 text-xs font-medium text-slate-700">Sottosquadri</div>
            <div className="h-2.5 rounded-full bg-gradient-to-r from-blue-600 via-green-500 via-yellow-400 via-red-500 to-fuchsia-600" />
            <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-500">
              {['0,00', '0,30', '0,60', '0,90', '1,20', '1,50'].map((v) => <span key={v}>{v}</span>)}
            </div>
          </div>
          <Expandable label="Parametri Fresatura" open={openPanel === 'milling'} onToggle={() => toggle('milling')}>
            <p className="text-xs text-slate-500">Parametri della fresa per i modelli da fresare: da definire.</p>
          </Expandable>
          <button type="button" className={plainButton} disabled={sourceIndex < 0 || !direction || generating} onClick={generateBlockout}>
            {generating ? '⏳ Generazione in corso...' : 'Genera superficie senza sottosquadri'}
          </button>
          <button type="button" className={plainButton} disabled={blockoutIndex < 0 || generating} onClick={restoreOriginal}>Ripristina modello originale</button>
          <button type="button" className={plainButton} onClick={() => setUndercut(UNDERCUT_DEFAULTS)}>Ripristina valori di default</button>
          <button type="button" className={plainButton} onClick={() => act('Mostra differenze modello originale')}>Mostra differenze modello originale</button>
          <button type="button" className={plainButton} onClick={() => act('Offset con pennello')}>Offset con pennello</button>
        </section>
      )}

      {step === 1 && (
        <section className="space-y-3">
          <h4 className="text-[15px] font-semibold text-slate-900">Generazione Guida</h4>
          <div className="grid grid-cols-3 gap-1.5">
            {['Curva', 'Pennello', 'Lazo'].map((tool) => (
              <button
                key={tool}
                type="button"
                onClick={() => setRegionTool(tool)}
                aria-pressed={regionTool === tool}
                className={`rounded-lg border px-2 py-1.5 text-xs font-medium ${regionTool === tool ? 'border-sky-500 bg-sky-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                {tool}
              </button>
            ))}
          </div>
          <Slider label="Dimensioni cursore" value={guide.cursorSize} min={0.5} max={15} step={0.5} unit="mm" onChange={(v) => setG({ cursorSize: v })} disabled={regionTool !== 'Pennello'} />
          <p className="text-[11px] text-slate-500">
            {blockoutIndex < 0
              ? 'Genera prima la superficie senza sottosquadri (passo 1): la guida si disegna su quella.'
              : regionTool === 'Curva'
                ? region.closed
                  ? 'Curva chiusa. Annulla (freccia sotto la vista o Ctrl+Z) la riapre.'
                  : `Clic sul modello per aggiungere punti (${region.points}); clic sul primo punto per chiudere. Annulla / Ripeti: frecce sotto la vista, Ctrl+Z / Ctrl+Y.`
                : regionTool === 'Pennello'
                  ? 'Trascina sul modello per colorare la regione; Maiusc per cancellare, Ctrl + rotella per il diametro.'
                  : 'Disegna un contorno: si aggiunge ciò che sta dentro; Maiusc per togliere.'}
          </p>
          <button type="button" className={plainButton} disabled={blockoutIndex < 0} onClick={region.reset}>Reimposta regione</button>
          <div className="space-y-2 rounded-xl border border-slate-200 p-2.5">
            <Slider label="Offset guida" value={guide.guideOffset} min={0} max={0.5} step={0.01} unit="mm" onChange={(v) => setG({ guideOffset: v })} />
            <Slider label="Spessore occlusale" value={guide.occlusalThickness} min={1} max={6} step={0.1} unit="mm" onChange={(v) => setG({ occlusalThickness: v })} />
            <Slider label="Spessore perimetrale" value={guide.perimeterThickness} min={1} max={6} step={0.1} unit="mm" onChange={(v) => setG({ perimeterThickness: v })} />
            <Slider label="Supporto cannula impianto" value={guide.implantSleeveSupport} min={4} max={15} step={0.1} unit="mm" onChange={(v) => setG({ implantSleeveSupport: v })} />
            <Slider label="Angolo supporto impianto" value={guide.implantSupportAngle} min={0} max={45} step={1} unit="°" onChange={(v) => setG({ implantSupportAngle: v })} />
            <Slider label="Supporto cannula pin" value={guide.pinSleeveSupport} min={3} max={12} step={0.1} unit="mm" onChange={(v) => setG({ pinSleeveSupport: v })} />
            <Slider label="Angolo supporto pin" value={guide.pinSupportAngle} min={0} max={45} step={1} unit="°" onChange={(v) => setG({ pinSupportAngle: v })} />
            <Slider label="Angolo estrusione" value={guide.extrusionAngle} min={0} max={45} step={1} unit="°" onChange={(v) => setG({ extrusionAngle: v })} />
            <Slider label="Tolleranza cannule" value={guide.sleeveTolerance} min={0} max={0.5} step={0.01} unit="mm" onChange={(v) => setG({ sleeveTolerance: v })} />
          </div>
          <Switch label="Add Sleeves Support Top Protection" checked={guide.sleevesTopProtection} onChange={(v) => setG({ sleevesTopProtection: v })} />
          <Switch label="Optimize Guide For 3D Printing" checked={guide.optimizeFor3DPrinting} onChange={(v) => setG({ optimizeFor3DPrinting: v })} />
          <button type="button" className={`${button} border-sky-700 bg-sky-600 text-white hover:bg-sky-700`} disabled={blockoutIndex < 0 || region.selected === 0 || generating} onClick={createGuide}>
            {generating ? '⏳ Creazione Marker Scan...' : 'Crea Marker Scan'}
          </button>
          <button type="button" className={plainButton} disabled={guideIndex < 0 || generating} onClick={deleteGuide}>Cancella guida</button>
          {guideIndex >= 0 && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={openPanel === 'smooth' ? activeButton : plainButton} aria-pressed={openPanel === 'smooth'} disabled={generating} onClick={toggleSmoothing}>
                  Leviga guida (Free Form)
                </button>
                <button
                  type="button"
                  className={plainButton}
                  disabled={generating || openPanel === 'smooth'}
                  title={openPanel === 'smooth' ? 'Chiudi prima il Free Form' : 'Triangoli regolari su tutta la guida (server mesh)'}
                  onClick={remeshGuide}
                >
                  Remesh isotropico
                </button>
              </div>
              <Slider label="Lato triangoli remesh" value={guideEdge} min={0.1} max={1} step={0.05} unit="mm" onChange={setGuideEdge} disabled={generating} />
            </>
          )}
          {/* colore della guida */}
          <div className="space-y-2 rounded-xl border border-slate-200 p-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700">Colore guida</span>
              <label className="flex items-center gap-1.5 text-slate-500">
                Personalizzato
                <input type="color" value={guideColor} onChange={(e) => changeGuideColor(e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-slate-300 bg-white p-0" aria-label="Colore personalizzato della guida" />
              </label>
            </div>
            <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label="Tavolozza colori della guida">
              {GUIDE_PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={guideColor.toLowerCase() === color}
                  aria-label={color}
                  title={color}
                  onClick={() => changeGuideColor(color)}
                  className={`h-6 rounded-md border shadow-sm transition ${guideColor.toLowerCase() === color ? 'border-sky-600 ring-2 ring-sky-400' : 'border-slate-300 hover:scale-105'}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={plainButton} disabled={guideColor.toLowerCase() === defaultGuideColor.toLowerCase()} onClick={saveDefaultGuideColor}>
                Usa come predefinito
              </button>
              <button type="button" className={plainButton} disabled={guideColor.toLowerCase() === defaultGuideColor.toLowerCase()} onClick={() => changeGuideColor(defaultGuideColor)}>
                Torna al predefinito
              </button>
            </div>
          </div>
          <button type="button" className={plainButton} onClick={() => setGuide(GUIDE_DEFAULTS)}>Ripristina valori di default</button>

          <h4 className="pt-2 text-[15px] font-semibold text-slate-900">Opzioni avanzate</h4>
          <Expandable label="Finestra rotonda" open={openPanel === 'window'} onToggle={() => toggle('window')}>
            <Slider label="Profondità finestra" value={windowOptions.depth} min={1} max={100} step={0.5} unit="mm" onChange={(v) => setW({ depth: v })} />
            <Slider label="Dimensione finestra" value={windowOptions.size} min={1} max={15} step={0.01} unit="mm" onChange={(v) => setW({ size: v })} />
            <Switch label="Normale alla superficie" checked={windowOptions.normalToSurface} onChange={(v) => setW({ normalToSurface: v })} />
            <p className="text-[11px] text-slate-500">
              {guideIndex < 0
                ? 'Crea prima la guida.'
                : `Passa sulla guida per vedere il foro (cerchio rosso), clic per aprire la finestra; Ctrl + rotella cambia la dimensione. ${windowOptions.normalToSurface ? 'Il foro segue la perpendicolare alla guida nel punto.' : 'Il foro segue la vista: perpendicolare allo schermo.'}`}
            </p>
            <button type="button" className={plainButton} disabled={!canUndoWindow || generating} onClick={undoWindow} title="Anche con Ctrl+Z">Annulla ultima finestra (Ctrl+Z)</button>
          </Expandable>
          <Expandable label="Ritaglio" open={openPanel === 'cut'} onToggle={() => toggle('cut')}>
            <Slider label="Profondità ritaglio" value={cutDepth} min={1} max={200} step={0.1} unit="mm" onChange={setCutDepth} />
            <button type="button" className={plainButton} onClick={() => act('Ritaglio: Applica')}>Applica</button>
          </Expandable>
          <Expandable label="Opzioni testo" open={openPanel === 'text'} onToggle={() => toggle('text')}>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={plainButton} onClick={() => act('Aggiungi testo')}>Aggiungi testo</button>
              <button type="button" className={plainButton} onClick={() => act('Rimuovi testo')}>Rimuovi testo</button>
            </div>
            <label className="grid grid-cols-[1fr_160px] items-center gap-2 text-xs">
              <span className="text-slate-600">Testo</span>
              <input
                type="text"
                value={textOptions.text}
                onChange={(e) => setT({ text: e.target.value })}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <Slider label="Dimensioni" value={textOptions.size} min={0.5} max={10} step={0.01} unit="pt" onChange={(v) => setT({ size: v })} />
            <Slider label="Profondità" value={textOptions.depth} min={0.1} max={5} step={0.05} unit="mm" onChange={(v) => setT({ depth: v })} />
            <Slider label="Distanza" value={textOptions.distance} min={0} max={5} step={0.05} unit="pt" onChange={(v) => setT({ distance: v })} />
            <Switch label="Incidi" checked={textOptions.engrave} onChange={(v) => setT({ engrave: v })} />
            <Switch label="Genera testo 3D" checked={textOptions.text3D} onChange={(v) => setT({ text3D: v })} />
          </Expandable>
        </section>
      )}

      <div className="grid grid-cols-2 gap-2 pt-1">
        <button type="button" className={plainButton} disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Passo precedente</button>
        <button type="button" className={plainButton} disabled={step === STEPS.length - 1} onClick={() => setStep((s) => s + 1)}>Passo successivo</button>
      </div>
    </div>
  )
}
