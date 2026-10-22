import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'
import { preparePrintSource, buildPrintSolid, orientTowardBorder } from '../utils/printModel'
import { transferVertexColors } from '../utils/meshColorTransfer'
import ProgressOverlay from './ProgressOverlay'
import ArticulatedModelPanel from './ArticulatedModelPanel'
import useOcclusalPlaneGizmo from './useOcclusalPlaneGizmo'
import useArticulatorSupports from './useArticulatorSupports'
import { loadSupportParts, planeBasis, outlineOnPlane, autoPlaceSupports, buildSupportHalf, geometryFromPositions } from '../utils/articulatorSupports'

// Strumenti della pagina "Utilita' di stampa 3D", nella colonna di destra al posto di quelli del
// Modificatore. "Crea modello da stampare" apre "Estrudi Bordo": il bordo
// aperto della scansione scende lungo la direzione di estrusione (freccia dorata, presa dalla vista)
// fino a una base piatta; con "Guscio" il modello e' cavo con il fondo aperto. Anteprima dal vivo;
// i colori del modello restano.

const button = 'w-full rounded-xl border px-3 py-2.5 text-sm font-medium shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed'
const plainButton = `${button} border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800`
const activeButton = `${button} border-sky-400 bg-sky-50 text-sky-800`
const primaryButton = `${button} border-sky-700 bg-sky-600 text-white hover:bg-sky-700`

// wizard del modello articolato: piano occlusale, parametri del modello, estrusione del bordo ferma
// prima della chiusura (inserimento delle primitive di supporto), chiusura e creazione del solido
const ARTICULATED_STEPS = ['Piano occlusale', 'Parametri', 'Supporto', 'Crea modello']

const EXTRUDE_DEFAULTS = { shell: true, autoHeight: true, height: 10, thickness: 2, borderSmoothing: 50 }

function Slider({ label, value, min, max, step, unit, onChange, disabled }) {
  return (
    <label className={`grid grid-cols-[1fr_96px_60px] items-center gap-2 text-xs ${disabled ? 'opacity-50' : ''}`}>
      <span className="text-slate-600">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-sky-600" />
      <span className="text-right tabular-nums text-slate-700">{value.toFixed(step < 1 ? 1 : 0)} {unit}</span>
    </label>
  )
}

function Switch({ label, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      {label}
    </label>
  )
}

export default function Print3DTools({ meshes = [], setMeshes, meshesRef, sceneRef, cameraRef, canvasHandlersRef, setToolGrid, viewportOverlay, callMeshServer, showMessage, onAction }) {
  const [tool, setTool] = useState(null) // 'extrude' | 'articulated'
  const [modelIndex, setModelIndex] = useState(0)
  const [direction, setDirection] = useState(null) // verso la base, nelle coordinate della mesh
  const directionRef = useRef(null) // ultima direzione (anche durante il trascinamento della freccia)
  directionRef.current = direction ?? directionRef.current
  const [initialDirection, setInitialDirection] = useState(null)
  // prima direzione della freccia per ogni modello: "Reimposta" torna sempre a questa, anche dopo
  // aver chiuso e riaperto il pannello
  const firstDirectionsRef = useRef(new WeakMap())
  const [settings, setSettings] = useState(EXTRUDE_DEFAULTS)
  const [busy, setBusy] = useState(false)
  const [progressTask, setProgressTask] = useState(null)
  const [previewInfo, setPreviewInfo] = useState(null) // { volume, base } oppure { error }
  const set = (patch) => setSettings((s) => ({ ...s, ...patch }))

  // modello articolato: piano occlusale sul rendering per centrare le arcate
  const occlusalPlaneRef = useRef(null) // { origin, normal, front } in mm
  const [planeResetKey, setPlaneResetKey] = useState(0)
  const [articulatedStep, setArticulatedStep] = useState(0)
  const [articulatedSettings, setArticulatedSettings] = useState(null)
  const [supportInfo, setSupportInfo] = useState(null) // { error } se l'estrusione non riesce
  // supporti: pezzi, riferimento del piano e modelli ({ index, side, height, outline }); posizioni nel piano
  const [supportSetup, setSupportSetup] = useState(null)
  const supportsRef = useRef([])
  const supportsKeyRef = useRef(null) // piano e parametri per cui valgono le posizioni dei supporti
  const [selectedSupport, setSelectedSupport] = useState(null)
  const [supportsVersion, setSupportsVersion] = useState(0) // supporti aggiunti o tolti
  const [addingSupport, setAddingSupport] = useState(false)
  const addModeRef = useRef(false)
  addModeRef.current = addingSupport
  const [lockMidline, setLockMidline] = useState(true)
  const lockMidlineRef = useRef(true)
  lockMidlineRef.current = lockMidline
  useArticulatorSupports({
    active: tool === 'articulated' && articulatedStep === 2,
    setup: supportSetup,
    supportsRef,
    meshesRef,
    sceneRef,
    cameraRef,
    canvasHandlersRef,
    selected: selectedSupport,
    onSelect: setSelectedSupport,
    addModeRef,
    lockMidlineRef,
    onAdd: (point) => {
      supportsRef.current = [...supportsRef.current, { x: point.x, y: point.y }]
      setSelectedSupport(supportsRef.current.length - 1)
      setAddingSupport(false)
      setSupportsVersion((v) => v + 1)
    },
    version: supportsVersion,
  })
  const deleteSupport = () => {
    if (selectedSupport == null) return
    supportsRef.current = supportsRef.current.filter((_, i) => i !== selectedSupport)
    setSelectedSupport(null)
    setSupportsVersion((v) => v + 1)
  }
  // Canc / Esc nel passo Supporto: elimina il supporto selezionato / annulla l'aggiunta
  useEffect(() => {
    if (tool !== 'articulated' || articulatedStep !== 2) return undefined
    const onKey = (event) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return
      if (event.key === 'Escape' && addModeRef.current) setAddingSupport(false)
      else if (event.key === 'Delete') deleteSupport()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => {
    if (articulatedStep !== 2) setAddingSupport(false)
  }, [articulatedStep])
  useEffect(() => {
    if (tool === 'articulated') return
    setArticulatedStep(0)
    setSupportSetup(null)
    supportsKeyRef.current = null
  }, [tool])
  useOcclusalPlaneGizmo({
    active: tool === 'articulated' && articulatedStep === 0, // il piano resta memorizzato nei passi successivi
    meshes,
    meshesRef,
    sceneRef,
    cameraRef,
    canvasHandlersRef,
    resetKey: planeResetKey,
    onChange: (plane) => { occlusalPlaneRef.current = plane },
  })

  // modelli su cui lavorare: tutte le mesh visibili (spunta "Visible"), non quelle create da qui;
  // la freccia sta sulla prima
  const choices = meshes.map((m, i) => ({ m, i })).filter(({ m }) => m.printOf == null)
  const targets = choices.filter(({ m }) => m.visible !== false).map(({ i }) => i)
  const source = meshes[modelIndex]
  useEffect(() => {
    const first = targets[0] ?? choices[0]?.i ?? 0
    if (modelIndex !== first) setModelIndex(first)
  }, [meshes])

  // verso dell'estrusione di ogni modello: verso il suo bordo aperto (con le due arcate, la base
  // della superiore va in alto e quella dell'inferiore in basso)
  const directionFor = (geometry, d) => {
    try {
      return orientTowardBorder(preparePrintSource(geometry, settings), d)
    } catch {
      return d
    }
  }
  const arrowDirection = direction && source ? directionFor(source.geometry, direction) : direction

  // direzione della vista nelle coordinate della mesh (la mesh puo' essere ruotata nella scena)
  const directionFromView = () => {
    const camera = cameraRef?.current
    const sceneMesh = meshesRef?.current[modelIndex]
    if (!camera || !sceneMesh) return null
    sceneMesh.updateMatrixWorld(true)
    const view = new THREE.Vector3()
    camera.getWorldDirection(view)
    return view.transformDirection(new THREE.Matrix4().copy(sceneMesh.matrixWorld).invert()).normalize().toArray()
  }

  const openExtrude = () => {
    if (tool === 'extrude') {
      setTool(null)
      return
    }
    const d = directionFromView()
    const geometry = source?.geometry
    if (geometry && d && !firstDirectionsRef.current.has(geometry)) firstDirectionsRef.current.set(geometry, d)
    setDirection(d)
    setInitialDirection((geometry && firstDirectionsRef.current.get(geometry)) || d)
    setTool('extrude')
  }

  // Anteprima: pareti e base trasparenti sopra il modello, freccia dorata della direzione
  // griglia 8 x 8 sulla vista mentre si sceglie la direzione di estrusione; sparisce chiudendo il
  // pannello o creando il modello
  useEffect(() => {
    if (tool !== 'extrude' || !setToolGrid) return undefined
    setToolGrid(8)
    return () => setToolGrid(null)
  }, [tool, setToolGrid])

  // l'anteprima vecchia resta finche' non e' pronta la nuova (niente sfarfallio mentre si trascina la
  // freccia); al massimo un ricalcolo ogni 120 ms
  const wallsRef = useRef({ teardown: null, last: 0 })
  useEffect(() => {
    const walls = wallsRef.current
    if (tool !== 'extrude' || !direction || targets.length === 0) {
      walls.teardown?.()
      walls.teardown = null
      return undefined
    }
    const wait = Math.max(30, 120 - (performance.now() - walls.last))
    const timer = setTimeout(() => {
      walls.last = performance.now()
      const previous = walls.teardown
      walls.teardown = setupPreview()
      previous?.()
    }, wait)
    return () => clearTimeout(timer)
  }, [tool, direction, settings, modelIndex, meshes])
  useEffect(() => () => wallsRef.current.teardown?.(), [])

  const setupPreview = () => {
    const objects = []
    let volume = 0
    let error = null
    for (const index of targets) {
      const made = previewOne(index, objects)
      if (made.error) error = `${meshes[index]?.name || 'Mesh'}: ${made.error}`
      else volume += made.volume
    }
    setPreviewInfo(error ? { error } : { volume, count: targets.length })
    return () => {
      for (const object of objects) {
        object.removeFromParent()
        object.geometry?.dispose()
        object.material?.dispose()
      }
    }
  }

  // anteprima di un modello: solo le parti nuove (pareti e base), nelle coordinate della scena
  // custom: { directionOf(index, prepared), options, opacity } per il modello articolato
  const previewOne = (index, objects, custom = null) => {
    const sceneMesh = meshesRef.current[index]
    const normalization = sceneMesh?.userData.normalization
    const data = meshes[index]
    if (!sceneMesh || !normalization || !data) return { volume: 0 }
    const { center, scale } = normalization
    let result
    try {
      if (custom) {
        const prepared = preparePrintSource(data.geometry, custom.options)
        result = buildPrintSolid(prepared, custom.directionOf(index, prepared), custom.options)
      } else {
        result = buildPrintSolid(preparePrintSource(data.geometry, settings), directionFor(data.geometry, direction), settings)
      }
    } catch (error) {
      return { error: error.message }
    }
    // solo le parti nuove (pareti e base), nelle coordinate della scena
    const position = result.geometry.getAttribute('position')
    const scenePositions = new Float32Array(position.count * 3)
    for (let v = 0; v < position.count; v++) {
      scenePositions[v * 3] = (position.getX(v) - center.x) * scale
      scenePositions[v * 3 + 1] = (position.getY(v) - center.y) * scale
      scenePositions[v * 3 + 2] = (position.getZ(v) - center.z) * scale
    }
    const added = new THREE.BufferGeometry()
    added.setAttribute('position', new THREE.BufferAttribute(scenePositions, 3))
    added.setIndex(new THREE.BufferAttribute(result.geometry.index.array.slice(result.addedFrom), 1))
    added.computeVertexNormals()
    const color = new THREE.Color(sceneMesh.material.color ?? 0xd9a07a)
    const walls = new THREE.Mesh(added, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: custom?.opacity ?? 0.55, roughness: 0.5, side: THREE.DoubleSide, depthWrite: false }))
    walls.raycast = () => {}
    sceneMesh.add(walls)
    objects.push(walls)
    return { volume: result.volume }
  }

  // Freccia dorata della direzione: passa per il centro del modello, la punta verso la base.
  // Passando sulla punta compare la crocetta di spostamento (punta verde): trascinandola la
  // direzione segue il cursore e l'estrusione si inclina dal vivo.
  const arrowRef = useRef(null) // { sceneMesh, center, length, head, cross, gold, green }
  const dragRef = useRef({ hover: false, dragging: false, frame: 0 })
  useEffect(() => {
    if (tool !== 'extrude' || !direction || !source) return undefined
    let teardown = null
    const timer = setTimeout(() => { teardown = setupArrow() }, 0) // dopo l'eventuale ricostruzione della scena
    return () => {
      clearTimeout(timer)
      teardown?.()
    }
  }, [tool, direction, modelIndex, meshes])

  const setupArrow = () => {
    const sceneMesh = meshesRef.current[modelIndex]
    if (!sceneMesh) return null
    sceneMesh.geometry.computeBoundingBox()
    const box = sceneMesh.geometry.boundingBox
    const center = box.getCenter(new THREE.Vector3())
    const length = box.getSize(new THREE.Vector3()).length() * 0.55
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.4, metalness: 0.2 })
    const green = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.4, emissive: 0x0b5d2a })
    const grey = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.5 })
    const arrow = new THREE.Group()
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(length * 0.008, length * 0.008, length * 0.88, 12), gold)
    shaft.position.y = length * 0.44
    const head = new THREE.Mesh(new THREE.ConeGeometry(length * 0.035, length * 0.12, 20), dragRef.current.hover || dragRef.current.dragging ? green : gold)
    head.position.y = length * 0.94
    arrow.add(shaft, head)
    const d = new THREE.Vector3(...arrowDirection)
    arrow.position.copy(center).addScaledVector(d, -length / 2)
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d)
    // crocetta di spostamento attorno alla punta, sul piano dello schermo
    const cross = new THREE.Group()
    for (const [x, y, angle] of [[1, 0, -Math.PI / 2], [-1, 0, Math.PI / 2], [0, 1, 0], [0, -1, Math.PI]]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(length * 0.022, length * 0.07, 14), grey)
      cone.position.set(x * length * 0.08, y * length * 0.08, 0)
      cone.rotation.z = angle
      cross.add(cone)
    }
    cross.position.copy(center).addScaledVector(d, length / 2)
    cross.visible = dragRef.current.hover || dragRef.current.dragging
    for (const object of [arrow, cross]) {
      object.traverse((child) => { child.raycast = () => {} })
      sceneMesh.add(object)
    }
    arrowRef.current = { sceneMesh, center, length, head, cross, gold, green }
    return () => {
      if (arrowRef.current?.head === head) arrowRef.current = null
      for (const object of [arrow, cross]) {
        object.removeFromParent()
        object.traverse((child) => child.geometry?.dispose())
      }
      gold.dispose()
      green.dispose()
      grey.dispose()
    }
  }

  // mouse sulla vista: punta della freccia da afferrare e trascinare
  useEffect(() => {
    if (tool !== 'extrude' || !canvasHandlersRef) return undefined
    const drag = dragRef.current
    const tipWorld = (arrow) => {
      const d = new THREE.Vector3(...(source ? directionFor(source.geometry, directionRef.current) : directionRef.current))
      return arrow.sceneMesh.localToWorld(arrow.center.clone().addScaledVector(d, arrow.length / 2))
    }
    const setHover = (hover, canvas) => {
      drag.hover = hover
      const arrow = arrowRef.current
      if (arrow) {
        arrow.head.material = hover || drag.dragging ? arrow.green : arrow.gold
        arrow.cross.visible = hover || drag.dragging
      }
      if (canvas) canvas.style.cursor = drag.dragging ? 'grabbing' : hover ? 'grab' : ''
    }
    const orientCross = () => {
      const arrow = arrowRef.current
      const camera = cameraRef.current
      if (!arrow || !camera) return
      // piano della crocetta = piano dello schermo, nelle coordinate della mesh
      const meshRotation = arrow.sceneMesh.getWorldQuaternion(new THREE.Quaternion())
      arrow.cross.quaternion.copy(meshRotation.invert().multiply(camera.quaternion))
      arrow.cross.position.copy(arrow.center).addScaledVector(new THREE.Vector3(...(source ? directionFor(source.geometry, directionRef.current) : directionRef.current)), arrow.length / 2)
    }
    const nearTip = (event) => {
      const arrow = arrowRef.current
      const camera = cameraRef.current
      if (!arrow || !camera) return false
      const rect = event.target.getBoundingClientRect()
      const p = tipWorld(arrow).project(camera)
      const x = (p.x + 1) / 2 * rect.width + rect.left
      const y = (1 - p.y) / 2 * rect.height + rect.top
      return Math.hypot(event.clientX - x, event.clientY - y) < 18
    }
    const handlers = {
      down: (event) => {
        if (!nearTip(event)) return false // altrove la vista ruota come sempre
        drag.dragging = true
        setHover(true, event.target)
        return true
      },
      move: (event) => {
        if (!drag.dragging) {
          const hover = nearTip(event)
          if (hover !== drag.hover) setHover(hover, event.target)
          if (hover) orientCross()
          return
        }
        const arrow = arrowRef.current
        const camera = cameraRef.current
        if (!arrow || !camera) return
        // punto sotto il cursore sul piano dello schermo che passa per la punta
        const rect = event.target.getBoundingClientRect()
        const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
        const raycaster = new THREE.Raycaster()
        raycaster.setFromCamera(ndc, camera)
        const forward = camera.getWorldDirection(new THREE.Vector3())
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(forward, tipWorld(arrow))
        const point = raycaster.ray.intersectPlane(plane, new THREE.Vector3())
        if (!point) return
        const local = arrow.sceneMesh.worldToLocal(point).sub(arrow.center)
        if (local.lengthSq() < 1e-10) return
        const next = local.normalize().toArray()
        directionRef.current = next
        orientCross()
        if (drag.frame) return
        drag.frame = requestAnimationFrame(() => {
          drag.frame = 0
          setDirection(directionRef.current)
        })
      },
      up: (event) => {
        drag.dragging = false
        setHover(event ? nearTip(event) : false, event?.target)
      },
      leave: () => {
        if (!drag.dragging) setHover(false, null)
      },
    }
    canvasHandlersRef.current = handlers
    return () => {
      if (drag.frame) cancelAnimationFrame(drag.frame)
      drag.frame = 0
      drag.dragging = false
      drag.hover = false
      if (canvasHandlersRef.current === handlers) canvasHandlersRef.current = null
    }
  }, [tool, canvasHandlersRef, modelIndex])

  // Crea il modello: pieno, oppure cavo con il server mesh; nuova mesh nella stessa posizione,
  // con i colori della scansione; il modello di partenza viene nascosto
  // directionOf(index, prepared): verso dell'estrusione di ciascun modello; options: impostazioni di
  // Estrudi Bordo (di base quelle del pannello)
  // extrasFor(index): { parts: geometrie in mm da unire al modello con il server mesh (supporti),
  // articulated: 'up' | 'down' (modello articolato superiore / inferiore) }
  const createModel = async (directionOf = (index, prepared) => orientTowardBorder(prepared, direction), options = settings, extrasFor = null) => {
    if (targets.length === 0) return
    setBusy(true)
    setProgressTask({
      title: targets.length > 1 ? `Creazione di ${targets.length} modelli da stampare` : 'Creazione modello da stampare',
      stages: options.shell ? ['Estrusione del bordo', 'Base piatta', 'Svuotamento (server mesh)', 'Colori del modello'] : ['Estrusione del bordo', 'Base piatta'],
      expectedMs: (options.shell ? 3500 : 800) * targets.length,
    })
    try {
      const models = []
      const notes = []
      for (const index of targets) {
        const made = await makeModel(index, directionOf, options)
        const extra = made && extrasFor ? extrasFor(index) : null
        const extras = extra?.parts ?? []
        if (extra?.articulated) made.model.articulated = extra.articulated
        if (extras.length > 0) {
          const files = { file: made.model.geometry }
          extras.forEach((geometry, i) => { files[`part${i}`] = geometry })
          const { geometry: joined, stats } = await callMeshServer('/union-parts', files)
          const colored = made.model.geometry.getAttribute('color') ? transferVertexColors(made.model.geometry, joined) : joined
          colored.computeVertexNormals()
          made.model.geometry = colored
          made.note += `, ${stats.parts} pezzi di supporto uniti`
        }
        if (made) {
          models.push(made.model)
          notes.push(made.note)
        }
      }
      setMeshes((prev) => {
        let next = prev.map((m, i) => (models.some((model) => model.printOf === i) ? { ...m, visible: false } : m))
        for (const model of models) {
          const existing = next.findIndex((m) => m.printOf === model.printOf)
          if (existing >= 0) next[existing] = model
          else next = [...next, model]
        }
        return next
      })
      setTool(null)
      showMessage?.(models.length > 1 ? `✅ ${models.length} modelli da stampare creati (${notes.join('; ')}).` : `✅ Modello da stampare creato: ${notes[0]}.`)
    } catch (error) {
      console.error(error)
      showMessage?.(`⚠️ Creazione del modello non riuscita: ${error.message}`)
    } finally {
      setBusy(false)
      setProgressTask(null)
    }
  }

  // un modello: pieno, oppure cavo con il server mesh; nella stessa posizione e con i colori della
  // scansione
  const makeModel = async (index, directionOf, settings) => {
    const source = meshes[index]
    const normalization = meshesRef.current[index]?.userData.normalization
    if (!source || !normalization) return null
    const prepared = preparePrintSource(source.geometry, settings)
    const modelDirection = directionOf(index, prepared)
    {
      const solid = buildPrintSolid(prepared, modelDirection, settings)
      let geometry = solid.geometry
      let note = `volume ${(solid.volume / 1000).toFixed(1)} cm³`
      if (settings.shell) {
        if (!callMeshServer) throw new Error('server mesh non disponibile')
        // stesso modello con la base piu' in basso: la parte tolta attraversa la base (fondo aperto)
        const extended = buildPrintSolid(prepared, modelDirection, { ...settings, extraDepth: settings.thickness + 1 })
        const { geometry: shell, stats } = await callMeshServer('/make-shell', { file: solid.geometry, extended: extended.geometry }, { thickness: settings.thickness })
        geometry = solid.geometry.getAttribute('color') ? transferVertexColors(solid.geometry, shell) : shell
        note = `guscio ${settings.thickness.toFixed(1)} mm, volume ${(stats.volumeMm3 / 1000).toFixed(1)} cm³ (pieno ${(stats.solidVolumeMm3 / 1000).toFixed(1)} cm³)`
      }
      geometry.computeVertexNormals()
      const model = {
        geometry,
        name: `${source.name || 'Mesh'} - modello di stampa`,
        visible: true,
        color: source.color,
        forceColor: source.forceColor,
        printOf: index,
        displayFrame: { center: normalization.center.toArray(), scale: normalization.scale, sourceIndex: index },
      }
      return { model, note: targets.length > 1 ? `${source.name}: ${note}` : note }
    }
  }

  // Modello articolato: il piano occlusale stabilisce la direzione dell'estrusione del bordo, come in
  // "Crea modello da stampare": verso l'alto per il modello sopra il piano (superiore), verso il basso
  // per quello sotto (inferiore); le basi piatte risultano parallele al piano.
  const articulatedOptions = (articulated) => ({
    ...EXTRUDE_DEFAULTS,
    shell: articulated.modelType === 'hollow',
    autoHeight: true,
    height: articulated.baseHeight,
  })
  const planeDirectionOf = () => {
    const plane = occlusalPlaneRef.current
    if (!plane) return null
    const normal = plane.normal
    return (index, prepared) => {
      // lato del piano su cui sta il modello: baricentro dei vertici (mm della mesh)
      const P = prepared.mesh.positions
      const n = P.length / 3
      let side = 0
      for (let v = 0; v < n; v++) {
        side += (P[v * 3] - plane.origin[0]) * normal[0] + (P[v * 3 + 1] - plane.origin[1]) * normal[1] + (P[v * 3 + 2] - plane.origin[2]) * normal[2]
      }
      side /= n
      if (Math.abs(side) < 0.5) return orientTowardBorder(prepared, normal) // a cavallo del piano: verso il bordo
      return side > 0 ? normal : normal.map((v) => -v)
    }
  }
  const createArticulatedBases = (articulated) => {
    const directionOf = planeDirectionOf()
    if (!directionOf || !articulated) return
    if (articulated.modelType === 'honeycomb') showMessage?.(`ℹ️ "Nido d'ape" in preparazione: il modello viene creato pieno.`)
    const setup = supportSetup
    const extrasFor = (index) => {
      const model = setup?.models.find((m) => m.index === index)
      if (!model) return null
      // cubo e cilindro come pezzi separati: il server li unisce uno alla volta
      const parts = supportsRef.current.flatMap((support) => {
        const { positions, cubeTriangles } = buildSupportHalf(setup.parts, setup.basis, support, model.side, model.height, model.outline)
        return [positions.slice(0, cubeTriangles * 9), positions.slice(cubeTriangles * 9)].map(geometryFromPositions)
      })
      return { parts, articulated: model.side }
    }
    createModel(directionOf, articulatedOptions(articulated), extrasFor)
  }

  // supporti: per ogni modello il lato del piano (superiore / inferiore), la distanza della base dal
  // piano e il bordo; posizioni automatiche la prima volta (o con piano e parametri cambiati)
  const prepareSupports = async (directionOf, options) => {
    try {
      const parts = await loadSupportParts()
      const plane = occlusalPlaneRef.current
      const basis = planeBasis(plane)
      const models = targets.map((index) => {
        const prepared = preparePrintSource(meshes[index].geometry, options)
        const d = directionOf(index, prepared)
        const { baseDepth } = buildPrintSolid(prepared, d, options)
        const length = Math.hypot(...d) || 1
        const along = (basis.origin.x * d[0] + basis.origin.y * d[1] + basis.origin.z * d[2]) / length
        const up = d[0] * basis.ez.x + d[1] * basis.ez.y + d[2] * basis.ez.z > 0
        return { index, side: up ? 'up' : 'down', height: baseDepth - along, outline: outlineOnPlane(basis, prepared) }
      })
      const key = JSON.stringify([plane, articulatedSettings, targets])
      if (supportsKeyRef.current !== key || supportsRef.current.length === 0) {
        supportsKeyRef.current = key
        supportsRef.current = autoPlaceSupports(models.flatMap((m) => m.outline), parts)
      }
      setSupportSetup({ parts, basis, models })
    } catch (error) {
      console.error(error)
      setSupportInfo({ error: `supporti non disponibili: ${error.message}` })
    }
  }
  const resetSupports = () => {
    if (!supportSetup) return
    supportsRef.current = autoPlaceSupports(supportSetup.models.flatMap((m) => m.outline), supportSetup.parts)
    setSelectedSupport(null)
    setSupportsVersion((v) => v + 1)
  }

  // passo Supporto: pareti dell'estrusione sul rendering, con la base ancora aperta
  useEffect(() => {
    if (tool !== 'articulated' || articulatedStep !== 2 || !articulatedSettings) {
      setSupportInfo(null)
      return undefined
    }
    const directionOf = planeDirectionOf()
    if (!directionOf) return undefined
    const options = { ...articulatedOptions(articulatedSettings), cap: false }
    let teardown = null
    const timer = setTimeout(() => {
      const objects = []
      let error = null
      for (const index of targets) {
        const made = previewOne(index, objects, { directionOf, options, opacity: 0.85 })
        if (made.error) error = `${meshes[index]?.name || 'Mesh'}: ${made.error}`
      }
      setSupportInfo(error ? { error } : null)
      if (!error) prepareSupports(directionOf, options)
      teardown = () => objects.forEach((object) => {
        object.removeFromParent()
        object.geometry?.dispose()
        object.material?.dispose()
      })
    }, 0) // dopo l'eventuale ricostruzione della scena
    return () => {
      clearTimeout(timer)
      teardown?.()
    }
  }, [tool, articulatedStep, articulatedSettings, meshes])

  return (
    <div className="mt-2 space-y-3">
      {viewportOverlay && createPortal(<ProgressOverlay task={progressTask} />, viewportOverlay)}
      <h4 className="text-[15px] font-semibold text-slate-900">Strumenti di stampa</h4>
      {choices.length > 1 && (
        <p className="text-[11px] text-slate-500">
          {targets.length === 0
            ? 'Nessuna mesh visibile: attiva "Visible" sulle mesh da usare.'
            : `Si lavora sulle mesh visibili (${targets.length}): ${targets.map((i) => meshes[i]?.name).join(', ')}.`}
        </p>
      )}
      <button
        type="button"
        className={tool === 'extrude' ? activeButton : plainButton}
        disabled={meshes.length === 0 || busy}
        title={meshes.length === 0 ? 'Carica prima una mesh' : 'Crea il modello da stampare'}
        onClick={openExtrude}
        aria-expanded={tool === 'extrude'}
      >
        Crea modello da stampare
      </button>

      {tool === 'extrude' && (
        <section className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/40 p-3">
          <h5 className="text-sm font-semibold text-slate-900">Estrudi Bordo</h5>
          <Switch label="Guscio" checked={settings.shell} onChange={(v) => set({ shell: v })} />
          <Switch label="Regolazione Automatica Altezza Modello" checked={settings.autoHeight} onChange={(v) => set({ autoHeight: v })} />
          <Slider label="Altezza Estrusione" value={settings.height} min={settings.autoHeight ? 0.5 : 5} max={50} step={0.5} unit="mm" onChange={(v) => set({ height: v })} />
          <Slider label="Levigatura bordo" value={settings.borderSmoothing} min={0} max={100} step={1} unit="" onChange={(v) => set({ borderSmoothing: v })} />
          <Slider label="Spessore Guscio" value={settings.thickness} min={0.5} max={10} step={0.1} unit="mm" onChange={(v) => set({ thickness: v })} disabled={!settings.shell} />
          <p className="text-[11px] text-slate-500">
            {settings.autoHeight
              ? 'La base sta a "Altezza Estrusione" sotto il punto più basso del bordo.'
              : '"Altezza Estrusione" è l\'altezza totale del modello, dalla cima alla base.'}
            {previewInfo?.error ? ` ⚠️ ${previewInfo.error}` : previewInfo?.volume ? ` Modello pieno: ${(previewInfo.volume / 1000).toFixed(1)} cm³.` : ''}
          </p>
          <button type="button" className={plainButton} onClick={() => setDirection(directionFromView())}>Imposta Direzione Estrusione da Vista</button>
          <button type="button" className={plainButton} disabled={!initialDirection} onClick={() => setDirection([...initialDirection])} title="Torna alla prima direzione della freccia">Reimposta Direzione Estrusione</button>
          <button type="button" className={plainButton} onClick={() => setSettings(EXTRUDE_DEFAULTS)}>Ripristina Impostazioni di Base</button>
          <button type="button" className={primaryButton} disabled={busy || !!previewInfo?.error} onClick={() => direction && createModel()}>
            {busy ? '⏳ Creazione...' : 'Crea modello'}
          </button>
        </section>
      )}

      <button
        type="button"
        className={plainButton}
        disabled={meshes.length === 0}
        title={meshes.length === 0 ? 'Carica prima una mesh' : 'Crea il modello di stampa svuotato (cavo)'}
        onClick={() => onAction?.('Crea modello di stampa svuotato')}
      >
        Crea modello di stampa svuotato
      </button>
      <button
        type="button"
        className={tool === 'articulated' ? activeButton : plainButton}
        disabled={meshes.length === 0 || busy}
        title={meshes.length === 0 ? 'Carica prima una mesh' : 'Crea il modello di stampa articolato'}
        aria-expanded={tool === 'articulated'}
        onClick={() => setTool((t) => (t === 'articulated' ? null : 'articulated'))}
      >
        Crea modello di stampa articolato
      </button>
      {tool === 'articulated' && (
        <div className="space-y-2">
          <ol className="grid grid-cols-2 gap-1" aria-label="Passi del modello articolato">
            {ARTICULATED_STEPS.map((label, i) => (
              <li
                key={label}
                aria-current={i === articulatedStep ? 'step' : undefined}
                className={`flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[11px] leading-tight ${i === articulatedStep ? 'border-sky-400 bg-sky-50 font-semibold text-sky-800' : i < articulatedStep ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-500'}`}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] text-white ${i === articulatedStep ? 'bg-sky-600' : i < articulatedStep ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                  {i < articulatedStep ? '✓' : i + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>
          {articulatedStep === 0 && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
              Piano occlusale: trascina il centro per spostarlo, le frecce rosse per ruotarlo, le verdi ai lati per
              inclinarlo a destra / sinistra, quelle davanti e dietro per inclinarlo avanti / indietro, la freccia
              dorata per inclinarlo in qualunque direzione, finché le arcate sono centrate.
              <button
                type="button"
                className="mt-2 block w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => setPlaneResetKey((k) => k + 1)}
              >
                Reimposta piano
              </button>
            </div>
          )}
          {articulatedStep === 1 && (
            <ArticulatedModelPanel
              busy={busy}
              initialSettings={articulatedSettings}
              confirmLabel="Avanti"
              onCancel={() => setTool(null)}
              onBack={() => setArticulatedStep(0)}
              onConfirm={(values) => {
                setArticulatedSettings(values)
                setArticulatedStep(2)
              }}
            />
          )}
          {articulatedStep === 2 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              {supportInfo?.error
                ? `⚠️ ${supportInfo.error}`
                : addingSupport
                  ? 'Clicca sulla vista dove mettere il nuovo supporto (Esc per annullare).'
                  : `Estrusione del bordo ferma prima della chiusura. ${supportsRef.current.length} supporti: clicca per selezionarne uno (arancione), trascinalo per spostarlo; cubo e altezza si adattano all'estrusione.`}
              {!supportInfo?.error && (
                <div className="mt-2 space-y-1.5">
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={!supportSetup}
                      aria-pressed={addingSupport}
                      className={`rounded border px-2 py-1 text-xs font-medium disabled:opacity-40 ${addingSupport ? 'border-amber-500 bg-amber-200 text-amber-900' : 'border-amber-300 bg-white text-amber-800 hover:bg-amber-100'}`}
                      onClick={() => setAddingSupport((on) => !on)}
                    >
                      Aggiungi supporto
                    </button>
                    <button
                      type="button"
                      disabled={selectedSupport == null}
                      title="Elimina il supporto selezionato (Canc)"
                      className="rounded border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                      onClick={deleteSupport}
                    >
                      Elimina supporto
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={!supportSetup}
                    className="block w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                    onClick={resetSupports}
                  >
                    Riposiziona supporti
                  </button>
                  <Switch label="Anteriore bloccato sulla linea mediana" checked={lockMidline} onChange={setLockMidline} />
                </div>
              )}
            </div>
          )}
          {articulatedStep === 3 && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
              Chiusura della base e creazione del solido di ciascun modello ({articulatedSettings?.modelType === 'hollow' ? 'cavo' : 'pieno'}, base {articulatedSettings?.baseHeight} mm), con i {supportsRef.current.length} supporti uniti: metà superiore al modello superiore, metà inferiore all'inferiore.
            </div>
          )}
          {articulatedStep !== 1 && (
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => setTool(null)} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                Annulla
              </button>
              <button type="button" disabled={articulatedStep === 0 || busy} onClick={() => setArticulatedStep((s) => s - 1)} className="rounded-lg border border-sky-400 bg-white px-2 py-2 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-40">
                Indietro
              </button>
              {articulatedStep < 3 ? (
                <button type="button" disabled={articulatedStep === 2 && !!supportInfo?.error} onClick={() => setArticulatedStep((s) => s + 1)} className="rounded-lg border border-sky-700 bg-sky-600 px-2 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-40">
                  Avanti
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => createArticulatedBases(articulatedSettings)} className="rounded-lg border border-sky-700 bg-sky-600 px-2 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-40">
                  Crea solido
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
