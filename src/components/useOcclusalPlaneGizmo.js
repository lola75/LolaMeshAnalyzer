import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { DENTAL_UP, DENTAL_FRONT } from '../utils/viewerLighting'

// Piano occlusale per il modello articolato (Utilita' di stampa 3D): disco trasparente con la sagoma
// dell'arcata, assi trasversale (viola), sagittale / linea mediana (blu) e verticale (dorato, "alto").
// Maniglie da trascinare:
// - centro: sposta il piano;
// - frecce curve rosse sul bordo: ruotano il piano attorno alla verticale (linea mediana);
// - frecce curve verdi ai lati: inclinano il piano a destra / sinistra (attorno alla linea mediana);
// - frecce curve verdi davanti e dietro: inclinano il piano in avanti / indietro (attorno all'asse trasversale);
// - punta della freccia dorata: inclina il piano in qualunque direzione.
// La posizione e' nelle coordinate della scena; onChange riceve { origin, normal, front } in mm
// (riferimento della prima mesh).

const COLORS = { disc: 0xbfe0e8, rim: 0x8a9399, arch: 0x8ec9f0, transverse: 0x8b1fa9, sagittal: 0x3346b0, up: 0xd4a017, rotate: 0xc0262d, tilt: 0x16a34a }

function labelSprite(text) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  ctx.font = 'bold 30px Segoe UI, Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 6
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.strokeText(text, 128, 32)
  ctx.fillStyle = '#1f2937'
  ctx.fillText(text, 128, 32)
  const texture = new THREE.CanvasTexture(canvas)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }))
  sprite.renderOrder = 1000
  return sprite
}

// tubo lungo un percorso con una freccia (cono) a ciascuna estremita'
// pickRadius: tubo invisibile piu' grosso, per afferrare facilmente le frecce sottili
function arrowPath(points, radius, color, heads = [true, true], pickRadius = 0) {
  const group = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true })
  const curve = new THREE.CatmullRomCurve3(points)
  const segments = Math.max(8, points.length * 4)
  group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 8, false), material))
  if (pickRadius > 0) {
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segments, pickRadius, 8, false), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false })))
  }
  const addHead = (tip, before) => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(radius * 3, radius * 8, 14), material)
    cone.position.copy(tip)
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip.clone().sub(before).normalize())
    group.add(cone)
  }
  if (heads[0]) addHead(points[0], points[1])
  if (heads[1]) addHead(points[points.length - 1], points[points.length - 2])
  group.traverse((o) => { o.renderOrder = 999 })
  return group
}

// scritta decorativa in corsivo, trasparente, tra le gambe della sagoma (nessuna funzione).
// Si gira da sola per restare leggibile da sopra o da sotto e con qualunque rotazione della vista.
function decorationText(text, scale) {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  ctx.font = 'italic 150px "Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, 512, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.anisotropy = 4
  const width = 30 * scale
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / 4),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })
  )
  mesh.renderOrder = 901
  const toLocal = new THREE.Quaternion()
  const screenUp = new THREE.Vector3()
  const toCamera = new THREE.Vector3()
  const basis = new THREE.Matrix4()
  mesh.onBeforeRender = (renderer, scene, camera) => {
    const parent = mesh.parent
    if (!parent) return
    toLocal.copy(parent.getWorldQuaternion(new THREE.Quaternion())).invert()
    toCamera.copy(camera.position)
    parent.worldToLocal(toCamera)
    const n = new THREE.Vector3(0, 0, toCamera.z >= 0 ? 1 : -1)
    screenUp.set(0, 1, 0).applyQuaternion(camera.quaternion).applyQuaternion(toLocal)
    const up = new THREE.Vector3(0, screenUp.y >= 0 ? 1 : -1, 0)
    const right = new THREE.Vector3().crossVectors(up, n)
    mesh.quaternion.setFromRotationMatrix(basis.makeBasis(right, up, n))
    mesh.updateMatrixWorld(true)
  }
  return mesh
}

// sagoma dell'arcata (ferro di cavallo) nel piano locale XY, incisivi verso +Y
function archOutline(scale) {
  const outerA = 26, outerB = 22, width = 9, legBack = 18
  const mid = outerA - width / 2
  const pts = []
  const ring = (cx, cy, a, b, from, to, steps) => {
    for (let i = 0; i <= steps; i++) {
      const t = from + ((to - from) * i) / steps
      pts.push(new THREE.Vector3(cx + a * Math.cos(t), cy + b * Math.sin(t), 0))
    }
  }
  pts.push(new THREE.Vector3(outerA, -legBack, 0)) // gamba destra, lato esterno
  ring(0, 0, outerA, outerB, 0, Math.PI, 48) // arco esterno, passando davanti
  ring(-mid, -legBack, width / 2, width / 2, Math.PI, 2 * Math.PI, 10) // estremita' sinistra arrotondata
  ring(0, 0, outerA - width, outerB - width, Math.PI, 0, 40) // arco interno
  ring(mid, -legBack, width / 2, width / 2, Math.PI, 2 * Math.PI, 10) // estremita' destra arrotondata
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => p.multiplyScalar(scale)), true, 'catmullrom', 0.2)
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 400, 0.35 * scale, 6, true), new THREE.MeshBasicMaterial({ color: COLORS.arch, transparent: true, opacity: 0.9, depthWrite: false }))
  return tube
}

export default function useOcclusalPlaneGizmo({ active, meshes, meshesRef, sceneRef, cameraRef, canvasHandlersRef, onChange, resetKey }) {
  const stateRef = useRef(null) // { origin, normal, front } nella scena
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!active) return undefined
    let teardown = null
    const timer = setTimeout(() => { teardown = setup() }, 0) // dopo l'eventuale ricostruzione della scena
    return () => {
      clearTimeout(timer)
      teardown?.()
    }
  }, [active, meshes, resetKey])

  const setup = () => {
    const scene = sceneRef.current
    const sceneMeshes = meshesRef.current.filter((m, i) => m && meshes[i]?.visible !== false)
    const normalization = (sceneMeshes[0] || meshesRef.current[0])?.userData.normalization
    if (!scene || !normalization) return null
    const mm = normalization.scale // unita' della scena per mm

    // posizione iniziale: centro delle mesh visibili, Z in alto, incisivi verso +Y
    if (!stateRef.current || stateRef.current.resetKey !== resetKey) {
      const box = new THREE.Box3()
      sceneMeshes.forEach((m) => box.expandByObject(m))
      stateRef.current = {
        resetKey,
        origin: box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3()),
        normal: new THREE.Vector3(...DENTAL_UP),
        front: new THREE.Vector3(...DENTAL_FRONT),
      }
    }
    const radius = 40 * mm
    const thin = 0.22 * mm
    const grab = 2.2 * mm // raggio per afferrare le maniglie

    const gizmo = new THREE.Group()
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 96), new THREE.MeshBasicMaterial({ color: COLORS.disc, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }))
    disc.renderOrder = 900
    const rimPoints = Array.from({ length: 129 }, (_, i) => new THREE.Vector3(radius * Math.cos((i / 128) * Math.PI * 2), radius * Math.sin((i / 128) * Math.PI * 2), 0))
    const rim = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rimPoints), new THREE.LineBasicMaterial({ color: COLORS.rim }))
    const arch = archOutline(mm)
    arch.position.y = -4 * mm
    const decoration = decorationText('ISDIEGS', mm)
    decoration.position.set(0, -15 * mm, 0)
    gizmo.add(disc, rim, arch, decoration)

    // assi
    const transverse = arrowPath([new THREE.Vector3(-radius * 0.92, 0, 0), new THREE.Vector3(radius * 0.92, 0, 0)], thin, COLORS.transverse)
    const sagittal = arrowPath([new THREE.Vector3(0, -radius * 0.95, 0), new THREE.Vector3(0, radius * 0.95, 0)], thin, COLORS.sagittal)
    const upTip = new THREE.Vector3(0, 0, radius * 0.6)
    const up = arrowPath([new THREE.Vector3(0, 0, -radius * 0.45), upTip], thin * 1.3, COLORS.up, [false, true])
    const label = labelSprite('Alto')
    label.position.copy(upTip).add(new THREE.Vector3(0, 0, 6 * mm))
    label.scale.set(16 * mm, 4 * mm, 1)
    gizmo.add(transverse, sagittal, up, label)

    // maniglie
    const handles = []
    const addHandle = (object, kind) => {
      object.userData.kind = kind
      object.traverse((o) => { o.userData.kind = kind })
      handles.push(object)
      gizmo.add(object)
    }
    for (const side of [1, -1]) {
      const span = 0.42
      const red = arrowPath(Array.from({ length: 17 }, (_, i) => {
        const t = (side > 0 ? 0 : Math.PI) + span * (i / 8 - 1)
        return new THREE.Vector3(radius * 1.01 * Math.cos(t), radius * 1.01 * Math.sin(t), 0)
      }), thin * 1.5, COLORS.rotate, [true, true], grab)
      addHandle(red, 'rotate')
      // destra / sinistra: arco nel piano trasversale (XZ)
      const roll = arrowPath(Array.from({ length: 17 }, (_, i) => {
        const t = 0.45 * (i / 8 - 1)
        return new THREE.Vector3(side * radius * 1.06 * Math.cos(t), 0, radius * 1.06 * Math.sin(t))
      }), thin * 1.5, COLORS.tilt, [true, true], grab)
      addHandle(roll, 'roll')
      // avanti / indietro: arco nel piano sagittale (YZ)
      const pitch = arrowPath(Array.from({ length: 17 }, (_, i) => {
        const t = 0.45 * (i / 8 - 1)
        return new THREE.Vector3(0, side * radius * 1.06 * Math.cos(t), radius * 1.06 * Math.sin(t))
      }), thin * 1.5, COLORS.tilt, [true, true], grab)
      addHandle(pitch, 'pitch')
    }
    const tipHandle = new THREE.Mesh(new THREE.SphereGeometry(grab, 16, 12), new THREE.MeshBasicMaterial({ color: COLORS.up, transparent: true, opacity: 0.001, depthTest: false }))
    tipHandle.position.copy(upTip)
    addHandle(tipHandle, 'tilt')
    const centerHandle = new THREE.Mesh(new THREE.SphereGeometry(1.2 * mm, 16, 12), new THREE.MeshBasicMaterial({ color: 0x334155, depthTest: false, transparent: true }))
    centerHandle.renderOrder = 1000
    addHandle(centerHandle, 'move')
    scene.add(gizmo)

    const place = () => {
      const { origin, normal, front } = stateRef.current
      const x = new THREE.Vector3().crossVectors(front, normal).normalize()
      const y = new THREE.Vector3().crossVectors(normal, x).normalize()
      gizmo.position.copy(origin)
      gizmo.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, normal))
      gizmo.updateMatrixWorld(true)
      // in mm della prima mesh, per la costruzione del modello
      const { center, scale } = normalization
      onChangeRef.current?.({
        origin: origin.clone().divideScalar(scale).add(center).toArray(),
        normal: normal.toArray(),
        front: y.toArray(),
      })
    }
    place()

    // mouse
    const raycaster = new THREE.Raycaster()
    let drag = null
    let hovered = null
    const rayOf = (event) => {
      const rect = event.target.getBoundingClientRect()
      raycaster.setFromCamera(new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), cameraRef.current)
      return raycaster.ray
    }
    const pickHandle = (event) => {
      rayOf(event)
      const hit = raycaster.intersectObjects(handles, true)[0]
      return hit ? hit.object.userData.kind : null
    }
    const highlight = (kind, canvas) => {
      hovered = kind
      for (const handle of handles) {
        const on = handle.userData.kind === kind
        handle.traverse((o) => { if (o.material) o.material.opacity = on ? 1 : 0.85 })
        handle.scale.setScalar(on && handle.userData.kind !== 'tilt' ? 1.15 : 1)
      }
      if (canvas) canvas.style.cursor = drag ? 'grabbing' : kind ? 'grab' : ''
    }
    const pointOnPlane = (ray, normal, through) => ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, through), new THREE.Vector3())
    const handlers = {
      down: (event) => {
        const kind = pickHandle(event)
        if (!kind) return false // altrove la vista ruota come sempre
        const state = stateRef.current
        const camera = cameraRef.current
        const forward = camera.getWorldDirection(new THREE.Vector3())
        const ray = rayOf(event)
        // cerniere: rotazione attorno alla linea mediana (roll) o all'asse trasversale (pitch); il
        // punto si prende sul piano perpendicolare all'asse, o sullo schermo se lo si guarda di taglio
        const axis = kind === 'roll' ? state.front.clone().normalize()
          : kind === 'pitch' ? new THREE.Vector3().crossVectors(state.front, state.normal).normalize() : null
        const hingePlane = axis && Math.abs(axis.dot(forward)) > 0.25 ? axis : forward
        drag = {
          axis,
          hingePlane,
          kind,
          start: { origin: state.origin.clone(), normal: state.normal.clone(), front: state.front.clone() },
          // movimento e rotazione sul piano del disco; inclinazioni sul piano dello schermo
          point: kind === 'move' || kind === 'rotate' ? pointOnPlane(ray, state.normal, state.origin) : pointOnPlane(ray, axis ? hingePlane : forward, state.origin),
          forward,
        }
        highlight(kind, event.target)
        return true
      },
      move: (event) => {
        if (!drag) {
          const kind = pickHandle(event)
          if (kind !== hovered) highlight(kind, event.target)
          return
        }
        const ray = rayOf(event)
        const state = stateRef.current
        const { start } = drag
        if (drag.kind === 'move') {
          const p = pointOnPlane(ray, start.normal, start.origin)
          if (p && drag.point) state.origin.copy(start.origin).add(p.sub(drag.point))
        } else if (drag.kind === 'rotate') {
          const p = pointOnPlane(ray, start.normal, start.origin)
          if (!p || !drag.point) return
          const a = drag.point.clone().sub(start.origin)
          const b = p.sub(start.origin)
          const angle = Math.atan2(new THREE.Vector3().crossVectors(a, b).dot(start.normal), a.dot(b))
          state.front.copy(start.front).applyAxisAngle(start.normal, angle)
        } else if (drag.kind === 'tilt') {
          const p = pointOnPlane(ray, drag.forward, start.origin)
          if (!p) return
          const n = p.sub(start.origin)
          if (n.lengthSq() < 1e-12) return
          const q = new THREE.Quaternion().setFromUnitVectors(start.normal, n.normalize())
          state.normal.copy(start.normal).applyQuaternion(q)
          state.front.copy(start.front).applyQuaternion(q)
        } else if (drag.kind === 'roll' || drag.kind === 'pitch') {
          // rotazione attorno all'asse: angolo tra i punti proiettati sul piano perpendicolare
          const { axis } = drag
          const p = pointOnPlane(ray, drag.hingePlane, start.origin)
          if (!p || !drag.point) return
          const a = drag.point.clone().sub(start.origin).projectOnPlane(axis)
          const b = p.sub(start.origin).projectOnPlane(axis)
          if (a.lengthSq() < 1e-12 || b.lengthSq() < 1e-12) return
          const angle = Math.atan2(new THREE.Vector3().crossVectors(a, b).dot(axis), a.dot(b))
          state.normal.copy(start.normal).applyAxisAngle(axis, angle)
          state.front.copy(start.front).applyAxisAngle(axis, angle)
        }
        place()
      },
      up: (event) => {
        drag = null
        highlight(event ? pickHandle(event) : null, event?.target)
      },
      leave: () => {
        if (!drag) highlight(null, null)
      },
    }
    canvasHandlersRef.current = handlers

    return () => {
      if (canvasHandlersRef.current === handlers) canvasHandlersRef.current = null
      gizmo.removeFromParent()
      gizmo.traverse((o) => {
        o.geometry?.dispose()
        o.material?.map?.dispose()
        o.material?.dispose()
      })
    }
  }
}
