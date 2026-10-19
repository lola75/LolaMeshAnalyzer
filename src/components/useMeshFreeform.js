import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { createSculptSession } from '../utils/freeformSculpt'

// Strumento Free Form del Modificatore mesh (vista 3D principale).
// Durante l'uso la mesh della scena mostra la copia di lavoro (vertici uniti) che i pennelli
// modificano dal vivo; la mesh dell'elenco cambia solo con commit() (Applica).
//
// active: pannello aperto; meshIndex: mesh su cui si lavora; settings: { brush, radius (mm), strength }.
// Restituisce i gestori del mouse (stessa interfaccia del pennello dell'Offset) e i comandi.
export default function useMeshFreeform({ active, meshIndex, meshes, meshesRef, sceneRef, cameraRef, rendererRef, brushStateRef, settings }) {
  const sessionRef = useRef(null) // { session, geometry }
  const viewRef = useRef(null) // { sceneMesh, editGeometry, ring, center, scale, refresh }
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const frameRef = useRef({ id: 0, event: null })
  const grabRef = useRef(null)
  const [state, setState] = useState({ ready: false, preparing: false, strokes: 0, canUndo: false, error: null })

  const target = active ? meshes[meshIndex] : null

  // Copia di lavoro: si prepara all'apertura (o se la mesh dell'elenco e' cambiata)
  useEffect(() => {
    if (!target) return undefined
    if (sessionRef.current?.geometry === target.geometry) {
      setState((s) => ({ ...s, ready: true, preparing: false }))
      return undefined
    }
    let cancelled = false
    setState({ ready: false, preparing: true, strokes: 0, canUndo: false, error: null })
    const timer = setTimeout(() => {
      try {
        const session = createSculptSession(target.geometry)
        if (cancelled) {
          session.dispose()
          return
        }
        sessionRef.current?.session.dispose()
        sessionRef.current = { session, geometry: target.geometry }
        setState({ ready: true, preparing: false, strokes: 0, canUndo: false, error: null })
      } catch (err) {
        console.error('Preparazione Free Form non riuscita:', err)
        if (!cancelled) setState({ ready: false, preparing: false, strokes: 0, canUndo: false, error: err.message })
      }
    }, 30)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [target?.geometry, active])

  // Chiusura dello strumento: la copia di lavoro si libera
  useEffect(() => {
    if (active) return
    sessionRef.current?.session.dispose()
    sessionRef.current = null
  }, [active])

  // Collegamento alla scena: geometria di lavoro al posto di quella della mesh, cerchio del pennello
  useEffect(() => {
    const entry = sessionRef.current
    const sceneMesh = meshesRef.current[meshIndex]
    const scene = sceneRef.current
    const normalization = sceneMesh?.userData.normalization
    if (!active || !state.ready || !entry || entry.geometry !== meshes[meshIndex]?.geometry || !normalization || !scene) return undefined

    const { session } = entry
    const { center, scale } = normalization
    const display = new THREE.BufferAttribute(new Float32Array(session.positions.length), 3)
    display.setUsage(THREE.DynamicDrawUsage)
    const normalAttr = new THREE.BufferAttribute(new Float32Array(session.normals.length), 3)
    normalAttr.setUsage(THREE.DynamicDrawUsage)
    const editGeometry = new THREE.BufferGeometry()
    editGeometry.setAttribute('position', display)
    editGeometry.setAttribute('normal', normalAttr)
    if (session.colors) editGeometry.setAttribute('color', new THREE.BufferAttribute(session.colors, 3))
    editGeometry.setIndex(new THREE.BufferAttribute(session.indices, 1))

    const P = session.positions
    const N = session.normals
    const writeVertex = (v) => {
      const i = v * 3
      display.array[i] = (P[i] - center.x) * scale
      display.array[i + 1] = (P[i + 1] - center.y) * scale
      display.array[i + 2] = (P[i + 2] - center.z) * scale
      normalAttr.array[i] = N[i]
      normalAttr.array[i + 1] = N[i + 1]
      normalAttr.array[i + 2] = N[i + 2]
    }
    const refresh = (list) => {
      if (list) for (const v of list) writeVertex(v)
      else for (let v = 0; v < session.vertexCount; v++) writeVertex(v)
      display.needsUpdate = true
      normalAttr.needsUpdate = true
      editGeometry.computeBoundingSphere()
    }
    refresh()
    editGeometry.computeBoundingBox()
    const originalGeometry = sceneMesh.geometry
    sceneMesh.geometry = editGeometry
    sceneMesh.raycast = () => {} // il raggio del mouse lo calcola il Free Form con la sua BVH

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 64),
      new THREE.MeshBasicMaterial({ color: 0xa78bfa, side: THREE.DoubleSide, depthTest: false, transparent: true, toneMapped: false })
    )
    ring.renderOrder = 20
    ring.visible = false
    ring.raycast = () => {}
    scene.add(ring)

    viewRef.current = { sceneMesh, editGeometry, ring, center, scale, refresh }
    brushStateRef.current = { active: true, painting: false }
    const canvas = rendererRef.current?.domElement
    if (canvas) canvas.style.cursor = 'crosshair'
    return () => {
      brushStateRef.current = { active: false, painting: false }
      viewRef.current = null
      cancelAnimationFrame(frameRef.current.id)
      frameRef.current = { id: 0, event: null }
      if (canvas) canvas.style.cursor = ''
      delete sceneMesh.raycast // torna il raycast normale della mesh
      if (sceneMesh.geometry === editGeometry) sceneMesh.geometry = originalGeometry
      editGeometry.dispose()
      ring.removeFromParent()
      ring.geometry.dispose()
      ring.material.dispose()
    }
  }, [active, state.ready, meshes, meshIndex])

  // raggio del mouse nelle coordinate della mesh (mm)
  const mouseRay = (event) => {
    const view = viewRef.current
    const canvas = rendererRef.current?.domElement
    const camera = cameraRef.current
    if (!view || !canvas || !camera) return null
    const rect = canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, camera)
    const worldRay = raycaster.ray.clone()
    view.sceneMesh.updateMatrixWorld(true)
    const toLocal = view.sceneMesh.matrixWorld.clone().invert()
    const local = worldRay.clone().applyMatrix4(toLocal)
    const { center, scale } = view
    const origin = local.origin.clone().divideScalar(scale).add(center)
    return { origin, direction: local.direction.clone().normalize(), worldRay }
  }

  const pick = (event) => {
    const ray = mouseRay(event)
    const session = sessionRef.current?.session
    if (!ray || !session) return null
    const hit = session.raycast(ray.origin, ray.direction)
    return hit ? { ...hit, worldRay: ray.worldRay } : null
  }

  const showCursor = (hit) => {
    const view = viewRef.current
    if (!view) return
    const { ring, sceneMesh, center, scale } = view
    ring.visible = !!hit
    if (!hit) return
    const localPoint = hit.point.clone().sub(center).multiplyScalar(scale)
    const worldPoint = sceneMesh.localToWorld(localPoint)
    const worldNormal = hit.normal.clone().transformDirection(sceneMesh.matrixWorld)
    const radius = settingsRef.current.radius * scale
    ring.scale.set(radius, radius, radius)
    ring.position.copy(worldPoint)
    ring.lookAt(worldPoint.clone().add(worldNormal))
  }

  const finishStroke = () => {
    const session = sessionRef.current?.session
    grabRef.current = null
    if (!session) return
    session.endStroke()
    setState((s) => ({ ...s, strokes: session.strokes, canUndo: session.canUndo() }))
  }

  const handlers = {
    down: (event) => {
      const session = sessionRef.current?.session
      const view = viewRef.current
      if (!session || !view) return false
      const hit = pick(event)
      if (!hit) return false
      const { brush, radius, strength } = settingsRef.current
      showCursor(hit)
      const changed = session.beginStroke(brush, hit, radius, strength, event.shiftKey)
      if (changed.length) view.refresh(changed)
      if (brush === 'grab') {
        // piano parallelo allo schermo passante per il punto afferrato
        const worldPoint = view.sceneMesh.localToWorld(hit.point.clone().sub(view.center).multiplyScalar(view.scale))
        const normal = new THREE.Vector3()
        cameraRef.current.getWorldDirection(normal)
        grabRef.current = { plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, worldPoint), start: worldPoint }
      }
      return true
    },
    move: (event) => {
      const frame = frameRef.current
      frame.event = event
      if (frame.id) return
      frame.id = requestAnimationFrame(() => {
        frame.id = 0
        const pending = frame.event
        const session = sessionRef.current?.session
        const view = viewRef.current
        if (!session || !view) return
        const painting = brushStateRef.current.painting
        const grab = grabRef.current
        if (painting && grab) {
          const ray = mouseRay(pending)
          const point = ray && ray.worldRay.intersectPlane(grab.plane, new THREE.Vector3())
          if (!point) return
          // spostamento sullo schermo -> mm nelle coordinate della mesh
          const toLocal = view.sceneMesh.matrixWorld.clone().invert()
          const a = grab.start.clone().applyMatrix4(toLocal)
          const b = point.clone().applyMatrix4(toLocal)
          const changed = session.grab(b.sub(a).divideScalar(view.scale))
          if (changed.length) view.refresh(changed)
          return
        }
        const hit = pick(pending)
        showCursor(hit)
        if (painting && hit) {
          const changed = session.stamp(hit)
          if (changed.length) view.refresh(changed)
        }
      })
    },
    up: () => finishStroke(),
    leave: () => showCursor(null),
  }

  const undo = () => {
    const session = sessionRef.current?.session
    if (!session?.undo()) return
    viewRef.current?.refresh()
    setState((s) => ({ ...s, strokes: session.strokes, canUndo: session.canUndo() }))
  }

  // mesh modificata (mm) oppure null se non ci sono pennellate
  const result = () => {
    const session = sessionRef.current?.session
    if (!session || session.strokes === 0) return null
    return session.toGeometry()
  }

  // dopo Applica: la nuova mesh dell'elenco e' quella della copia di lavoro, che resta valida
  const adopt = (geometry) => {
    if (!sessionRef.current) return
    sessionRef.current.geometry = geometry
    sessionRef.current.session.markSaved()
    setState((s) => ({ ...s, strokes: 0, canUndo: false }))
  }

  // Annulla tutto: la copia di lavoro torna alla mesh dell'elenco
  const discard = () => {
    const session = sessionRef.current?.session
    if (!session) return
    session.restoreSaved()
    viewRef.current?.refresh()
    setState((s) => ({ ...s, strokes: 0, canUndo: false }))
  }

  return { ...state, handlers, undo, discard, result, adopt }
}
