import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { loadSTL } from '../utils/loaders/stlLoader'
import { loadOBJ } from '../utils/loaders/objLoader'
import { loadPLY } from '../utils/loaders/plyLoader'
import { analyzeHoles, fillHoles, geometryToBinarySTL } from '../utils/holeFiller'
import { fillHolesAsync, cancelHoleFill } from '../utils/holeFillAsync'
import { analyzeComponents, selectComponentsByRatio, componentsGeometry, removeComponents } from '../utils/isolatedComponents'
import {
  prepareBrushMesh,
  paintSphere,
  countSelected,
  fillSelectedTriangles,
  offsetPositions,
  buildOffsetGeometry,
  buildSelectedPartGeometry,
  selectAll,
  invertSelection,
} from '../utils/brushOffset'
import { createMirrorGizmo, mirrorGeometry, mirrorMatrix } from '../utils/mirrorMesh'
import { mergeGeometries, saveMeshFile } from '../utils/stlExport'
import {
  flipNormals,
  deleteSelectedTriangles,
  straightenBorder,
  rebuildBorder,
  extendBorder,
} from '../utils/meshEditing'
import { offsetPolygon, selectArea, cutByArea, areaPoint } from '../utils/areaCut'
import { surfacePath, closedLoop, smoothLoopPositions, curveCutSelection, cutByCurve } from '../utils/curveCut'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import {
  MESH_LIB_SERVERS,
  getServerById,
  getSavedServerId,
  saveServerId,
  apiUrl,
  checkServerHealth,
} from '../utils/meshLibBackend'

// Interruttore on/off con etichetta
function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5 text-sm text-slate-700"
    >
      <span className={`relative h-5 w-9 rounded-full transition ${checked ? 'bg-sky-600' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  )
}

const AREA_COLOR = 0xd946ef // Taglia con Area: contorno e parte da eliminare
const CURVE_COLOR = 0xdc2626 // Taglia con Linea: contorno e punti
const CURVE_END_COLOR = 0x22c55e // Taglia con Linea: ultimo punto

// Marcatori rotondi per i punti dei contorni, uno per combinazione di colori
const markerTextures = new Map()
const getMarkerTexture = (fill, stroke) => {
  const key = `${fill}/${stroke}`
  if (!markerTextures.has(key)) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    const context = canvas.getContext('2d')
    context.beginPath()
    context.arc(16, 16, 12, 0, Math.PI * 2)
    context.fillStyle = fill
    context.fill()
    context.lineWidth = 5
    context.strokeStyle = stroke
    context.stroke()
    markerTextures.set(key, new THREE.CanvasTexture(canvas))
  }
  return markerTextures.get(key)
}

const HOLE_COLORS = { hole: 0xdc2626, selected: 0xf97316, outer: 0x94a3b8 }
const hexColor = (value) => `#${value.toString(16).padStart(6, '0')}`

// Etichette dei fori, uguali nella vista 3D e nel pannello: il bordo esterno
// della scansione è "E", i fori sono numerati da 1. La numerazione è memorizzata
// in `numbering` e un foro conserva il suo numero anche dopo la chiusura di altri
// fori: viene riconosciuto dal baricentro e dal numero di lati, che non cambiano.
const assignHoleLabels = (numbering, holes, diagonal) => {
  const tolerance = Math.max(diagonal, 1e-9) * 1e-5
  const used = new Set()
  const labels = new Map()
  for (const hole of holes) {
    if (hole.isOuterBorder) {
      labels.set(hole.id, 'E')
      continue
    }
    let entry = numbering.entries.find(
      (candidate) =>
        !used.has(candidate) &&
        candidate.edgeCount === hole.edgeCount &&
        Math.hypot(
          candidate.centroid[0] - hole.centroid[0],
          candidate.centroid[1] - hole.centroid[1],
          candidate.centroid[2] - hole.centroid[2]
        ) <= tolerance
    )
    if (!entry) {
      entry = { centroid: hole.centroid, edgeCount: hole.edgeCount, label: String(numbering.next++) }
      numbering.entries.push(entry)
    }
    used.add(entry)
    labels.set(hole.id, entry.label)
  }
  return labels
}

// Elenco ordinato per etichetta: "E" per primo, poi 1, 2, 3...
const sortHolesByLabel = (holes, labels) =>
  [...holes].sort((a, b) => {
    const la = labels.get(a.id)
    const lb = labels.get(b.id)
    return (la === 'E' ? 0 : Number(la)) - (lb === 'E' ? 0 : Number(lb))
  })

// Lunghezze degli spigoli (ognuno contato una volta), sulla mesh con vertici uniti
const edgeLengths = (geometry) => {
  const { positions: P, indices } = analyzeHoles(geometry).mesh
  const seen = new Set()
  const lengths = []
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k]
      const b = indices[t + ((k + 1) % 3)]
      const key = a < b ? a * 67108864 + b : b * 67108864 + a
      if (seen.has(key)) continue
      seen.add(key)
      lengths.push(Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]))
    }
  }
  return lengths
}

// Istogrammi prima/dopo con gli stessi intervalli, in % degli spigoli
const buildEdgeHistograms = (before, after, binCount = 28) => {
  const a = edgeLengths(before)
  const b = edgeLengths(after)
  const percentile99 = (values) => {
    const sorted = Float64Array.from(values).sort()
    return sorted[Math.floor((sorted.length - 1) * 0.99)] || 0
  }
  const max = Math.max(percentile99(a), percentile99(b)) || 1
  const toBins = (values) => {
    const bins = new Array(binCount).fill(0)
    for (const value of values) bins[Math.min(binCount - 1, Math.floor((value / max) * binCount))]++
    return bins.map((count) => (count / Math.max(values.length, 1)) * 100)
  }
  const beforeBins = toBins(a)
  const afterBins = toBins(b)
  return { max, before: beforeBins, after: afterBins, yMax: Math.max(...beforeBins, ...afterBins) }
}

const formatLength = (value) => (Number.isFinite(value) ? Number(value.toPrecision(3)).toString() : '–')

function EdgeHistogram({ title, bins, max, yMax }) {
  const width = 300
  const height = 64
  const barWidth = width / bins.length
  return (
    <figure>
      <figcaption className="text-[11px] font-semibold text-slate-700 mb-1">{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height + 14}`} className="w-full" role="img" aria-label={`${title}: distribuzione della lunghezza degli spigoli`}>
        <line x1="0" x2={width} y1={height} y2={height} stroke="#cbd5e1" strokeWidth="1" />
        {bins.map((value, i) => {
          const barHeight = yMax > 0 ? (value / yMax) * height : 0
          const from = (i * max) / bins.length
          const to = ((i + 1) * max) / bins.length
          return (
            <g key={i}>
              {barHeight > 0 && (
                <rect x={i * barWidth + 1} y={height - barHeight} width={Math.max(barWidth - 2, 1)} height={barHeight} rx="1.5" fill="#0284c7" />
              )}
              {/* area di passaggio del mouse: tutta la colonna, più grande della barra */}
              <rect x={i * barWidth} y="0" width={barWidth} height={height} fill="transparent">
                <title>{`Spigoli ${i === bins.length - 1 ? `≥ ${formatLength(from)}` : `${formatLength(from)}–${formatLength(to)}`}: ${value.toFixed(1)}%`}</title>
              </rect>
            </g>
          )
        })}
        <text x="0" y={height + 11} fontSize="9" fill="#64748b">0</text>
        <text x={width / 2} y={height + 11} fontSize="9" fill="#64748b" textAnchor="middle">{formatLength(max / 2)}</text>
        <text x={width} y={height + 11} fontSize="9" fill="#64748b" textAnchor="end">{formatLength(max)}</text>
      </svg>
    </figure>
  )
}

const createHoleLabelTexture = (text, color) => {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2)
  ctx.fillStyle = hexColor(color)
  ctx.fill()
  ctx.lineWidth = 8
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${text.length > 2 ? 44 : text.length > 1 ? 56 : 68}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, size / 2, size / 2 + 4)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export default function MeshModifier({ geometry, onClose, onApply, requireEditConsent }) {
  const containerRef = useRef(null)
  const sceneRef = useRef(null)
  const rendererRef = useRef(null)
  const cameraRef = useRef(null)
  const meshesRef = useRef([])
  const rotationRef = useRef({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const mouseRef = useRef({ x: 0, y: 0 })
  const mouseButtonRef = useRef(null)
  const moveStartRef = useRef(null)
  const selectedMeshPositionRef = useRef(new THREE.Vector3())
  const cameraControlRef = useRef(false)
  const cameraSphericalRef = useRef(new THREE.Spherical())
  const raycasterRef = useRef(new THREE.Raycaster())
  const fileInputRef = useRef(null)
  const selectedMeshHelperRef = useRef(null)
  const [message, setMessage] = useState('')
  const [meshes, setMeshes] = useState(geometry ? [{ geometry, name: 'Mesh iniziale', visible: true }] : [])
  // elenco aggiornato delle mesh, letto dai calcoli in background al termine
  const meshesStateRef = useRef(meshes)
  meshesStateRef.current = meshes
  // chiudendo il modificatore si interrompe un'eventuale chiusura dei fori in corso
  useEffect(() => () => cancelHoleFill(), [])
  const [selectedMeshIndex, setSelectedMeshIndex] = useState(0)
  const [isLoadingFile, setIsLoadingFile] = useState(false)
  const [showAlignMenu, setShowAlignMenu] = useState(false)
  const [manualMoveMode, setManualMoveMode] = useState(false)
  const [showManualMoveConsent, setShowManualMoveConsent] = useState(false)
  const [alignSourceIndex, setAlignSourceIndex] = useState(0)
  const [alignTargetIndex, setAlignTargetIndex] = useState(0)
  const [alignmentMode, setAlignmentMode] = useState('none')
  const [pointPairs, setPointPairs] = useState([])
  const [pendingPair, setPendingPair] = useState({ fixed: null, moving: null })
  const pendingPairRef = useRef({ fixed: null, moving: null })
  const [alignmentMessage, setAlignmentMessage] = useState('')
  const [pointAlignLoading, setPointAlignLoading] = useState(false)
  const [selectedServerId, setSelectedServerId] = useState(getSavedServerId())
  const selectedServer = getServerById(selectedServerId)
  const [serverOnline, setServerOnline] = useState(false)
  const [serverChecking, setServerChecking] = useState(false)

  // Ripara mesh: rilevamento e chiusura dei fori
  const [repairMode, setRepairMode] = useState(false)
  const [holeAnalysis, setHoleAnalysis] = useState(null)
  const [repairBusy, setRepairBusy] = useState(false)
  const [repairMessage, setRepairMessage] = useState('')
  const [fillMode, setFillMode] = useState('smooth')
  const [excludeOuterBorder, setExcludeOuterBorder] = useState(true)
  const [selectedHoleId, setSelectedHoleId] = useState(null)
  const [isRebuilding, setIsRebuilding] = useState(false)
  // Remesh isotropico e confronto prima/dopo
  const [isRemeshing, setIsRemeshing] = useState(false)
  const [remeshCompare, setRemeshCompare] = useState(null)
  const [remeshView, setRemeshView] = useState('after')
  // visualizzazione dei triangoli (wireframe), unica per tutto il modificatore
  const [showWireframe, setShowWireframe] = useState(false)
  // Semplifica mesh
  const [showSimplifyPanel, setShowSimplifyPanel] = useState(false)
  const [reductionPercent, setReductionPercent] = useState(50)
  const [isSimplifying, setIsSimplifying] = useState(false)
  // Rimuovi componenti isolati
  const [showIsolatedPanel, setShowIsolatedPanel] = useState(false)
  const [isolatedRatio, setIsolatedRatio] = useState(10)
  const [isolatedAnalysis, setIsolatedAnalysis] = useState(null)
  const [isolatedSelection, setIsolatedSelection] = useState([])
  const [isolatedBusy, setIsolatedBusy] = useState(false)
  // Offset con pennello
  const [showOffsetPanel, setShowOffsetPanel] = useState(false)
  const [brushData, setBrushData] = useState(null)
  const [brushDiameter, setBrushDiameter] = useState(1)
  const [brushErase, setBrushErase] = useState(false)
  const [offsetSelectedCount, setOffsetSelectedCount] = useState(0)
  const [offsetDistance, setOffsetDistance] = useState(0)
  const [offsetFromView, setOffsetFromView] = useState(false)
  const [offsetSeparate, setOffsetSeparate] = useState(false)
  const [offsetBusy, setOffsetBusy] = useState(false)
  // letto dai gestori del mouse della scena, che non vengono ricreati a ogni render
  const brushStateRef = useRef({ active: false, painting: false })
  const brushHandlersRef = useRef(null)
  const brushSceneRef = useRef(null)
  const brushFrameRef = useRef({ id: 0, event: null })
  const brushDataRef = useRef(null)
  brushDataRef.current = brushData
  // Applica modifiche: salvataggio della mesh finale
  const [showApplyDialog, setShowApplyDialog] = useState(false)
  const [applyFileName, setApplyFileName] = useState('mesh_modificata')
  const [applyFormat, setApplyFormat] = useState('binary')
  const [applyTarget, setApplyTarget] = useState('selected')
  const [applyBusy, setApplyBusy] = useState(false)
  // Specchia
  const [showMirrorPanel, setShowMirrorPanel] = useState(false)
  const [mirrorKeepOriginal, setMirrorKeepOriginal] = useState(false)
  const [mirrorResetToken, setMirrorResetToken] = useState(0)
  const mirrorStateRef = useRef({ active: false, dragging: false })
  const mirrorHandlersRef = useRef(null)
  const mirrorSceneRef = useRef(null)
  // piano di specchiatura nelle coordinate originali della mesh (null = piano predefinito)
  const mirrorPlaneRef = useRef(null)
  // true quando l'utente ha spostato o ruotato il piano: la specchiatura è una modifica in sospeso
  const mirrorTouchedRef = useRef(false)
  // Cronologia delle modifiche memorizzate, nell'ordine in cui l'utente le ha fatte
  const [editHistory, setEditHistory] = useState([])
  // Riempi buchi in corso: { done, total }
  const [fillingHoles, setFillingHoles] = useState(null)
  // Taglia con: 'Area' | 'Pennello' | 'Lazo' | 'Linea'
  const [cutTool, setCutTool] = useState(null)
  const [cutDraw, setCutDraw] = useState(null) // disegno sullo schermo: { type, points }
  const cutDrawRef = useRef(null)
  // Linea: punti cliccati sulla superficie { meshIndex, points: [vertice, ...] }
  const [curveCut, setCurveCut] = useState(null)
  const curveCutRef = useRef(null)
  curveCutRef.current = curveCut
  const curveDragRef = useRef(null) // indice del punto trascinato
  const curveFrameRef = useRef({ id: 0, event: null })
  const curvePathCacheRef = useRef({ mesh: null, paths: new Map() })
  const [curveCloseHole, setCurveCloseHole] = useState(false)
  const [curveSaveParts, setCurveSaveParts] = useState(false)
  const [curveInvert, setCurveInvert] = useState(false)
  const [curveSmooth, setCurveSmooth] = useState(true)
  const [curveSmoothStrength, setCurveSmoothStrength] = useState(5)
  const [curveSmoothDistance, setCurveSmoothDistance] = useState(1)
  const [curvePreview, setCurvePreview] = useState({ count: 0, error: '' })
  // Area: poligono tracciato a punti, nelle coordinate originali della mesh
  // { meshIndex, eye, dir, origin, u, v, points: [[a, b], ...] } (vedi utils/areaCut)
  const [areaCut, setAreaCut] = useState(null)
  const areaCutRef = useRef(null)
  areaCutRef.current = areaCut
  const areaDragRef = useRef(null) // indice del punto trascinato
  const [areaOffset, setAreaOffset] = useState(0)
  const [areaDepth, setAreaDepth] = useState(5)
  const [areaMaterialCut, setAreaMaterialCut] = useState(false)
  const [areaSaveParts, setAreaSaveParts] = useState(false)
  const [areaInvert, setAreaInvert] = useState(false)
  const [cutBusy, setCutBusy] = useState(false)
  // Modifica Bordo: 'Raddrizza bordo' | 'Ricostruisci bordo' | 'Estendi bordo'
  const [borderTool, setBorderTool] = useState(null)
  const [borderOnlyOuter, setBorderOnlyOuter] = useState(true)
  const [borderIterations, setBorderIterations] = useState(10)
  const [borderStrength, setBorderStrength] = useState(0.5)
  const [borderPasses, setBorderPasses] = useState(3)
  const [borderDistance, setBorderDistance] = useState(1)
  const [borderDirection, setBorderDirection] = useState('outward')
  const [borderBusy, setBorderBusy] = useState(false)
  const offsetParamsRef = useRef({ distance: 0, fromView: false })
  offsetParamsRef.current = { distance: offsetDistance, fromView: offsetFromView }

  // Direzione dell'offset nelle coordinate della mesh: "Da Vista" verso la telecamera,
  // altrimenti la normale media della zona (estrusione lineare)
  const offsetModeFor = (sceneMesh, fromView) => {
    const camera = cameraRef.current
    if (!fromView || !camera || !sceneMesh) return 'average'
    sceneMesh.updateMatrixWorld(true)
    const toCamera = camera.getWorldDirection(new THREE.Vector3()).negate()
    toCamera.transformDirection(sceneMesh.matrixWorld.clone().invert())
    return [toCamera.x, toCamera.y, toCamera.z]
  }
  const holeMarkersRef = useRef([])
  const holeClickRef = useRef(null)
  const fillHoleByIdRef = useRef(null)
  const repairUndoRef = useRef([])
  const pushHistory = (label, entry) => {
    repairUndoRef.current.push({ ...entry, label })
    setEditHistory(repairUndoRef.current.map((item) => ({ label: item.label, meshIndex: item.meshIndex })))
  }
  const popHistory = () => {
    const last = repairUndoRef.current.pop()
    setEditHistory(repairUndoRef.current.map((item) => ({ label: item.label, meshIndex: item.meshIndex })))
    return last
  }
  // numerazione dei fori per geometria; passa alla geometria riparata e a quella ripristinata
  const holeNumberingRef = useRef(new WeakMap())
  const viewStateRef = useRef(null)

  const meshColors = [0xffaa7f, 0x7faaff, 0xaa7fff, 0x7fffaa, 0xffff7f, 0xff7fff]

  const getMeshDisplayColor = (mesh, index) => {
    if (mesh && mesh.color) return mesh.color
    const hasVertexColors = !!mesh.geometry?.getAttribute?.('color')
    if (hasVertexColors) {
      return '#999999'
    }
    const colorValue = meshColors[index % meshColors.length]
    return `#${colorValue.toString(16).padStart(6, '0')}`
  }

  const getTextColor = (backgroundColor) => {
    const hex = backgroundColor.replace('#', '')
    const value = parseInt(hex, 16)
    return value > 0xffffff / 2 ? '#1f2937' : '#ffffff'
  }

  const alignmentLeftContainerRef = useRef(null)
  const alignmentRightContainerRef = useRef(null)
  const fixedSceneRef = useRef(null)
  const movingSceneRef = useRef(null)
  const fixedRendererRef = useRef(null)
  const movingRendererRef = useRef(null)
  const fixedCameraRef = useRef(null)
  const movingCameraRef = useRef(null)
  const fixedMeshRef = useRef(null)
  const movingMeshRef = useRef(null)
  const fixedRaycasterRef = useRef(new THREE.Raycaster())
  const movingRaycasterRef = useRef(new THREE.Raycaster())
  const alignmentMarkersRef = useRef({ fixed: [], moving: [] })
  const pendingFixedMarkerRef = useRef(null)
  const fixedDragRef = useRef(false)
  const movingDragRef = useRef(false)
  const fixedLastPointerRef = useRef({ x: 0, y: 0 })
  const movingLastPointerRef = useRef({ x: 0, y: 0 })
  const fixedPointerDownCandidateRef = useRef(null)
  const movingPointerDownCandidateRef = useRef(null)
  const fixedPointerMovedRef = useRef(false)
  const movingPointerMovedRef = useRef(false)
  const fixedCameraStateRef = useRef({ theta: 0, phi: Math.PI / 2, radius: 3 })
  const movingCameraStateRef = useRef({ theta: 0, phi: Math.PI / 2, radius: 3 })

  useEffect(() => {
    const checkHealth = async () => {
      setServerChecking(true)
      const ok = await checkServerHealth(selectedServer.url)
      setServerOnline(ok)
      setServerChecking(false)
    }
    checkHealth()

    if (meshes.length < 2) {
      setAlignSourceIndex(0)
      setAlignTargetIndex(0)
      return
    }

    if (alignSourceIndex >= meshes.length) {
      setAlignSourceIndex(0)
    }

    if (alignTargetIndex >= meshes.length || alignTargetIndex === alignSourceIndex) {
      setAlignTargetIndex(alignSourceIndex === 0 ? 1 : 0)
    }
  }, [meshes, selectedServer.url])

  const bakeMeshGeometry = (mesh) => {
    const cloned = mesh.geometry.clone()
    mesh.updateMatrixWorld(true)
    cloned.applyMatrix4(mesh.matrixWorld)
    cloned.computeVertexNormals()
    return cloned
  }

  const handleServerSelection = (event) => {
    const nextServerId = event.target.value
    setSelectedServerId(nextServerId)
    saveServerId(nextServerId)
  }

  const serializeGeometryToSTL = (geometry, name = 'mesh') => {
    const positionAttr = geometry.getAttribute('position')
    if (!positionAttr) return ''

    const normalAttr = geometry.getAttribute('normal')
    const positions = positionAttr.array
    const normals = normalAttr ? normalAttr.array : null
    const indices = geometry.index ? geometry.index.array : null
    const faceCount = indices ? indices.length / 3 : positions.length / 9

    const getVertex = (target, srcArray, index) => {
      const offset = index * 3
      target.set(srcArray[offset], srcArray[offset + 1], srcArray[offset + 2])
      return target
    }

    let stl = `solid ${name}
`
    const v0 = new THREE.Vector3()
    const v1 = new THREE.Vector3()
    const v2 = new THREE.Vector3()
    const normal = new THREE.Vector3()

    for (let i = 0; i < faceCount; i += 1) {
      const a = indices ? indices[i * 3] : i * 3
      const b = indices ? indices[i * 3 + 1] : i * 3 + 1
      const c = indices ? indices[i * 3 + 2] : i * 3 + 2

      getVertex(v0, positions, a)
      getVertex(v1, positions, b)
      getVertex(v2, positions, c)

      if (normals) {
        getVertex(normal, normals, a)
      } else {
        normal.crossVectors(
          new THREE.Vector3().subVectors(v1, v0),
          new THREE.Vector3().subVectors(v2, v0)
        ).normalize()
      }

      stl += ` facet normal ${normal.x} ${normal.y} ${normal.z}\n`
      stl += '  outer loop\n'
      stl += `   vertex ${v0.x} ${v0.y} ${v0.z}\n`
      stl += `   vertex ${v1.x} ${v1.y} ${v1.z}\n`
      stl += `   vertex ${v2.x} ${v2.y} ${v2.z}\n`
      stl += '  endloop\n'
      stl += ' endfacet\n'
    }

    stl += `endsolid ${name}
`
    return stl
  }



  useEffect(() => {
    if (!containerRef.current || meshes.length === 0) return

    // Scene setup
    const scene = new THREE.Scene()
    // sfondo trasparente: il colore/gradiente viene da --render-bg (globals.css)
    scene.background = null
    sceneRef.current = scene

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6)
    hemiLight.position.set(0, 20, 0)
    scene.add(hemiLight)

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2)
    directionalLight.position.set(5, 10, 7)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.set(2048, 2048)
    directionalLight.shadow.camera.near = 0.5
    directionalLight.shadow.camera.far = 50
    if (directionalLight.shadow.camera.isOrthographicCamera) {
      directionalLight.shadow.camera.left = -10
      directionalLight.shadow.camera.right = 10
      directionalLight.shadow.camera.top = 10
      directionalLight.shadow.camera.bottom = -10
    }
    scene.add(directionalLight)

    const fillLight = new THREE.PointLight(0xffffff, 0.5)
    fillLight.position.set(-5, 5, 5)
    scene.add(fillLight)

    // Camera
    const width = containerRef.current.clientWidth
    const height = containerRef.current.clientHeight
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000)
    camera.position.z = 3
    cameraRef.current = camera

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    if ('useLegacyLights' in renderer) {
      renderer.useLegacyLights = false
    }
    if ('outputColorSpace' in renderer) {
      renderer.outputColorSpace = THREE.SRGBColorSpace
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    renderer.setClearColor(0x000000, 0)
    renderer.sortObjects = false
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.style.display = 'block'
    containerRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Colors per le diverse mesh
    const meshColors = [0xffaa7f, 0x7faaff, 0xaa7fff, 0x7fffaa, 0xffff7f, 0xff7fff]

    // Camera positioning - will be adjusted based on meshes
    let cameraZ = 3

    // Create meshes
    meshesRef.current = []
    meshes.forEach((meshData, index) => {
      const clonedGeometry = meshData.geometry.clone()
      const hasVertexColors = !!clonedGeometry.getAttribute('color')
      
      // Determina il colore: prima personalizzato, poi default per tipo di mesh
      let meshColor = meshColors[index % meshColors.length]
      if (meshData.color) {
        meshColor = parseInt(meshData.color.replace('#', ''), 16) || meshColor
      }
      
      const material = hasVertexColors
        ? new THREE.MeshStandardMaterial({
            color: 0xffffff,
            vertexColors: true,
            roughness: 0.35,
            metalness: 0.05,
            side: THREE.DoubleSide,
          })
        : new THREE.MeshStandardMaterial({
            color: meshColor,
            roughness: 0.35,
            metalness: 0.05,
            side: THREE.DoubleSide,
          })

      const mesh = new THREE.Mesh(clonedGeometry, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.visible = meshData.visible
      scene.add(mesh)
      mesh.userData.meshIndex = index
      meshesRef.current.push(mesh)

      // Center and fit mesh
      // una parte ricavata da un'altra mesh (displayFrame) usa il riferimento di quella,
      // così nella vista resta nella sua posizione e alla sua grandezza
      const frame = meshData.displayFrame
      clonedGeometry.computeBoundingBox()
      const boundingBox = clonedGeometry.boundingBox
      const center = new THREE.Vector3()
      if (frame) center.fromArray(frame.center)
      else boundingBox.getCenter(center)
      clonedGeometry.translate(-center.x, -center.y, -center.z)
      clonedGeometry.computeBoundingBox()
      const size = clonedGeometry.boundingBox.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)
      const scale = frame ? frame.scale : maxDim > 0 ? 1.5 / maxDim : 1
      clonedGeometry.scale(scale, scale, scale)
      mesh.position.set(0, 0, 0)
      mesh.rotation.set(0, 0, 0)
      // usata per disegnare i marcatori dei fori nelle coordinate della scena
      mesh.userData.normalization = { center: center.clone(), scale }

      // Adjust camera distance based on largest mesh dimension
      const fov = camera.fov * (Math.PI / 180)
      const scaledMaxDim = maxDim * scale
      const calculatedZ = Math.abs(scaledMaxDim / 2 / Math.tan(fov / 2))
      if (Number.isFinite(calculatedZ) && calculatedZ > 0) {
        cameraZ = Math.max(cameraZ, calculatedZ * 1.5)
      }
    })

    // Position camera to frame all meshes
    camera.position.z = cameraZ
    camera.lookAt(0, 0, 0)

    // Se la scena viene ricostruita con le stesse mesh (es. dopo la chiusura di un foro),
    // mantieni inquadratura e orientamento correnti
    // mantieni inquadratura e orientamento correnti; vale anche quando vengono aggiunte
    // solo parti ricavate da mesh esistenti, che prendono posizione e rotazione dalla mesh d'origine
    const savedView = viewStateRef.current
    const savedCount = savedView ? savedView.meshes.length : 0
    if (
      savedView &&
      (savedCount === meshesRef.current.length ||
        (savedCount < meshes.length && meshes.slice(savedCount).every((m) => m.displayFrame?.sourceIndex < savedCount)))
    ) {
      camera.position.copy(savedView.cameraPosition)
      camera.quaternion.copy(savedView.cameraQuaternion)
      meshesRef.current.forEach((m, i) => {
        const saved = savedView.meshes[i < savedCount ? i : meshes[i].displayFrame.sourceIndex]
        m.position.copy(saved.position)
        m.rotation.copy(saved.rotation)
      })
    }

    const onMouseDown = (e) => {
      if (e.button === 1) {
        e.preventDefault()
      }
      // Offset con pennello: il clic sinistro sulla mesh colora invece di ruotare
      if (e.button === 0 && brushStateRef.current.active && brushHandlersRef.current?.down(e)) {
        brushStateRef.current.painting = true
        return
      }
      // Specchia: trascinamento dei cursori del piano
      if (e.button === 0 && mirrorStateRef.current.active && mirrorHandlersRef.current?.down(e)) {
        mirrorStateRef.current.dragging = true
        return
      }
      isDraggingRef.current = true
      mouseRef.current.x = e.clientX
      mouseRef.current.y = e.clientY
      mouseButtonRef.current = e.button

      // Raycast to detect if user clicked on any mesh
      try {
        const rect = renderer.domElement.getBoundingClientRect()
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        )
        const raycaster = raycasterRef.current
        raycaster.setFromCamera(ndc, cameraRef.current)

        // Clic su un marcatore di foro: la chiusura avviene al rilascio, se il mouse non si è mosso
        holeClickRef.current = null
        if (e.button === 0 && holeMarkersRef.current.length > 0) {
          const markerHits = raycaster.intersectObjects(holeMarkersRef.current, false)
          if (markerHits.length > 0) {
            holeClickRef.current = { holeId: markerHits[0].object.userData.holeId, x: e.clientX, y: e.clientY }
          }
        }

        const intersects = raycaster.intersectObjects(meshesRef.current, true)

        if (manualMoveMode && meshesRef.current[selectedMeshIndex] && intersects.length > 0 && intersects[0].object === meshesRef.current[selectedMeshIndex]) {
          // start moving the selected mesh
          moveStartRef.current = { x: e.clientX, y: e.clientY }
          selectedMeshPositionRef.current.copy(meshesRef.current[selectedMeshIndex].position)
          cameraControlRef.current = false
        } else if (intersects.length === 0 && e.button !== 1) {
          // click on background (not middle-button): enable camera orbit control
          cameraControlRef.current = true
          // store spherical coordinates of camera
          const sph = cameraSphericalRef.current
          sph.setFromVector3(cameraRef.current.position.clone())
        } else {
          // clicked a different mesh: select it (or middle-button: prepare to pan)
          const clicked = intersects.length > 0 ? intersects[0].object : null
          if (clicked) {
            const idx = meshesRef.current.indexOf(clicked)
            if (idx !== -1) setSelectedMeshIndex(idx)
          }
          cameraControlRef.current = false
        }
      } catch (err) {
        cameraControlRef.current = false
      }
    }

    const onMouseMove = (e) => {
      if (brushStateRef.current.active) {
        brushHandlersRef.current?.move(e)
        if (brushStateRef.current.painting) return
      }
      if (mirrorStateRef.current.active) {
        mirrorHandlersRef.current?.move(e)
        if (mirrorStateRef.current.dragging) return
      }
      if (!isDraggingRef.current) return

      const deltaX = e.clientX - mouseRef.current.x
      const deltaY = e.clientY - mouseRef.current.y
      mouseRef.current.x = e.clientX
      mouseRef.current.y = e.clientY

      // Middle-button pan in main viewport (highest priority, pan all meshes)
      if (!manualMoveMode && mouseButtonRef.current === 1) {
        const camera = cameraRef.current
        const panSpeed = 0.003 * camera.position.z
        meshesRef.current.forEach((m) => {
          m.position.x += deltaX * panSpeed
          m.position.y -= deltaY * panSpeed
        })
        return
      }

      // Camera orbit control when started on background
      if (cameraControlRef.current) {
        const camera = cameraRef.current
        const sph = cameraSphericalRef.current
        const orbitSpeed = 0.005
        sph.theta -= deltaX * orbitSpeed
        sph.phi -= deltaY * orbitSpeed
        sph.phi = Math.max(0.01, Math.min(Math.PI - 0.01, sph.phi))
        camera.position.setFromSpherical(sph)
        camera.lookAt(0, 0, 0)
        return
      }

      if (manualMoveMode && mouseButtonRef.current === 1 && meshesRef.current[selectedMeshIndex]) {
        const mesh = meshesRef.current[selectedMeshIndex]
        const camera = cameraRef.current
        const distanceFactor = Math.max(0.00012, camera.position.distanceTo(new THREE.Vector3(0, 0, 0)) * 0.00028)
        const cameraDirection = new THREE.Vector3()
        camera.getWorldDirection(cameraDirection)
        const cameraRight = new THREE.Vector3().crossVectors(cameraDirection, camera.up).normalize()
        const cameraUp = new THREE.Vector3().copy(camera.up).normalize()

        const moveVector = new THREE.Vector3()
        moveVector.addScaledVector(cameraRight, deltaX * distanceFactor)
        moveVector.addScaledVector(cameraUp, -deltaY * distanceFactor)

        mesh.position.add(moveVector)
        return
      }

      if (manualMoveMode && meshesRef.current[selectedMeshIndex]) {
        const mesh = meshesRef.current[selectedMeshIndex]
        const camera = cameraRef.current

        if (mouseButtonRef.current === 1) {
          const moveSpeed = 0.004
          mesh.position.x += deltaX * moveSpeed
          mesh.position.y -= deltaY * moveSpeed
          return
        }

        const distanceFactor = Math.max(0.00012, camera.position.distanceTo(new THREE.Vector3(0, 0, 0)) * 0.00028)

        const cameraDirection = new THREE.Vector3()
        camera.getWorldDirection(cameraDirection)
        const cameraRight = new THREE.Vector3().crossVectors(cameraDirection, camera.up).normalize()
        const cameraUp = new THREE.Vector3().copy(camera.up).normalize()

        const moveVector = new THREE.Vector3()
        moveVector.addScaledVector(cameraRight, deltaX * distanceFactor)
        moveVector.addScaledVector(cameraUp, -deltaY * distanceFactor)

        mesh.position.add(moveVector)
        return
      }

      // Use axis-based rotations to avoid Euler clamping (allow continuous rotation)
      if (mouseButtonRef.current === 0) {
        const camera = cameraRef.current
        const rotationSpeed = 0.01
        const worldUp = new THREE.Vector3(0, 1, 0)
        const cameraDirection = new THREE.Vector3()
        if (camera) camera.getWorldDirection(cameraDirection)
        const cameraRight = new THREE.Vector3().crossVectors(cameraDirection, camera?.up || new THREE.Vector3(0, 1, 0)).normalize()

        meshesRef.current.forEach((m) => {
          m.rotateOnWorldAxis(worldUp, -deltaX * rotationSpeed)
          m.rotateOnAxis(cameraRight, deltaY * rotationSpeed)
        })

        // keep rotationRef in sync with the first mesh
        const first = meshesRef.current[0]
        if (first) {
          rotationRef.current.y = first.rotation.y
          rotationRef.current.x = first.rotation.x
        }
      } else {
        rotationRef.current.y -= deltaX * 0.01
        rotationRef.current.x += deltaY * 0.01
      }
    }

    const onMouseUp = (e) => {
      if (brushStateRef.current.painting) {
        brushStateRef.current.painting = false
        brushHandlersRef.current?.up()
      }
      if (mirrorStateRef.current.dragging) {
        mirrorStateRef.current.dragging = false
        mirrorHandlersRef.current?.up()
      }
      const holeClick = holeClickRef.current
      holeClickRef.current = null
      if (holeClick && Math.hypot(e.clientX - holeClick.x, e.clientY - holeClick.y) < 5) {
        fillHoleByIdRef.current?.(holeClick.holeId)
      }
      isDraggingRef.current = false
      cameraControlRef.current = false
      mouseButtonRef.current = null
    }

    const onWheel = (e) => {
      e.preventDefault()
      // Always zoom the camera along its forward vector
      const camera = cameraRef.current
      if (!camera) return
      const direction = new THREE.Vector3()
      camera.getWorldDirection(direction)
      // deltaY positive -> zoom out; negative -> zoom in
      const zoomFactor = 0.0012
      camera.position.addScaledVector(direction, e.deltaY * zoomFactor)
      // keep camera at a reasonable distance from origin
      const minDist = 0.3
      const maxDist = 50
      const dist = camera.position.length()
      if (dist < minDist) {
        camera.position.setLength(minDist)
      } else if (dist > maxDist) {
        camera.position.setLength(maxDist)
      }
      // sync spherical state used by orbit
      try {
        cameraSphericalRef.current.setFromVector3(camera.position.clone())
      } catch (err) {
        // ignore
      }
    }

    const onContextMenu = (event) => {
      event.preventDefault()
    }

    const onMouseLeave = () => {
      if (brushStateRef.current.painting) {
        brushStateRef.current.painting = false
        brushHandlersRef.current?.up()
      }
      brushHandlersRef.current?.leave()
      if (mirrorStateRef.current.dragging) {
        mirrorStateRef.current.dragging = false
        mirrorHandlersRef.current?.up()
      }
    }

    renderer.domElement.addEventListener('mouseleave', onMouseLeave)
    renderer.domElement.addEventListener('mousedown', onMouseDown)
    renderer.domElement.addEventListener('mousemove', onMouseMove)
    renderer.domElement.addEventListener('mouseup', onMouseUp)
    renderer.domElement.addEventListener('contextmenu', onContextMenu)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

    // Animation loop
    let animationId
    const animate = () => {
      animationId = requestAnimationFrame(animate)

      meshesRef.current.forEach(mesh => {
        mesh.rotation.x += (rotationRef.current.x - mesh.rotation.x) * 0.1
        mesh.rotation.y += (rotationRef.current.y - mesh.rotation.y) * 0.1
      })

      if (selectedMeshHelperRef.current) {
        selectedMeshHelperRef.current.update()
      }

      renderer.render(scene, camera)
    }
    animate()

    // Handle resize
    const handleResize = () => {
      const newWidth = containerRef.current?.clientWidth || width
      const newHeight = containerRef.current?.clientHeight || height
      camera.aspect = newWidth / newHeight
      camera.updateProjectionMatrix()
      renderer.setSize(newWidth, newHeight)
    }

    window.addEventListener('resize', handleResize)

    return () => {
      viewStateRef.current = {
        cameraPosition: camera.position.clone(),
        cameraQuaternion: camera.quaternion.clone(),
        meshes: meshesRef.current.map((m) => ({ position: m.position.clone(), rotation: m.rotation.clone() })),
      }
      cancelAnimationFrame(animationId)
      renderer.domElement.removeEventListener('mouseleave', onMouseLeave)
      renderer.domElement.removeEventListener('mousedown', onMouseDown)
      renderer.domElement.removeEventListener('mousemove', onMouseMove)
      renderer.domElement.removeEventListener('mouseup', onMouseUp)
      renderer.domElement.removeEventListener('contextmenu', onContextMenu)
      renderer.domElement.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', handleResize)
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement)
      } else if (containerRef.current?.contains(renderer.domElement)) {
        containerRef.current.removeChild(renderer.domElement)
      }
      renderer.dispose()
      meshesRef.current.forEach(mesh => {
        mesh.geometry.dispose()
        if (mesh.material instanceof Array) {
          mesh.material.forEach(m => m.dispose())
        } else {
          mesh.material.dispose()
        }
      })
    }
  }, [meshes])

  useEffect(() => {
    if (!sceneRef.current) return

    if (selectedMeshHelperRef.current) {
      sceneRef.current.remove(selectedMeshHelperRef.current)
      selectedMeshHelperRef.current.geometry.dispose()
      selectedMeshHelperRef.current.material.dispose()
      selectedMeshHelperRef.current = null
    }

    if (!manualMoveMode) return

    const selectedMesh = meshesRef.current[selectedMeshIndex]
    if (!selectedMesh) return

    const helper = new THREE.BoxHelper(selectedMesh, 0xffd700)
    helper.material.linewidth = 2
    helper.renderOrder = 999
    sceneRef.current.add(helper)
    selectedMeshHelperRef.current = helper

    return () => {
      if (selectedMeshHelperRef.current) {
        sceneRef.current.remove(selectedMeshHelperRef.current)
        selectedMeshHelperRef.current.geometry.dispose()
        selectedMeshHelperRef.current.material.dispose()
        selectedMeshHelperRef.current = null
      }
    }
  }, [selectedMeshIndex, manualMoveMode, meshes])

  const remeshPanelVisible =
    !!remeshCompare && !repairMode && !showSimplifyPanel && !showIsolatedPanel && !showOffsetPanel && !showMirrorPanel && !cutTool && !borderTool && alignmentMode !== 'point-align'

  // Rimuovi componenti isolati: analisi dei componenti della mesh selezionata
  useEffect(() => {
    const target = showIsolatedPanel ? meshes[selectedMeshIndex] : null
    if (!target) {
      setIsolatedAnalysis(null)
      setIsolatedBusy(false)
      return
    }
    let cancelled = false
    setIsolatedBusy(true)
    const timer = setTimeout(() => {
      try {
        const analysis = analyzeComponents(target.geometry)
        if (!cancelled) setIsolatedAnalysis({ ...analysis, meshIndex: selectedMeshIndex, geometry: target.geometry })
      } catch (err) {
        console.error('Analisi componenti non riuscita:', err)
        if (!cancelled) {
          setIsolatedAnalysis(null)
          setMessage(`❌ Analisi dei componenti non riuscita: ${err.message}`)
        }
      } finally {
        if (!cancelled) setIsolatedBusy(false)
      }
    }, 30)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [showIsolatedPanel, selectedMeshIndex, meshes])

  // la selezione segue la soglia del rapporto dimensione
  useEffect(() => {
    setIsolatedSelection(isolatedAnalysis ? selectComponentsByRatio(isolatedAnalysis, isolatedRatio) : [])
  }, [isolatedAnalysis, isolatedRatio])

  // componenti selezionati colorati di rosso nella vista
  useEffect(() => {
    if (!showIsolatedPanel || !isolatedAnalysis || isolatedSelection.length === 0) return
    if (meshes[isolatedAnalysis.meshIndex]?.geometry !== isolatedAnalysis.geometry) return
    const sceneMesh = meshesRef.current[isolatedAnalysis.meshIndex]
    const normalization = sceneMesh?.userData.normalization
    if (!normalization) return

    const { center, scale } = normalization
    const highlightGeometry = componentsGeometry(isolatedAnalysis, isolatedSelection)
    highlightGeometry.translate(-center.x, -center.y, -center.z)
    highlightGeometry.scale(scale, scale, scale)
    const highlight = new THREE.Mesh(
      highlightGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xdc2626,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        toneMapped: false,
      })
    )
    highlight.renderOrder = 5
    highlight.raycast = () => {} // solo visivo
    sceneMesh.add(highlight)
    return () => {
      highlight.removeFromParent()
      highlight.geometry.dispose()
      highlight.material.dispose()
    }
  }, [showIsolatedPanel, isolatedAnalysis, isolatedSelection, meshes])

  // Offset con pennello: preparazione della mesh selezionata (vertici uniti, normali, griglia)
  useEffect(() => {
    const target = showOffsetPanel || cutTool ? meshes[selectedMeshIndex] : null
    if (!target) {
      setBrushData(null)
      setOffsetBusy(false)
      return
    }
    if (brushDataRef.current?.geometry === target.geometry) return
    let cancelled = false
    setOffsetBusy(true)
    const timer = setTimeout(() => {
      try {
        const data = prepareBrushMesh(target.geometry)
        const previous = brushDataRef.current
        // dopo un'estrusione i vertici restano gli stessi: la zona colorata resta selezionata
        if (previous && previous.meshIndex === selectedMeshIndex && previous.selected.length === data.selected.length) {
          data.selected.set(previous.selected)
        } else {
          const unit = 10 ** Math.floor(Math.log10(Math.max(data.mesh.diagonal, 1e-6) / 100))
          setBrushDiameter(Math.max(unit, Math.round((data.mesh.diagonal * 0.05) / unit) * unit))
        }
        if (cancelled) return
        setBrushData({ ...data, meshIndex: selectedMeshIndex, geometry: target.geometry })
        setOffsetSelectedCount(countSelected(data))
      } catch (err) {
        console.error('Preparazione pennello non riuscita:', err)
        if (!cancelled) {
          setBrushData(null)
          setMessage(`❌ Preparazione del pennello non riuscita: ${err.message}`)
        }
      } finally {
        if (!cancelled) setOffsetBusy(false)
      }
    }, 30)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [showOffsetPanel, cutTool, selectedMeshIndex, meshes])

  // Offset con pennello: nella vista la mesh usa i vertici uniti, così l'anteprima
  // dell'estrusione sposta direttamente i vertici; la zona colorata è un secondo
  // oggetto marrone che condivide le stesse posizioni; il cerchio segue il mouse.
  useEffect(() => {
    if (!brushData || meshes[brushData.meshIndex]?.geometry !== brushData.geometry) return
    const sceneMesh = meshesRef.current[brushData.meshIndex]
    const normalization = sceneMesh?.userData.normalization
    const scene = sceneRef.current
    if (!normalization || !scene) return

    const { center, scale } = normalization
    const { positions: P, colors, indices } = brushData.mesh
    const positionAttr = new THREE.BufferAttribute(new Float32Array(P.length), 3)
    positionAttr.setUsage(THREE.DynamicDrawUsage)
    const editGeometry = new THREE.BufferGeometry()
    editGeometry.setAttribute('position', positionAttr)
    if (colors) editGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    editGeometry.setIndex(new THREE.BufferAttribute(indices, 1))
    const originalGeometry = sceneMesh.geometry
    sceneMesh.geometry = editGeometry

    const overlayIndex = new THREE.BufferAttribute(new Uint32Array(indices.length), 1)
    overlayIndex.setUsage(THREE.DynamicDrawUsage)
    const overlayGeometry = new THREE.BufferGeometry()
    overlayGeometry.setAttribute('position', positionAttr)
    overlayGeometry.setIndex(overlayIndex)
    const overlay = new THREE.Mesh(
      overlayGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x964b00,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        toneMapped: false,
      })
    )
    overlay.renderOrder = 5
    overlay.frustumCulled = false
    overlay.raycast = () => {}
    sceneMesh.add(overlay)

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 64),
      new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide, depthTest: false, transparent: true, toneMapped: false })
    )
    ring.renderOrder = 20
    ring.visible = false
    ring.raycast = () => {}
    scene.add(ring)

    const work = new Float32Array(P.length)
    const update = ({ positions = true, selection = true } = {}) => {
      if (positions) {
        const { distance, fromView } = offsetParamsRef.current
        offsetPositions(brushData, distance, offsetModeFor(sceneMesh, fromView), work)
        const out = positionAttr.array
        for (let i = 0; i < work.length; i += 3) {
          out[i] = (work[i] - center.x) * scale
          out[i + 1] = (work[i + 1] - center.y) * scale
          out[i + 2] = (work[i + 2] - center.z) * scale
        }
        positionAttr.needsUpdate = true
        editGeometry.computeVertexNormals()
        editGeometry.computeBoundingBox()
        editGeometry.computeBoundingSphere()
      }
      if (selection) {
        overlayGeometry.setDrawRange(0, fillSelectedTriangles(brushData, overlayIndex.array))
        overlayIndex.needsUpdate = true
      }
    }
    update()

    // colora i triangoli indicati da `flags` (1 = colorato); null li toglie tutti
    const showTriangles = (flags) => {
      const out = overlayIndex.array
      let n = 0
      if (flags) {
        for (let t = 0; t < flags.length; t++) {
          if (!flags[t]) continue
          out[n++] = indices[t * 3]
          out[n++] = indices[t * 3 + 1]
          out[n++] = indices[t * 3 + 2]
        }
      }
      overlayGeometry.setDrawRange(0, n)
      overlayIndex.needsUpdate = true
    }

    brushSceneRef.current = { sceneMesh, ring, overlay, update, showTriangles, center, scale }
    brushStateRef.current = { active: true, painting: false }
    const canvas = rendererRef.current?.domElement
    if (canvas) canvas.style.cursor = 'crosshair'
    return () => {
      brushStateRef.current = { active: false, painting: false }
      brushSceneRef.current = null
      cancelAnimationFrame(brushFrameRef.current.id)
      brushFrameRef.current = { id: 0, event: null }
      if (canvas) canvas.style.cursor = ''
      if (sceneMesh.geometry === editGeometry) sceneMesh.geometry = originalGeometry
      editGeometry.dispose()
      overlay.removeFromParent()
      overlayGeometry.dispose()
      overlay.material.dispose()
      ring.removeFromParent()
      ring.geometry.dispose()
      ring.material.dispose()
    }
  }, [brushData, meshes])

  // anteprima dell'estrusione mentre si muove il cursore della distanza
  useEffect(() => {
    brushSceneRef.current?.update({ positions: true, selection: false })
  }, [offsetDistance, offsetFromView, brushData])

  // Taglia con Area: area con offset, nelle coordinate originali della mesh
  const areaGeometry = (area) => ({ ...area, polygon: offsetPolygon(area.points, areaOffset) })
  const currentArea = () => {
    const area = areaCutRef.current
    return area && brushData && area.meshIndex === brushData.meshIndex ? area : null
  }

  // Taglia con Area: la parte che verrà eliminata è colorata in viola
  useEffect(() => {
    const brushScene = brushSceneRef.current
    if (cutTool !== 'Area' || !brushData || !brushScene) return
    brushScene.overlay.material.color.setHex(AREA_COLOR)
    const area = areaCut && areaCut.meshIndex === brushData.meshIndex && areaCut.points.length >= 3 ? areaCut : null
    // durante il trascinamento dei punti il calcolo parte solo quando il mouse si ferma
    const timer = setTimeout(() => {
      try {
        if (area) {
          const depth = areaMaterialCut ? areaDepth : null
          brushData.selected.set(selectArea(brushData.mesh, areaGeometry(area), { invert: areaInvert, depth }))
        } else {
          brushData.selected.fill(0)
        }
      } catch (err) {
        console.error('Anteprima del taglio non riuscita:', err)
      }
      brushSceneRef.current?.update({ positions: false, selection: true })
      setOffsetSelectedCount(countSelected(brushData))
    }, area ? 60 : 0)
    return () => {
      clearTimeout(timer)
      brushScene.overlay.material.color.setHex(0x964b00)
    }
  }, [cutTool, brushData, meshes, areaCut, areaOffset, areaInvert, areaMaterialCut, areaDepth])

  // Taglia con Area: punti, contorno e riempimento del poligono, sempre in primo piano
  useEffect(() => {
    const brushScene = brushSceneRef.current
    if (cutTool !== 'Area' || !brushScene || !areaCut || areaCut.meshIndex !== brushData?.meshIndex || areaCut.points.length === 0) return
    const { sceneMesh, center, scale } = brushScene
    const toLocal = (point) => {
      const [x, y, z] = areaPoint(areaCut, point)
      return new THREE.Vector3((x - center.x) * scale, (y - center.y) * scale, (z - center.z) * scale)
    }
    const overlayMaterial = (extra) => ({ depthTest: false, depthWrite: false, transparent: true, toneMapped: false, ...extra })
    const group = new THREE.Group()
    const polygon = offsetPolygon(areaCut.points, areaOffset)
    if (polygon.length >= 3 && !areaInvert) {
      const faces = THREE.ShapeUtils.triangulateShape(polygon.map(([a, b]) => new THREE.Vector2(a, b)), [])
      const fillGeometry = new THREE.BufferGeometry().setFromPoints(polygon.map(toLocal))
      fillGeometry.setIndex(faces.flat())
      group.add(new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial(overlayMaterial({ color: AREA_COLOR, opacity: 0.3, side: THREE.DoubleSide }))))
    }
    const Outline = polygon.length >= 3 ? THREE.LineLoop : THREE.Line
    group.add(new Outline(new THREE.BufferGeometry().setFromPoints(polygon.map(toLocal)), new THREE.LineBasicMaterial(overlayMaterial({ color: AREA_COLOR }))))
    group.add(
      new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(areaCut.points.map(toLocal)),
        new THREE.PointsMaterial(overlayMaterial({ size: 11, sizeAttenuation: false, map: getMarkerTexture('#f5d0fe', hexColor(AREA_COLOR)), alphaTest: 0.5 }))
      )
    )
    group.traverse((object) => {
      object.renderOrder = 30
      object.frustumCulled = false
      object.raycast = () => {}
    })
    sceneMesh.add(group)
    return () => {
      group.removeFromParent()
      group.traverse((object) => {
        object.geometry?.dispose()
        object.material?.dispose()
      })
    }
  }, [cutTool, brushData, meshes, areaCut, areaOffset, areaInvert])

  // Taglia con Area / Linea: Ctrl+Z, Canc o Backspace tolgono l'ultimo punto
  // (su una linea chiusa riaprono prima il contorno)
  useEffect(() => {
    if (cutTool !== 'Area' && cutTool !== 'Linea') return
    const onKeyDown = (event) => {
      const undoKey = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z'
      if (!undoKey && event.key !== 'Delete' && event.key !== 'Backspace') return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return
      const [current, set] = cutTool === 'Area' ? [areaCutRef.current, setAreaCut] : [curveCutRef.current, setCurveCut]
      if (!current || current.points.length === 0) return
      event.preventDefault()
      // il punto tolto non deve far scattare anche l'annulla del visualizzatore sotto
      event.stopImmediatePropagation()
      if (current.closed) set({ ...current, closed: false })
      else set(current.points.length > 1 ? { ...current, points: current.points.slice(0, -1) } : null)
    }
    // in cattura: parte prima degli altri gestori dei tasti registrati sulla finestra
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [cutTool])

  // Taglia con Linea: percorsi sulla superficie tra punti consecutivi (in cache) e, quando
  // l'utente ha chiuso la linea cliccando sul primo punto, contorno chiuso
  const curvePaths = useMemo(() => {
    if (!curveCut || !brushData || curveCut.meshIndex !== brushData.meshIndex) return null
    const cache = curvePathCacheRef.current
    if (cache.mesh !== brushData.mesh) {
      cache.mesh = brushData.mesh
      cache.paths = new Map()
    }
    const pathBetween = (a, b) => {
      const key = `${a}_${b}`
      if (!cache.paths.has(key)) cache.paths.set(key, surfacePath(brushData.mesh, a, b))
      return cache.paths.get(key)
    }
    const { points } = curveCut
    const segments = []
    for (let i = 0; i + 1 < points.length; i++) segments.push(pathBetween(points[i], points[i + 1]))
    const closed = !!curveCut.closed && points.length >= 3
    if (closed) segments.push(pathBetween(points[points.length - 1], points[0]))
    const broken = segments.some((segment) => !segment)
    const loop = closed && !broken ? closedLoop(segments) : null
    return { segments: segments.filter(Boolean), broken, loop: loop && loop.length >= 3 ? loop : null }
  }, [curveCut, brushData])

  // Taglia con Linea: la parte che verrà eliminata è colorata in marrone
  useEffect(() => {
    if (cutTool !== 'Linea' || !brushData || !brushSceneRef.current) return
    const loop = curvePaths?.loop
    const timer = setTimeout(() => {
      let preview = { count: 0, error: curvePaths?.broken ? 'Due punti non sono collegati sulla superficie.' : '' }
      let removed = null
      if (loop) {
        try {
          const selection = curveCutSelection(brushData.mesh, loop, curveInvert)
          removed = selection.removed
          preview = { count: selection.count, error: '' }
        } catch (err) {
          preview = { count: 0, error: err.message }
        }
      }
      brushSceneRef.current?.showTriangles(removed)
      setCurvePreview(preview)
    }, loop ? 60 : 0)
    return () => clearTimeout(timer)
  }, [cutTool, brushData, meshes, curvePaths, curveInvert])

  // cambiando strumento la colorazione torna quella della selezione
  useEffect(() => () => brushSceneRef.current?.update({ positions: false, selection: true }), [cutTool])

  // Taglia con Linea: contorno sulla superficie (lisciato, se "Tensione Spigoli") e punti
  useEffect(() => {
    const brushScene = brushSceneRef.current
    if (cutTool !== 'Linea' || !brushScene || !curvePaths || curveCut.points.length === 0) return
    const { sceneMesh, center, scale } = brushScene
    const P = brushData.mesh.positions
    const N = brushData.normals
    // linea e punti leggermente sollevati sulla superficie, per non sparire nella mesh
    const lift = brushData.mesh.diagonal * 0.0008
    const toLocal = (x, y, z, v, factor = 1) =>
      new THREE.Vector3(
        (x + N[v * 3] * lift * factor - center.x) * scale,
        (y + N[v * 3 + 1] * lift * factor - center.y) * scale,
        (z + N[v * 3 + 2] * lift * factor - center.z) * scale
      )
    const { loop } = curvePaths
    let linePoints
    if (loop && curveSmooth) {
      const smoothed = smoothLoopPositions(P, loop, curveSmoothStrength, N)
      linePoints = loop.map((v, i) => toLocal(smoothed[i * 3], smoothed[i * 3 + 1], smoothed[i * 3 + 2], v))
    } else {
      const vertices = loop || curvePaths.segments.flat()
      linePoints = vertices.map((v) => toLocal(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], v))
    }
    const group = new THREE.Group()
    const Line = loop ? THREE.LineLoop : THREE.Line
    group.add(new Line(new THREE.BufferGeometry().setFromPoints(linePoints), new THREE.LineBasicMaterial({ color: CURVE_COLOR, toneMapped: false })))

    const { points } = curveCut
    const markerGeometry = new THREE.BufferGeometry().setFromPoints(points.map((v) => toLocal(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], v, 2)))
    const colors = new Float32Array(points.length * 3)
    const color = new THREE.Color()
    points.forEach((_, i) => {
      color.setHex(!loop && points.length > 1 && i === points.length - 1 ? CURVE_END_COLOR : CURVE_COLOR)
      color.toArray(colors, i * 3)
    })
    markerGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    group.add(
      new THREE.Points(
        markerGeometry,
        new THREE.PointsMaterial({ size: 10, sizeAttenuation: false, vertexColors: true, map: getMarkerTexture('#ffffff', '#7f1d1d'), alphaTest: 0.5, toneMapped: false })
      )
    )
    group.traverse((object) => {
      object.renderOrder = 30
      object.frustumCulled = false
      object.raycast = () => {}
    })
    sceneMesh.add(group)
    return () => {
      group.removeFromParent()
      group.traverse((object) => {
        object.geometry?.dispose()
        object.material?.dispose()
      })
    }
  }, [cutTool, brushData, meshes, curveCut, curvePaths, curveSmooth, curveSmoothStrength])

  // Specchia: cursori del piano e anteprima trasparente della mesh specchiata
  useEffect(() => {
    const target = showMirrorPanel ? meshes[selectedMeshIndex] : null
    const sceneMesh = meshesRef.current[selectedMeshIndex]
    const normalization = sceneMesh?.userData.normalization
    const canvas = rendererRef.current?.domElement
    if (!target || !normalization || !canvas) return

    const { center, scale } = normalization
    sceneMesh.geometry.computeBoundingSphere()
    const radius = Math.max(sceneMesh.geometry.boundingSphere?.radius || 0.75, 0.1) * 1.05
    const gizmo = createMirrorGizmo(radius, new THREE.Vector2(canvas.clientWidth || 1, canvas.clientHeight || 1))
    const { group } = gizmo
    const plane = mirrorPlaneRef.current
    if (plane && plane.meshIndex === selectedMeshIndex) {
      group.position.set((plane.point.x - center.x) * scale, (plane.point.y - center.y) * scale, (plane.point.z - center.z) * scale)
      group.quaternion.copy(plane.quaternion)
    } else {
      // piano predefinito: passa per il centro della mesh, normale lungo X (destra/sinistra)
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0))
    }
    sceneMesh.add(group)

    const ghost = new THREE.Mesh(
      sceneMesh.geometry,
      new THREE.MeshStandardMaterial({
        color: 0xffaa7f,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: THREE.DoubleSide,
        roughness: 0.5,
      })
    )
    ghost.matrixAutoUpdate = false
    ghost.raycast = () => {}
    sceneMesh.add(ghost)

    const updatePreview = () => {
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion)
      ghost.matrix.copy(mirrorMatrix(group.position, normal))
      ghost.matrixWorldNeedsUpdate = true
    }
    const savePlane = () => {
      const p = group.position
      mirrorPlaneRef.current = {
        meshIndex: selectedMeshIndex,
        point: new THREE.Vector3(p.x / scale + center.x, p.y / scale + center.y, p.z / scale + center.z),
        quaternion: group.quaternion.clone(),
      }
    }
    updatePreview()
    savePlane()

    mirrorSceneRef.current = { sceneMesh, gizmo, updatePreview, savePlane, drag: null }
    mirrorStateRef.current = { active: true, dragging: false }
    return () => {
      mirrorStateRef.current = { active: false, dragging: false }
      mirrorSceneRef.current = null
      canvas.style.cursor = ''
      ghost.removeFromParent()
      ghost.material.dispose()
      gizmo.dispose()
    }
  }, [showMirrorPanel, selectedMeshIndex, meshes, mirrorResetToken])

  // Triangoli visibili (wireframe) su tutte le mesh; riapplicato quando la scena viene ricostruita
  useEffect(() => {
    meshesRef.current.forEach((m) => {
      if (!m.material) return
      m.material.wireframe = showWireframe
      m.material.needsUpdate = true
    })
  }, [showWireframe, meshes])

  // Ripara mesh: analisi dei fori della mesh selezionata
  useEffect(() => {
    const target = repairMode ? meshes[selectedMeshIndex] : null
    if (!target) {
      setHoleAnalysis(null)
      setRepairBusy(false)
      return
    }
    let cancelled = false
    setRepairBusy(true)
    // il timeout lascia al browser il tempo di mostrare "Analisi in corso"
    const timer = setTimeout(() => {
      try {
        const analysis = analyzeHoles(target.geometry)
        let numbering = holeNumberingRef.current.get(target.geometry)
        if (!numbering) {
          numbering = { entries: [], next: 1 }
          holeNumberingRef.current.set(target.geometry, numbering)
        }
        const labels = assignHoleLabels(numbering, analysis.holes, analysis.mesh.diagonal)
        if (!cancelled) setHoleAnalysis({ ...analysis, labels, meshIndex: selectedMeshIndex, geometry: target.geometry })
      } catch (err) {
        console.error('Analisi fori non riuscita:', err)
        if (!cancelled) {
          setHoleAnalysis(null)
          setRepairMessage(`❌ Analisi dei fori non riuscita: ${err.message}`)
        }
      } finally {
        if (!cancelled) setRepairBusy(false)
      }
    }, 30)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [repairMode, selectedMeshIndex, meshes])

  // Ripara mesh: bordo rosso ed etichetta numerata (cliccabile) per ogni foro
  useEffect(() => {
    if (!repairMode || !holeAnalysis) return
    if (meshes[holeAnalysis.meshIndex]?.geometry !== holeAnalysis.geometry) return
    const sceneMesh = meshesRef.current[holeAnalysis.meshIndex]
    const normalization = sceneMesh?.userData.normalization
    if (!normalization) return

    const { center, scale } = normalization
    const positions = holeAnalysis.mesh.positions
    const toScene = (x, y, z) => new THREE.Vector3((x - center.x) * scale, (y - center.y) * scale, (z - center.z) * scale)
    const canvas = rendererRef.current?.domElement
    const resolution = new THREE.Vector2(canvas?.clientWidth || 1, canvas?.clientHeight || 1)
    const group = new THREE.Group()
    const markers = []

    holeAnalysis.holes.forEach((hole) => {
      const color = hole.id === selectedHoleId ? HOLE_COLORS.selected : hole.isOuterBorder ? HOLE_COLORS.outer : HOLE_COLORS.hole

      // bordo del foro: linea spessa, visibile anche attraverso la mesh
      const points = []
      for (const v of [...hole.loop, hole.loop[0]]) {
        points.push((positions[v * 3] - center.x) * scale, (positions[v * 3 + 1] - center.y) * scale, (positions[v * 3 + 2] - center.z) * scale)
      }
      const lineGeometry = new LineGeometry()
      lineGeometry.setPositions(points)
      const outline = new Line2(
        lineGeometry,
        new LineMaterial({ color, linewidth: hole.id === selectedHoleId ? 5 : 3.5, resolution, depthTest: false, transparent: true, toneMapped: false })
      )
      outline.renderOrder = 10
      outline.raycast = () => {} // solo visivo: non deve intercettare i clic sulla mesh
      group.add(outline)

      // etichetta con lo stesso numero del tasto "Chiudi" nel pannello
      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: createHoleLabelTexture(holeAnalysis.labels.get(hole.id), color),
          depthTest: false,
          transparent: true,
          sizeAttenuation: false, // dimensione costante sullo schermo
          toneMapped: false,
        })
      )
      label.scale.set(0.055, 0.055, 1)
      label.position.copy(toScene(...hole.centroid))
      label.renderOrder = 11
      label.userData.holeId = hole.id
      group.add(label)
      markers.push(label)
    })

    sceneMesh.add(group)
    holeMarkersRef.current = markers
    return () => {
      holeMarkersRef.current = []
      group.removeFromParent()
      group.traverse((object) => {
        if (!object.isSprite) object.geometry?.dispose() // la geometria degli sprite è condivisa da three.js
        object.material?.map?.dispose()
        object.material?.dispose()
      })
    }
  }, [repairMode, holeAnalysis, selectedHoleId, meshes])

  const fillHolesByIds = (holeIds) => {
    if (!holeAnalysis || repairBusy || holeIds.length === 0) return
    const meshIndex = holeAnalysis.meshIndex
    const target = meshes[meshIndex]
    if (!target || target.geometry !== holeAnalysis.geometry) return

    setRepairBusy(true)
    setRepairMessage('⏳ Chiusura dei fori in corso...')
    // calcolo in background: con fori grandi può durare a lungo e la pagina deve restare utilizzabile
    fillHolesAsync(target.geometry, holeIds, fillMode, (done, total) => {
      if (total > 1) setRepairMessage(`⏳ Chiusura dei fori in corso... ${done}/${total}`)
    }).then(
      (result) => {
        if (meshesStateRef.current[meshIndex]?.geometry !== target.geometry) {
          setRepairMessage('⚠️ La mesh è cambiata durante il calcolo: chiusura non applicata.')
          setRepairBusy(false)
          return
        }
        // i fori rimasti mantengono il loro numero sulla mesh riparata
        const numbering = holeNumberingRef.current.get(target.geometry)
        if (numbering) holeNumberingRef.current.set(result.geometry, numbering)
        pushHistory(`Ripara mesh: ${result.filledCount === 1 ? '1 foro chiuso' : `${result.filledCount} fori chiusi`}`, { meshIndex, previous: target.geometry, repaired: result.geometry })
        setMeshes((prev) => prev.map((m, i) => (i === meshIndex ? { ...m, geometry: result.geometry } : m)))
        setSelectedHoleId(null)
        setRepairMessage(
          `✅ ${result.filledCount === 1 ? '1 foro chiuso' : `${result.filledCount} fori chiusi`} (${result.addedTriangles} triangoli aggiunti).`
        )
      },
      (err) => {
        console.error('Chiusura fori non riuscita:', err)
        setRepairMessage(`❌ Chiusura non riuscita: ${err.message}`)
        setRepairBusy(false)
      }
    )
  }
  fillHoleByIdRef.current = (holeId) => fillHolesByIds([holeId])

  const fillAllHoles = () => {
    if (!holeAnalysis) return
    const ids = holeAnalysis.holes.filter((hole) => !(excludeOuterBorder && hole.isOuterBorder)).map((hole) => hole.id)
    fillHolesByIds(ids)
  }

  const undoLastRepair = () => {
    const last = popHistory()
    if (!last) return
    setMeshes((prev) => prev.map((m, i) => (i === last.meshIndex && m.geometry === last.repaired ? { ...m, geometry: last.previous } : m)))
    setSelectedHoleId(null)
    setRepairMessage('↶ Ultima chiusura annullata.')
  }

  const downloadRepairedMesh = () => {
    const target = meshes[selectedMeshIndex]
    if (!target) return
    const blob = new Blob([geometryToBinarySTL(target.geometry)], { type: 'model/stl' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${target.name || 'mesh'}_riparata.stl`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // Ricostruisci mesh: chiude in automatico tutti i fori con chiusura minima,
  // tranne il più grande (bordo della scansione), che resta aperto.
  const rebuildMesh = () => {
    const meshIndex = selectedMeshIndex
    const target = commitPendingEdits()[meshIndex]
    if (!target || isRebuilding || repairBusy) return

    setIsRebuilding(true)
    setMessage('⏳ Ricostruzione della mesh in corso...')
    setTimeout(() => {
      try {
        const analysis = analyzeHoles(target.geometry)
        const [largest, ...others] = analysis.holes // ordinati dal perimetro maggiore
        if (others.length === 0) {
          setMessage(
            largest
              ? '✅ Nessun foro da chiudere: resta aperto solo il foro più grande.'
              : '✅ Nessun foro trovato: la mesh è già chiusa.'
          )
          return
        }
        const result = fillHoles(analysis, others.map((hole) => hole.id), 'minimal')
        const numbering = holeNumberingRef.current.get(target.geometry)
        if (numbering) holeNumberingRef.current.set(result.geometry, numbering)
        pushHistory('Ricostruisci Mesh', { meshIndex, previous: target.geometry, repaired: result.geometry })
        setMeshes((prev) => prev.map((m, i) => (i === meshIndex ? { ...m, geometry: result.geometry } : m)))
        setSelectedHoleId(null)
        setMessage(
          `✅ Mesh ricostruita: ${others.length === 1 ? '1 foro chiuso' : `${others.length} fori chiusi`} con chiusura minima. ` +
            `Lasciato aperto il foro più grande (${largest.edgeCount} lati).`
        )
      } catch (err) {
        console.error('Ricostruzione mesh non riuscita:', err)
        setMessage(`❌ Ricostruzione non riuscita: ${err.message}`)
      } finally {
        setIsRebuilding(false)
        setTimeout(() => setMessage(''), 6000)
      }
    }, 30)
  }

  const ensureServerOnline = async () => {
    if (await checkServerHealth(selectedServer.url)) return true
    const startServer = window.electron?.startMeshServer1
    if (selectedServerId === 'server1' && typeof startServer === 'function') {
      const result = await startServer()
      if (result?.success) return checkServerHealth(selectedServer.url)
    }
    return false
  }

  const serverOperationBusy = isRemeshing || isSimplifying

  // Invia la mesh selezionata al server MeshLib, sostituisce la geometria con il risultato
  // e apre il confronto prima/dopo. Usata da Remesh Isotropic e Semplifica Mesh.
  const runServerMeshOperation = async ({ endpoint, fields = {}, title, setBusy, busyText, doneText }) => {
    const meshIndex = selectedMeshIndex
    const target = commitPendingEdits()[meshIndex]
    if (!target || serverOperationBusy || isRebuilding || repairBusy) return false

    setRepairMode(false)
    setBusy(true)
    setMessage(`⏳ ${busyText}`)
    try {
      if (!(await ensureServerOnline())) {
        throw new Error(`${selectedServer.name} non è raggiungibile: avvia il server Python.`)
      }
      setServerOnline(true)

      const formData = new FormData()
      const stl = new Blob([geometryToBinarySTL(target.geometry)], { type: 'application/octet-stream' })
      formData.append('file', stl, `${target.name || 'mesh'}.stl`)
      Object.entries(fields).forEach(([key, value]) => formData.append(key, String(value)))
      const outdatedServer = 'il server in esecuzione non ha ancora questa funzione: chiudi e riavvia il server Python.'
      let response
      try {
        response = await fetch(apiUrl(selectedServer.url, endpoint), { method: 'POST', body: formData })
      } catch {
        // il browser non riceve la risposta: server andato in errore senza intestazioni CORS
        // (tipico di una versione vecchia del server ancora in esecuzione) oppure connessione interrotta
        throw new Error(
          `connessione con ${selectedServer.name} interrotta. Se hai aggiornato i file del server, chiudilo e riavvialo; ` +
            'altrimenti controlla la finestra del server per eventuali errori.'
        )
      }
      if (response.status === 404) throw new Error(outdatedServer)
      if (!response.ok) {
        let detail = response.statusText
        try {
          detail = (await response.json()).detail || detail
        } catch {
          // risposta non JSON
        }
        throw new Error(detail)
      }

      const statsHeader = response.headers.get('X-Mesh-Stats')
      if (!statsHeader) throw new Error(outdatedServer)
      const stats = JSON.parse(statsHeader)
      const result = loadPLY(await response.arrayBuffer())
      pushHistory(title, { meshIndex, previous: target.geometry, repaired: result })
      setMeshes((prev) => prev.map((m, i) => (i === meshIndex ? { ...m, geometry: result } : m)))
      setRemeshCompare({
        title,
        meshIndex,
        name: target.name,
        before: target.geometry,
        after: result,
        stats,
        histograms: buildEdgeHistograms(target.geometry, result),
      })
      setRemeshView('after')
      setShowWireframe(true)
      setMessage(`✅ ${doneText(stats)}`)
      return true
    } catch (err) {
      console.error(`${title} non riuscito:`, err)
      setMessage(`❌ ${title} non riuscito: ${err.message}`)
      return false
    } finally {
      setBusy(false)
      setTimeout(() => setMessage(''), 6000)
    }
  }

  // Remesh isotropico (server MeshLib): pulizia della geometria e densità uniforme dei triangoli
  const remeshIsotropic = () => {
    setShowSimplifyPanel(false)
    setShowIsolatedPanel(false)
    setShowOffsetPanel(false)
    setShowMirrorPanel(false)
    setCutTool(null)
    setBorderTool(null)
    return runServerMeshOperation({
      endpoint: '/remesh-isotropic',
      title: 'Remesh isotropico',
      setBusy: setIsRemeshing,
      busyText: 'Remesh isotropico in corso...',
      doneText: () => 'Remesh isotropico completato.',
    })
  }

  // Semplifica mesh (server MeshLib): riduzione percentuale del numero di triangoli
  const simplifyMesh = async () => {
    const done = await runServerMeshOperation({
      endpoint: '/simplify',
      fields: { reduction_percent: reductionPercent },
      title: 'Semplificazione',
      setBusy: setIsSimplifying,
      busyText: `Semplificazione del ${reductionPercent}% in corso...`,
      doneText: (stats) =>
        `Mesh semplificata: ${stats.before.triangles.toLocaleString('it-IT')} → ${stats.after.triangles.toLocaleString('it-IT')} triangoli (−${stats.achievedPercent.toFixed(1)}%).`,
    })
    if (done) setShowSimplifyPanel(false)
  }

  const toggleSimplifyPanel = () => {
    if (showSimplifyPanel) {
      setShowSimplifyPanel(false)
      return
    }
    if (meshes.length === 0) return
    commitPendingEdits()
    setRepairMode(false)
    setRemeshCompare(null)
    if (alignmentMode !== 'none') {
      setAlignmentMode('none')
      resetPointPairs()
    }
    setManualMoveMode(false)
    setShowIsolatedPanel(false)
    setShowOffsetPanel(false)
    setShowMirrorPanel(false)
    setCutTool(null)
    setBorderTool(null)
    setShowSimplifyPanel(true)
  }

  const toggleIsolatedPanel = () => {
    if (showIsolatedPanel) {
      setShowIsolatedPanel(false)
      return
    }
    if (meshes.length === 0) return
    commitPendingEdits()
    setRepairMode(false)
    setShowSimplifyPanel(false)
    setRemeshCompare(null)
    if (alignmentMode !== 'none') {
      setAlignmentMode('none')
      resetPointPairs()
    }
    setManualMoveMode(false)
    setShowOffsetPanel(false)
    setShowMirrorPanel(false)
    setCutTool(null)
    setBorderTool(null)
    setShowIsolatedPanel(true)
  }

  const removeIsolatedComponents = () => {
    const analysis = isolatedAnalysis
    if (!analysis || isolatedBusy || isolatedSelection.length === 0) return
    const meshIndex = analysis.meshIndex
    const target = meshes[meshIndex]
    if (!target || target.geometry !== analysis.geometry) return

    setIsolatedBusy(true)
    setTimeout(() => {
      try {
        const result = removeComponents(analysis, isolatedSelection)
        pushHistory(`Rimuovi componenti isolati (${result.removedComponents})`, { meshIndex, previous: target.geometry, repaired: result.geometry })
        setMeshes((prev) => prev.map((m, i) => (i === meshIndex ? { ...m, geometry: result.geometry } : m)))
        setMessage(
          `✅ ${result.removedComponents === 1 ? '1 componente rimosso' : `${result.removedComponents} componenti rimossi`} ` +
            `(${result.removedTriangles.toLocaleString('it-IT')} triangoli).`
        )
      } catch (err) {
        console.error('Rimozione componenti non riuscita:', err)
        setMessage(`❌ Rimozione non riuscita: ${err.message}`)
        setIsolatedBusy(false)
      } finally {
        setTimeout(() => setMessage(''), 6000)
      }
    }, 30)
  }

  const lastEditUndoable = () => {
    const last = repairUndoRef.current[repairUndoRef.current.length - 1]
    return !!last && meshes[last.meshIndex]?.geometry === last.repaired
  }

  const undoLastEdit = () => {
    if (!lastEditUndoable()) return
    const last = popHistory()
    setMeshes((prev) => prev.map((m, i) => (i === last.meshIndex && m.geometry === last.repaired ? { ...m, geometry: last.previous } : m)))
  }

  // Memorizza le modifiche ancora in anteprima (offset non confermato, piano di
  // specchiatura spostato) prima di passare a un altro strumento. Restituisce
  // l'elenco aggiornato, da usare subito dagli strumenti che lavorano al clic.
  const commitPendingEdits = () => {
    let next = meshes
    const replace = (index, geometry, label) => {
      pushHistory(label, { meshIndex: index, previous: next[index].geometry, repaired: geometry })
      next = next.map((m, i) => (i === index ? { ...m, geometry } : m))
    }
    try {
      if (pendingOffset) {
        const mode = offsetModeFor(brushSceneRef.current?.sceneMesh, offsetFromView)
        replace(pendingOffset.meshIndex, buildOffsetGeometry(brushData, offsetDistance, mode), `Offset con pennello (${offsetDistance.toLocaleString('it-IT')} mm)`)
        setOffsetDistance(0)
      }
      if (pendingMirror) {
        const plane = mirrorPlaneRef.current
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion)
        replace(pendingMirror.meshIndex, mirrorGeometry(next[pendingMirror.meshIndex].geometry, plane.point, normal), 'Specchia')
        mirrorTouchedRef.current = false
      }
    } catch (err) {
      console.error('Memorizzazione della modifica non riuscita:', err)
      setMessage(`❌ Memorizzazione della modifica non riuscita: ${err.message}`)
    }
    if (next !== meshes) setMeshes(next)
    return next
  }

  const toggleOffsetPanel = () => {
    if (showOffsetPanel) {
      commitPendingEdits()
      setShowOffsetPanel(false)
      setOffsetDistance(0)
      return
    }
    if (meshes.length === 0) return
    commitPendingEdits()
    setRepairMode(false)
    setShowSimplifyPanel(false)
    setShowIsolatedPanel(false)
    setRemeshCompare(null)
    if (alignmentMode !== 'none') {
      setAlignmentMode('none')
      resetPointPairs()
    }
    setManualMoveMode(false)
    setOffsetDistance(0)
    setShowMirrorPanel(false)
    setCutTool(null)
    setBorderTool(null)
    setShowOffsetPanel(true)
  }

  // Applica / Ignora modifiche: ogni strumento lavora sulla mesh già modificata dagli
  // strumenti precedenti; qui la mesh finale viene salvata e riportata nel visualizzatore.
  const openApplyDialog = () => {
    if (meshes.length === 0) return
    const baseName = (meshes[selectedMeshIndex]?.name || 'mesh').replace(/\.(stl|obj|ply)$/i, '').replace(/\s+/g, '_')
    setApplyFileName(`${baseName}_modificata`)
    setApplyTarget('selected')
    setShowApplyDialog(true)
  }

  const applyGeometryAvailable =
    applyTarget === 'merged' ? meshes.some((m) => m.visible) : !!meshes[selectedMeshIndex]

  // Modifiche visibili nella vista ma non ancora confermate con il tasto dello strumento
  const pendingOffset =
    showOffsetPanel &&
    !offsetSeparate &&
    !!brushData &&
    meshes[brushData.meshIndex]?.geometry === brushData.geometry &&
    offsetDistance !== 0 &&
    offsetSelectedCount > 0
      ? { meshIndex: brushData.meshIndex }
      : null
  const pendingMirror =
    showMirrorPanel &&
    !mirrorKeepOriginal &&
    mirrorTouchedRef.current &&
    mirrorPlaneRef.current &&
    meshes[mirrorPlaneRef.current.meshIndex]
      ? { meshIndex: mirrorPlaneRef.current.meshIndex }
      : null

  // geometria della mesh con le eventuali modifiche in anteprima
  const finalGeometryOf = (index) => {
    let result = meshes[index].geometry
    if (pendingOffset?.meshIndex === index) {
      result = buildOffsetGeometry(brushData, offsetDistance, offsetModeFor(brushSceneRef.current?.sceneMesh, offsetFromView))
    }
    if (pendingMirror?.meshIndex === index) {
      const plane = mirrorPlaneRef.current
      result = mirrorGeometry(result, plane.point, new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion))
    }
    return result
  }

  const confirmApply = async (save) => {
    if (!applyGeometryAvailable || applyBusy) return
    setApplyBusy(true)
    try {
      const geometry =
        applyTarget === 'merged' && meshes.length > 1
          ? mergeGeometries(meshes.map((m, i) => (m.visible ? finalGeometryOf(i) : null)).filter(Boolean))
          : finalGeometryOf(selectedMeshIndex)
      if (save) {
        const saved = await saveMeshFile(geometry, applyFileName, applyFormat)
        if (!saved) return // salvataggio annullato dall'utente
      }
      setShowApplyDialog(false)
      if (onApply) onApply(geometry)
      else onClose?.()
    } catch (err) {
      console.error('Salvataggio mesh non riuscito:', err)
      setMessage(`❌ Salvataggio non riuscito: ${err.message}`)
      setTimeout(() => setMessage(''), 6000)
    } finally {
      setApplyBusy(false)
    }
  }

  // Ignora modifiche: annulla tutte le modifiche e torna alla mesh com'era all'apertura del modificatore
  const discardChanges = () => {
    const changed =
      meshes.length !== 1 || meshes[0]?.geometry !== geometry || editHistory.length > 0 || !!pendingOffset || !!pendingMirror
    if (!changed) {
      setMessage('ℹ️ Nessuna modifica da annullare: la mesh è già quella originale.')
      setTimeout(() => setMessage(''), 4000)
      return
    }
    if (!window.confirm('Annullare tutte le modifiche e tornare alla mesh originale?')) return

    setRepairMode(false)
    setSelectedHoleId(null)
    setRepairMessage('')
    setShowSimplifyPanel(false)
    setShowIsolatedPanel(false)
    setShowOffsetPanel(false)
    setShowMirrorPanel(false)
    setCutTool(null)
    setBorderTool(null)
    setRemeshCompare(null)
    setManualMoveMode(false)
    setOffsetDistance(0)
    setBrushData(null)
    brushDataRef.current = null
    mirrorPlaneRef.current = null
    mirrorTouchedRef.current = false
    repairUndoRef.current = []
    setEditHistory([])
    setSelectedMeshIndex(0)
    setMeshes(geometry ? [{ geometry, name: 'Mesh iniziale', visible: true }] : [])
    setMessage('↶ Tutte le modifiche sono state annullate: mesh originale ripristinata.')
    setTimeout(() => setMessage(''), 6000)
  }

  const toggleMirrorPanel = () => {
    if (showMirrorPanel) {
      commitPendingEdits()
      setShowMirrorPanel(false)
      return
    }
    commitPendingEdits()
    mirrorTouchedRef.current = false
    if (meshes.length === 0) return
    setRepairMode(false)
    setShowSimplifyPanel(false)
    setShowIsolatedPanel(false)
    setShowOffsetPanel(false)
    setRemeshCompare(null)
    if (alignmentMode !== 'none') {
      setAlignmentMode('none')
      resetPointPairs()
    }
    setManualMoveMode(false)
    setCutTool(null)
    setBorderTool(null)
    setShowMirrorPanel(true)
  }

  const resetMirrorPlane = () => {
    mirrorPlaneRef.current = null
    mirrorTouchedRef.current = false
    setMirrorResetToken((token) => token + 1)
  }

  const applyMirror = () => {
    const plane = mirrorPlaneRef.current
    const target = plane ? meshes[plane.meshIndex] : null
    if (!target) return
    const meshIndex = plane.meshIndex
    try {
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion)
      const geometry = mirrorGeometry(target.geometry, plane.point, normal)
      if (mirrorKeepOriginal) {
        setMeshes((prev) => [...prev, { geometry, name: `${target.name || 'Mesh'} - specchiata`, visible: true }])
        setMessage('✅ Copia specchiata aggiunta come nuova mesh.')
      } else {
        pushHistory('Specchia', { meshIndex, previous: target.geometry, repaired: geometry })
        setMeshes((prev) => prev.map((m, i) => (i === meshIndex ? { ...m, geometry } : m)))
        setMessage('✅ Mesh specchiata.')
        mirrorTouchedRef.current = false
      }
    } catch (err) {
      console.error('Specchiatura non riuscita:', err)
      setMessage(`❌ Specchiatura non riuscita: ${err.message}`)
    } finally {
      setTimeout(() => setMessage(''), 6000)
    }
  }

  // Raggio del mouse nelle coordinate della scena
  const raycasterFromEvent = (event) => {
    const canvas = rendererRef.current?.domElement
    if (!canvas || !cameraRef.current) return null
    const rect = canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    )
    raycasterRef.current.setFromCamera(ndc, cameraRef.current)
    return raycasterRef.current
  }

  // Parametro del punto dell'asse (origin + s·dir) più vicino al raggio
  const closestAxisParam = (ray, origin, dir) => {
    const w0 = origin.clone().sub(ray.origin)
    const b = dir.dot(ray.direction)
    const denom = 1 - b * b
    if (denom < 1e-6) return null
    return (b * ray.direction.dot(w0) - dir.dot(w0)) / denom
  }

  // Specchia: trascinamento dei cursori (calcoli nelle coordinate locali della mesh)
  mirrorHandlersRef.current = {
    down: (event) => {
      const mirrorScene = mirrorSceneRef.current
      const raycaster = mirrorScene && raycasterFromEvent(event)
      if (!raycaster) return false
      const hit = raycaster.intersectObjects(mirrorScene.gizmo.pickables, false)[0]
      if (!hit) return false
      const { group } = mirrorScene.gizmo
      const ray = raycaster.ray.clone().applyMatrix4(mirrorScene.sceneMesh.matrixWorld.clone().invert())
      const handle = hit.object.userData.handle
      const drag = { handle, point0: group.position.clone(), quat0: group.quaternion.clone() }
      if (handle === 'axis') {
        drag.axis = new THREE.Vector3(0, 0, 1).applyQuaternion(drag.quat0)
        drag.s0 = closestAxisParam(ray, drag.point0, drag.axis)
        if (drag.s0 === null) return false
      } else {
        const planeNormal =
          handle === 'center'
            ? ray.direction.clone().negate()
            : new THREE.Vector3(handle === 'rotX' ? 1 : 0, handle === 'rotY' ? 1 : 0, 0).applyQuaternion(drag.quat0)
        drag.axis = planeNormal
        drag.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, drag.point0)
        drag.hit0 = ray.intersectPlane(drag.plane, new THREE.Vector3())
        if (!drag.hit0) return false
      }
      mirrorScene.drag = drag
      rendererRef.current.domElement.style.cursor = 'grabbing'
      return true
    },
    move: (event) => {
      const mirrorScene = mirrorSceneRef.current
      const raycaster = mirrorScene && raycasterFromEvent(event)
      if (!raycaster) return
      const canvas = rendererRef.current.domElement
      const drag = mirrorScene.drag
      if (!drag) {
        if (!isDraggingRef.current) {
          canvas.style.cursor = raycaster.intersectObjects(mirrorScene.gizmo.pickables, false).length > 0 ? 'grab' : ''
        }
        return
      }
      const { group } = mirrorScene.gizmo
      const ray = raycaster.ray.clone().applyMatrix4(mirrorScene.sceneMesh.matrixWorld.clone().invert())
      if (drag.handle === 'axis') {
        const s = closestAxisParam(ray, drag.point0, drag.axis)
        if (s === null) return
        group.position.copy(drag.point0).addScaledVector(drag.axis, s - drag.s0)
      } else {
        const hit = ray.intersectPlane(drag.plane, new THREE.Vector3())
        if (!hit) return
        if (drag.handle === 'center') {
          group.position.copy(drag.point0).add(hit.sub(drag.hit0))
        } else {
          const v0 = drag.hit0.clone().sub(drag.point0)
          const v1 = hit.sub(drag.point0)
          const angle = Math.atan2(v0.clone().cross(v1).dot(drag.axis), v0.dot(v1))
          group.quaternion.setFromAxisAngle(drag.axis, angle).multiply(drag.quat0)
        }
      }
      mirrorScene.updatePreview()
    },
    up: () => {
      const mirrorScene = mirrorSceneRef.current
      if (!mirrorScene) return
      if (mirrorScene.drag) mirrorTouchedRef.current = true
      mirrorScene.drag = null
      mirrorScene.savePlane()
      rendererRef.current.domElement.style.cursor = ''
    },
  }

  // Pennello: punto della mesh sotto il mouse
  const pickBrushHit = (event) => {
    const brushScene = brushSceneRef.current
    const canvas = rendererRef.current?.domElement
    if (!brushScene || !canvas || !cameraRef.current) return null
    const rect = canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    )
    const raycaster = raycasterRef.current
    raycaster.setFromCamera(ndc, cameraRef.current)
    return raycaster.intersectObject(brushScene.sceneMesh, false)[0] || null
  }

  const updateBrushCursor = (hit, erase) => {
    const brushScene = brushSceneRef.current
    if (!brushScene) return
    const { ring, sceneMesh, scale } = brushScene
    ring.visible = !!hit
    if (!hit) return
    const normal = hit.face ? hit.face.normal.clone().transformDirection(sceneMesh.matrixWorld) : new THREE.Vector3(0, 0, 1)
    const radius = (brushDiameter / 2) * scale
    ring.scale.set(radius, radius, radius)
    ring.position.copy(hit.point)
    ring.lookAt(hit.point.clone().add(normal))
    ring.material.color.setHex(erase ? 0x38bdf8 : 0xfacc15)
  }

  const paintAtHit = (hit, erase) => {
    const brushScene = brushSceneRef.current
    if (!brushScene || !brushData) return
    const { sceneMesh, center, scale, update } = brushScene
    const local = sceneMesh.worldToLocal(hit.point.clone())
    const point = [local.x / scale + center.x, local.y / scale + center.y, local.z / scale + center.z]
    if (paintSphere(brushData, point, brushDiameter / 2, erase)) {
      update({ positions: offsetParamsRef.current.distance !== 0, selection: true })
    }
  }

  // Shift tenuto premuto: cancella invece di colorare
  // Taglia con Lazo: disegno sullo schermo con il tasto sinistro
  const canvasPoint = (event) => {
    const rect = rendererRef.current.domElement.getBoundingClientRect()
    return [event.clientX - rect.left, event.clientY - rect.top]
  }

  const drawHandlers = {
    down: (event) => {
      const point = canvasPoint(event)
      updateBrushCursor(null, false)
      cutDrawRef.current = { type: cutTool, points: [point, point], erase: event.shiftKey }
      setCutDraw(cutDrawRef.current)
      return true
    },
    move: (event) => {
      const draw = cutDrawRef.current
      if (!draw || !brushStateRef.current.painting) return
      const point = canvasPoint(event)
      if (draw.type === 'Lazo') {
        const last = draw.points[draw.points.length - 1]
        if (Math.hypot(point[0] - last[0], point[1] - last[1]) < 3) return
        cutDrawRef.current = { ...draw, points: [...draw.points, point] }
      }
      setCutDraw(cutDrawRef.current)
    },
    up: () => {
      const draw = cutDrawRef.current
      if (!draw) return
      if (draw.points.length >= 3) selectVerticesOnScreen((x, y) => pointInPolygon(x, y, draw.points), draw.erase)
      cutDrawRef.current = null
      setCutDraw(null)
    },
    leave: () => {},
  }

  // Taglia con Area: raggio del mouse nelle coordinate originali della mesh
  const meshRay = (event) => {
    const matrices = meshToClipMatrix()
    const canvas = rendererRef.current?.domElement
    const camera = cameraRef.current
    if (!matrices || !canvas || !camera) return null
    const rect = canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, camera)
    const toMesh = matrices.toWorld.clone().invert()
    return {
      origin: raycaster.ray.origin.clone().applyMatrix4(toMesh),
      direction: raycaster.ray.direction.clone().transformDirection(toMesh),
      toMesh,
    }
  }

  // Piano dell'area: perpendicolare alla vista attuale e passante per il centro della mesh.
  // Il taglio proietta il poligono in profondità da questa posizione della telecamera.
  const newAreaFrame = (ray) => {
    const camera = cameraRef.current
    const brushScene = brushSceneRef.current
    const dir = camera.getWorldDirection(new THREE.Vector3()).transformDirection(ray.toMesh)
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).transformDirection(ray.toMesh)
    const u = new THREE.Vector3().crossVectors(dir, up).normalize()
    const v = new THREE.Vector3().crossVectors(u, dir).normalize()
    const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld).applyMatrix4(ray.toMesh)
    return {
      meshIndex: brushData.meshIndex,
      eye: eye.toArray(),
      dir: dir.toArray(),
      origin: [brushScene.center.x, brushScene.center.y, brushScene.center.z],
      u: u.toArray(),
      v: v.toArray(),
      points: [],
    }
  }

  const areaPointOnPlane = (area, ray) => {
    const normal = new THREE.Vector3(...area.dir)
    const denominator = ray.direction.dot(normal)
    if (Math.abs(denominator) < 1e-6) return null
    const origin = new THREE.Vector3(...area.origin)
    const t = origin.clone().sub(ray.origin).dot(normal) / denominator
    if (t <= 0) return null
    const q = ray.origin.clone().addScaledVector(ray.direction, t).sub(origin)
    return [q.dot(new THREE.Vector3(...area.u)), q.dot(new THREE.Vector3(...area.v))]
  }

  // Posizione sullo schermo dei punti dell'area (null se dietro la telecamera)
  const screenPoints = (points) => {
    const matrices = meshToClipMatrix()
    const canvas = rendererRef.current?.domElement
    if (!matrices || !canvas) return []
    return points.map((point) => {
      const clip = new THREE.Vector4(...point, 1).applyMatrix4(matrices.toClip)
      if (clip.w <= 0) return null
      return [((clip.x / clip.w + 1) / 2) * canvas.clientWidth, ((1 - clip.y / clip.w) / 2) * canvas.clientHeight]
    })
  }

  // indice del punto vicino (entro 8 pixel) alla posizione del mouse, -1 se nessuno
  const pointUnderMouse = (event, positions) => {
    const [x, y] = canvasPoint(event)
    return screenPoints(positions).findIndex((p) => p && Math.hypot(p[0] - x, p[1] - y) <= 8)
  }

  const setAreaCutNow = (area) => {
    areaCutRef.current = area
    setAreaCut(area)
  }

  const areaHandlers = {
    down: (event) => {
      if (!brushData || cutBusy) return false
      const ray = meshRay(event)
      if (!ray) return false
      let area = currentArea()
      if (area) {
        // clic vicino a un punto esistente: lo si trascina
        const index = pointUnderMouse(event, area.points.map((point) => areaPoint(area, point)))
        if (index !== -1) {
          areaDragRef.current = index
          return true
        }
      } else {
        area = newAreaFrame(ray)
      }
      const point = areaPointOnPlane(area, ray)
      if (!point) return true
      const next = { ...area, points: [...area.points, point] }
      areaDragRef.current = next.points.length - 1
      setAreaCutNow(next)
      return true
    },
    move: (event) => {
      const index = areaDragRef.current
      const area = currentArea()
      if (index === null || !area || !brushStateRef.current.painting) return
      const ray = meshRay(event)
      const point = ray && areaPointOnPlane(area, ray)
      if (!point) return
      setAreaCutNow({ ...area, points: area.points.map((p, i) => (i === index ? point : p)) })
    },
    up: () => {
      areaDragRef.current = null
    },
    leave: () => {},
  }

  // Taglia con Linea: punti agganciati ai vertici della mesh
  const currentCurve = () => {
    const curve = curveCutRef.current
    return curve && brushData && curve.meshIndex === brushData.meshIndex ? curve : null
  }

  const vertexPosition = (v) => {
    const P = brushData.mesh.positions
    return [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]
  }

  // vertice del triangolo sotto il mouse più vicino al punto colpito
  const pickCurveVertex = (event) => {
    const hit = pickBrushHit(event)
    const brushScene = brushSceneRef.current
    if (!hit?.face || !brushScene) return null
    const { sceneMesh, center, scale } = brushScene
    const local = sceneMesh.worldToLocal(hit.point.clone())
    const point = [local.x / scale + center.x, local.y / scale + center.y, local.z / scale + center.z]
    let best = null
    let bestDistance = Infinity
    for (const v of [hit.face.a, hit.face.b, hit.face.c]) {
      const [x, y, z] = vertexPosition(v)
      const distance = Math.hypot(x - point[0], y - point[1], z - point[2])
      if (distance < bestDistance) {
        bestDistance = distance
        best = v
      }
    }
    return best
  }

  const setCurveCutNow = (curve) => {
    curveCutRef.current = curve
    setCurveCut(curve)
  }

  const curveHandlers = {
    down: (event) => {
      if (!brushData || cutBusy) return false
      const curve = currentCurve()
      if (curve) {
        // clic vicino a un punto esistente: lo si trascina sulla superficie
        const index = pointUnderMouse(event, curve.points.map(vertexPosition))
        if (index !== -1) {
          // clic sul primo punto con almeno 3 punti: l'utente chiude la linea
          if (index === 0 && !curve.closed && curve.points.length >= 3) setCurveCutNow({ ...curve, closed: true })
          curveDragRef.current = index
          return true
        }
      }
      const vertex = pickCurveVertex(event)
      if (vertex === null) return false // clic sullo sfondo: ruota la vista
      if (curve?.closed) return true // linea già chiusa: si possono solo spostare i punti
      const points = curve ? curve.points : []
      if (points[points.length - 1] !== vertex) {
        setCurveCutNow({ meshIndex: brushData.meshIndex, points: [...points, vertex], closed: false })
      }
      curveDragRef.current = curveCutRef.current.points.length - 1
      return true
    },
    move: (event) => {
      if (curveDragRef.current === null || !brushStateRef.current.painting) return
      const frame = curveFrameRef.current
      frame.event = event
      if (frame.id) return
      frame.id = requestAnimationFrame(() => {
        frame.id = 0
        const index = curveDragRef.current
        const curve = currentCurve()
        if (index === null || !curve) return
        const vertex = pickCurveVertex(frame.event)
        if (vertex === null || vertex === curve.points[index]) return
        setCurveCutNow({ ...curve, points: curve.points.map((v, i) => (i === index ? vertex : v)) })
      })
    },
    up: () => {
      curveDragRef.current = null
    },
    leave: () => {},
  }

  brushHandlersRef.current =
    cutTool === 'Area' ? areaHandlers : cutTool === 'Linea' ? curveHandlers : cutTool && cutTool !== 'Pennello' ? drawHandlers : {
    down: (event) => {
      const hit = pickBrushHit(event)
      if (!hit) return false
      const erase = brushErase || event.shiftKey
      updateBrushCursor(hit, erase)
      paintAtHit(hit, erase)
      return true
    },
    move: (event) => {
      const frame = brushFrameRef.current
      frame.event = event
      if (frame.id) return
      frame.id = requestAnimationFrame(() => {
        frame.id = 0
        const pending = frame.event
        const hit = pickBrushHit(pending)
        const erase = brushErase || pending.shiftKey
        updateBrushCursor(hit, erase)
        if (hit && brushStateRef.current.painting) paintAtHit(hit, erase)
      })
    },
    up: () => {
      if (brushData) setOffsetSelectedCount(countSelected(brushData))
    },
    leave: () => updateBrushCursor(null, false),
  }

  // Cancella / inverti / seleziona tutto
  const changeBrushSelection = (change) => {
    if (!brushData) return
    change(brushData)
    brushSceneRef.current?.update({ positions: offsetDistance !== 0, selection: true })
    setOffsetSelectedCount(countSelected(brushData))
  }

  // Matrice dalle coordinate originali della mesh allo spazio di ritaglio della telecamera
  const meshToClipMatrix = () => {
    const brushScene = brushSceneRef.current
    const camera = cameraRef.current
    if (!brushScene || !camera) return null
    const { sceneMesh, center, scale } = brushScene
    sceneMesh.updateMatrixWorld(true)
    camera.updateMatrixWorld()
    const toLocal = new THREE.Matrix4()
      .makeScale(scale, scale, scale)
      .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z))
    const toWorld = new THREE.Matrix4().multiplyMatrices(sceneMesh.matrixWorld, toLocal)
    return { toWorld, toClip: new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(toWorld) }
  }

  // Seleziona (o con Shift deseleziona) i vertici la cui proiezione sullo schermo soddisfa `test`.
  // La selezione attraversa la mesh: prende anche i vertici nascosti dietro.
  const selectVerticesOnScreen = (test, erase) => {
    const matrices = meshToClipMatrix()
    const canvas = rendererRef.current?.domElement
    if (!matrices || !canvas || !brushData) return
    const e = matrices.toClip.elements
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const P = brushData.mesh.positions
    const { selected } = brushData
    for (let v = 0; v < selected.length; v++) {
      const x = P[v * 3]
      const y = P[v * 3 + 1]
      const z = P[v * 3 + 2]
      const w = e[3] * x + e[7] * y + e[11] * z + e[15]
      if (w <= 0) continue
      const sx = (((e[0] * x + e[4] * y + e[8] * z + e[12]) / w + 1) / 2) * width
      const sy = ((1 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / w) / 2) * height
      if (test(sx, sy)) selected[v] = erase ? 0 : 1
    }
    brushSceneRef.current.update({ positions: false, selection: true })
    setOffsetSelectedCount(countSelected(brushData))
  }

  const pointInPolygon = (x, y, points) => {
    let inside = false
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i]
      const [xj, yj] = points[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }

  const clearCut = () => {
    cutDrawRef.current = null
    setCutDraw(null)
    curveCutRef.current = null
    curveDragRef.current = null
    setCurveCut(null)
    areaCutRef.current = null
    areaDragRef.current = null
    setAreaCut(null)
  }

  // Sostituisce la geometria di una mesh e memorizza il passo nella cronologia
  const replaceMeshGeometry = (meshIndex, previous, geometry, label) => {
    pushHistory(label, { meshIndex, previous, repaired: geometry })
    setMeshes((prev) => prev.map((m, i) => (i === meshIndex ? { ...m, geometry } : m)))
  }

  const showTimedMessage = (text) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 6000)
  }

  const applyCut = () => {
    if (!brushData || offsetSelectedCount === 0) return
    const meshIndex = brushData.meshIndex
    const target = meshes[meshIndex]
    if (!target || target.geometry !== brushData.geometry) return
    try {
      const result = deleteSelectedTriangles(brushData)
      replaceMeshGeometry(meshIndex, target.geometry, result.geometry, `Taglia con ${cutTool}`)
      clearCut()
      showTimedMessage(`✅ Taglio eseguito: ${result.removedTriangles.toLocaleString('it-IT')} triangoli eliminati.`)
    } catch (err) {
      console.error('Taglio non riuscito:', err)
      showTimedMessage(`❌ Taglio non riuscito: ${err.message}`)
    }
  }

  // Taglia con Area: elimina la parte dentro il poligono (o fuori, se invertito), in
  // profondità o solo per la profondità di fresatura; la parte tagliata può diventare una nuova mesh
  const applyAreaCut = () => {
    const area = currentArea()
    if (!brushData || !area || area.points.length < 3 || cutBusy) return
    const meshIndex = brushData.meshIndex
    const target = meshes[meshIndex]
    if (!target || target.geometry !== brushData.geometry) return
    const options = { invert: areaInvert, depth: areaMaterialCut ? areaDepth : null, keepRemoved: areaSaveParts }
    const geometryArea = areaGeometry(area)
    runCut('Taglia con Area', () => cutByArea(brushData.mesh, geometryArea, options))
  }

  // Taglia con Linea: elimina la zona chiusa dal contorno (o l'altra, se invertito);
  // con "Chiudi Foro" il foro lasciato dal taglio viene chiuso
  const applyCurveCut = () => {
    const loop = curvePaths?.loop
    if (!brushData || !loop || cutBusy) return
    const options = {
      invert: curveInvert,
      keepRemoved: curveSaveParts,
      smoothing: curveSmooth ? { strength: curveSmoothStrength, distance: curveSmoothDistance, normals: brushData.normals } : null,
    }
    const closeHole = curveCloseHole
    runCut('Taglia con Linea', async () => {
      const result = cutByCurve(brushData.mesh, loop, options)
      if (!closeHole) return result
      // foro del taglio: il bordo con il baricentro più vicino a quello del contorno
      const { holes } = analyzeHoles(result.geometry)
      const distance = (hole) => Math.hypot(...hole.centroid.map((value, k) => value - result.borderCentroid[k]))
      const hole = holes.reduce((best, h) => (!best || distance(h) < distance(best) ? h : best), null)
      if (!hole) return result
      setMessage('⏳ Chiusura del foro in corso...')
      const filled = await fillHolesAsync(result.geometry, [hole.id], 'smooth')
      return { ...result, geometry: filled.geometry, holeClosed: true }
    })
  }

  // Esegue un taglio: `compute` restituisce (anche in modo asincrono) la mesh rimasta e,
  // se richiesta, la parte tagliata, che diventa una nuova mesh nella stessa posizione
  const runCut = (label, compute) => {
    const meshIndex = brushData.meshIndex
    const target = meshes[meshIndex]
    if (!target || target.geometry !== brushData.geometry) return
    // riferimento della vista della mesh tagliata: le due parti restano dove erano
    const { center, scale } = brushSceneRef.current
    const displayFrame = { center: center.toArray(), scale }
    setCutBusy(true)
    setMessage('⏳ Taglio in corso...')
    setTimeout(async () => {
      try {
        const result = await compute()
        if (meshesStateRef.current[meshIndex]?.geometry !== target.geometry) {
          showTimedMessage('⚠️ La mesh è cambiata durante il calcolo: taglio annullato.')
          return
        }
        pushHistory(label, { meshIndex, previous: target.geometry, repaired: result.geometry })
        setMeshes((prev) => {
          const next = prev.map((m, i) => (i === meshIndex ? { ...m, geometry: result.geometry, displayFrame } : m))
          if (!result.removedGeometry) return next
          const part = {
            geometry: result.removedGeometry,
            name: `${target.name || 'Mesh'} - parte tagliata`,
            visible: true,
            displayFrame: { ...displayFrame, sourceIndex: meshIndex },
          }
          return [...next, part]
        })
        clearCut()
        const count = result.removedTriangles.toLocaleString('it-IT')
        showTimedMessage(
          (result.removedGeometry
            ? `✅ Taglio eseguito: ${count} triangoli separati nella nuova mesh "${target.name || 'Mesh'} - parte tagliata".`
            : `✅ Taglio eseguito: ${count} triangoli eliminati.`) + (result.holeClosed ? ' Foro chiuso.' : '')
        )
      } catch (err) {
        console.error('Taglio non riuscito:', err)
        showTimedMessage(`❌ Taglio non riuscito: ${err.message}`)
      } finally {
        setCutBusy(false)
      }
    }, 30)
  }

  // Chiude tutti i pannelli degli strumenti (prima memorizza le modifiche in anteprima)
  const closeToolPanels = () => {
    const current = commitPendingEdits()
    setRepairMode(false)
    setSelectedHoleId(null)
    setShowSimplifyPanel(false)
    setShowIsolatedPanel(false)
    setShowOffsetPanel(false)
    setOffsetDistance(0)
    setShowMirrorPanel(false)
    setCutTool(null)
    clearCut()
    setBorderTool(null)
    setRemeshCompare(null)
    if (alignmentMode !== 'none') {
      setAlignmentMode('none')
      resetPointPairs()
    }
    setManualMoveMode(false)
    return current
  }

  const toggleCutTool = (tool) => {
    if (cutTool === tool) {
      setCutTool(null)
      clearCut()
      return
    }
    if (meshes.length === 0) return
    closeToolPanels()
    setCutTool(tool)
  }

  const toggleBorderTool = (tool) => {
    if (borderTool === tool) {
      setBorderTool(null)
      return
    }
    if (meshes.length === 0) return
    closeToolPanels()
    setBorderTool(tool)
  }

  const applyBorderTool = () => {
    const meshIndex = selectedMeshIndex
    const target = meshes[meshIndex]
    if (!target || borderBusy) return
    setBorderBusy(true)
    setMessage(`⏳ ${borderTool} in corso...`)
    setTimeout(() => {
      try {
        let result
        let done
        if (borderTool === 'Raddrizza bordo') {
          result = straightenBorder(target.geometry, { iterations: borderIterations, strength: borderStrength, onlyOuter: borderOnlyOuter })
          done = `✅ Bordo raddrizzato (${result.loopCount === 1 ? '1 bordo' : `${result.loopCount} bordi`}).`
        } else if (borderTool === 'Ricostruisci bordo') {
          result = rebuildBorder(target.geometry, { passes: borderPasses })
          done = `✅ Bordo ricostruito: ${result.removedTriangles.toLocaleString('it-IT')} triangoli irregolari eliminati.`
        } else {
          result = extendBorder(target.geometry, { distance: borderDistance, direction: borderDirection, onlyOuter: borderOnlyOuter })
          done = `✅ Bordo esteso di ${borderDistance.toLocaleString('it-IT')} mm (${result.steps} fasce).`
        }
        const label =
          borderTool === 'Estendi bordo' ? `Estendi bordo (${borderDistance.toLocaleString('it-IT')} mm)` : borderTool
        replaceMeshGeometry(meshIndex, target.geometry, result.geometry, label)
        showTimedMessage(done)
      } catch (err) {
        console.error(`${borderTool} non riuscito:`, err)
        showTimedMessage(`❌ ${borderTool} non riuscito: ${err.message}`)
      } finally {
        setBorderBusy(false)
      }
    }, 30)
  }

  // Inverti Normali: inverte l'orientamento di tutti i triangoli della mesh selezionata
  const invertNormals = () => {
    if (meshes.length === 0) return
    const current = closeToolPanels()
    const meshIndex = selectedMeshIndex
    const target = current[meshIndex]
    if (!target) return
    try {
      replaceMeshGeometry(meshIndex, target.geometry, flipNormals(target.geometry), 'Inverti Normali')
      showTimedMessage('✅ Normali invertite.')
    } catch (err) {
      showTimedMessage(`❌ Inversione non riuscita: ${err.message}`)
    }
  }

  // Riempi buchi: chiude in un colpo tutti i fori (levigati), tranne il bordo esterno della scansione
  // Il calcolo avviene in background: la pagina resta utilizzabile e si vede l'avanzamento.
  // Premendo di nuovo il tasto durante il calcolo lo si interrompe.
  const fillAllHolesQuick = () => {
    if (fillingHoles) {
      cancelHoleFill()
      return
    }
    if (meshes.length === 0 || repairBusy) return
    const current = closeToolPanels()
    const meshIndex = selectedMeshIndex
    const target = current[meshIndex]
    if (!target) return
    let analysis
    try {
      analysis = analyzeHoles(target.geometry)
    } catch (err) {
      showTimedMessage(`❌ Analisi dei buchi non riuscita: ${err.message}`)
      return
    }
    const ids = analysis.holes.filter((hole) => !hole.isOuterBorder).map((hole) => hole.id)
    if (ids.length === 0) {
      showTimedMessage('✅ Nessun buco da chiudere.')
      return
    }
    setFillingHoles({ done: 0, total: ids.length })
    setMessage(`⏳ Chiusura dei buchi in corso... 0/${ids.length}`)
    fillHolesAsync(target.geometry, ids, 'smooth', (done, total) => {
      setFillingHoles({ done, total })
      setMessage(`⏳ Chiusura dei buchi in corso... ${done}/${total}`)
    })
      .then((result) => {
        if (meshesStateRef.current[meshIndex]?.geometry !== target.geometry) {
          showTimedMessage('⚠️ La mesh è cambiata durante il calcolo: buchi non chiusi.')
          return
        }
        replaceMeshGeometry(meshIndex, target.geometry, result.geometry, `Riempi buchi (${result.filledCount})`)
        showTimedMessage(
          `✅ ${result.filledCount === 1 ? '1 buco chiuso' : `${result.filledCount} buchi chiusi`} (${result.addedTriangles.toLocaleString('it-IT')} triangoli aggiunti).`
        )
      })
      .catch((err) => {
        console.error('Riempi buchi non riuscito:', err)
        showTimedMessage(`❌ Riempi buchi: ${err.message}`)
      })
      .finally(() => setFillingHoles(null))
  }

  const applyOffset = () => {
    if (!brushData || offsetBusy || offsetSelectedCount === 0) return
    if (offsetDistance === 0 && !offsetSeparate) return
    const meshIndex = brushData.meshIndex
    const target = meshes[meshIndex]
    if (!target || target.geometry !== brushData.geometry) return
    try {
      const mode = offsetModeFor(brushSceneRef.current?.sceneMesh, offsetFromView)
      const distanceText = `${offsetDistance.toLocaleString('it-IT')} mm`
      if (offsetSeparate) {
        // la mesh originale resta invariata: la zona spostata diventa una nuova mesh
        const geometry = buildSelectedPartGeometry(brushData, offsetDistance, mode)
        setMeshes((prev) => [...prev, { geometry, name: `${target.name || 'Mesh'} - offset`, visible: true }])
        setMessage(`✅ Zona salvata come parte separata (offset ${distanceText}).`)
      } else {
        const geometry = buildOffsetGeometry(brushData, offsetDistance, mode)
        pushHistory(`Offset con pennello (${distanceText})`, { meshIndex, previous: target.geometry, repaired: geometry })
        setMeshes((prev) => prev.map((m, i) => (i === meshIndex ? { ...m, geometry } : m)))
        setMessage(`✅ Zona selezionata spostata di ${distanceText}.`)
      }
      setOffsetDistance(0)
    } catch (err) {
      console.error('Offset non riuscito:', err)
      setMessage(`❌ Offset non riuscito: ${err.message}`)
    } finally {
      setTimeout(() => setMessage(''), 6000)
    }
  }

  // Mostra nella vista la versione prima o dopo il remesh
  const showRemeshVersion = (version) => {
    if (!remeshCompare || version === remeshView) return
    const { meshIndex, before, after } = remeshCompare
    const from = version === 'before' ? after : before
    const to = version === 'before' ? before : after
    setMeshes((prev) => prev.map((m, i) => (i === meshIndex && m.geometry === from ? { ...m, geometry: to } : m)))
    setRemeshView(version)
  }

  const toggleRepairMode = () => {
    if (repairMode) {
      setRepairMode(false)
      setSelectedHoleId(null)
      setRepairMessage('')
      return
    }
    commitPendingEdits()
    if (meshes.length === 0) return
    setShowSimplifyPanel(false)
    setShowIsolatedPanel(false)
    setShowOffsetPanel(false)
    setShowMirrorPanel(false)
    setCutTool(null)
    setBorderTool(null)
    setShowAlignMenu(false)
    setManualMoveMode(false)
    if (alignmentMode !== 'none') {
      setAlignmentMode('none')
      resetPointPairs()
    }
    setRepairMessage('')
    setRepairMode(true)
  }

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    const extension = file.name.split('.').pop().toLowerCase()
    if (!['stl', 'obj', 'ply'].includes(extension)) {
      setMessage('❌ Formato non supportato. Usa STL, OBJ o PLY.')
      setTimeout(() => setMessage(''), 3000)
      return
    }

    setIsLoadingFile(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      let geometry

      switch (extension) {
        case 'stl':
          geometry = loadSTL(arrayBuffer)
          break
        case 'obj':
          geometry = loadOBJ(new TextDecoder().decode(arrayBuffer))
          break
        case 'ply':
          geometry = loadPLY(arrayBuffer)
          break
        default:
          throw new Error('Estensione non supportata')
      }

      if (!geometry || typeof geometry.getAttribute !== 'function') {
        throw new Error('Geometria non valida')
      }

      const newMeshes = [
        ...meshes,
        {
          geometry,
          name: file.name.split('.')[0],
          visible: true
        }
      ]
      setMeshes(newMeshes)
      setSelectedMeshIndex(newMeshes.length - 1)
      setMessage(`✅ Mesh "${file.name}" caricata con successo!`)
      setTimeout(() => setMessage(''), 3000)
    } catch (err) {
      setMessage(`❌ Errore: ${err.message}`)
      setTimeout(() => setMessage(''), 3000)
      console.error(err)
    } finally {
      setIsLoadingFile(false)
      e.target.value = ''
    }
  }

  const handleRemoveMesh = (index) => {
    const newMeshes = meshes.filter((_, i) => i !== index)
    setMeshes(newMeshes)
    if (selectedMeshIndex >= newMeshes.length) {
      setSelectedMeshIndex(Math.max(0, newMeshes.length - 1))
    }
  }

  const handleToggleMeshVisibility = (index) => {
    const newMeshes = [...meshes]
    newMeshes[index].visible = !newMeshes[index].visible
    setMeshes(newMeshes)
  }

  const handleAddMeshClick = () => {
    if (!isLoadingFile) {
      fileInputRef.current?.click()
    }
  }

  const handleManualMove = () => {
    setRepairMode(false)
    setShowAlignMenu(false)
    setAlignmentMode('none')
    resetPointPairs()
    if (manualMoveMode) {
      // disable immediately
      setManualMoveMode(false)
      setMessage('✅ Modalità sposta mesh manualmente disattivata.')
      setTimeout(() => setMessage(''), 4000)
      return
    }
    if (!requireEditConsent) {
      setManualMoveMode(true)
      setMessage('✨ Modalità sposta mesh manualmente attivata.')
      setTimeout(() => setMessage(''), 4000)
      return
    }
    // ask for consent before enabling manual move
    setShowManualMoveConsent(true)
  }

  const confirmManualMoveConsent = () => {
    setShowManualMoveConsent(false)
    setManualMoveMode(true)
    setMessage('✨ Modalità sposta mesh manualmente attivata. Sinistro=trasla, destro=ruota, rotella=pan X/Y.')
    setTimeout(() => setMessage(''), 4000)
  }

  const cancelManualMoveConsent = () => {
    setShowManualMoveConsent(false)
  }

  const serializeMeshBlob = (meshIndex) => {
    const mesh = meshesRef.current[meshIndex]
    if (!mesh) {
      throw new Error('Mesh non trovata nella scena.')
    }
    const baked = bakeMeshGeometry(mesh)
    return new Blob([serializeGeometryToSTL(baked, meshes[meshIndex]?.name || 'mesh')], { type: 'application/vnd.ms-pki.stl' })
  }

  const clearAlignmentMarkers = () => {
    ['fixed', 'moving'].forEach((side) => {
      alignmentMarkersRef.current[side].forEach((marker) => {
        if (marker.parent) {
          marker.parent.remove(marker)
        }
        marker.geometry.dispose()
        if (marker.material) {
          if (Array.isArray(marker.material)) {
            marker.material.forEach((material) => material.dispose())
          } else {
            marker.material.dispose()
          }
        }
      })
      alignmentMarkersRef.current[side] = []
    })
  }

  const resetPointPairs = () => {
    setPointPairs([])
    setPendingPair({ fixed: null, moving: null })
    pendingPairRef.current = { fixed: null, moving: null }
    clearAlignmentMarkers()
    if (pendingFixedMarkerRef.current) {
      disposeMarker(pendingFixedMarkerRef.current)
      pendingFixedMarkerRef.current = null
    }
    setAlignmentMessage('')
  }

  const createAlignmentMarker = (position, color) => {
    const material = new THREE.MeshStandardMaterial({ color, emissive: 0x000000, roughness: 0.3, metalness: 0.2 })
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 10), material)
    marker.position.copy(position)
    marker.castShadow = true
    marker.receiveShadow = true
    return marker
  }

  const createLabelSprite = (text, color = '#ffffff') => {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, size, size)
    ctx.font = 'bold 40px Arial'
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(text), size / 2, size / 2 + 4)
    const tex = new THREE.CanvasTexture(canvas)
    tex.encoding = THREE.sRGBEncoding
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(0.12, 0.12, 1)
    return sprite
  }

  const getNextAvailableIndex = () => {
    const used = new Set(pointPairs.map((p) => p.index))
    // also include markers that may be present but not yet in pointPairs
    Object.values(alignmentMarkersRef.current).forEach((arr) => arr.forEach((m) => { if (m.userData && m.userData.index) used.add(m.userData.index) }))
    for (let i = 1; i <= 7; i++) {
      if (!used.has(i)) return i
    }
    return null
  }

  const updateLabels = () => {
    // Renumber markers and pointPairs to be consecutive starting at 1
    const fixed = alignmentMarkersRef.current.fixed || []
    const moving = alignmentMarkersRef.current.moving || []
    const n = Math.min(fixed.length, moving.length)
    const newPairs = []
    for (let i = 0; i < n; i++) {
      const idx = i + 1
      const fm = fixed[i]
      const mm = moving[i]
      // dispose old label sprites
      if (fm.userData && fm.userData.labelSprite) {
        const sp = fm.userData.labelSprite
        if (sp.material && sp.material.map) sp.material.map.dispose()
        if (sp.material) sp.material.dispose()
        fm.remove(sp)
      }
      if (mm.userData && mm.userData.labelSprite) {
        const sp2 = mm.userData.labelSprite
        if (sp2.material && sp2.material.map) sp2.material.map.dispose()
        if (sp2.material) sp2.material.dispose()
        mm.remove(sp2)
      }
      const lf = createLabelSprite(idx, '#ffffff')
      lf.position.set(0.06, 0.06, 0.06)
      fm.add(lf)
      fm.userData.labelSprite = lf
      fm.userData.index = idx
      const lm = createLabelSprite(idx, '#ffffff')
      lm.position.set(0.06, 0.06, 0.06)
      mm.add(lm)
      mm.userData.labelSprite = lm
      mm.userData.index = idx
      newPairs.push({ fixed: fm.position.clone().toArray(), moving: mm.position.clone().toArray(), index: idx })
    }
    setPointPairs(newPairs)
  }

  const changeSelectedMeshColor = (hex) => {
    if (selectedMeshIndex == null || meshes.length === 0) return
    setMeshes((prev) => {
      const next = prev.map((m, i) => i === selectedMeshIndex ? { ...m, color: hex } : m)
      return next
    })
    // update main scene mesh material
    const m = meshesRef.current[selectedMeshIndex]
    if (m && m.material && m.material.color) {
      m.material.color.set(hex)
    }
    // update alignment scenes if they contain this mesh
    if (fixedMeshRef.current && fixedMeshRef.current.userData && fixedMeshRef.current.userData.meshIndex === selectedMeshIndex) {
      if (fixedMeshRef.current.material && fixedMeshRef.current.material.color) fixedMeshRef.current.material.color.set(hex)
    }
    if (movingMeshRef.current && movingMeshRef.current.userData && movingMeshRef.current.userData.meshIndex === selectedMeshIndex) {
      if (movingMeshRef.current.material && movingMeshRef.current.material.color) movingMeshRef.current.material.color.set(hex)
    }
  }

  const changeAlignmentMeshColor = (meshIndex, hex) => {
    setMeshes((prev) => {
      const next = prev.map((m, i) => i === meshIndex ? { ...m, color: hex } : m)
      return next
    })
    // Apply to main scene
    const m = meshesRef.current[meshIndex]
    if (m && m.material && m.material.color) {
      m.material.color.set(hex)
    }
    // Apply to alignment scenes
    if (fixedMeshRef.current && fixedMeshRef.current.userData && fixedMeshRef.current.userData.meshIndex === meshIndex) {
      if (fixedMeshRef.current.material && fixedMeshRef.current.material.color) fixedMeshRef.current.material.color.set(hex)
    }
    if (movingMeshRef.current && movingMeshRef.current.userData && movingMeshRef.current.userData.meshIndex === meshIndex) {
      if (movingMeshRef.current.material && movingMeshRef.current.material.color) movingMeshRef.current.material.color.set(hex)
    }
  }

  const addAlignmentPoint = (side, position, label = null) => {
    const mesh = side === 'fixed' ? fixedMeshRef.current : movingMeshRef.current
    const scene = side === 'fixed' ? fixedSceneRef.current : movingSceneRef.current
    if (!scene) return
    const color = side === 'fixed' ? 0xde4b4b : 0x3b82f6
    const marker = createAlignmentMarker(position, color)
    if (label !== null) {
      const sprite = createLabelSprite(label, '#ffffff')
      // place label slightly above the marker
      sprite.position.set(0.06, 0.06, 0.06)
      marker.add(sprite)
      marker.userData.labelSprite = sprite
    }
    // Attach marker to corresponding mesh so it follows visual transforms (no scaling)
    if (mesh) {
      // convert world position to mesh local and add as child
      const localPos = position.clone()
      mesh.worldToLocal(localPos)
      marker.position.copy(localPos)
      mesh.add(marker)
    } else {
      // fallback: add to scene
      scene.add(marker)
    }
    marker.userData.side = side
    alignmentMarkersRef.current[side].push(marker)
    return marker
  }

  const disposeMarker = (marker) => {
    if (!marker) return
    if (marker.parent) {
      marker.parent.remove(marker)
    }
    if (marker.geometry) marker.geometry.dispose()
    if (marker.material) {
      if (Array.isArray(marker.material)) {
        marker.material.forEach((material) => material.dispose())
      } else {
        marker.material.dispose()
      }
    }
    if (marker.userData && marker.userData.labelSprite) {
      const sp = marker.userData.labelSprite
      if (sp.material && sp.material.map) sp.material.map.dispose()
      if (sp.material) sp.material.dispose()
      if (sp.parent) sp.parent.remove(sp)
      marker.userData.labelSprite = null
    }
  }

  const removePointPair = (index) => {
    // remove by position in arrays
    ['fixed', 'moving'].forEach((side) => {
      const marker = alignmentMarkersRef.current[side][index]
      if (marker) {
        disposeMarker(marker)
        alignmentMarkersRef.current[side].splice(index, 1)
      }
    })
    setAlignmentMessage(`✅ Coppia punto ${index + 1} rimossa.`)
    // renumber remaining labels and update pointPairs
    setTimeout(() => updateLabels(), 50)
  }

  const updateAlignmentCamera = (camera, state, allowPoleCrossing = false) => {
    let phi = state.phi
    let theta = state.theta

    if (!allowPoleCrossing) {
      phi = THREE.MathUtils.clamp(phi, 0.001, Math.PI - 0.001)
    } else {
      // Allow the mobile camera to cross the poles without locking.
      // Normalize phi into the valid [0, PI] range and adjust theta by PI when flipping.
      while (phi < 0) {
        phi = -phi
        theta += Math.PI
      }
      while (phi > Math.PI) {
        phi = 2 * Math.PI - phi
        theta += Math.PI
      }
      phi = THREE.MathUtils.clamp(phi, 0.001, Math.PI - 0.001)
    }
    theta = ((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)

    state.phi = phi
    state.theta = theta

    const pos = new THREE.Vector3().setFromSpherical(new THREE.Spherical(state.radius, state.phi, state.theta))
    camera.position.copy(pos)
    camera.up.set(0, 1, 0)
    camera.lookAt(0, 0, 0)
  }

  const syncAlignmentOrientation = (theta, phi) => {
    const fixedState = fixedCameraStateRef.current
    const movingState = movingCameraStateRef.current
    fixedState.theta = theta
    fixedState.phi = phi
    movingState.theta = theta
    movingState.phi = phi

    if (fixedCameraRef.current) {
      updateAlignmentCamera(fixedCameraRef.current, fixedState)
    }
    if (movingCameraRef.current) {
      updateAlignmentCamera(movingCameraRef.current, movingState)
    }
  }

  // Visual orientation utilities (PCA-based) - do not modify geometry scale
  const visualTransformRef = useRef({ fixed: null, moving: null })

  const powerIteration = (m, iterations = 30) => {
    let v = [1, 0.1, 0.1]
    for (let i = 0; i < iterations; i++) {
      const x = [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
        m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
        m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
      ]
      const norm = Math.hypot(x[0], x[1], x[2]) || 1
      v = [x[0] / norm, x[1] / norm, x[2] / norm]
    }
    // Rayleigh quotient for eigenvalue
    const mv = [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ]
    const lambda = v[0] * mv[0] + v[1] * mv[1] + v[2] * mv[2]
    return { vector: v, value: lambda }
  }

  const computePCA = (geometry) => {
    if (!geometry) return null
    const posAttr = geometry.getAttribute('position')
    if (!posAttr) return null
    const arr = posAttr.array
    const n = posAttr.count || arr.length / 3
    let cx = 0, cy = 0, cz = 0
    for (let i = 0; i < arr.length; i += 3) {
      cx += arr[i]; cy += arr[i + 1]; cz += arr[i + 2]
    }
    cx /= n; cy /= n; cz /= n

    // covariance
    let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0
    for (let i = 0, p = 0; i < n; i++, p += 3) {
      const x = arr[p] - cx
      const y = arr[p + 1] - cy
      const z = arr[p + 2] - cz
      cxx += x * x; cxy += x * y; cxz += x * z
      cyy += y * y; cyz += y * z; czz += z * z
    }
    cxx /= n; cxy /= n; cxz /= n; cyy /= n; cyz /= n; czz /= n

    const M = [cxx, cxy, cxz, cxy, cyy, cyz, cxz, cyz, czz]
    const p1 = powerIteration(M, 40)
    // deflate
    const l1 = p1.value
    const v1 = p1.vector
    const outer = (a, b) => [a[0]*b[0], a[0]*b[1], a[0]*b[2], a[1]*b[0], a[1]*b[1], a[1]*b[2], a[2]*b[0], a[2]*b[1], a[2]*b[2]]
    const def = M.map((val, idx) => val - l1 * outer(v1, v1)[idx])
    const p2 = powerIteration(def, 40)
    const v2 = p2.vector
    // v3 as cross
    const v3 = [
      v1[1]*v2[2] - v1[2]*v2[1],
      v1[2]*v2[0] - v1[0]*v2[2],
      v1[0]*v2[1] - v1[1]*v2[0]
    ]
    const norm3 = Math.hypot(v3[0], v3[1], v3[2]) || 1
    v3[0] /= norm3; v3[1] /= norm3; v3[2] /= norm3

    // Ensure right handedness
    const mat = new THREE.Matrix4()
    mat.set(
      v1[0], v2[0], v3[0], 0,
      v1[1], v2[1], v3[1], 0,
      v1[2], v2[2], v3[2], 0,
      0, 0, 0, 1
    )
    // if determinant negative, flip v2
    const det = new THREE.Matrix3().set(
      v1[0], v2[0], v3[0],
      v1[1], v2[1], v3[1],
      v1[2], v2[2], v3[2]
    ).determinant()
    if (det < 0) {
      v2[0] = -v2[0]; v2[1] = -v2[1]; v2[2] = -v2[2]
      mat.set(
        v1[0], v2[0], v3[0], 0,
        v1[1], v2[1], v3[1], 0,
        v1[2], v2[2], v3[2], 0,
        0, 0, 0, 1
      )
    }

    return { centroid: new THREE.Vector3(cx, cy, cz), axes: { x: new THREE.Vector3(...v1), y: new THREE.Vector3(...v2), z: new THREE.Vector3(...v3) }, matrix: mat }
  }

  const applyPCAOrientation = (useTarget = true) => {
    try {
      if (!fixedMeshRef.current || !movingMeshRef.current) return
      const refMesh = useTarget ? fixedMeshRef.current : movingMeshRef.current
      const refGeom = refMesh.geometry
      const pca = computePCA(refGeom)
      if (!pca) return

      // Save original moving mesh transform if not saved
      if (!visualTransformRef.current.moving) {
        visualTransformRef.current.moving = {
          quaternion: movingMeshRef.current.quaternion.clone(),
          position: movingMeshRef.current.position.clone()
        }
      }

      // Apply rotation so that PCA axes align with world axes for the moving mesh only
      const rotMat = new THREE.Matrix4().copy(pca.matrix)
      const inv = new THREE.Matrix4().copy(rotMat).invert()
      movingMeshRef.current.setRotationFromMatrix(inv)

      setAlignmentMessage('✅ Orientamento visivo applicato alla mesh mobile (PCA).')
      setTimeout(() => setAlignmentMessage(''), 3000)
    } catch (err) {
      console.warn('applyPCAOrientation failed', err)
      setAlignmentMessage('❌ Errore sincronizzazione orientamento.')
      setTimeout(() => setAlignmentMessage(''), 3000)
    }
  }

  const resetVisualOrientation = () => {
    if (visualTransformRef.current.moving && movingMeshRef.current) {
      movingMeshRef.current.quaternion.copy(visualTransformRef.current.moving.quaternion)
      movingMeshRef.current.position.copy(visualTransformRef.current.moving.position)
    }
    visualTransformRef.current = { fixed: null, moving: null }
    setAlignmentMessage('✅ Orientamento visivo ripristinato.')
    setTimeout(() => setAlignmentMessage(''), 3000)
  }

  const addPointPair = (fixedPoint, movingPoint) => {
    // prefer pending fixed index if set
    let nextIndex = pendingPairRef.current && pendingPairRef.current.fixedIndex ? pendingPairRef.current.fixedIndex : getNextAvailableIndex()
    if (!nextIndex) {
      setAlignmentMessage('❌ Numero massimo di punti raggiunto (7).')
      return
    }
    setPointPairs((prev) => [...prev, { fixed: fixedPoint.toArray(), moving: movingPoint.toArray(), index: nextIndex }])
    // Add markers for completed pair. Reuse pending fixed marker if present
    if (pendingFixedMarkerRef.current && pendingFixedMarkerRef.current.userData && pendingFixedMarkerRef.current.userData.index === nextIndex) {
      alignmentMarkersRef.current.fixed.push(pendingFixedMarkerRef.current)
      pendingFixedMarkerRef.current.userData.side = 'fixed'
      pendingFixedMarkerRef.current = null
    } else {
      addAlignmentPoint('fixed', fixedPoint, nextIndex)
    }
    addAlignmentPoint('moving', movingPoint, nextIndex)
    // ensure consecutive numbering after adding
    updateLabels()
  }

  const handleAlignmentModeToggle = () => {
    setRepairMode(false)
    setShowSimplifyPanel(false)
    setShowAlignMenu(false)
    setManualMoveMode(false)
    const nextMode = alignmentMode === 'point-align' ? 'none' : 'point-align'
    setAlignmentMode(nextMode)
    if (nextMode === 'point-align') {
      resetPointPairs()
      setAlignmentMessage('✨ Modalità allineamento per punti attivata. Seleziona prima un punto sulla mesh target fissa, poi uno sulla mesh source mobile.')
    } else {
      resetPointPairs()
      setAlignmentMessage('✅ Modalità allineamento per punti disattivata.')
      setTimeout(() => setAlignmentMessage(''), 3000)
    }
  }

  const handlePointAlignment = async () => {
    if (meshes.length < 2) {
      setAlignmentMessage('❌ Devi avere almeno due mesh per allineare.')
      return
    }
    if (alignSourceIndex === alignTargetIndex) {
      setAlignmentMessage('❌ Seleziona due mesh diverse come source e target.')
      return
    }
    if (pointPairs.length < 3) {
      setAlignmentMessage('❌ Servono almeno 3 coppie di punti selezionate.')
      return
    }

    setPointAlignLoading(true)
    setAlignmentMessage('🔄 Invio punti di corrispondenza al server...')

    try {
      const sourceMesh = meshes[alignSourceIndex]
      const targetMesh = meshes[alignTargetIndex]
      const sourceBlob = serializeMeshBlob(alignSourceIndex)
      const targetBlob = serializeMeshBlob(alignTargetIndex)
      const formData = new FormData()
      formData.append('source', sourceBlob, `${sourceMesh.name}.stl`)
      formData.append('target', targetBlob, `${targetMesh.name}.stl`)
      formData.append('source_points', JSON.stringify(pointPairs.map((pair) => pair.moving)))
      formData.append('target_points', JSON.stringify(pointPairs.map((pair) => pair.fixed)))

      console.log('[Point Align] Invio richiesta:', {
        source: sourceMesh.name,
        target: targetMesh.name,
        pointPairs: pointPairs.length,
      })

      const response = await fetch(apiUrl(selectedServer.url, '/align-points'), {
        method: 'POST',
        body: formData,
      })

      console.log('[Point Align] Risposta ricevuta:', response.status, response.statusText)

      if (!response.ok) {
        let errorData
        try {
          errorData = await response.json()
        } catch (e) {
          errorData = { detail: await response.text() }
        }
        console.error('[Point Align] Errore risposta:', errorData)
        throw new Error(errorData?.detail || `Errore HTTP ${response.status}: ${response.statusText}`)
      }

      const buffer = await response.arrayBuffer()
      const alignedGeometry = loadPLY(buffer)
      const alignedName = `PointAlign_${sourceMesh.name}_to_${targetMesh.name}`.replace(/[^a-zA-Z0-9._-]/g, '_')

      setMeshes((prevMeshes) => {
        const nextMeshes = [
          ...prevMeshes,
          {
            geometry: alignedGeometry,
            name: alignedName,
            visible: true,
          },
        ]
        setSelectedMeshIndex(nextMeshes.length - 1)
        return nextMeshes
      })
      resetPointPairs()
      setAlignmentMode('none')
      setAlignmentMessage(`✅ Allineamento per punti completato: aggiunta mesh ${alignedName}`)

    } catch (err) {
      console.error('[Point Align] Errore catturato:', err.message)
      console.error('[Point Align] Stack:', err.stack)
      setAlignmentMessage(`❌ ${err.message}`)
    } finally {
      setPointAlignLoading(false)
      setTimeout(() => setAlignmentMessage(''), 5000)
    }
  }

  const handleICPPrealign = async () => {
    if (meshes.length < 2) {
      setAlignmentMessage('❌ Devi avere almeno due mesh per allineare.')
      return
    }
    if (alignSourceIndex === alignTargetIndex) {
      setAlignmentMessage('❌ Seleziona due mesh diverse come source e target.')
      return
    }

    setPointAlignLoading(true)
    setAlignmentMessage('🔄 Pre-allineamento ICP in corso...')

    try {
      const sourceMesh = meshes[alignSourceIndex]
      const targetMesh = meshes[alignTargetIndex]
      const sourceBlob = serializeMeshBlob(alignSourceIndex)
      const targetBlob = serializeMeshBlob(alignTargetIndex)
      const formData = new FormData()
      formData.append('source', sourceBlob, `${sourceMesh.name}.stl`)
      formData.append('target', targetBlob, `${targetMesh.name}.stl`)

      console.log('[ICP Prealign] Invio richiesta:', {
        source: sourceMesh.name,
        target: targetMesh.name,
      })

      const response = await fetch(apiUrl(selectedServer.url, '/align-ransac'), {
        method: 'POST',
        body: formData,
      })

      console.log('[ICP Prealign] Risposta ricevuta:', response.status, response.statusText)

      if (!response.ok) {
        let errorData
        try {
          errorData = await response.json()
        } catch (e) {
          errorData = { detail: await response.text() }
        }
        console.error('[ICP Prealign] Errore risposta:', errorData)
        throw new Error(errorData?.detail || `Errore HTTP ${response.status}: ${response.statusText}`)
      }

      const buffer = await response.arrayBuffer()
      const alignedGeometry = loadPLY(buffer)
      const alignedName = `ICPPrealign_${sourceMesh.name}_to_${targetMesh.name}`.replace(/[^a-zA-Z0-9._-]/g, '_')

      setMeshes((prevMeshes) => {
        const nextMeshes = [
          ...prevMeshes,
          {
            geometry: alignedGeometry,
            name: alignedName,
            visible: true,
          },
        ]
        setSelectedMeshIndex(nextMeshes.length - 1)
        return nextMeshes
      })
      setAlignmentMessage(`✅ Pre-allineamento ICP completato: aggiunta mesh ${alignedName}`)

    } catch (err) {
      console.error('[ICP Prealign] Errore catturato:', err.message)
      console.error('[ICP Prealign] Stack:', err.stack)
      setAlignmentMessage(`❌ ${err.message}`)
    } finally {
      setPointAlignLoading(false)
      setTimeout(() => setAlignmentMessage(''), 5000)
    }
  }

  const handleICPAlignment = async () => {
    if (meshes.length < 2) {
      setAlignmentMessage('❌ Devi avere almeno due mesh per allineare.')
      return
    }
    if (alignSourceIndex === alignTargetIndex) {
      setAlignmentMessage('❌ Seleziona due mesh diverse come source e target.')
      return
    }

    setPointAlignLoading(true)
    setAlignmentMessage('🔄 Allineamento fine tramite ICP in corso...')

    try {
      const sourceMesh = meshes[alignSourceIndex]
      const targetMesh = meshes[alignTargetIndex]
      const sourceBlob = serializeMeshBlob(alignSourceIndex)
      const targetBlob = serializeMeshBlob(alignTargetIndex)
      const formData = new FormData()
      formData.append('source', sourceBlob, `${sourceMesh.name}.stl`)
      formData.append('target', targetBlob, `${targetMesh.name}.stl`)

      console.log('[ICP Align] Invio richiesta:', {
        source: sourceMesh.name,
        target: targetMesh.name,
      })

      const response = await fetch(apiUrl(selectedServer.url, '/align-icp'), {
        method: 'POST',
        body: formData,
      })

      console.log('[ICP Align] Risposta ricevuta:', response.status, response.statusText)

      if (!response.ok) {
        let errorData
        try {
          errorData = await response.json()
        } catch (e) {
          errorData = { detail: await response.text() }
        }
        console.error('[ICP Align] Errore risposta:', errorData)
        throw new Error(errorData?.detail || `Errore HTTP ${response.status}: ${response.statusText}`)
      }

      const buffer = await response.arrayBuffer()
      const alignedGeometry = loadPLY(buffer)
      const alignedName = `ICP_${sourceMesh.name}_to_${targetMesh.name}`.replace(/[^a-zA-Z0-9._-]/g, '_')

      setMeshes((prevMeshes) => {
        const nextMeshes = [
          ...prevMeshes,
          {
            geometry: alignedGeometry,
            name: alignedName,
            visible: true,
          },
        ]
        setSelectedMeshIndex(nextMeshes.length - 1)
        return nextMeshes
      })
      setAlignmentMessage(`✅ Allineamento fine completato: aggiunta mesh ${alignedName}`)

    } catch (err) {
      console.error('[ICP Align] Errore catturato:', err.message)
      console.error('[ICP Align] Stack:', err.stack)
      setAlignmentMessage(`❌ ${err.message}`)
    } finally {
      setPointAlignLoading(false)
      setTimeout(() => setAlignmentMessage(''), 5000)
    }
  }

  const disposeAlignmentScene = (scene, renderer) => {
    if (renderer) {
      renderer.domElement.remove()
      renderer.dispose()
    }
    if (scene) {
      scene.traverse((object) => {
        if (object.isMesh) {
          object.geometry?.dispose()
          if (object.material) {
            if (Array.isArray(object.material)) {
              object.material.forEach((material) => material.dispose())
            } else {
              object.material.dispose()
            }
          }
        }
      })
    }
  }

  useEffect(() => {
    if (alignmentMode !== 'point-align' || meshes.length < 2) return
    if (!alignmentLeftContainerRef.current || !alignmentRightContainerRef.current) return

    clearAlignmentMarkers()
    pendingPairRef.current = { fixed: null, moving: null }
    setPendingPair({ fixed: null, moving: null })

    const fixedContainer = alignmentLeftContainerRef.current
    const movingContainer = alignmentRightContainerRef.current
    fixedContainer.innerHTML = ''
    movingContainer.innerHTML = ''

    const buildScene = (meshIndex, container, sceneRef, cameraRef, rendererRef, meshRef, cameraStateRef, backgroundColor) => {
      const width = Math.max(container.clientWidth, 250)
      const height = Math.max(container.clientHeight, 250)
      const scene = new THREE.Scene()
      scene.background = backgroundColor == null ? null : new THREE.Color(backgroundColor)
      sceneRef.current = scene

      const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6)
      hemiLight.position.set(0, 20, 0)
      scene.add(hemiLight)

      const ambientLight = new THREE.AmbientLight(0xffffff, 0.8)
      scene.add(ambientLight)

      const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2)
      directionalLight.position.set(5, 8, 5)
      directionalLight.castShadow = true
      scene.add(directionalLight)

      const fillLight = new THREE.PointLight(0xffffff, 0.8)
      fillLight.position.set(-5, 5, 5)
      scene.add(fillLight)

      const backLight = new THREE.DirectionalLight(0xffffff, 0.4)
      backLight.position.set(-5, 5, -5)
      scene.add(backLight)

      const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 1000)
      camera.position.set(0, 0, 3)
      camera.lookAt(0, 0, 0)
      cameraRef.current = camera

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
      renderer.setSize(width, height, false)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      renderer.useLegacyLights = false
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.15
      renderer.setClearColor(backgroundColor ?? 0x000000, backgroundColor == null ? 0 : 1)
      renderer.sortObjects = false
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      renderer.domElement.style.display = 'block'
      renderer.domElement.style.touchAction = 'none'
      renderer.domElement.style.pointerEvents = 'auto'
      container.style.position = container.style.position || 'relative'
      container.style.overflow = 'hidden'
      container.appendChild(renderer.domElement)
      rendererRef.current = renderer

      const meshData = meshes[meshIndex]
      if (!meshData) return

      const clonedGeometry = meshData.geometry.clone()
      clonedGeometry.computeBoundingBox()
      const boundingBox = clonedGeometry.boundingBox
      const center = new THREE.Vector3()
      boundingBox.getCenter(center)
      clonedGeometry.translate(-center.x, -center.y, -center.z)
      clonedGeometry.computeBoundingBox()
      const size = clonedGeometry.boundingBox.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)
      const scale = maxDim > 0 ? 1.5 / maxDim : 1
      clonedGeometry.scale(scale, scale, scale)
      clonedGeometry.computeBoundingSphere()
      const sphereRadius = clonedGeometry.boundingSphere?.radius || (maxDim * scale) / 2
      const fovRad = THREE.MathUtils.degToRad(camera.fov)
      const fitRadius = sphereRadius / Math.sin(fovRad / 2) * 1.15
      const resetRadius = Math.max(1.0, fitRadius)

      const meshColor = meshData.color ? parseInt(meshData.color.replace('#', ''), 16) : 0xb0c4de
      const material = new THREE.MeshStandardMaterial({
        color: meshColor,
        roughness: 0.5,
        metalness: 0.05,
        side: THREE.DoubleSide,
      })

      const mesh = new THREE.Mesh(clonedGeometry, material)
      mesh.position.set(0, 0, 0)
      mesh.rotation.set(0, 0, 0)
      scene.add(mesh)
      mesh.userData.meshIndex = meshIndex
      meshRef.current = mesh

      // Always center the scene around the mesh and reset camera controls for a symmetric view
      const resetState = { theta: 0, phi: Math.PI / 2, radius: resetRadius }
      cameraStateRef.current = { ...resetState }
      if (camera) {
        camera.position.set(0, 0, resetState.radius)
        camera.lookAt(0, 0, 0)
      }

      return { scene, camera, renderer }
    }

    const fixedSceneData = buildScene(alignTargetIndex, fixedContainer, fixedSceneRef, fixedCameraRef, fixedRendererRef, fixedMeshRef, fixedCameraStateRef, null)
    const movingSceneData = buildScene(alignSourceIndex, movingContainer, movingSceneRef, movingCameraRef, movingRendererRef, movingMeshRef, movingCameraStateRef, null)

    const renderLoop = () => {
      if (fixedRendererRef.current && fixedSceneRef.current && fixedCameraRef.current) {
        fixedRendererRef.current.render(fixedSceneRef.current, fixedCameraRef.current)
      }
      if (movingRendererRef.current && movingSceneRef.current && movingCameraRef.current) {
        movingRendererRef.current.render(movingSceneRef.current, movingCameraRef.current)
      }
      requestAnimationFrame(renderLoop)
    }
    let animationId = requestAnimationFrame(renderLoop)

    const clickThreshold = 6

    const getFixedIntersectionPoint = (event) => {
      if (!fixedRendererRef.current || !fixedCameraRef.current || !fixedMeshRef.current) return null
      const rect = fixedRendererRef.current.domElement.getBoundingClientRect()
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      )
      fixedRaycasterRef.current.setFromCamera(mouse, fixedCameraRef.current)
      const intersects = fixedRaycasterRef.current.intersectObject(fixedMeshRef.current, true)
      return intersects.length ? intersects[0].point.clone() : null
    }

    const onFixedPointerDown = (event) => {
      if (!fixedRendererRef.current) return
      fixedPointerMovedRef.current = false
      fixedLastPointerRef.current = { x: event.clientX, y: event.clientY }
      fixedDragRef.current = true
      fixedRendererRef.current.domElement.setPointerCapture(event.pointerId)
    }

    const onFixedPointerMove = (event) => {
      if (!fixedDragRef.current || !fixedCameraRef.current) return
      const dx = event.clientX - fixedLastPointerRef.current.x
      const dy = event.clientY - fixedLastPointerRef.current.y
      if (Math.abs(dx) > clickThreshold || Math.abs(dy) > clickThreshold) {
        fixedPointerMovedRef.current = true
      }
      fixedLastPointerRef.current = { x: event.clientX, y: event.clientY }
      // If right-button or middle-button is pressed, rotate/pan the fixed mesh itself
      const buttons = event.buttons
      const rightPressed = (buttons & 2) === 2
      const middlePressed = (buttons & 4) === 4
      if (rightPressed && fixedMeshRef.current) {
        const rotSpeed = 0.01
        fixedMeshRef.current.rotateY(-dx * rotSpeed)
        fixedMeshRef.current.rotateX(dy * rotSpeed)
        return
      }

      if (middlePressed && fixedMeshRef.current) {
        const camera = fixedCameraRef.current
        const panSpeed = 0.003 * camera.position.z
        fixedMeshRef.current.position.x += dx * panSpeed
        fixedMeshRef.current.position.y -= dy * panSpeed
        return
      }

      const state = fixedCameraStateRef.current
      state.theta -= dx * 0.004
      state.phi += dy * 0.004
      if (fixedCameraRef.current) updateAlignmentCamera(fixedCameraRef.current, state)
    }

    const onFixedPointerUp = (event) => {
      if (!fixedRendererRef.current) return
      fixedDragRef.current = false
      fixedRendererRef.current.domElement.releasePointerCapture(event.pointerId)
    }

    const onFixedClick = (event) => {
      if (event.button !== 0 || !fixedRendererRef.current) return
      const point = getFixedIntersectionPoint(event)
      if (point) {
        // Remove old pending marker if exists
        if (pendingFixedMarkerRef.current) {
          disposeMarker(pendingFixedMarkerRef.current)
          pendingFixedMarkerRef.current = null
        }
        // Add new pending marker with provisional index label
        const nextIndex = pointPairs.length + 1
        const marker = createAlignmentMarker(point, 0xde4b4b)
        const label = createLabelSprite(nextIndex, '#ffffff')
        label.position.set(0.06, 0.06, 0.06)
        marker.add(label)
        marker.userData.labelSprite = label
        marker.userData.index = nextIndex
        if (fixedMeshRef.current) {
          const local = point.clone()
          fixedMeshRef.current.worldToLocal(local)
          marker.position.copy(local)
          fixedMeshRef.current.add(marker)
        } else {
          fixedSceneRef.current?.add(marker)
        }
        pendingFixedMarkerRef.current = marker

        pendingPairRef.current = { ...pendingPairRef.current, fixed: point, fixedIndex: nextIndex }
        setPendingPair(pendingPairRef.current)
        setAlignmentMessage('Punto target selezionato. Ora seleziona il punto corrispondente sulla mesh mobile.')
      }
    }

    const onFixedWheel = (event) => {
      event.preventDefault()
      if (!fixedCameraRef.current) return
      const state = fixedCameraStateRef.current
      state.radius = Math.max(0.6, Math.min(20, state.radius + event.deltaY * 0.0025))
      updateAlignmentCamera(fixedCameraRef.current, state)
    }

    const getMovingIntersectionPoint = (event) => {
      if (!movingRendererRef.current || !movingCameraRef.current || !movingMeshRef.current) return null
      const rect = movingRendererRef.current.domElement.getBoundingClientRect()
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      )
      movingRaycasterRef.current.setFromCamera(mouse, movingCameraRef.current)
      const intersects = movingRaycasterRef.current.intersectObject(movingMeshRef.current, true)
      return intersects.length ? intersects[0].point.clone() : null
    }

    const onMovingPointerDown = (event) => {
      if (!movingRendererRef.current) return
      movingPointerMovedRef.current = false
      movingLastPointerRef.current = { x: event.clientX, y: event.clientY }
      // prevent default for middle/right to avoid page actions
      if (event.button === 1 || event.button === 2) event.preventDefault()
      movingDragRef.current = true
      movingRendererRef.current.domElement.setPointerCapture(event.pointerId)
    }

    const onMovingPointerMove = (event) => {
      if (!movingDragRef.current || !movingCameraRef.current) return
      const dx = event.clientX - movingLastPointerRef.current.x
      const dy = event.clientY - movingLastPointerRef.current.y
      if (Math.abs(dx) > clickThreshold || Math.abs(dy) > clickThreshold) {
        movingPointerMovedRef.current = true
      }
      movingLastPointerRef.current = { x: event.clientX, y: event.clientY }
      // If right-button or middle-button is pressed, rotate the moving mesh itself
      // (preserves left-click behavior for point selection)
      const buttons = event.buttons
      const rightPressed = (buttons & 2) === 2
      const middlePressed = (buttons & 4) === 4
      if (rightPressed && movingMeshRef.current) {
        const rotSpeed = 0.01
        // Rotate around mesh's local Y (yaw) and local X (pitch)
        movingMeshRef.current.rotateY(-dx * rotSpeed)
        movingMeshRef.current.rotateX(dy * rotSpeed)
        return
      }

      if (middlePressed && movingMeshRef.current) {
        // pan the moving mesh in camera plane (X/Y)
        const camera = movingCameraRef.current
        const panSpeed = 0.003 * camera.position.z
        movingMeshRef.current.position.x += dx * panSpeed
        movingMeshRef.current.position.y -= dy * panSpeed
        return
      }

      const state = movingCameraStateRef.current
      // Horizontal rotation (theta) as usual
      state.theta -= dx * 0.004
      // Vertical drag follows default direction for the moving view
      state.phi -= dy * 0.004
      if (movingCameraRef.current) updateAlignmentCamera(movingCameraRef.current, state, true)
    }

    const onMovingPointerUp = (event) => {
      if (!movingRendererRef.current) return
      movingDragRef.current = false
      movingRendererRef.current.domElement.releasePointerCapture(event.pointerId)
    }

    const onMovingClick = (event) => {
      if (event.button !== 0 || !movingRendererRef.current) return
      const point = getMovingIntersectionPoint(event)
      if (point) {
        if (!pendingPairRef.current.fixed) {
          setAlignmentMessage('Seleziona prima un punto sulla mesh target fissa.')
        } else {
          // Complete the pair
          addPointPair(pendingPairRef.current.fixed, point)
          
          // Clean up pending marker
          if (pendingFixedMarkerRef.current) {
            disposeMarker(pendingFixedMarkerRef.current)
            pendingFixedMarkerRef.current = null
          }
          
          pendingPairRef.current = { fixed: null, moving: null }
          setPendingPair({ fixed: null, moving: null })
          setAlignmentMessage('Coppia aggiunta. Seleziona un altro punto sulla mesh target fissa.')
        }
      }
    }

    const onMovingWheel = (event) => {
      event.preventDefault()
      if (!movingCameraRef.current) return
      const state = movingCameraStateRef.current
      state.radius = Math.max(0.6, Math.min(20, state.radius + event.deltaY * 0.0025))
      updateAlignmentCamera(movingCameraRef.current, state)
    }

    fixedRendererRef.current.domElement.addEventListener('pointerdown', onFixedPointerDown)
    fixedRendererRef.current.domElement.addEventListener('pointermove', onFixedPointerMove)
    fixedRendererRef.current.domElement.addEventListener('pointerup', onFixedPointerUp)
    fixedRendererRef.current.domElement.addEventListener('pointercancel', onFixedPointerUp)
    fixedRendererRef.current.domElement.addEventListener('click', onFixedClick)
    fixedRendererRef.current.domElement.addEventListener('wheel', onFixedWheel, { passive: false })

    movingRendererRef.current.domElement.addEventListener('pointerdown', onMovingPointerDown)
    movingRendererRef.current.domElement.addEventListener('pointermove', onMovingPointerMove)
    movingRendererRef.current.domElement.addEventListener('pointerup', onMovingPointerUp)
    movingRendererRef.current.domElement.addEventListener('pointercancel', onMovingPointerUp)
    movingRendererRef.current.domElement.addEventListener('click', onMovingClick)
    movingRendererRef.current.domElement.addEventListener('wheel', onMovingWheel, { passive: false })

    const handleResize = () => {
      const fixedWidth = Math.max(fixedContainer.clientWidth, 250)
      const fixedHeight = Math.max(fixedContainer.clientHeight, 250)
      const movingWidth = Math.max(movingContainer.clientWidth, 250)
      const movingHeight = Math.max(movingContainer.clientHeight, 250)

      if (fixedCameraRef.current) {
        fixedCameraRef.current.aspect = fixedWidth / fixedHeight
        fixedCameraRef.current.updateProjectionMatrix()
      }
      if (fixedRendererRef.current) {
        fixedRendererRef.current.setSize(fixedWidth, fixedHeight)
      }

      if (movingCameraRef.current) {
        movingCameraRef.current.aspect = movingWidth / movingHeight
        movingCameraRef.current.updateProjectionMatrix()
      }
      if (movingRendererRef.current) {
        movingRendererRef.current.setSize(movingWidth, movingHeight)
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', handleResize)
      if (fixedRendererRef.current) {
        fixedRendererRef.current.domElement.removeEventListener('pointerdown', onFixedPointerDown)
        fixedRendererRef.current.domElement.removeEventListener('pointermove', onFixedPointerMove)
        fixedRendererRef.current.domElement.removeEventListener('pointerup', onFixedPointerUp)
        fixedRendererRef.current.domElement.removeEventListener('pointercancel', onFixedPointerUp)
        fixedRendererRef.current.domElement.removeEventListener('click', onFixedClick)
        fixedRendererRef.current.domElement.removeEventListener('wheel', onFixedWheel)
      }
      if (movingRendererRef.current) {
        movingRendererRef.current.domElement.removeEventListener('pointerdown', onMovingPointerDown)
        movingRendererRef.current.domElement.removeEventListener('pointermove', onMovingPointerMove)
        movingRendererRef.current.domElement.removeEventListener('pointerup', onMovingPointerUp)
        movingRendererRef.current.domElement.removeEventListener('pointercancel', onMovingPointerUp)
        movingRendererRef.current.domElement.removeEventListener('click', onMovingClick)
        movingRendererRef.current.domElement.removeEventListener('wheel', onMovingWheel)
      }
      disposeAlignmentScene(fixedSceneRef.current, fixedRendererRef.current)
      disposeAlignmentScene(movingSceneRef.current, movingRendererRef.current)
      if (pendingFixedMarkerRef.current) {
        disposeMarker(pendingFixedMarkerRef.current)
        pendingFixedMarkerRef.current = null
      }
      fixedSceneRef.current = null
      movingSceneRef.current = null
      fixedCameraRef.current = null
      movingCameraRef.current = null
      fixedRendererRef.current = null
      movingRendererRef.current = null
      fixedMeshRef.current = null
      movingMeshRef.current = null
    }
  }, [alignmentMode, meshes, alignSourceIndex, alignTargetIndex])



  return (
    <div className="fixed inset-0 z-30 bg-slate-50 flex">
      {/* Main viewport */}
      <div className="flex-1 relative p-6">
        <div className="absolute inset-0 rounded-[32px] bg-white border border-slate-200 shadow-2xl overflow-hidden">
          <div ref={containerRef} className="render-bg w-full h-full" />
          {cutDraw && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              {cutDraw.type === 'Lazo' && (
                <polygon
                  points={cutDraw.points.map((point) => point.join(',')).join(' ')}
                  fill="rgba(150,75,0,0.15)"
                  stroke="#964B00"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                />
              )}
            </svg>
          )}
        </div>

        {/* Top bar with close button */}
        <div className="absolute top-6 left-6 right-6 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-lg font-bold text-slate-900">Modificatore Mesh</h2>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <span>Backend</span>
              <select
                value={selectedServerId}
                onChange={handleServerSelection}
                className="px-2 py-1 border border-slate-300 rounded-lg text-sm"
              >
                {MESH_LIB_SERVERS.map((server) => (
                  <option key={server.id} value={server.id}>{server.name}</option>
                ))}
              </select>
            </label>
            <span className={`inline-block px-3 py-1 text-sm font-medium rounded-full ${serverOnline ? 'bg-emerald-100 text-emerald-800' : 'bg-yellow-100 text-yellow-800'}`}>
              {serverChecking ? '⏳ Controllo server...' : serverOnline ? `✓ ${selectedServer.name} online` : `⚠ ${selectedServer.name} offline`}
            </span>
            <button
              type="button"
              onClick={() => setShowWireframe((visible) => !visible)}
              aria-pressed={showWireframe}
              title={showWireframe ? 'Nascondi i triangoli' : 'Mostra i triangoli'}
              className={`px-3 py-1 rounded-lg text-sm font-medium border transition ${
                showWireframe ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
            >
              🔺 Triangoli
            </button>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-sky-600 text-white hover:bg-sky-700 transition"
          >
            ✕ Chiudi
          </button>
        </div>

        {/* Message display */}
        {message && (
          <div className="absolute top-20 left-6 bg-white border border-slate-200 text-slate-900 px-4 py-2 rounded-lg shadow-lg">
            {message}
          </div>
        )}

        {manualMoveMode && (
          <div className="absolute top-20 right-6 bg-emerald-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm space-y-1">
            <div>Modalità spostamento manuale attiva</div>
            <div className="text-xs text-emerald-100">Mesh selezionata: {meshes[selectedMeshIndex]?.name || 'Nessuna'}</div>
          </div>
        )}

        {showManualMoveConsent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8">
            <div className="bg-white rounded-3xl p-6 max-w-md w-full border border-slate-200 shadow-2xl">
              <h3 className="text-lg font-semibold text-slate-900 mb-3">Autorizzazione impostazioni mouse</h3>
              <p className="text-sm text-slate-600 mb-4">Le modifiche tramite mouse (traslazione/rotazione) possono alterare la mesh. Confermi di avere l'autorizzazione a modificare questa mesh?</p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={cancelManualMoveConsent}
                  className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  Annulla
                </button>
                <button
                  onClick={confirmManualMoveConsent}
                  className="px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  Conferma consenso
                </button>
              </div>
            </div>
          </div>
        )}

        {repairMode && alignmentMode !== 'point-align' && (
          <div className="absolute bottom-8 left-8 w-[360px] max-h-[70%] flex flex-col bg-white/95 border border-slate-200 rounded-2xl shadow-2xl backdrop-blur-sm text-slate-800">
            <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-200">
              <div>
                <div className="text-sm font-semibold text-slate-900">Ripara mesh</div>
                <div className="text-xs text-slate-500 truncate max-w-[260px]">{meshes[selectedMeshIndex]?.name}</div>
              </div>
              <button
                type="button"
                onClick={toggleRepairMode}
                className="h-7 w-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100"
                aria-label="Chiudi Ripara mesh"
              >
                ×
              </button>
            </div>

            <div className="px-4 py-3 space-y-3 overflow-y-auto">
              {repairBusy && !holeAnalysis ? (
                <div className="text-sm text-slate-600">⏳ Analisi dei fori in corso...</div>
              ) : holeAnalysis ? (
                <>
                  <div className="text-sm">
                    {holeAnalysis.holes.length === 0 ? (
                      <span className="text-emerald-700 font-medium">✅ Nessun foro: la superficie è chiusa.</span>
                    ) : (
                      <span>
                        <span className="font-semibold">{holeAnalysis.holes.filter((h) => !h.isOuterBorder).length}</span> fori trovati
                        {holeAnalysis.holes.some((h) => h.isOuterBorder) && ' + bordo esterno della scansione'}
                      </span>
                    )}
                  </div>

                  {holeAnalysis.holes.length > 0 && (
                    <>
                      <label className="block text-xs font-medium text-slate-600">
                        Tipo di chiusura
                        <select
                          value={fillMode}
                          onChange={(e) => setFillMode(e.target.value)}
                          className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-800"
                        >
                          <option value="smooth">Liscia (raccordata alla superficie)</option>
                          <option value="flat">Piatta</option>
                          <option value="minimal">Minima (solo triangoli del bordo)</option>
                        </select>
                      </label>

                      {holeAnalysis.holes.some((h) => h.isOuterBorder) && (
                        <label className="flex items-start gap-2 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            checked={excludeOuterBorder}
                            onChange={(e) => setExcludeOuterBorder(e.target.checked)}
                            className="mt-0.5"
                          />
                          <span>Escludi il bordo esterno della scansione da “Chiudi tutti”</span>
                        </label>
                      )}

                      <button
                        type="button"
                        onClick={fillAllHoles}
                        disabled={repairBusy || holeAnalysis.holes.every((h) => excludeOuterBorder && h.isOuterBorder)}
                        className="w-full px-3 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {repairBusy ? '⏳ Elaborazione...' : 'Chiudi tutti i fori'}
                      </button>

                      <div className="text-[11px] text-slate-500">
                        I bordi dei fori sono evidenziati in rosso. Clicca il numero nella vista 3D
                        oppure il tasto “Chiudi” con lo stesso numero.
                      </div>

                      <div className="space-y-1.5">
                        {(() => {
                          const { labels } = holeAnalysis
                          return sortHolesByLabel(holeAnalysis.holes, labels).map((hole) => {
                            const label = labels.get(hole.id)
                            const color = hexColor(
                              hole.id === selectedHoleId ? HOLE_COLORS.selected : hole.isOuterBorder ? HOLE_COLORS.outer : HOLE_COLORS.hole
                            )
                            return (
                              <div
                                key={hole.id}
                                onClick={() => setSelectedHoleId(hole.id === selectedHoleId ? null : hole.id)}
                                className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs cursor-pointer ${
                                  hole.id === selectedHoleId ? 'border-orange-400 bg-orange-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white border-2 border-white shadow"
                                    style={{ backgroundColor: color }}
                                  >
                                    {label}
                                  </span>
                                  <div className="min-w-0">
                                    <div className="font-semibold text-slate-800">
                                      {hole.isOuterBorder ? 'Bordo esterno' : `Foro ${label}`}
                                    </div>
                                    <div className="text-slate-500">
                                      {hole.edgeCount} lati · perimetro {hole.perimeter.toFixed(2)}
                                    </div>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    fillHolesByIds([hole.id])
                                  }}
                                  disabled={repairBusy}
                                  className="shrink-0 px-2.5 py-1 rounded-md bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  Chiudi {label}
                                </button>
                              </div>
                            )
                          })
                        })()}
                      </div>
                    </>
                  )}
                </>
              ) : null}

              {repairMessage && <div className="text-xs text-slate-700">{repairMessage}</div>}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={undoLastRepair}
                  disabled={repairBusy || repairUndoRef.current.length === 0}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  ↶ Annulla chiusura
                </button>
                <button
                  type="button"
                  onClick={downloadRepairedMesh}
                  disabled={repairBusy || !meshes[selectedMeshIndex]}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  ⬇ Scarica STL
                </button>
              </div>
            </div>
          </div>
        )}

        {showSimplifyPanel && alignmentMode !== 'point-align' && meshes[selectedMeshIndex] && (() => {
          const geometry = meshes[selectedMeshIndex].geometry
          const currentTriangles = Math.floor(geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3)
          const expectedTriangles = Math.max(4, Math.round(currentTriangles * (1 - reductionPercent / 100)))
          const setPercent = (value) => setReductionPercent(Math.min(100, Math.max(0, Math.round(Number(value) || 0))))
          return (
            <div className="absolute bottom-8 left-8 w-[360px] bg-white/95 border border-slate-200 rounded-2xl shadow-2xl backdrop-blur-sm text-slate-800">
              <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-200">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Semplifica Mesh</div>
                  <div className="text-xs text-slate-500 truncate max-w-[260px]">{meshes[selectedMeshIndex].name}</div>
                </div>
                <button
                  type="button"
                  onClick={toggleSimplifyPanel}
                  className="h-7 w-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100"
                  aria-label="Chiudi Semplifica mesh"
                >
                  ×
                </button>
              </div>

              <div className="px-4 py-3 space-y-3">
                <div className="grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-3 text-sm">
                  <span className="text-slate-600">Numero di triangoli</span>
                  <span className="font-semibold text-slate-900 tabular-nums">{currentTriangles.toLocaleString('it-IT')}</span>

                  <label className="text-slate-600" htmlFor="simplify-percent">Forza riduzione</label>
                  <div className="flex items-center gap-2">
                    <input
                      id="simplify-percent"
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={reductionPercent}
                      onChange={(e) => setPercent(e.target.value)}
                      disabled={isSimplifying}
                      className="flex-1 min-w-0 accent-sky-600"
                    />
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={reductionPercent}
                      onChange={(e) => setPercent(e.target.value)}
                      disabled={isSimplifying}
                      className="w-14 px-1.5 py-0.5 border border-slate-300 rounded-md text-sm text-right tabular-nums"
                      aria-label="Forza riduzione in percentuale"
                    />
                    <span className="text-slate-500">%</span>
                  </div>
                </div>

                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={showWireframe} onChange={(e) => setShowWireframe(e.target.checked)} />
                  Mostra triangoli
                </label>

                <div className="text-xs text-slate-500 tabular-nums">
                  Risultato: circa <span className="font-semibold text-slate-700">{expectedTriangles.toLocaleString('it-IT')}</span> triangoli
                </div>
                {reductionPercent >= 90 && (
                  <div className="text-[11px] text-amber-700">
                    Riduzioni molto alte alterano visibilmente la forma; oltre il 75% circa anche il bordo di una
                    scansione aperta viene semplificato.
                  </div>
                )}

                <button
                  type="button"
                  onClick={simplifyMesh}
                  disabled={isSimplifying || reductionPercent === 0}
                  className="w-full px-3 py-2.5 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSimplifying ? '⏳ Semplificazione in corso...' : 'Semplifica'}
                </button>
              </div>
            </div>
          )
        })()}

        {showIsolatedPanel && alignmentMode !== 'point-align' && meshes[selectedMeshIndex] && (() => {
          const analysis = isolatedAnalysis?.meshIndex === selectedMeshIndex ? isolatedAnalysis : null
          const selectedIds = new Set(isolatedSelection)
          const selectedTriangles = analysis
            ? analysis.components.reduce((sum, c) => sum + (selectedIds.has(c.id) ? c.triangles.length : 0), 0)
            : 0
          const setRatio = (value) => setIsolatedRatio(Math.min(100, Math.max(0, Math.round((Number(value) || 0) * 10) / 10)))
          const canUndo = lastEditUndoable()
          return (
            <div className="absolute bottom-8 left-8 w-[360px] bg-white/95 border border-slate-200 rounded-2xl shadow-2xl backdrop-blur-sm text-slate-800">
              <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-200">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Rimuovi componenti isolati</div>
                  <div className="text-xs text-slate-500 truncate max-w-[260px]">{meshes[selectedMeshIndex].name}</div>
                </div>
                <button
                  type="button"
                  onClick={toggleIsolatedPanel}
                  className="h-7 w-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100"
                  aria-label="Chiudi Rimuovi componenti isolati"
                >
                  ×
                </button>
              </div>

              <div className="px-4 py-3 space-y-3">
                <div className="grid grid-cols-[130px_1fr] items-center gap-x-3 gap-y-3 text-sm">
                  <span className="text-slate-600">Componenti trovati</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {analysis ? analysis.components.length.toLocaleString('it-IT') : '…'}
                  </span>

                  <label className="text-slate-600" htmlFor="isolated-ratio">Rapporto Dimensione</label>
                  <div className="flex items-center gap-2">
                    <input
                      id="isolated-ratio"
                      type="range"
                      min="0"
                      max="100"
                      step="0.5"
                      value={isolatedRatio}
                      onChange={(e) => setRatio(e.target.value)}
                      disabled={isolatedBusy}
                      className="flex-1 min-w-0 accent-sky-600"
                    />
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={isolatedRatio}
                      onChange={(e) => setRatio(e.target.value)}
                      disabled={isolatedBusy}
                      className="w-14 px-1.5 py-0.5 border border-slate-300 rounded-md text-sm text-right tabular-nums"
                      aria-label="Rapporto dimensione in percentuale"
                    />
                    <span className="text-slate-500">%</span>
                  </div>
                </div>

                <div className="text-xs text-slate-500">
                  Seleziona i pezzi la cui dimensione è al massimo questa percentuale della dimensione della mesh. Il
                  componente principale non viene mai selezionato.
                </div>

                <div className="text-xs text-slate-600 tabular-nums">
                  {isolatedBusy && !analysis ? (
                    '⏳ Analisi dei componenti in corso...'
                  ) : (
                    <>
                      Selezionati:{' '}
                      <span className="font-semibold text-red-600">{isolatedSelection.length.toLocaleString('it-IT')}</span>{' '}
                      {isolatedSelection.length === 1 ? 'componente' : 'componenti'} (
                      {selectedTriangles.toLocaleString('it-IT')} triangoli)
                    </>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setIsolatedSelection([])}
                    disabled={isolatedBusy || isolatedSelection.length === 0}
                    className="px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancella Selezione
                  </button>
                  <button
                    type="button"
                    onClick={removeIsolatedComponents}
                    disabled={isolatedBusy || isolatedSelection.length === 0}
                    className="px-3 py-2.5 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isolatedBusy && analysis ? '⏳ Rimozione...' : 'Rimuovi'}
                  </button>
                </div>

                {canUndo && (
                  <button
                    type="button"
                    onClick={undoLastEdit}
                    disabled={isolatedBusy}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    ↶ Annulla ultima modifica
                  </button>
                )}
              </div>
            </div>
          )
        })()}

        {showOffsetPanel && alignmentMode !== 'point-align' && meshes[selectedMeshIndex] && (() => {
          const ready = brushData?.meshIndex === selectedMeshIndex
          const diagonal = ready ? brushData.mesh.diagonal : 1
          // unità "tonda" in base alla grandezza della mesh, per limiti e passi dei cursori
          const unit = 10 ** Math.floor(Math.log10(Math.max(diagonal, 1e-6) / 100))
          const step = unit / 10
          const decimals = Math.max(0, -Math.round(Math.log10(step)))
          const roundTo = (value) => Math.round(value / step) * step
          const maxDiameter = Math.max(unit * 10, Math.ceil((diagonal * 0.3) / unit) * unit)
          const maxDistance = Math.max(unit * 10, Math.ceil((diagonal * 0.1) / unit) * unit)
          const setDiameter = (value) => setBrushDiameter(Math.min(maxDiameter, Math.max(step, roundTo(Number(value) || 0))))
          const setDistance = (value) =>
            setOffsetDistance(Math.min(maxDistance, Math.max(-maxDistance, roundTo(Number(value) || 0))))
          const canUndo = lastEditUndoable()
          const numberClass = 'w-16 px-1.5 py-0.5 border border-slate-300 rounded-md text-sm text-right tabular-nums'
          return (
            <div className="absolute bottom-8 left-8 w-[360px] bg-white/95 border border-slate-200 rounded-2xl shadow-2xl backdrop-blur-sm text-slate-800">
              <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-200">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Offset con pennello</div>
                  <div className="text-xs text-slate-500 truncate max-w-[260px]">{meshes[selectedMeshIndex].name}</div>
                </div>
                <button
                  type="button"
                  onClick={toggleOffsetPanel}
                  className="h-7 w-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100"
                  aria-label="Chiudi Offset con pennello"
                >
                  ×
                </button>
              </div>

              <div className="px-4 py-3 space-y-3">
                {!ready ? (
                  <div className="text-xs text-slate-600">⏳ Preparazione del pennello in corso...</div>
                ) : (
                  <>
                    <Toggle checked={offsetSeparate} onChange={setOffsetSeparate} label="Salva come Parti Separate" />

                    <div className="grid grid-cols-[130px_1fr] items-center gap-x-3 gap-y-3 text-sm">
                      <label className="text-slate-600" htmlFor="brush-diameter">Dimensione Strumento</label>
                      <div className="flex items-center gap-2">
                        <input
                          id="brush-diameter"
                          type="range"
                          min={step}
                          max={maxDiameter}
                          step={step}
                          value={brushDiameter}
                          onChange={(e) => setDiameter(e.target.value)}
                          className="flex-1 min-w-0 accent-sky-600"
                        />
                        <input
                          type="number"
                          min={step}
                          max={maxDiameter}
                          step={step}
                          value={Number(brushDiameter.toFixed(decimals))}
                          onChange={(e) => setDiameter(e.target.value)}
                          className={numberClass}
                          aria-label="Dimensione dello strumento in mm"
                        />
                        <span className="text-slate-500">mm</span>
                      </div>

                      <label className="text-slate-600" htmlFor="offset-distance">Offset</label>
                      <div className="flex items-center gap-2">
                        <input
                          id="offset-distance"
                          type="range"
                          min={-maxDistance}
                          max={maxDistance}
                          step={step}
                          value={offsetDistance}
                          onChange={(e) => setDistance(e.target.value)}
                          disabled={offsetSelectedCount === 0}
                          className="flex-1 min-w-0 accent-sky-600"
                        />
                        <input
                          type="number"
                          min={-maxDistance}
                          max={maxDistance}
                          step={step}
                          value={Number(offsetDistance.toFixed(decimals))}
                          onChange={(e) => setDistance(e.target.value)}
                          disabled={offsetSelectedCount === 0}
                          className={numberClass}
                          aria-label="Offset in mm"
                        />
                        <span className="text-slate-500">mm</span>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-500">
                      Trascina con il tasto sinistro sulla mesh per colorare la zona; con Shift premuto la cancelli.
                      Trascinando sullo sfondo ruoti la vista. Offset positivo verso l'esterno, negativo verso l'interno.
                    </div>
                    <div className="text-xs text-slate-600 tabular-nums">
                      Vertici selezionati:{' '}
                      <span className="font-semibold text-[#964B00]">{offsetSelectedCount.toLocaleString('it-IT')}</span>
                    </div>

                    <div className="space-y-2">
                      {[
                        ['Cancella Area(e)', () => changeBrushSelection((data) => data.selected.fill(0)), offsetSelectedCount === 0],
                        ['Inverti Area(e)', () => changeBrushSelection(invertSelection), false],
                        ['Seleziona Tutti', () => changeBrushSelection(selectAll), false],
                      ].map(([text, onClick, disabled]) => (
                        <button
                          key={text}
                          type="button"
                          onClick={onClick}
                          disabled={offsetBusy || disabled}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {text}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={applyOffset}
                        disabled={offsetBusy || offsetSelectedCount === 0 || (offsetDistance === 0 && !offsetSeparate)}
                        className="w-full px-3 py-2.5 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Offset
                      </button>
                    </div>

                    <Toggle checked={offsetFromView} onChange={setOffsetFromView} label="Da Vista" />

                    {canUndo && (
                      <button
                        type="button"
                        onClick={undoLastEdit}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        ↶ Annulla ultima modifica
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })()}

        {showMirrorPanel && alignmentMode !== 'point-align' && meshes[selectedMeshIndex] && (
          <div className="absolute bottom-8 left-8 w-[360px] bg-white/95 border border-slate-200 rounded-2xl shadow-2xl backdrop-blur-sm text-slate-800">
            <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-200">
              <div>
                <div className="text-sm font-semibold text-slate-900">Specchia</div>
                <div className="text-xs text-slate-500 truncate max-w-[260px]">{meshes[selectedMeshIndex].name}</div>
              </div>
              <button
                type="button"
                onClick={toggleMirrorPanel}
                className="h-7 w-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100"
                aria-label="Chiudi Specchia"
              >
                ×
              </button>
            </div>

            <div className="px-4 py-3 space-y-3">
              <div className="text-xs text-slate-500">
                Trascina le frecce verdi per spostare il piano, gli anelli rosso e verde per ruotarlo, il punto rosso per
                spostarlo liberamente. La parte trasparente è l'anteprima.
              </div>

              <Toggle checked={mirrorKeepOriginal} onChange={setMirrorKeepOriginal} label="Mantieni originale" />

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={resetMirrorPlane}
                  className="px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Reimposta piano
                </button>
                <button
                  type="button"
                  onClick={applyMirror}
                  className="px-3 py-2.5 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700"
                >
                  Applica
                </button>
              </div>

              {lastEditUndoable() && (
                <button
                  type="button"
                  onClick={undoLastEdit}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50"
                >
                  ↶ Annulla ultima modifica
                </button>
              )}
            </div>
          </div>
        )}

        {cutTool && alignmentMode !== 'point-align' && meshes[selectedMeshIndex] && (() => {
          const ready = brushData?.meshIndex === selectedMeshIndex
          const diagonal = ready ? brushData.mesh.diagonal : 1
          const unit = 10 ** Math.floor(Math.log10(Math.max(diagonal, 1e-6) / 100))
          const step = unit / 10
          const decimals = Math.max(0, -Math.round(Math.log10(step)))
          const maxDiameter = Math.max(unit * 10, Math.ceil((diagonal * 0.3) / unit) * unit)
          const setDiameter = (value) =>
            setBrushDiameter(Math.min(maxDiameter, Math.max(step, Math.round((Number(value) || 0) / step) * step)))
          const help = {
            Pennello: 'Tieni premuto il tasto sinistro sulla mesh e trascina per colorare la parte da eliminare.',
            Lazo: 'Tieni premuto il tasto sinistro e disegna un contorno libero attorno alla parte da eliminare.',
          }[cutTool]
          // riga con cursore e campo numerico (in mm, salvo `options.unit`)
          const numberClass = 'w-16 px-1.5 py-0.5 border border-slate-300 rounded-md text-sm text-right tabular-nums disabled:bg-slate-50'
          const sliderRow = (id, label, value, min, max, onChange, disabled = false, options = {}) => {
            const rowStep = options.step ?? step
            const rowDecimals = options.decimals ?? decimals
            const rowUnit = options.unit ?? 'mm'
            const clampTo = (raw) => Math.min(max, Math.max(min, Math.round((Number(raw) || 0) / rowStep) * rowStep))
            return (
              <>
                <label className={`text-slate-600 ${disabled ? 'opacity-50' : ''}`} htmlFor={id}>{label}</label>
                <div className={`flex items-center gap-2 ${disabled ? 'opacity-50' : ''}`}>
                  <input
                    id={id}
                    type="range"
                    min={min}
                    max={max}
                    step={rowStep}
                    value={value}
                    disabled={disabled}
                    onChange={(e) => onChange(clampTo(e.target.value))}
                    className="flex-1 min-w-0 accent-sky-600 disabled:cursor-not-allowed"
                  />
                  <input
                    type="number"
                    min={min}
                    max={max}
                    step={rowStep}
                    value={Number(value.toFixed(rowDecimals))}
                    disabled={disabled}
                    onChange={(e) => onChange(clampTo(e.target.value))}
                    className={numberClass}
                    aria-label={rowUnit ? `${label} in ${rowUnit}` : label}
                  />
                  <span className="w-6 text-slate-500">{rowUnit}</span>
                </div>
              </>
            )
          }
          const header = (
            <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-200">
              <div>
                <div className="text-sm font-semibold text-slate-900">Taglia con {cutTool}</div>
                <div className="text-xs text-slate-500 truncate max-w-[260px]">{meshes[selectedMeshIndex].name}</div>
              </div>
              <button
                type="button"
                onClick={() => toggleCutTool(cutTool)}
                className="h-7 w-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100"
                aria-label="Chiudi Taglia"
              >
                ×
              </button>
            </div>
          )
          if (cutTool === 'Linea') {
            const curve = ready && curveCut?.meshIndex === brushData.meshIndex ? curveCut : null
            const pointCount = curve ? curve.points.length : 0
            const maxSmoothDistance = Math.max(unit * 10, Math.ceil((diagonal * 0.05) / unit) * unit)
            return (
              <div className="absolute bottom-8 left-8 w-[360px] bg-white/95 border border-slate-200 rounded-2xl shadow-2xl backdrop-blur-sm text-slate-800">
                {header}
                <div className="px-4 py-3 space-y-3">
                  {!ready ? (
                    <div className="text-xs text-slate-600">⏳ Preparazione in corso...</div>
                  ) : (
                    <>
                      <div className="text-xs text-slate-500">
                        Clicca sulla mesh per aggiungere i punti: la linea segue la superficie. Per chiudere il contorno clicca
                        sul primo punto. Trascina un punto per spostarlo, Ctrl+Z (o Canc) toglie l&apos;ultimo (su una linea chiusa la
                        riapre). La parte marrone viene eliminata.
                        Per ruotare la vista trascina sullo sfondo o usa il tasto destro.
                      </div>

                      <div className="flex flex-col items-start gap-2.5">
                        <Toggle checked={curveCloseHole} onChange={setCurveCloseHole} label="Chiudi Foro" />
                        <Toggle checked={curveSaveParts} onChange={setCurveSaveParts} label="Salva Parti Tagliate" />
                      </div>

                      <button
                        type="button"
                        onClick={clearCut}
                        disabled={pointCount === 0 || cutBusy}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Annulla Curva
                      </button>

                      <div className="flex flex-col items-start gap-2.5">
                        <Toggle checked={curveInvert} onChange={setCurveInvert} label="Inverti Area Taglio" />
                        <Toggle checked={curveSmooth} onChange={setCurveSmooth} label="Tensione Spigoli" />
                      </div>

                      <div className="grid grid-cols-[130px_1fr] items-center gap-x-3 gap-y-3 text-sm">
                        {sliderRow('curve-smooth-strength', 'Forza Lisciatura', curveSmoothStrength, 1, 50, setCurveSmoothStrength, !curveSmooth, {
                          step: 1,
                          decimals: 0,
                          unit: '',
                        })}
                        {sliderRow('curve-smooth-distance', 'Distanza Lisciatura', Math.min(curveSmoothDistance, maxSmoothDistance), 0, maxSmoothDistance, setCurveSmoothDistance, !curveSmooth)}
                      </div>

                      <div className="text-xs text-slate-600 tabular-nums">
                        Punti: <span className="font-semibold text-slate-900">{pointCount}</span>
                        {' · '}Triangoli da tagliare:{' '}
                        <span className="font-semibold text-[#964B00]">{curvePreview.count.toLocaleString('it-IT')}</span>
                      </div>
                      {curve && !curve.closed && pointCount > 0 && (
                        <div className="text-xs text-slate-600">
                          {pointCount >= 3 ? '👉 Clicca sul primo punto per chiudere la linea.' : 'Aggiungi almeno 3 punti, poi chiudi la linea sul primo.'}
                        </div>
                      )}
                      {curve?.closed && curvePreview.error && <div className="text-xs text-red-600">⚠️ {curvePreview.error}</div>}

                      <button
                        type="button"
                        onClick={applyCurveCut}
                        disabled={!curvePaths?.loop || curvePreview.count === 0 || cutBusy}
                        className="w-full px-3 py-2.5 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {cutBusy ? '⏳ Taglio...' : 'Taglia'}
                      </button>

                      {lastEditUndoable() && (
                        <button
                          type="button"
                          onClick={undoLastEdit}
                          disabled={cutBusy}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          ↶ Annulla ultima modifica
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          }
          if (cutTool === 'Area') {
            const area = ready && areaCut?.meshIndex === brushData.meshIndex ? areaCut : null
            const pointCount = area ? area.points.length : 0
            const maxOffset = Math.max(unit * 10, Math.ceil((diagonal * 0.05) / unit) * unit)
            const maxDepth = Math.max(unit * 20, Math.ceil((diagonal * 0.2) / unit) * unit)
            return (
              <div className="absolute bottom-8 left-8 w-[360px] bg-white/95 border border-slate-200 rounded-2xl shadow-2xl backdrop-blur-sm text-slate-800">
                <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-200">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Taglia con Area</div>
                    <div className="text-xs text-slate-500 truncate max-w-[260px]">{meshes[selectedMeshIndex].name}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleCutTool('Area')}
                    className="h-7 w-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100"
                    aria-label="Chiudi Taglia"
                  >
                    ×
                  </button>
                </div>

                <div className="px-4 py-3 space-y-3">
                  {!ready ? (
                    <div className="text-xs text-slate-600">⏳ Preparazione in corso...</div>
                  ) : (
                    <>
                      <div className="text-xs text-slate-500">
                        Clicca con il tasto sinistro per aggiungere i punti del contorno; trascina un punto per spostarlo, Ctrl+Z (o Canc) toglie
                        l&apos;ultimo. Il taglio segue la direzione della vista del primo punto. Per ruotare la vista usa il tasto destro.
                      </div>

                      <div className="grid grid-cols-[130px_1fr] items-center gap-x-3 gap-y-3 text-sm">
                        {sliderRow('area-cut-offset', 'Offset', areaOffset, 0, maxOffset, setAreaOffset)}
                        {sliderRow('area-cut-depth', 'Profondità Fresatura', Math.min(areaDepth, maxDepth), step, maxDepth, setAreaDepth, !areaMaterialCut)}
                      </div>

                      <div className="flex flex-col items-start gap-2.5">
                        <Toggle checked={areaMaterialCut} onChange={setAreaMaterialCut} label="Taglio del Materiale" />
                        <Toggle checked={areaSaveParts} onChange={setAreaSaveParts} label="Salva Parti Tagliate" />
                        <Toggle checked={areaInvert} onChange={setAreaInvert} label="Inverti Selezione" />
                      </div>

                      <div className="text-xs text-slate-600 tabular-nums">
                        Punti: <span className="font-semibold text-slate-900">{pointCount}</span>
                        {' · '}Vertici da tagliare:{' '}
                        <span className="font-semibold text-fuchsia-600">{offsetSelectedCount.toLocaleString('it-IT')}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={clearCut}
                          disabled={pointCount === 0 || cutBusy}
                          className="px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Deseleziona
                        </button>
                        <button
                          type="button"
                          onClick={applyAreaCut}
                          disabled={pointCount < 3 || cutBusy}
                          className="px-3 py-2.5 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {cutBusy ? '⏳ Taglio...' : 'Taglia'}
                        </button>
                      </div>

                      {lastEditUndoable() && (
                        <button
                          type="button"
                          onClick={undoLastEdit}
                          disabled={cutBusy}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          ↶ Annulla ultima modifica
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          }
          return (
            <div className="absolute bottom-8 left-8 w-[360px] bg-white/95 border border-slate-200 rounded-2xl shadow-2xl backdrop-blur-sm text-slate-800">
              <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-200">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Taglia con {cutTool}</div>
                  <div className="text-xs text-slate-500 truncate max-w-[260px]">{meshes[selectedMeshIndex].name}</div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleCutTool(cutTool)}
                  className="h-7 w-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100"
                  aria-label="Chiudi Taglia"
                >
                  ×
                </button>
              </div>

              <div className="px-4 py-3 space-y-3">
                {!ready ? (
                  <div className="text-xs text-slate-600">⏳ Preparazione in corso...</div>
                ) : (
                  <>
                    <div className="text-xs text-slate-500">
                      {help}{' '}
                      {cutTool === 'Pennello'
                        ? 'Con Shift premuto cancelli. Trascinando sullo sfondo ruoti la vista.'
                        : 'Con Shift premuto togli dalla selezione. Per ruotare la vista usa il tasto destro.'}
                    </div>

                    {cutTool === 'Pennello' && (
                      <div className="grid grid-cols-[130px_1fr] items-center gap-x-3 text-sm">
                        <label className="text-slate-600" htmlFor="cut-brush-diameter">Dimensione Strumento</label>
                        <div className="flex items-center gap-2">
                          <input
                            id="cut-brush-diameter"
                            type="range"
                            min={step}
                            max={maxDiameter}
                            step={step}
                            value={brushDiameter}
                            onChange={(e) => setDiameter(e.target.value)}
                            className="flex-1 min-w-0 accent-sky-600"
                          />
                          <input
                            type="number"
                            min={step}
                            max={maxDiameter}
                            step={step}
                            value={Number(brushDiameter.toFixed(decimals))}
                            onChange={(e) => setDiameter(e.target.value)}
                            className="w-16 px-1.5 py-0.5 border border-slate-300 rounded-md text-sm text-right tabular-nums"
                            aria-label="Dimensione dello strumento in mm"
                          />
                          <span className="text-slate-500">mm</span>
                        </div>
                      </div>
                    )}

                    <div className="text-xs text-slate-600 tabular-nums">
                      Vertici selezionati:{' '}
                      <span className="font-semibold text-[#964B00]">{offsetSelectedCount.toLocaleString('it-IT')}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          changeBrushSelection((data) => data.selected.fill(0))
                          clearCut()
                        }}
                        disabled={offsetSelectedCount === 0 && !cutDraw}
                        className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Cancella Selezione
                      </button>
                      <button
                        type="button"
                        onClick={() => changeBrushSelection(invertSelection)}
                        className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Inverti Selezione
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={applyCut}
                      disabled={offsetSelectedCount === 0}
                      className="w-full px-3 py-2.5 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Elimina selezione
                    </button>

                    {lastEditUndoable() && (
                      <button
                        type="button"
                        onClick={undoLastEdit}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        ↶ Annulla ultima modifica
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })()}

        {borderTool && alignmentMode !== 'point-align' && meshes[selectedMeshIndex] && (() => {
          const numberClass = 'w-16 px-1.5 py-0.5 border border-slate-300 rounded-md text-sm text-right tabular-nums'
          const slider = (id, label, value, setValue, min, max, step, unitLabel) => (
            <>
              <label className="text-slate-600" htmlFor={id}>{label}</label>
              <div className="flex items-center gap-2">
                <input
                  id={id}
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={value}
                  onChange={(e) => setValue(Number(e.target.value))}
                  disabled={borderBusy}
                  className="flex-1 min-w-0 accent-sky-600"
                />
                <input
                  type="number"
                  step={step}
                  value={value}
                  onChange={(e) => setValue(Number(e.target.value) || 0)}
                  disabled={borderBusy}
                  className={numberClass}
                  aria-label={label}
                />
                {unitLabel && <span className="text-slate-500">{unitLabel}</span>}
              </div>
            </>
          )
          const description = {
            'Raddrizza bordo': 'Leviga il bordo aperto togliendo le irregolarità, senza accorciarlo.',
            'Ricostruisci bordo':
              'Elimina i triangoli a punta e quelli molto schiacciati lungo il bordo aperto, poi lo leviga leggermente.',
            'Estendi bordo': 'Aggiunge una fascia di triangoli oltre il bordo aperto, lunga la distanza scelta.',
          }[borderTool]
          return (
            <div className="absolute bottom-8 left-8 w-[360px] bg-white/95 border border-slate-200 rounded-2xl shadow-2xl backdrop-blur-sm text-slate-800">
              <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-200">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{borderTool}</div>
                  <div className="text-xs text-slate-500 truncate max-w-[260px]">{meshes[selectedMeshIndex].name}</div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleBorderTool(borderTool)}
                  className="h-7 w-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100"
                  aria-label={`Chiudi ${borderTool}`}
                >
                  ×
                </button>
              </div>

              <div className="px-4 py-3 space-y-3">
                <div className="text-xs text-slate-500">{description}</div>

                {borderTool !== 'Ricostruisci bordo' && (
                  <Toggle checked={borderOnlyOuter} onChange={setBorderOnlyOuter} label="Solo bordo esterno" />
                )}

                <div className="grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-3 text-sm">
                  {borderTool === 'Raddrizza bordo' && (
                    <>
                      {slider('border-iterations', 'Iterazioni', borderIterations, (v) => setBorderIterations(Math.min(100, Math.max(1, Math.round(v)))), 1, 50, 1)}
                      {slider('border-strength', 'Intensità', borderStrength, (v) => setBorderStrength(Math.min(1, Math.max(0.05, v))), 0.05, 1, 0.05)}
                    </>
                  )}
                  {borderTool === 'Ricostruisci bordo' &&
                    slider('border-passes', 'Passaggi', borderPasses, (v) => setBorderPasses(Math.min(20, Math.max(1, Math.round(v)))), 1, 10, 1)}
                  {borderTool === 'Estendi bordo' && (
                    <>
                      {slider('border-distance', 'Distanza', borderDistance, (v) => setBorderDistance(Math.round(v * 100) / 100), -10, 10, 0.1, 'mm')}
                      <label className="text-slate-600" htmlFor="border-direction">Direzione</label>
                      <select
                        id="border-direction"
                        value={borderDirection}
                        onChange={(e) => setBorderDirection(e.target.value)}
                        disabled={borderBusy}
                        className="px-2 py-1 border border-slate-300 rounded-md text-sm bg-white"
                      >
                        <option value="outward">Prosegui la superficie</option>
                        <option value="axis">Verso la base</option>
                      </select>
                    </>
                  )}
                </div>
                {borderTool === 'Estendi bordo' && (
                  <div className="text-[11px] text-slate-500">
                    "Verso la base" estende in direzione opposta alla normale media della mesh; con una distanza negativa va
                    nel verso contrario.
                  </div>
                )}

                <button
                  type="button"
                  onClick={applyBorderTool}
                  disabled={borderBusy || (borderTool === 'Estendi bordo' && borderDistance === 0)}
                  className="w-full px-3 py-2.5 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {borderBusy ? '⏳ Elaborazione...' : 'Applica'}
                </button>

                {lastEditUndoable() && (
                  <button
                    type="button"
                    onClick={undoLastEdit}
                    disabled={borderBusy}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    ↶ Annulla ultima modifica
                  </button>
                )}
              </div>
            </div>
          )
        })()}

        {remeshPanelVisible && (
          <div className="absolute bottom-8 left-8 w-[380px] max-h-[75%] flex flex-col bg-white/95 border border-slate-200 rounded-2xl shadow-2xl backdrop-blur-sm text-slate-800">
            <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-200">
              <div>
                <div className="text-sm font-semibold text-slate-900">{remeshCompare.title}: prima / dopo</div>
                <div className="text-xs text-slate-500 truncate max-w-[280px]">{remeshCompare.name}</div>
              </div>
              <button
                type="button"
                onClick={() => setRemeshCompare(null)}
                className="h-7 w-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100"
                aria-label="Chiudi confronto prima / dopo"
              >
                ×
              </button>
            </div>

            <div className="px-4 py-3 space-y-3 overflow-y-auto">
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-xs font-semibold" role="group" aria-label="Versione mostrata">
                  {[
                    ['before', 'Prima'],
                    ['after', 'Dopo'],
                  ].map(([value, text]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => showRemeshVersion(value)}
                      aria-pressed={remeshView === value}
                      className={`px-3 py-1.5 ${remeshView === value ? 'bg-sky-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={showWireframe} onChange={(e) => setShowWireframe(e.target.checked)} />
                  Mostra triangoli
                </label>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] text-slate-500">
                  Lunghezza degli spigoli (% sul totale). Una distribuzione stretta e alta indica triangoli
                  di dimensione uniforme.
                </div>
                <EdgeHistogram title="Prima" bins={remeshCompare.histograms.before} max={remeshCompare.histograms.max} yMax={remeshCompare.histograms.yMax} />
                <EdgeHistogram title="Dopo" bins={remeshCompare.histograms.after} max={remeshCompare.histograms.max} yMax={remeshCompare.histograms.yMax} />
              </div>

              {remeshCompare.stats?.before && remeshCompare.stats?.after && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="text-left font-medium py-1"></th>
                      <th className="text-right font-medium py-1">Prima</th>
                      <th className="text-right font-medium py-1">Dopo</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-800">
                    {[
                      ['Triangoli', (s) => s.triangles.toLocaleString('it-IT')],
                      ['Spigolo medio', (s) => formatLength(s.edgeMean)],
                      ['Spigolo min / max', (s) => `${formatLength(s.edgeMin)} / ${formatLength(s.edgeMax)}`],
                      ['Irregolarità spigoli', (s) => `${Math.round(s.edgeVariation * 100)}%`],
                      ['Triangoli allungati', (s) => `${s.elongatedPercent.toFixed(1)}%`],
                      ['Facce auto-intersecanti', (s) => (s.selfIntersectingFaces ?? '–').toLocaleString('it-IT')],
                    ].map(([label, format]) => (
                      <tr key={label} className="border-t border-slate-100">
                        <td className="py-1 text-slate-600">{label}</td>
                        <td className="py-1 text-right tabular-nums">{format(remeshCompare.stats.before)}</td>
                        <td className="py-1 text-right tabular-nums font-semibold">{format(remeshCompare.stats.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="text-[11px] text-slate-500">
                Alla chiusura del pannello la mesh resta nella versione selezionata ({remeshView === 'after' ? 'dopo' : 'prima'} l'operazione).
              </div>
            </div>
          </div>
        )}

        {/* Suggerimenti interazione - in basso a destra */}
        <div className="absolute bottom-8 right-8 bg-slate-900/80 backdrop-blur-sm text-white text-xs px-3 py-2 rounded-lg space-y-1 shadow-lg pointer-events-none">
          <p>🖱️ Trascina per ruotare</p>
          <p>🔍 Rotella per zoom</p>
        </div>

        {alignmentMode === 'point-align' && (
          <div className="absolute inset-0 p-4 pointer-events-auto">
            <div className="grid grid-cols-2 gap-4 h-full pointer-events-auto">
              <div className="bg-white/95 border border-slate-200 rounded-3xl overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                  <div className="text-sm font-semibold text-slate-900 mb-2">Target fisso</div>
                  <div className="flex gap-1 flex-wrap">
                    {['#ffaa7f','#7faaff','#aa7fff','#7fffaa','#ffff7f','#ff7fff','#ffffff','#222222'].map((c) => (
                      <button
                        key={`fixed-${c}`}
                        onClick={(e) => { e.stopPropagation(); changeAlignmentMeshColor(alignTargetIndex, c) }}
                        title="Colore"
                        style={{ backgroundColor: c, width: 20, height: 20, borderRadius: 4, border: meshes[alignTargetIndex] && meshes[alignTargetIndex].color === c ? '2px solid #000' : '1px solid rgba(15,23,42,0.12)'}}
                        className="transition"
                      />
                    ))}
                  </div>
                </div>
                <div ref={alignmentLeftContainerRef} className="render-bg flex-1 overflow-hidden min-h-[280px]" />
              </div>
              <div className="bg-white/95 border border-slate-200 rounded-3xl overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                  <div className="text-sm font-semibold text-slate-900 mb-2">Source mobile</div>
                  <div className="flex gap-1 flex-wrap">
                    {['#ffaa7f','#7faaff','#aa7fff','#7fffaa','#ffff7f','#ff7fff','#ffffff','#222222'].map((c) => (
                      <button
                        key={`moving-${c}`}
                        onClick={(e) => { e.stopPropagation(); changeAlignmentMeshColor(alignSourceIndex, c) }}
                        title="Colore"
                        style={{ backgroundColor: c, width: 20, height: 20, borderRadius: 4, border: meshes[alignSourceIndex] && meshes[alignSourceIndex].color === c ? '2px solid #000' : '1px solid rgba(15,23,42,0.12)'}}
                        className="transition"
                      />
                    ))}
                  </div>
                </div>
                <div ref={alignmentRightContainerRef} className="render-bg flex-1 overflow-hidden min-h-[280px]" />
              </div>
            </div>
            <div className="absolute left-4 right-4 bottom-4 bg-white/95 border border-slate-200 rounded-3xl p-4 shadow-2xl backdrop-blur-sm space-y-3">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Allineamento per punti</div>
                  <div className="text-xs text-slate-500">Seleziona prima un punto sulla mesh target fissa (sinistra), poi un punto corrispondente sulla mesh source mobile (destra).</div>
                </div>
                <button
                  onClick={handlePointAlignment}
                  disabled={pointAlignLoading || !serverOnline}
                  className="px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pointAlignLoading ? '⏳ Calcolo in corso...' : '🧭 Allinea mesh'}
                </button>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleICPPrealign}
                    disabled={pointAlignLoading || !serverOnline}
                    className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {pointAlignLoading ? '⏳ Calcolo in corso...' : '🎯 pre-align ICP'}
                  </button>
                  <div className="text-xs text-slate-500">Allineamento automatico tramite corrispondenze robuste</div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleICPAlignment}
                    disabled={pointAlignLoading || !serverOnline}
                    className="flex-1 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {pointAlignLoading ? '⏳ Calcolo in corso...' : '🔧 Allineamento fine tramite ICP'}
                  </button>
                  <div className="text-xs text-slate-500">Allineamento fine tramite ICP dopo la corrispondenza iniziale</div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-700">Punti selezionati</div>
                  <div className="h-40 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                    {pointPairs.length === 0 ? (
                      <div>Nessuna coppia aggiunta ancora.</div>
                    ) : (
                      pointPairs.map((pair, index) => (
                        <div key={index} className="mb-2 p-2 rounded-lg bg-white border border-slate-200">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="font-semibold text-slate-900">Coppia {index + 1}</div>
                            <button
                              onClick={() => removePointPair(index)}
                              className="text-red-600 hover:text-red-800 text-xs font-semibold"
                              type="button"
                            >
                              Cancella
                            </button>
                          </div>
                          <div className="text-[10px] text-slate-500">Target: [{pair.fixed.map((v) => v.toFixed(3)).join(', ')}]</div>
                          <div className="text-[10px] text-slate-500">Source: [{pair.moving.map((v) => v.toFixed(3)).join(', ')}]</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-700">Stato</div>
                  <div className="min-h-[160px] rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    {alignmentMessage || 'Inizia selezionando il primo punto target fisso.'}
                  </div>
                  <button
                    onClick={resetPointPairs}
                    className="w-full px-3 py-2 rounded-lg bg-white text-slate-900 border border-slate-200 hover:bg-slate-100 text-sm"
                  >
                    🗑️ Ripristina punti
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="w-[330px] border-l border-slate-200 bg-white p-4 text-slate-800 shadow-xl overflow-y-auto">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-[19px] font-semibold text-slate-900">Mesh Caricate</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-lg font-medium text-slate-600 hover:bg-slate-100"
            aria-label="Chiudi modificatore mesh"
          >
            ×
          </button>
        </div>

        <button
          type="button"
          onClick={handleAddMeshClick}
          disabled={isLoadingFile}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border border-sky-700 bg-sky-600 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          <span className="text-xl leading-none">＋</span>
          {isLoadingFile ? 'Caricamento...' : 'Aggiungi Mesh'}
        </button>

        {meshes.length > 0 && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            {meshes.map((mesh, index) => (
              <div
                key={index}
                className={`mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-2 ${selectedMeshIndex === index ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-white'}`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedMeshIndex(index)}
                  className="flex flex-1 items-center justify-between gap-2 overflow-hidden text-left text-sm font-medium text-slate-800"
                >
                  <span className="truncate">{mesh.name}</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleToggleMeshVisibility(index)
                    }}
                    className="flex h-7 items-center justify-center rounded-md border border-slate-300 px-2 text-[10px] font-semibold uppercase tracking-wide"
                    style={{
                      backgroundColor: mesh.visible ? '#f5b38c' : '#dbeaf5',
                      color: mesh.visible ? '#0f172a' : '#334155',
                    }}
                    title={mesh.visible ? 'Nascondi mesh' : 'Mostra mesh'}
                  >
                    {mesh.visible ? 'Visible' : 'Hidden'}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemoveMesh(index)
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-lg leading-none text-slate-500 hover:bg-slate-100"
                    title="Rimuovi mesh"
                    aria-label={`Rimuovi ${mesh.name}`}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {meshes.length > 0 && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-800">Modifiche memorizzate</span>
              <button
                type="button"
                onClick={undoLastEdit}
                disabled={!lastEditUndoable()}
                className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                title="Annulla l'ultima modifica"
              >
                ↶ Annulla
              </button>
            </div>
            {editHistory.length === 0 ? (
              <div className="text-xs text-slate-500">Nessuna modifica. Ogni strumento usato verrà aggiunto qui, in ordine.</div>
            ) : (
              <ol className="max-h-40 space-y-1 overflow-y-auto text-xs text-slate-700">
                {editHistory.map((step, index) => (
                  <li key={index} className="flex gap-1.5">
                    <span className="w-5 shrink-0 text-right font-semibold text-sky-700 tabular-nums">{index + 1}.</span>
                    <span>
                      {step.label}
                      {meshes.length > 1 && meshes[step.meshIndex] && (
                        <span className="text-slate-400"> — {meshes[step.meshIndex].name}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        <div className="space-y-2.5 pt-1">
          {[
            'Ripara mesh',
            'Ricostruisci Mesh',
            'Remesh Isotropic',
            'Semplifica Mesh',
            'Inverti Normali',
            'Riempi buchi',
            'Rimuovi componenti isolati',
            'Offset con pennello',
            'Specchia',
          ].map((label) => (
            <button
              key={label}
              type="button"
              onClick={
                label === 'Ripara mesh'
                  ? toggleRepairMode
                  : label === 'Ricostruisci Mesh'
                    ? rebuildMesh
                    : label === 'Remesh Isotropic'
                      ? remeshIsotropic
                      : label === 'Semplifica Mesh'
                        ? toggleSimplifyPanel
                        : label === 'Rimuovi componenti isolati'
                          ? toggleIsolatedPanel
                          : label === 'Offset con pennello'
                            ? toggleOffsetPanel
                            : label === 'Specchia'
                              ? toggleMirrorPanel
                              : label === 'Inverti Normali'
                                ? invertNormals
                                : label === 'Riempi buchi'
                                  ? fillAllHolesQuick
                                  : undefined
              }
              disabled={
                (label === 'Ricostruisci Mesh' ||
                  label === 'Remesh Isotropic' ||
                  label === 'Semplifica Mesh' ||
                  (label === 'Riempi buchi' && !fillingHoles)) &&
                (isRebuilding || serverOperationBusy || repairBusy || meshes.length === 0)
              }
              aria-pressed={
                label === 'Ripara mesh'
                  ? repairMode
                  : label === 'Semplifica Mesh'
                    ? showSimplifyPanel
                    : label === 'Rimuovi componenti isolati'
                      ? showIsolatedPanel
                      : label === 'Offset con pennello'
                        ? showOffsetPanel
                        : label === 'Specchia'
                          ? showMirrorPanel
                          : undefined
              }
              className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-[15px] shadow-sm transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 ${
                (label === 'Ripara mesh' && repairMode) ||
                (label === 'Semplifica Mesh' && showSimplifyPanel) ||
                (label === 'Rimuovi componenti isolati' && showIsolatedPanel) ||
                (label === 'Offset con pennello' && showOffsetPanel) ||
                (label === 'Specchia' && showMirrorPanel)
                  ? 'border-sky-400 bg-sky-50 text-sky-800'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              <span className="flex items-center gap-3">
                <span className="flex h-5 w-5 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-[11px] text-sky-700">
                  ✦
                </span>
                <span>
                  {label === 'Ricostruisci Mesh' && isRebuilding
                    ? 'Ricostruzione...'
                    : label === 'Remesh Isotropic' && isRemeshing
                      ? 'Remesh in corso...'
                      : label === 'Semplifica Mesh' && isSimplifying
                        ? 'Semplificazione...'
                        : label === 'Riempi buchi' && fillingHoles
                          ? `Interrompi (${fillingHoles.done}/${fillingHoles.total})`
                          : label}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt-6">
          <h4 className="mb-2 text-[15px] font-semibold text-slate-900">Taglia con</h4>
          <div className="space-y-2.5">
            {['Area', 'Pennello', 'Lazo', 'Linea'].map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleCutTool(label)}
                disabled={meshes.length === 0}
                aria-pressed={cutTool === label}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-[15px] shadow-sm transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 ${
                  cutTool === label ? 'border-sky-400 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-700'
                }`}
              >
                <span className="flex items-center gap-3">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-[11px] text-sky-700">✕</span>
                  <span>{label}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <h4 className="mb-2 text-[15px] font-semibold text-slate-900">Modifica Bordo</h4>
          <div className="space-y-2.5">
            {['Raddrizza bordo', 'Ricostruisci bordo', 'Estendi bordo'].map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleBorderTool(label)}
                disabled={meshes.length === 0}
                aria-pressed={borderTool === label}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-[15px] shadow-sm transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 ${
                  borderTool === label ? 'border-sky-400 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-700'
                }`}
              >
                <span className="flex items-center gap-3">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-[11px] text-sky-700">◌</span>
                  <span>{label}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={discardChanges}
            className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Ignora modifiche
          </button>
          <button
            type="button"
            onClick={openApplyDialog}
            disabled={meshes.length === 0}
            className="flex-1 rounded-xl border border-sky-700 bg-sky-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Applica modifiche
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".stl,.obj,.ply"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {showApplyDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px]">
          <div className="w-[420px] rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 pt-4 pb-3">
              <div>
                <div className="text-base font-semibold text-slate-900">Applica modifiche</div>
                <div className="text-xs text-slate-500">Salva la mesh modificata e riportala nel visualizzatore</div>
              </div>
              <button
                type="button"
                onClick={() => setShowApplyDialog(false)}
                disabled={applyBusy}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100"
                aria-label="Chiudi"
              >
                ×
              </button>
            </div>

            <div className="space-y-4 px-5 py-4 text-sm">
              {(pendingOffset || pendingMirror) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Verranno incluse anche le modifiche in anteprima non ancora confermate:
                  {pendingOffset && <div>• Offset con pennello ({offsetDistance.toLocaleString('it-IT')} mm)</div>}
                  {pendingMirror && <div>• Specchiatura</div>}
                </div>
              )}
              {meshes.length > 1 && (
                <div className="space-y-1.5">
                  <div className="font-medium text-slate-700">Mesh da applicare</div>
                  {[
                    ['selected', `Mesh selezionata (${meshes[selectedMeshIndex]?.name || 'mesh'})`],
                    ['merged', 'Tutte le mesh visibili, unite in una sola'],
                  ].map(([value, text]) => (
                    <label key={value} className="flex items-center gap-2 text-slate-700">
                      <input type="radio" name="apply-target" checked={applyTarget === value} onChange={() => setApplyTarget(value)} />
                      {text}
                    </label>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="font-medium text-slate-700" htmlFor="apply-file-name">Nome del file</label>
                <div className="flex items-center gap-2">
                  <input
                    id="apply-file-name"
                    type="text"
                    value={applyFileName}
                    onChange={(e) => setApplyFileName(e.target.value)}
                    className="flex-1 rounded-md border border-slate-300 px-2.5 py-1.5"
                    autoFocus
                  />
                  <span className="text-slate-500">.stl</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="font-medium text-slate-700">Formato</div>
                {[
                  ['binary', 'STL binario', 'file più piccolo, consigliato'],
                  ['ascii', 'STL ASCII (testo)', 'leggibile con un editor di testo'],
                ].map(([value, text, hint]) => (
                  <label key={value} className="flex items-center gap-2 text-slate-700">
                    <input type="radio" name="apply-format" checked={applyFormat === value} onChange={() => setApplyFormat(value)} />
                    {text}
                    <span className="text-xs text-slate-400">— {hint}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => confirmApply(false)}
                disabled={applyBusy || !applyGeometryAvailable}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Applica senza salvare
              </button>
              <button
                type="button"
                onClick={() => confirmApply(true)}
                disabled={applyBusy || !applyGeometryAvailable || !applyFileName.trim()}
                className="flex-1 rounded-lg bg-sky-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {applyBusy ? '⏳ Salvataggio...' : 'Salva e applica'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
