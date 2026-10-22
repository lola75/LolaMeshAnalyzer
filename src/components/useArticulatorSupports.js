import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { buildSupportHalf, geometryFromPositions, toPlane } from '../utils/articulatorSupports'

// Passo "Supporto" del modello articolato: i supporti (blu) sul rendering, attaccati all'estrusione
// aperta di ciascun modello. Si trascinano sul piano occlusale; cubo e altezza si riadattano dal vivo.
// setup: { parts, basis, models: [{ index, side, height, outline }] } (mm della mesh);
// supportsRef.current: [{ x, y, midline }] nel piano; selected: supporto scelto (onSelect al clic);
// addModeRef.current: il prossimo clic sulla vista aggiunge un supporto (onAdd({ x, y }));
// lockMidlineRef.current: il supporto anteriore (midline) si sposta solo lungo la linea mediana.
// version: cambia quando si aggiungono o tolgono supporti.

const SUPPORT_COLOR = 0x5b9ff0

export default function useArticulatorSupports({ active, setup, supportsRef, meshesRef, sceneRef, cameraRef, canvasHandlersRef, selected = null, onSelect, addModeRef, lockMidlineRef, onAdd, version = 0 }) {
  const callbacksRef = useRef({})
  callbacksRef.current = { onSelect, onAdd }
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const refreshRef = useRef(null) // ricolora i supporti (selezione cambiata) senza ricostruirli
  useEffect(() => { refreshRef.current?.() }, [selected])

  useEffect(() => {
    if (!active || !setup) return undefined
    const scene = sceneRef.current
    const { parts, basis, models } = setup
    const frames = models.map((m) => meshesRef.current[m.index]?.userData.normalization)
    if (!scene || frames.some((f) => !f) || models.length === 0) return undefined
    const material = new THREE.MeshStandardMaterial({ color: SUPPORT_COLOR, roughness: 0.45, metalness: 0.05, transparent: true, opacity: 0.92 })
    const highlight = new THREE.MeshStandardMaterial({ color: 0x2f7de1, roughness: 0.4, emissive: 0x0b3a7a })
    const chosen = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4, emissive: 0x5a3200 }) // supporto selezionato
    const group = new THREE.Group()
    scene.add(group)

    // meshes[s] = una mesh per modello (meta' superiore o inferiore)
    const meshes = []
    const build = (s) => {
      const support = supportsRef.current[s]
      meshes[s]?.forEach((mesh) => { mesh.removeFromParent(); mesh.geometry.dispose() })
      meshes[s] = models.map((model, k) => {
        const { positions } = buildSupportHalf(parts, basis, support, model.side, model.height, model.outline)
        const { center, scale } = frames[k]
        for (let i = 0; i < positions.length; i += 3) {
          positions[i] = (positions[i] - center.x) * scale
          positions[i + 1] = (positions[i + 1] - center.y) * scale
          positions[i + 2] = (positions[i + 2] - center.z) * scale
        }
        const mesh = new THREE.Mesh(geometryFromPositions(positions), material)
        mesh.userData.supportIndex = s
        group.add(mesh)
        return mesh
      })
    }
    supportsRef.current.forEach((_, s) => build(s))

    // trascinamento sul piano occlusale (coordinate della scena del primo modello)
    const frame = frames[0]
    const planeOrigin = basis.origin.clone().sub(frame.center).multiplyScalar(frame.scale)
    const scenePlane = new THREE.Plane().setFromNormalAndCoplanarPoint(basis.ez, planeOrigin)
    const raycaster = new THREE.Raycaster()
    let drag = null
    let hovered = null
    const rayOf = (event) => {
      const rect = event.target.getBoundingClientRect()
      raycaster.setFromCamera(new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), cameraRef.current)
      return raycaster.ray
    }
    const planePoint = (event) => {
      const p = rayOf(event).intersectPlane(scenePlane, new THREE.Vector3())
      if (!p) return null
      p.divideScalar(frame.scale).add(frame.center)
      const [x, y] = toPlane(basis, p.x, p.y, p.z)
      return { x, y }
    }
    const pick = (event) => {
      rayOf(event)
      const hit = raycaster.intersectObjects(group.children, false)[0]
      return hit ? hit.object.userData.supportIndex : null
    }
    const setHover = (s, canvas) => {
      hovered = s
      meshes.forEach((list, i) => list.forEach((mesh) => { mesh.material = i === selectedRef.current ? chosen : i === s ? highlight : material }))
      if (canvas) canvas.style.cursor = drag ? 'grabbing' : addModeRef?.current ? 'crosshair' : s != null ? 'grab' : ''
    }
    let frameRequest = 0
    const handlers = {
      down: (event) => {
        if (addModeRef?.current) {
          const point = planePoint(event)
          if (point) callbacksRef.current.onAdd?.(point)
          return true
        }
        const s = pick(event)
        if (s == null) return false // altrove la vista ruota come sempre
        const start = planePoint(event)
        if (!start) return false
        drag = { s, start, from: { ...supportsRef.current[s] } }
        if (s !== selectedRef.current) callbacksRef.current.onSelect?.(s)
        setHover(s, event.target)
        return true
      },
      move: (event) => {
        if (!drag) {
          const s = pick(event)
          if (s !== hovered) setHover(s, event.target)
          return
        }
        const p = planePoint(event)
        if (!p) return
        const { from } = drag
        const locked = from.midline && lockMidlineRef?.current
        supportsRef.current[drag.s] = { ...from, x: locked ? 0 : from.x + p.x - drag.start.x, y: from.y + p.y - drag.start.y }
        if (frameRequest) return
        const s = drag.s
        frameRequest = requestAnimationFrame(() => {
          frameRequest = 0
          build(s)
          setHover(s, null)
        })
      },
      up: (event) => {
        drag = null
        setHover(event ? pick(event) : null, event?.target)
      },
      leave: () => {
        if (!drag) setHover(null, null)
      },
    }
    canvasHandlersRef.current = handlers
    refreshRef.current = () => setHover(hovered, null)
    setHover(null, null)

    return () => {
      cancelAnimationFrame(frameRequest)
      if (canvasHandlersRef.current === handlers) canvasHandlersRef.current = null
      refreshRef.current = null
      group.removeFromParent()
      group.traverse((o) => o.geometry?.dispose())
      material.dispose()
      highlight.dispose()
      chosen.dispose()
    }
  }, [active, setup, version])
}
