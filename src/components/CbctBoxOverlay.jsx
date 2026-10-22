import React, { useEffect, useRef } from 'react'
import { SLICE_TYPE } from '@niivue/niivue'

// Box di "Riduci volume" disegnato sopra la vista 3D di NiiVue:
// sei maniglie (una per faccia) da trascinare per stringere il box; il volume fuori dal
// box viene nascosto dal vivo con i piani di taglio di NiiVue.
// Il box e' in coordinate frazionarie della texture NiiVue (0-1 per asse, ordine RAS).

const HANDLE_RADIUS = 6
const HIT_RADIUS = 12
const MIN_SIZE = 0.05 // dimensione minima del box (frazione del volume)
const BOX_COLOR = 'rgba(255, 255, 255, 0.9)'
const HANDLE_COLOR = '#facc15'
const HANDLE_ACTIVE_COLOR = '#ef4444'

// Facce: asse 0/1/2, lato 0 = minimo, 1 = massimo
const FACES = [0, 1, 2].flatMap((axis) => [{ axis, side: 0 }, { axis, side: 1 }])
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]

const cornerFrac = (box, index) => [0, 1, 2].map((axis) => ((index >> axis) & 1 ? box.max[axis] : box.min[axis]))

const faceCenterFrac = (box, { axis, side }) => [0, 1, 2].map((a) => (
  a === axis ? (side ? box.max[a] : box.min[a]) : (box.min[a] + box.max[a]) / 2
))

// Piani di taglio NiiVue [profondita', azimut, elevazione] che tengono solo l'interno del box.
// Lo shader conserva il lato dove dot(n, p - 0.5) + profondita' > 0, con n = sph2cartDeg(azimut + 180, elevazione).
export const boxClipPlanes = (box) => [
  [0.5 - box.min[0], -90, 0], // n = +x
  [box.max[0] - 0.5, 90, 0], // n = -x
  [0.5 - box.min[1], 0, 0], // n = +y
  [box.max[1] - 0.5, 180, 0], // n = -y
  [0.5 - box.min[2], 0, -90], // n = +z
  [box.max[2] - 0.5, 0, 90], // n = -z
]

export const NO_CLIP_PLANES = [[2, 0, 0]] // profondita' > 1: nessun taglio

export const FULL_BOX = { min: [0, 0, 0], max: [1, 1, 1] }

export const boxCornersMm = (volume, box) => Array.from({ length: 8 }, (_, i) => {
  const mm = volume.convertFrac2MM(cornerFrac(box, i), true)
  return [mm[0], mm[1], mm[2]]
})

// Proiezione mm -> pixel CSS del canvas (stessa formula di Niivue.calculateScreenPoint)
const makeProjector = (nv, canvas) => {
  const tile = nv.screenSlices?.find((slice) => slice.axCorSag === SLICE_TYPE.RENDER)
  const volume = nv.volumes?.[0]
  if (!tile || !volume) return null
  const viewport = tile.leftTopWidthHeight
  const [mvp] = nv.calculateMvpMatrix(null, viewport, nv.scene.renderAzimuth, nv.scene.renderElevation)
  const scale = canvas.width / canvas.getBoundingClientRect().width || 1
  return (frac) => {
    const [x, y, z] = volume.convertFrac2MM(frac, true)
    const cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12]
    const cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13]
    const w = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15] || 1
    return [
      ((cx / w + 1) * 0.5 * viewport[2] + viewport[0]) / scale,
      ((1 - cy / w) * 0.5 * viewport[3] + viewport[1]) / scale,
    ]
  }
}

export default function CbctBoxOverlay({ nvRef, canvasRef, box, onChange }) {
  const overlayRef = useRef(null)
  const boxRef = useRef(box)
  const handlesRef = useRef([]) // maniglie proiettate dell'ultimo fotogramma
  const hoverRef = useRef(null)
  const dragRef = useRef(null)
  const onChangeRef = useRef(onChange)
  boxRef.current = box
  onChangeRef.current = onChange

  // Disegno continuo: il box segue rotazione, zoom e spostamento della vista 3D
  useEffect(() => {
    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const overlay = overlayRef.current
      const nv = nvRef.current
      const canvas = canvasRef.current
      if (!overlay || !nv || !canvas) return
      const rect = overlay.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const width = Math.round(rect.width * dpr)
      const height = Math.round(rect.height * dpr)
      if (overlay.width !== width || overlay.height !== height) {
        overlay.width = width
        overlay.height = height
      }
      const ctx = overlay.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, rect.width, rect.height)

      const project = makeProjector(nv, canvas)
      if (!project) {
        handlesRef.current = []
        return
      }
      const current = boxRef.current
      const corners = Array.from({ length: 8 }, (_, i) => project(cornerFrac(current, i)))
      const center = project([0, 1, 2].map((a) => (current.min[a] + current.max[a]) / 2))
      const handles = FACES.map((face) => ({ ...face, point: project(faceCenterFrac(current, face)) }))
      handlesRef.current = handles

      ctx.lineWidth = 1.5
      ctx.strokeStyle = BOX_COLOR
      ctx.beginPath()
      for (const [a, b] of EDGES) {
        ctx.moveTo(...corners[a])
        ctx.lineTo(...corners[b])
      }
      ctx.stroke()

      // Linee dalle maniglie al centro del box
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
      ctx.beginPath()
      for (const handle of handles) {
        ctx.moveTo(...center)
        ctx.lineTo(...handle.point)
      }
      ctx.stroke()

      const active = dragRef.current || hoverRef.current
      for (const handle of handles) {
        const isActive = active && active.axis === handle.axis && active.side === handle.side
        ctx.beginPath()
        ctx.arc(handle.point[0], handle.point[1], HANDLE_RADIUS, 0, Math.PI * 2)
        ctx.fillStyle = isActive ? HANDLE_ACTIVE_COLOR : HANDLE_COLOR
        ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
        ctx.shadowBlur = 4
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.lineWidth = 1
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
        ctx.stroke()
      }
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [nvRef, canvasRef])

  // Mouse: le maniglie si trascinano, il resto passa a NiiVue (rotazione, zoom, ecc.)
  useEffect(() => {
    const container = canvasRef.current?.parentElement
    if (!container) return undefined

    const localPoint = (event) => {
      const rect = container.getBoundingClientRect()
      return [event.clientX - rect.left, event.clientY - rect.top]
    }

    const hitHandle = (point) => {
      let best = null
      let bestDistance = HIT_RADIUS
      for (const handle of handlesRef.current) {
        const distance = Math.hypot(handle.point[0] - point[0], handle.point[1] - point[1])
        if (distance <= bestDistance) {
          best = handle
          bestDistance = distance
        }
      }
      return best
    }

    const onMouseDown = (event) => {
      if (event.button !== 0) return
      const handle = hitHandle(localPoint(event))
      if (!handle) return
      event.stopPropagation()
      event.preventDefault()
      const nv = nvRef.current
      const project = nv && makeProjector(nv, canvasRef.current)
      if (!project) return
      // Direzione sullo schermo dell'asse della faccia: pixel per unita' frazionaria
      const start = boxRef.current
      const origin = faceCenterFrac(start, handle)
      const moved = [...origin]
      moved[handle.axis] += 1
      const p0 = project(origin)
      const p1 = project(moved)
      const axisScreen = [p1[0] - p0[0], p1[1] - p0[1]]
      dragRef.current = {
        axis: handle.axis,
        side: handle.side,
        startPoint: localPoint(event),
        startBox: start,
        axisScreen,
        axisLengthSq: Math.max(axisScreen[0] ** 2 + axisScreen[1] ** 2, 400),
      }
      container.style.cursor = 'grabbing'
    }

    const onMouseMove = (event) => {
      const drag = dragRef.current
      const point = localPoint(event)
      if (!drag) {
        const handle = hitHandle(point)
        hoverRef.current = handle
        container.style.cursor = handle ? 'grab' : ''
        return
      }
      event.stopPropagation()
      const delta = [point[0] - drag.startPoint[0], point[1] - drag.startPoint[1]]
      const deltaFrac = (delta[0] * drag.axisScreen[0] + delta[1] * drag.axisScreen[1]) / drag.axisLengthSq
      const { axis, side, startBox } = drag
      const next = { min: [...startBox.min], max: [...startBox.max] }
      if (side === 0) {
        next.min[axis] = Math.min(Math.max(startBox.min[axis] + deltaFrac, 0), startBox.max[axis] - MIN_SIZE)
      } else {
        next.max[axis] = Math.max(Math.min(startBox.max[axis] + deltaFrac, 1), startBox.min[axis] + MIN_SIZE)
      }
      boxRef.current = next
      onChangeRef.current(next)
    }

    const onMouseUp = (event) => {
      if (!dragRef.current) return
      event.stopPropagation()
      dragRef.current = null
      container.style.cursor = hoverRef.current ? 'grab' : ''
    }

    container.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('mouseup', onMouseUp, true)
    return () => {
      container.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('mouseup', onMouseUp, true)
      container.style.cursor = ''
    }
  }, [nvRef, canvasRef])

  return <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
}
