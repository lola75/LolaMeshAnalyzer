import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import LightingControl from './LightingControl'
import { setupViewerLighting } from '../utils/viewerLighting'
import { analyzeNormals, createNormalVisualization } from '../utils/normalAnalyzer'
import MeshModifier from './MeshModifier'

export default function MeshViewer({
  geometry: geometryProp,
  secondaryGeometry = null,
  secondaryColor = 0x33c1ff,
  secondaryOpacity = 0.45,
  preserveWorldCoordinates = false,
  requireEditConsent,
  onPointsChanged,
  enablePointSelection = false,
  pointSelectionMode = 'modifier',
  primaryVisible = true,
  secondaryVisible = true,
  // Piu' mesh nella stessa vista (pagina principale): la mesh "geometry" e' quella attiva
  // (analisi, triangoli, normali); extraMeshes = altre mesh [{ id, geometry, color }] nello
  // stesso riferimento, extraVisible = { id: true/false }
  primaryColor = 0xffaa7f,
  primaryForceColor = false, // colore scelto dall'utente: vale anche se la mesh ha colori propri
  extraMeshes = null,
  extraVisible = null,
  // Modifica Mesh con piu' mesh: elenco [{ id, name, geometry }] da cui scegliere e callback
  // onApplyEdit(id, geometria modificata); senza, la modifica resta locale come prima
  editableMeshes = null,
  editTargetId = null,
  onApplyEdit = null,
  onOpenMarkerScan = null, // mesh del Modificatore portate in Crea Marker Scan
}) {
  const containerRef = useRef(null)
  const sceneRef = useRef(null)
  const rendererRef = useRef(null)
  const cameraRef = useRef(null)
  const meshRef = useRef(null)
  const secondaryMeshRef = useRef(null)
  const secondaryOverlayRef = useRef(null)
  const extraMeshRefs = useRef(new Map())
  const textureInputRef = useRef(null)
  const appliedTextureRef = useRef(null)
  const [normalAnalysis, setNormalAnalysis] = useState(null)
  const [showNormals, setShowNormals] = useState(false)
  const [showTriangles, setShowTriangles] = useState(false)
  const [showTextureMenu, setShowTextureMenu] = useState(false)
  const [showMeshModifier, setShowMeshModifier] = useState(false)
  // mesh scelta per il Modificatore quando ce ne sono piu' di una
  const [showEditChooser, setShowEditChooser] = useState(false)
  const [editChoiceId, setEditChoiceId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [showEditConsentModal, setShowEditConsentModal] = useState(false)
  // mesh modificata con "Applica modifiche" nel modificatore; torna quella originale se ne arriva una nuova
  const [editedGeometry, setEditedGeometry] = useState(null)
  useEffect(() => setEditedGeometry(null), [geometryProp])
  const geometry = editedGeometry || geometryProp
  const normalsVisualizerRef = useRef(null)
  const textureMenuRef = useRef(null)
  const pointMarkersRef = useRef([]) // Traccia i marker di punti
  const selectedPointsRef = useRef([]) // Traccia i punti selezionati
  const enablePointSelectionRef = useRef(enablePointSelection) // Ref per tenere traccia dello stato
  const pointSelectionModeRef = useRef(pointSelectionMode)
  const onPointsChangedRef = useRef(onPointsChanged) // Ref per il callback

  // Aggiorna il ref quando enablePointSelection cambia
  useEffect(() => {
    enablePointSelectionRef.current = enablePointSelection
  }, [enablePointSelection])

  useEffect(() => {
    pointSelectionModeRef.current = pointSelectionMode
  }, [pointSelectionMode])

  // Aggiorna il ref quando onPointsChanged cambia
  useEffect(() => {
    onPointsChangedRef.current = onPointsChanged
  }, [onPointsChanged])

  const hasEditChoice = Array.isArray(editableMeshes) && editableMeshes.length > 1

  // Dopo il consenso: con piu' mesh si sceglie quale modificare, altrimenti si apre subito
  const openModifierOrChooser = () => {
    if (hasEditChoice) {
      setEditChoiceId(editTargetId ?? editableMeshes[0].id)
      setShowEditChooser(true)
      return
    }
    setEditingId(editableMeshes?.[0]?.id ?? null)
    setShowMeshModifier(true)
  }

  const openMeshModifierWithConsent = () => {
    if (!requireEditConsent) {
      openModifierOrChooser()
      return
    }
    setShowEditConsentModal(true)
  }

  const confirmEditConsent = () => {
    setShowEditConsentModal(false)
    openModifierOrChooser()
  }

  const confirmEditChoice = () => {
    setShowEditChooser(false)
    setEditingId(editChoiceId)
    setShowMeshModifier(true)
  }

  const modifierGeometry = (editingId != null && editableMeshes?.find((m) => m.id === editingId)?.geometry) || geometry

  const cancelEditConsent = () => {
    setShowEditConsentModal(false)
  }
  
  const pivotRef = useRef(null)
  const undoStackRef = useRef([])
  const redoStackRef = useRef([])

  // Close texture menu when clicking outside
  useEffect(() => {
    if (!showTextureMenu) return
    const handleClickOutside = (e) => {
      if (textureMenuRef.current && !textureMenuRef.current.contains(e.target)) {
        setShowTextureMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showTextureMenu])

  const pushSnapshot = () => {
    if (!meshRef.current) return
    try {
      const snap = meshRef.current.geometry.clone()
      undoStackRef.current.push(snap)
      // cap stack
      if (undoStackRef.current.length > 50) undoStackRef.current.shift()
      // clear redo
      redoStackRef.current.length = 0
    } catch (err) {
      console.warn('pushSnapshot failed', err)
    }
  }

  const undo = () => {
    if (undoStackRef.current.length === 0) return
    const last = undoStackRef.current.pop()
    if (!meshRef.current) return
    try {
      const current = meshRef.current.geometry.clone()
      redoStackRef.current.push(current)
      meshRef.current.geometry.copy(last)
      meshRef.current.geometry.computeVertexNormals()
      meshRef.current.geometry.computeBoundingBox()
    } catch (err) {
      console.warn('undo failed', err)
    }
  }

  const redo = () => {
    if (redoStackRef.current.length === 0) return
    const next = redoStackRef.current.pop()
    if (!meshRef.current) return
    try {
      const current = meshRef.current.geometry.clone()
      undoStackRef.current.push(current)
      meshRef.current.geometry.copy(next)
      meshRef.current.geometry.computeVertexNormals()
      meshRef.current.geometry.computeBoundingBox()
    } catch (err) {
      console.warn('redo failed', err)
    }
  }

  useEffect(() => {
    if (!containerRef.current || !geometry) return

    // Reset dei punti selezionati quando viene caricata una nuova geometria
    pointMarkersRef.current = []
    selectedPointsRef.current = []
    console.log('🔴 MeshViewer: Geometria caricata. Reset punti selezionati.')

    // Scene setup
    const scene = new THREE.Scene()
    // Background changed to a light neutral color for better contrast
    // sfondo trasparente: il colore/gradiente viene da --render-bg (globals.css)
    scene.background = null
    sceneRef.current = scene

    // Add lighting
    // le luci (legate alla telecamera) si aggiungono dopo telecamera e mesh: setupViewerLighting

    // Camera
    const width = containerRef.current.clientWidth
    const height = containerRef.current.clientHeight
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000)
    camera.position.z = 5
    // shared camera distance used by pan/zoom handlers
    let cameraZ = camera.position.z
    const cameraTarget = new THREE.Vector3(0, 0, 0)

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
    // Match the scene background (light neutral)
    renderer.setClearColor(0x000000, 0)
    renderer.sortObjects = false
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.style.cursor = 'grab'
    containerRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // PMREM generator for nicer environment lighting (used if env maps are added)
    const pmremGenerator = new THREE.PMREMGenerator(renderer)
    pmremGenerator.compileEquirectangularShader()

    // Create mesh from geometry
    const primaryGeometry = geometry.clone()
    const secondaryGeometryClone = secondaryGeometry ? secondaryGeometry.clone() : null
    const hasVertexColors = !!primaryGeometry.getAttribute('color') && !primaryForceColor

    // Increase vertex color saturation slightly for better visibility
    const increaseSaturation = (geom, factor = 1.25) => {
      const colorAttr = geom.getAttribute('color')
      if (!colorAttr) return
      const arr = colorAttr.array
      // helper conversions
      const rgbToHsl = (r, g, b) => {
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        let h = 0
        let s = 0
        const l = (max + min) / 2
        if (max !== min) {
          const d = max - min
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
          switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break
            case g: h = (b - r) / d + 2; break
            case b: h = (r - g) / d + 4; break
            default: break
          }
          h /= 6
        }
        return [h, s, l]
      }
      const hslToRgb = (h, s, l) => {
        const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1
          if (t > 1) t -= 1
          if (t < 1 / 6) return p + (q - p) * 6 * t
          if (t < 1 / 2) return q
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
          return p
        }
        if (s === 0) return [l, l, l]
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s
        const p = 2 * l - q
        return [
          hue2rgb(p, q, h + 1 / 3),
          hue2rgb(p, q, h),
          hue2rgb(p, q, h - 1 / 3)
        ]
      }

      for (let i = 0; i < arr.length; i += 3) {
        let r = arr[i]
        let g = arr[i + 1]
        let b = arr[i + 2]
        const [h, s, l] = rgbToHsl(r, g, b)
        const newS = Math.min(1, s * factor)
        const [nr, ng, nb] = hslToRgb(h, newS, l)
        arr[i] = Math.max(0, Math.min(1, nr))
        arr[i + 1] = Math.max(0, Math.min(1, ng))
        arr[i + 2] = Math.max(0, Math.min(1, nb))
      }
      colorAttr.needsUpdate = true
    }
    const material = hasVertexColors
      ? new THREE.MeshPhongMaterial({
          color: 0xffffff,
          emissive: 0x000000,
          flatShading: true,
          side: THREE.DoubleSide,
          vertexColors: true,
          shininess: 0,
          wireframe: false
        })
      : new THREE.MeshStandardMaterial({
          color: primaryColor,
          roughness: 0.6,
          metalness: 0.05,
          envMapIntensity: 1,
          flatShading: false,
          side: THREE.DoubleSide,
          vertexColors: false
        })

    if (hasVertexColors) increaseSaturation(primaryGeometry, 1.3)

    // Detect if geometry is a point-cloud (no index and no normals)
    const isPointCloud = (geom) => {
      if (!geom) return false
      const pos = geom.getAttribute && geom.getAttribute('position')
      const idx = geom.index
      const normals = geom.getAttribute && geom.getAttribute('normal')
      if (!pos) return false
      // Heuristic: if no index and no normals, treat as point cloud
      return (!idx || idx.count === 0) && !normals
    }

    let mesh = null
    if (isPointCloud(primaryGeometry)) {
      const pointsMat = new THREE.PointsMaterial({
        size: Math.max(0.002, Math.max(primaryGeometry.boundingSphere ? primaryGeometry.boundingSphere.radius * 0.01 : 0.01, 0.002)),
        color: hasVertexColors ? 0xffffff : primaryColor,
        vertexColors: hasVertexColors || false,
        sizeAttenuation: true,
      })
      mesh = new THREE.Points(primaryGeometry, pointsMat)
    } else {
      mesh = new THREE.Mesh(primaryGeometry, material)
    }
    meshRef.current = mesh

    let secondaryMesh = null
    let secondaryOverlay = null
    if (secondaryGeometryClone) {
      if (isPointCloud(secondaryGeometryClone)) {
        const secPointsMat = new THREE.PointsMaterial({
          size: Math.max(0.03, Math.max(secondaryGeometryClone.boundingSphere ? secondaryGeometryClone.boundingSphere.radius * 0.06 : 0.03, 0.03)),
          color: secondaryColor,
          vertexColors: false,
          opacity: Math.max(secondaryOpacity, 0.95),
          transparent: true,
          depthWrite: false,
          depthTest: false,
          sizeAttenuation: true,
        })
        secondaryMesh = new THREE.Points(secondaryGeometryClone, secPointsMat)
        secondaryMesh.renderOrder = 2
        secondaryMeshRef.current = secondaryMesh
      } else {
        const secondaryMaterial = new THREE.MeshStandardMaterial({
          color: new THREE.Color(secondaryColor),
          transparent: true,
          opacity: Math.max(secondaryOpacity, 0.4),
          roughness: 0.6,
          metalness: 0.05,
          side: THREE.DoubleSide,
          depthWrite: false,
          depthTest: false,
        })
        secondaryMesh = new THREE.Mesh(secondaryGeometryClone, secondaryMaterial)
        secondaryMesh.renderOrder = 2
        secondaryMeshRef.current = secondaryMesh

        const edgeGeo = new THREE.EdgesGeometry(secondaryGeometryClone, 15)
        const edgeMat = new THREE.LineBasicMaterial({
          color: 0x00ffff,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        })
        secondaryOverlay = new THREE.LineSegments(edgeGeo, edgeMat)
        secondaryOverlay.renderOrder = 3
      }
    }
    secondaryOverlayRef.current = secondaryOverlay

    const extraObjects = []
    extraMeshRefs.current = new Map()
    for (const extra of extraMeshes || []) {
      if (!extra?.geometry) continue
      const extraGeometry = extra.geometry.clone()
      const extraHasColors = !!extraGeometry.getAttribute('color') && !extra.forceColor
      const extraMaterial = new THREE.MeshStandardMaterial({
        color: extraHasColors ? 0xffffff : extra.color,
        vertexColors: extraHasColors,
        roughness: 0.6,
        metalness: 0.05,
        side: THREE.DoubleSide,
      })
      const extraMesh = new THREE.Mesh(extraGeometry, extraMaterial)
      extraMesh.visible = extraVisible?.[extra.id] ?? true
      extraObjects.push(extraMesh)
      extraMeshRefs.current.set(extra.id, extraMesh)
    }

    const boundingBox = new THREE.Box3().setFromObject(mesh)
    if (secondaryMesh) {
      boundingBox.expandByObject(secondaryMesh)
    }
    for (const extraMesh of extraObjects) boundingBox.expandByObject(extraMesh)
    const center = boundingBox.getCenter(new THREE.Vector3())
    const size = boundingBox.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const fov = camera.fov * (Math.PI / 180)
    cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2))
    if (!Number.isFinite(cameraZ) || cameraZ <= 0) {
      cameraZ = 5
    }
    cameraZ *= 1.5

    if (!preserveWorldCoordinates) {
      mesh.geometry.translate(-center.x, -center.y, -center.z)
      if (secondaryMesh) secondaryMesh.geometry.translate(-center.x, -center.y, -center.z)
      if (secondaryOverlay) secondaryOverlay.geometry.translate(-center.x, -center.y, -center.z)
      for (const extraMesh of extraObjects) extraMesh.geometry.translate(-center.x, -center.y, -center.z)
    }

    mesh.position.set(0, 0, 0)

    const pivot = new THREE.Group()
    pivot.add(mesh)
    if (secondaryMesh) {
      pivot.add(secondaryMesh)
    }
    if (secondaryOverlay) {
      pivot.add(secondaryOverlay)
    }
    for (const extraMesh of extraObjects) pivot.add(extraMesh)
    scene.add(pivot)
    pivotRef.current = pivot

    // Position camera to look at origin (pivot)
    camera.position.set(0, 0, cameraZ)
    camera.lookAt(new THREE.Vector3(0, 0, 0))
    cameraRef.current = camera

    // illuminazione condivisa con le altre viste (stile e luminosita' dal pulsante "Luce")
    const lighting = setupViewerLighting(scene, camera, renderer)

    // Analizza normali
    const analysis = analyzeNormals(geometry)
    setNormalAnalysis(analysis)

    // Add wireframe visualization toggle
    let wireframeMode = false

    // Interaction controls: rotate, pan, zoom and selection in repair mode
    let mouse = { x: 0, y: 0, isDown: false, button: null, selectionCandidate: false, moved: false }
    let rotation = { x: 0, y: 0 }

    const projectToScreen = (vec) => {
      const v = vec.clone()
      mesh.updateMatrixWorld()
      v.applyMatrix4(mesh.matrixWorld)
      v.project(camera)
      const rect = containerRef.current.getBoundingClientRect()
      const x = (v.x + 1) / 2 * rect.width + rect.left
      const y = (1 - v.y) / 2 * rect.height + rect.top
      return { x, y }
    }

    // Rimozione punti selezionati con Canc/Del
    const clearSelectedPoints = () => {
      pointMarkersRef.current.forEach(marker => {
        if (marker.parent) marker.parent.remove(marker)
      })
      pointMarkersRef.current = []
      selectedPointsRef.current = []
      if (onPointsChangedRef.current) onPointsChangedRef.current([])
    }

    // Raycasting per selezione di punti sulla mesh
    const handlePointSelection = (e) => {
      if (!renderer || !camera || !mesh) {
        console.warn('Renderer, camera o mesh non disponibili')
        return
      }

      const rect = renderer.domElement.getBoundingClientRect()
      const mouseX = (e.clientX - rect.left) / rect.width * 2 - 1
      const mouseY = -(e.clientY - rect.top) / rect.height * 2 + 1
      
      const mouse = new THREE.Vector2(mouseX, mouseY)
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(mouse, camera)
      
      // Interseca il pivot (che contiene il mesh) per considerare le trasformazioni
      const objectToTest = pivotRef.current || mesh
      const intersects = raycaster.intersectObject(objectToTest, true)
      
      if (intersects.length > 0) {
        const point = intersects[0].point.clone()
        mesh.updateMatrixWorld(true)
        
        console.log('Punto selezionato:', point)
        
        // Crea una piccola sfera rossa come marker
        const markerSize = Math.max(0.02, 0.03 * cameraZ)
        const markerGeometry = new THREE.SphereGeometry(markerSize, 16, 16)
        const markerMaterial = new THREE.MeshBasicMaterial({ 
          color: 0xff0000, 
          emissive: 0xff0000,
          depthTest: true,
          renderOrder: 999
        })
        const marker = new THREE.Mesh(markerGeometry, markerMaterial)
        
        // Aggiungi un outline nero per visibilità
        const outlineGeometry = new THREE.SphereGeometry(markerSize * 1.3, 16, 16)
        const outlineMaterial = new THREE.MeshBasicMaterial({
          color: 0x000000,
          side: THREE.BackSide,
          depthTest: true,
          renderOrder: 998
        })
        const outline = new THREE.Mesh(outlineGeometry, outlineMaterial)
        marker.add(outline)
        
        const localPos = mesh.worldToLocal(point.clone())
        marker.position.copy(localPos)
        marker.layers.set(0)
        mesh.add(marker)
        marker.updateMatrixWorld(true)
        
        pointMarkersRef.current.push(marker)
        // Salva la posizione rispetto al mesh (coordinate locali) per consistenza durante trasformazioni
        const posLocalToMesh = mesh.worldToLocal(point.clone()).toArray()
        selectedPointsRef.current.push({
          position: posLocalToMesh,
          name: `Punto ${selectedPointsRef.current.length + 1}`
        })
        
        const totalPoints = selectedPointsRef.current.length
        console.log('🔴 MeshViewer: Punto aggiunto. Totale punti ref:', totalPoints)
        console.log('🔴 Callback ref current:', !!onPointsChangedRef.current)
        if (onPointsChangedRef.current) {
          console.log('🔴 MeshViewer: Calling onPointsChanged with', totalPoints, 'points')
          onPointsChangedRef.current([...selectedPointsRef.current])
        } else {
          console.warn('🔴 MeshViewer: onPointsChangedRef.current is null!')
        }
      } else {
        console.warn('Nessuna intersezione trovata')
      }
    }

    const onPointerDown = (e) => {
      const modifierSelection = e.ctrlKey || e.metaKey
      const clickSelection = pointSelectionModeRef.current === 'click' && !modifierSelection
      if (enablePointSelectionRef.current && e.button === 0 && (modifierSelection || clickSelection)) {
        e.preventDefault()
        if (modifierSelection) {
          handlePointSelection(e)
          return
        }
        mouse.selectionCandidate = true
        mouse.moved = false
        mouse.selectionX = e.clientX
        mouse.selectionY = e.clientY
      }

      mouse.isDown = true
      mouse.button = e.button
      mouse.x = e.clientX
      mouse.y = e.clientY
      if (e.button === 0) {
        renderer.domElement.style.cursor = 'grabbing'
      }
      renderer.domElement.setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e) => {
      if (!mouse.isDown) return

      const deltaX = e.clientX - mouse.x
      const deltaY = e.clientY - mouse.y
      if (mouse.selectionCandidate && Math.hypot(e.clientX - mouse.selectionX, e.clientY - mouse.selectionY) > 5) {
        mouse.moved = true
      }
      mouse.x = e.clientX
      mouse.y = e.clientY

      if (mouse.button === 0) {
        const rotationAxis = new THREE.Vector3(deltaY, deltaX, 0).applyQuaternion(camera.quaternion)
        if (rotationAxis.lengthSq() > 0 && pivotRef.current) {
          const rotation = new THREE.Quaternion().setFromAxisAngle(
            rotationAxis.normalize(),
            Math.hypot(deltaX, deltaY) * 0.005
          )
          pivotRef.current.quaternion.premultiply(rotation).normalize()
        }
      } else {
        const panSpeed = 0.003 * cameraZ
        if (pivotRef.current) {
          pivotRef.current.position.x += deltaX * panSpeed
          pivotRef.current.position.y -= deltaY * panSpeed
        } else {
          mesh.position.x += deltaX * panSpeed
          mesh.position.y -= deltaY * panSpeed
        }
      }
    }

    const onPointerUp = (e) => {
      if (mouse.selectionCandidate && !mouse.moved) {
        handlePointSelection(e)
      }
      mouse.isDown = false
      mouse.button = null
      mouse.selectionCandidate = false
      if (e.button === 0) renderer.domElement.style.cursor = 'grab'
    }

    const onContextMenu = (e) => e.preventDefault()
    const onWheel = (e) => {
      e.preventDefault()
      cameraZ = Math.max(0.5, cameraZ + e.deltaY * 0.01)
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointerleave', onPointerUp)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('contextmenu', onContextMenu)
    renderer.domElement.addEventListener('wheel', onWheel)

    const updateCameraPosition = () => {
      camera.position.set(cameraTarget.x, cameraTarget.y, cameraTarget.z + cameraZ)
      camera.lookAt(cameraTarget)
      camera.updateMatrixWorld()
    }

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate)
      updateCameraPosition()
      renderer.render(scene, camera)
    }
    animate()

    // double click to delete currently selected triangles

    const onKeyDown = (e) => {
      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      // Toggle normals with 'n'
      if (e.key.toLowerCase() === 'n') {
        setShowNormals((s) => !s)
        return
      }
      // Cancella punti selezionati con Delete
      if ((e.key === 'Delete' || e.key === 'Backspace') && enablePointSelectionRef.current) {
        e.preventDefault()
        clearSelectedPoints()
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)

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
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointerleave', onPointerUp)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('contextmenu', onContextMenu)
      renderer.domElement.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('keydown', onKeyDown)
      // dispose created resources
      lighting.dispose()
      pmremGenerator.dispose && pmremGenerator.dispose()
      renderer.dispose()
      material.dispose && material.dispose()
      if (appliedTextureRef.current) {
        appliedTextureRef.current.dispose && appliedTextureRef.current.dispose()
        appliedTextureRef.current = null
      }
      containerRef.current?.removeChild(renderer.domElement)
    }
  }, [geometry, secondaryGeometry, secondaryColor, secondaryOpacity, preserveWorldCoordinates, primaryColor, primaryForceColor, extraMeshes])

  useEffect(() => {
    if (meshRef.current) meshRef.current.visible = primaryVisible
    if (secondaryMeshRef.current) secondaryMeshRef.current.visible = secondaryVisible
    if (secondaryOverlayRef.current) secondaryOverlayRef.current.visible = secondaryVisible
    extraMeshRefs.current.forEach((extraMesh, id) => {
      extraMesh.visible = extraVisible?.[id] ?? true
    })
  }, [primaryVisible, secondaryVisible, extraVisible, extraMeshes])

  const centerMesh = () => {
    const mesh = meshRef.current
    const camera = cameraRef.current
    if (!mesh || !camera) return

    const box = new THREE.Box3().setFromObject(mesh)
    if (box.isEmpty()) return

    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const fov = camera.fov * (Math.PI / 180)
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2))
    cameraZ *= 1.5

    mesh.geometry.translate(-center.x, -center.y, -center.z)
    mesh.position.set(0, 0, 0)
    // If we use a pivot, reset its translation so mesh stays centered for rotation
    if (pivotRef.current) {
      pivotRef.current.position.set(0, 0, 0)
    }
    camera.position.set(0, 0, cameraZ)
    camera.lookAt(new THREE.Vector3(0, 0, 0))
  }

  // Generate preset textures
  const createMarbleTexture = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')
    // Marble pattern with veins
    ctx.fillStyle = '#e8e0d5'
    ctx.fillRect(0, 0, 512, 512)
    ctx.strokeStyle = 'rgba(150, 140, 130, 0.4)'
    ctx.lineWidth = 1
    for (let i = 0; i < 20; i++) {
      const x = Math.random() * 512
      const y = Math.random() * 512
      ctx.beginPath()
      ctx.moveTo(x, y)
      for (let j = 0; j < 50; j++) {
        ctx.lineTo(x + Math.random() * 100 - 50, y + Math.random() * 100 - 50)
      }
      ctx.stroke()
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
    return texture
  }

  const createWoodTexture = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')
    // Wood pattern with rings
    for (let y = 0; y < 512; y++) {
      const shade = 140 + Math.sin(y * 0.02) * 40 + Math.random() * 20
      ctx.fillStyle = `rgb(${shade}, ${shade - 20}, ${shade - 40})`
      ctx.fillRect(0, y, 512, 1)
    }
    // Add vertical grain
    for (let x = 0; x < 512; x += 2) {
      ctx.strokeStyle = `rgba(0, 0, 0, ${Math.random() * 0.1})`
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, 512)
      ctx.stroke()
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
    return texture
  }

  const createMetalTexture = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')
    // Brushed metal pattern
    ctx.fillStyle = '#b0b0b0'
    ctx.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 500; i++) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${Math.random() * 0.15})`
      ctx.lineWidth = Math.random() * 2
      const y = Math.random() * 512
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(512, y)
      ctx.stroke()
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
    return texture
  }

  const createConcreteTexture = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')
    // Concrete/stone texture with noise
    ctx.fillStyle = '#7a7a7a'
    ctx.fillRect(0, 0, 512, 512)
    const imageData = ctx.getImageData(0, 0, 512, 512)
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
      const noise = Math.random() * 60
      data[i] += noise
      data[i + 1] += noise
      data[i + 2] += noise
    }
    ctx.putImageData(imageData, 0, 0)
    const texture = new THREE.CanvasTexture(canvas)
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
    return texture
  }

  const applyTexture = (texture) => {
    if (!meshRef.current || !meshRef.current.material) return
    meshRef.current.material.map = texture
    meshRef.current.material.needsUpdate = true
    if (appliedTextureRef.current) {
      appliedTextureRef.current.dispose && appliedTextureRef.current.dispose()
    }
    appliedTextureRef.current = texture
  }

  // Handle texture upload from user and apply to mesh material
  const handleTextureChange = (e) => {
    const file = e.target?.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    const loader = new THREE.TextureLoader()
    loader.load(url, (tex) => {
      tex.encoding = THREE.sRGBEncoding
      tex.flipY = false
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(1, 1)
      if (meshRef.current) {
        meshRef.current.material.map = tex
        meshRef.current.material.needsUpdate = true
      }
      // dispose previous texture
      if (appliedTextureRef.current) appliedTextureRef.current.dispose && appliedTextureRef.current.dispose()
      appliedTextureRef.current = tex
      URL.revokeObjectURL(url)
    }, undefined, (err) => {
      console.warn('Texture load failed', err)
      URL.revokeObjectURL(url)
    })
    // clear input value so same file can be reselected
    e.target.value = ''
  }

  // Gestisci visualizzazione normali
  useEffect(() => {
    if (!sceneRef.current) return

    if (showNormals && !normalsVisualizerRef.current) {
      const normalViz = createNormalVisualization(geometry)
      if (normalViz) {
        sceneRef.current.add(normalViz)
        normalsVisualizerRef.current = normalViz
      }
    } else if (!showNormals && normalsVisualizerRef.current) {
      sceneRef.current.remove(normalsVisualizerRef.current)
      normalsVisualizerRef.current = null
    }
  }, [showNormals, geometry])

  // Toggle triangle wireframe on the mesh material
  useEffect(() => {
    if (!meshRef.current || !meshRef.current.material) return
    try {
      meshRef.current.material.wireframe = !!showTriangles
      meshRef.current.material.needsUpdate = true
    } catch (e) {
      console.warn('Errore impostando wireframe sul materiale', e)
    }
  }, [showTriangles, geometry])

  return (
    <div ref={containerRef} className="mesh-viewer-root render-bg w-full h-[423px] lg:h-[660px] rounded-lg overflow-hidden shadow-xl relative">
      <div className="absolute top-4 left-4 right-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="bg-black/60 backdrop-blur-sm rounded-lg p-3 text-white text-xs space-y-1">
          <p>{enablePointSelection && pointSelectionMode === 'click' ? '🖱️ Click breve per aggiungere un punto; trascina per ruotare' : '🖱️ Trascina sinistro per ruotare'}</p>
          <p>🖱️ Trascina destro o centrale per traslare</p>
          <p>🔍 Rotella per zoom</p>
        </div>

        <div className="flex flex-wrap gap-2 justify-start lg:justify-end">
          <button
            onClick={undo}
            className="px-3 py-1 rounded-lg text-xs font-medium bg-slate-600 text-white hover:bg-slate-500 transition pointer-events-auto"
          >
            ↶ Undo
          </button>
          <button
            onClick={redo}
            className="px-3 py-1 rounded-lg text-xs font-medium bg-slate-600 text-white hover:bg-slate-500 transition pointer-events-auto"
          >
            ↷ Redo
          </button>
          <button
            onClick={() => setShowNormals(!showNormals)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
              showNormals
                ? 'bg-green-600 text-white'
                : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
            } pointer-events-auto`}
          >
            {showNormals ? '👁️ Nascondi' : '👁️ Mostra'} Normali
          </button>

          <div className="relative">
            <button
              onClick={() => setShowTextureMenu(!showTextureMenu)}
              className="px-3 py-1 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 transition pointer-events-auto"
            >
              📷 Texture
            </button>
            {showTextureMenu && (
              <div
                ref={textureMenuRef}
                className="absolute top-full right-0 mt-2 bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-50 overflow-hidden pointer-events-auto"
              >
                <button
                  onClick={() => {
                    applyTexture(createMarbleTexture())
                    setShowTextureMenu(false)
                  }}
                  className="block w-full text-left px-4 py-2 text-xs text-white hover:bg-slate-700 transition"
                >
                  🪨 Marmo
                </button>
                <button
                  onClick={() => {
                    applyTexture(createWoodTexture())
                    setShowTextureMenu(false)
                  }}
                  className="block w-full text-left px-4 py-2 text-xs text-white hover:bg-slate-700 transition"
                >
                  🌳 Legno
                </button>
                <button
                  onClick={() => {
                    applyTexture(createMetalTexture())
                    setShowTextureMenu(false)
                  }}
                  className="block w-full text-left px-4 py-2 text-xs text-white hover:bg-slate-700 transition"
                >
                  ⚙️ Metallo
                </button>
                <button
                  onClick={() => {
                    applyTexture(createConcreteTexture())
                    setShowTextureMenu(false)
                  }}
                  className="block w-full text-left px-4 py-2 text-xs text-white hover:bg-slate-700 transition"
                >
                  🔲 Cemento
                </button>
                <hr className="border-slate-700" />
                <button
                  onClick={() => {
                    textureInputRef.current?.click()
                    setShowTextureMenu(false)
                  }}
                  className="block w-full text-left px-4 py-2 text-xs text-white hover:bg-slate-700 transition"
                >
                  📁 Carica file
                </button>
              </div>
            )}
          </div>
          <input ref={textureInputRef} type="file" accept="image/*" className="hidden" onChange={handleTextureChange} />

          <button
            onClick={centerMesh}
            className="px-3 py-1 rounded-lg text-xs font-medium bg-sky-600 text-white hover:bg-sky-700 transition pointer-events-auto"
          >
            🧭 Centra Mesh
          </button>

          <button
            onClick={openMeshModifierWithConsent}
            className="px-3 py-1 rounded-lg text-xs font-medium bg-orange-600 text-white hover:bg-orange-700 transition pointer-events-auto"
          >
            ✏️ Modifica Mesh
          </button>

          <button
            onClick={() => setShowTriangles((s) => !s)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition ${showTriangles ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}
          >
            🔺 Triangoli
          </button>



          {normalAnalysis && (
            <div
              className={`px-3 py-1 rounded-lg text-xs font-medium pointer-events-auto ${
                normalAnalysis.hasIssues
                  ? 'bg-red-900/80 text-red-100'
                  : 'bg-green-900/80 text-green-100'
              }`}
            >
              {normalAnalysis.hasIssues ? '⚠️' : '✅'} Normali
            </div>
          )}

          <LightingControl variant="dark" className="pointer-events-auto" />
        </div>
      </div>

      {/* Pannello Risultati */}
      {normalAnalysis && (
        <div className="absolute bottom-4 left-4 right-4 bg-black/70 backdrop-blur-sm rounded-lg p-3 text-xs text-slate-200 pointer-events-auto max-w-xs">
          <p className="font-semibold mb-2">{normalAnalysis.message}</p>
          <div className="space-y-1 text-slate-300">
            <p>📊 Facce totali: {normalAnalysis.totalFaces}</p>
            {normalAnalysis.hasIssues && (
              <>
                <p className="text-red-300">⚠️ Invertite: {normalAnalysis.invertedCount}</p>
                <p className="text-red-300">📈 Percentuale: {normalAnalysis.percentage}%</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Edit consent modal */}
      {showEditConsentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full border border-slate-200 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900 mb-3">Autorizzazione modifica mesh</h3>
            <p className="text-sm text-slate-600 mb-4">
              Le modifiche alla mesh sono consentite solo con autorizzazione esplicita. Confermi di avere il consenso necessario prima di proseguire?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={cancelEditConsent}
                className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Annulla
              </button>
              <button
                onClick={confirmEditConsent}
                className="px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Conferma consenso
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scelta della mesh da modificare (piu' mesh caricate) */}
      {showEditChooser && hasEditChoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full border border-slate-200 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900 mb-1">Quale mesh vuoi modificare?</h3>
            <p className="text-sm text-slate-500 mb-4">Il Modificatore mesh si apre sulla mesh scelta.</p>
            <ul className="flex flex-col gap-1.5 max-h-72 overflow-y-auto mb-5">
              {editableMeshes.map((m) => (
                <li key={m.id}>
                  <label className={`flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer ${editChoiceId === m.id ? 'border-sky-500 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <input
                      type="radio"
                      name="mesh-to-edit"
                      className="accent-sky-600"
                      checked={editChoiceId === m.id}
                      onChange={() => setEditChoiceId(m.id)}
                    />
                    {m.color != null && (
                      <span className="w-3 h-3 rounded-full shrink-0 border border-black/10" style={{ background: `#${m.color.toString(16).padStart(6, '0')}` }} />
                    )}
                    <span className="text-sm text-slate-800 truncate" title={m.name}>{m.name}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowEditChooser(false)}
                className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Annulla
              </button>
              <button
                onClick={confirmEditChoice}
                disabled={editChoiceId == null}
                className="px-3 py-2 rounded-lg bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
              >
                Modifica
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mesh Modifier Modal */}
      {showMeshModifier && (
        <MeshModifier
          geometry={modifierGeometry}
          onClose={() => setShowMeshModifier(false)}
          onOpenMarkerScan={onOpenMarkerScan ? (list) => {
            setShowMeshModifier(false)
            onOpenMarkerScan(list)
          } : null}
          onApply={(edited) => {
            if (onApplyEdit && editingId != null) onApplyEdit(editingId, edited)
            else setEditedGeometry(edited)
            setShowMeshModifier(false)
          }}
          requireEditConsent={requireEditConsent}
        />
      )}
    </div>
  )
}
