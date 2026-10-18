import React, { useEffect, useRef } from 'react'
import { SLICE_TYPE } from '@niivue/niivue'
import { makeMmProjector } from '../utils/niivuePicking'

// Goniometro sulle slice 2D e sulla vista 3D (layout del Matching) per correggere a mano la
// posizione di una mesh gia' allineata alla CBCT:
// - due cerchi concentrici centrati sul centro della mesh: trascinando lungo la corona la mesh ruota
//   attorno all'asse perpendicolare alla slice (nel 3D: perpendicolare allo schermo); l'angolo
//   parte da 0 a ogni trascinamento;
// - pallino centrale: trascinandolo la mesh si sposta nel piano della slice (nel 3D: dello schermo).
// La mesh viene trasformata dal vivo (3D e contorno sulle slice); a fine trascinamento onCommit
// riceve la matrice 4x4 (per righe) dello spostamento, da comporre con quella dell'oggetto.

const RING_OUTER = 0.42 // raggio del cerchio esterno, frazione del lato minore del riquadro
const RING_INNER = 0.38
const RING_GRAB_PX = 10 // tolleranza per afferrare la corona (pixel CSS)
const CENTER_PX = 9
const RING_COLOR = '#2f3cff'
const CENTER_COLOR = '#e040fb'

// Assi in mm mostrati in orizzontale/verticale in ciascuna slice (come swizzleVec3MM di NiiVue)
const PLANE_AXES = { 0: [0, 1], 1: [0, 2], 2: [1, 2] }

const identity = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
const matMul = (a, b) => a.map((row) => b[0].map((_, j) => row.reduce((sum, v, k) => sum + v * b[k][j], 0)))
const apply = (m, [x, y, z]) => [0, 1, 2].map((r) => m[r][0] * x + m[r][1] * y + m[r][2] * z + m[r][3])

// Rotazione di `angle` (rad) nel piano degli assi i, j attorno al punto center
const planeRotation = (i, j, angle, center) => {
  const r = identity()
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  r[i][i] = c
  r[i][j] = -s
  r[j][i] = s
  r[j][j] = c
  const t = (v) => {
    const m = identity()
    m[0][3] = v[0]
    m[1][3] = v[1]
    m[2][3] = v[2]
    return m
  }
  return matMul(t(center), matMul(r, t(center.map((v) => -v))))
}

const translationMatrix = (v) => {
  const m = identity()
  m[0][3] = v[0]
  m[1][3] = v[1]
  m[2][3] = v[2]
  return m
}

// Rotazione di `angle` (rad) attorno all'asse unitario n passante per center (Rodrigues)
const axisRotation = (n, angle, center) => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const t = 1 - c
  const [x, y, z] = n
  const r = [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0],
    [0, 0, 0, 1],
  ]
  return matMul(translationMatrix(center), matMul(r, translationMatrix(center.map((v) => -v))))
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const meshCenter = (pts) => {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pts.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (pts[i + k] < min[k]) min[k] = pts[i + k]
      if (pts[i + k] > max[k]) max[k] = pts[i + k]
    }
  }
  return [0, 1, 2].map((k) => (min[k] + max[k]) / 2)
}

// Riquadri del layout personalizzato (slice 2D e vista 3D), ciascuno con:
// toScreen(mm) -> pixel CSS del canvas; rotation(angolo antiorario sullo schermo, centro) e
// translation(dx, dy in pixel CSS) -> matrici 4x4 in mm
const gonioTiles = (nv, canvas, dpr) => {
  if (!nv.customLayout?.length) return []
  const tiles = []
  for (const tile of nv.screenSlices ?? []) {
    const [l, t, w, h] = tile.leftTopWidthHeight
    const rect = [l / dpr, t / dpr, w / dpr, h / dpr]
    if (PLANE_AXES[tile.axCorSag] && tile.fovMM && tile.leftTopMM) {
      const [i, j] = PLANE_AXES[tile.axCorSag]
      const [left, top] = tile.leftTopMM
      const [fovX, fovY] = tile.fovMM
      // verso di rotazione: lo schermo puo' essere specchiato rispetto agli assi in mm
      const handedness = Math.sign(fovX) * Math.sign(fovY)
      tiles.push({
        axCorSag: tile.axCorSag,
        rect,
        toScreen: (mm) => [
          (l + ((mm[i] - left) / fovX) * w) / dpr,
          (t + (1 - (mm[j] - top) / fovY) * h) / dpr,
        ],
        rotation: (angle, center) => planeRotation(i, j, angle * handedness, center),
        translation: (dx, dy) => {
          const v = [0, 0, 0]
          v[i] = ((dx * dpr) / w) * fovX
          v[j] = (-(dy * dpr) / h) * fovY
          return translationMatrix(v)
        },
      })
    } else if (tile.axCorSag === SLICE_TYPE.RENDER) {
      const project = makeMmProjector(nv, canvas)
      if (!project) continue
      tiles.push({ axCorSag: SLICE_TYPE.RENDER, rect, toScreen: project, ...renderTileMotion(project) })
    }
  }
  return tiles
}

// Vista 3D (proiezione ortografica): rotazione attorno all'asse di vista e spostamento nel piano
// dello schermo, ricavati dalla proiezione degli assi x, y, z
const renderTileMotion = (project) => {
  const o = project([0, 0, 0])
  const columns = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e) => {
    const p = project(e)
    return [p[0] - o[0], p[1] - o[1]]
  })
  const jx = columns.map((c) => c[0]) // pixel per mm in orizzontale
  const jy = columns.map((c) => c[1]) // pixel per mm in verticale (verso il basso)
  // pseudo-inversa: pixel -> mm nel piano dello schermo
  const a = dot(jx, jx)
  const b = dot(jx, jy)
  const d = dot(jy, jy)
  const det = a * d - b * b || 1
  const toMM = (dx, dy) => {
    const u = (d * dx - b * dy) / det
    const v = (a * dy - b * dx) / det
    return [0, 1, 2].map((k) => jx[k] * u + jy[k] * v)
  }
  const axisRaw = cross(jx, jy)
  const length = Math.hypot(...axisRaw) || 1
  const axis = axisRaw.map((v) => v / length)
  // verso: una piccola rotazione positiva deve girare in senso antiorario sullo schermo
  const right = toMM(1, 0)
  const turned = apply(axisRotation(axis, 0.1, [0, 0, 0]), right)
  const sign = Math.atan2(-dot(jy, turned), dot(jx, turned)) > 0 ? 1 : -1
  return {
    rotation: (angle, center) => axisRotation(axis, angle * sign, center),
    translation: (dx, dy) => translationMatrix(toMM(dx, dy)),
  }
}

const angleOf = (x, y, cx, cy) => Math.atan2(-(y - cy), x - cx) // gradi matematici, y verso l'alto

export default function CbctMeshGoniometer({ getNv, getCanvas, mesh, onCommit }) {
  const overlayRef = useRef(null)
  const centerRef = useRef(null)
  const dragRef = useRef(null)
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  // Centro della mesh e cursore delle slice sul centro: le tre slice passano per la mesh
  useEffect(() => {
    const nv = getNv()
    if (!nv || !mesh) return
    const center = meshCenter(mesh.pts)
    centerRef.current = center
    nv.scene.crosshairPos = nv.mm2frac(center, 0, true)
    // slice centrate sulla mesh: il goniometro sta al centro di ogni riquadro
    nv.sliceTileFocus = center
    if (nv.sliceTilePan) nv.sliceTilePan = { 0: [0, 0], 1: [0, 0], 2: [0, 0] }
    nv.drawScene()
    return () => {
      nv.sliceTileFocus = null
    }
  }, [mesh, getNv])

  // Trascinamento: corona = rotazione, centro = spostamento
  useEffect(() => {
    const nv = getNv()
    const canvas = getCanvas()
    if (!nv || !canvas || !mesh) return undefined
    const container = canvas.parentElement ?? canvas

    const locate = (event) => {
      const rect = canvas.getBoundingClientRect()
      const dpr = canvas.width / rect.width || 1
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const center = centerRef.current
      if (!center) return null
      for (const tile of gonioTiles(nv, canvas, dpr)) {
        const [l, t, w, h] = tile.rect
        if (x < l || y < t || x > l + w || y > t + h) continue
        const [cx, cy] = tile.toScreen(center)
        const d = Math.hypot(x - cx, y - cy)
        const outer = RING_OUTER * Math.min(w, h)
        const inner = RING_INNER * Math.min(w, h)
        let mode = null
        if (d <= CENTER_PX + 3) mode = 'move'
        else if (d >= inner - RING_GRAB_PX && d <= outer + RING_GRAB_PX) mode = 'rotate'
        return { tile, x, y, cx, cy, mode }
      }
      return null
    }

    // Vertici della mesh = matrice applicata alle posizioni di inizio trascinamento
    const transformFromStart = (drag) => {
      const p = mesh.pts
      const m = drag.matrix
      const s = drag.startPts
      for (let k = 0; k < p.length; k += 3) {
        const x = s[k]
        const y = s[k + 1]
        const z = s[k + 2]
        p[k] = m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3]
        p[k + 1] = m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3]
        p[k + 2] = m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3]
      }
      mesh.updateMesh(nv.gl)
      centerRef.current = apply(m, drag.startCenter)
      if (drag.mode === 'move') nv.scene.crosshairPos = nv.mm2frac(centerRef.current, 0, true)
      nv.drawScene()
    }

    // al massimo un aggiornamento della mesh per fotogramma
    const render = () => {
      const drag = dragRef.current
      if (!drag || drag.frame) return
      drag.frame = requestAnimationFrame(() => {
        drag.frame = 0
        if (dragRef.current === drag) transformFromStart(drag)
      })
    }

    const onMove = (event) => {
      const drag = dragRef.current
      if (!drag) {
        const hit = locate(event)
        container.style.cursor = hit?.mode === 'move' ? 'move' : hit?.mode === 'rotate' ? 'grab' : ''
        return
      }
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      if (drag.mode === 'rotate') {
        const angle = angleOf(x, y, drag.cx, drag.cy)
        let step = angle - drag.lastAngle
        if (step > Math.PI) step -= 2 * Math.PI
        if (step < -Math.PI) step += 2 * Math.PI
        drag.lastAngle = angle
        drag.angle += step // sullo schermo, antiorario positivo
        drag.current = [x, y]
        drag.matrix = drag.tile.rotation(drag.angle, drag.startCenter)
      } else {
        drag.matrix = drag.tile.translation(x - drag.start[0], y - drag.start[1])
      }
      render()
    }

    const onUp = () => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      if (drag.frame) cancelAnimationFrame(drag.frame)
      container.style.cursor = ''
      window.removeEventListener('mouseup', onUp, true)
      transformFromStart(drag) // stato finale esatto
      onCommitRef.current?.(drag.matrix)
    }

    const onDown = (event) => {
      if (event.button !== 0 || dragRef.current) return
      const hit = locate(event)
      if (!hit?.mode) return
      event.preventDefault()
      event.stopImmediatePropagation() // NiiVue non deve spostare il cursore ne' ruotare il 3D
      dragRef.current = {
        mode: hit.mode,
        tile: hit.tile,
        cx: hit.cx,
        cy: hit.cy,
        start: [hit.x, hit.y],
        current: [hit.x, hit.y],
        lastAngle: angleOf(hit.x, hit.y, hit.cx, hit.cy),
        startAngle: angleOf(hit.x, hit.y, hit.cx, hit.cy),
        angle: 0,
        startPts: Float32Array.from(mesh.pts),
        startCenter: centerRef.current,
        matrix: identity(),
        frame: 0,
      }
      container.style.cursor = hit.mode === 'move' ? 'move' : 'grabbing'
      window.addEventListener('mouseup', onUp, true)
    }

    container.addEventListener('mousedown', onDown, true)
    window.addEventListener('mousemove', onMove, true)
    return () => {
      container.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('mouseup', onUp, true)
      container.style.cursor = ''
      dragRef.current = null
    }
  }, [mesh, getNv, getCanvas])

  // Disegno dei cerchi sopra le slice (segue zoom, cursore e ridimensionamenti)
  useEffect(() => {
    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const overlay = overlayRef.current
      const nv = getNv()
      const canvas = getCanvas()
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
      const center = centerRef.current
      if (!center) return
      const canvasRect = canvas.getBoundingClientRect()
      const offsetX = canvasRect.left - rect.left
      const offsetY = canvasRect.top - rect.top
      const canvasDpr = canvas.width / canvasRect.width || 1
      const drag = dragRef.current
      for (const tile of gonioTiles(nv, canvas, canvasDpr)) {
        const [l, t, w, h] = tile.rect
        ctx.save()
        ctx.translate(offsetX, offsetY)
        ctx.beginPath()
        ctx.rect(l, t, w, h)
        ctx.clip()
        const [cx, cy] = tile.toScreen(center)
        const outer = RING_OUTER * Math.min(w, h)
        const inner = RING_INNER * Math.min(w, h)
        ctx.strokeStyle = RING_COLOR
        ctx.lineWidth = 1.5
        for (const r of [inner, outer]) {
          ctx.beginPath()
          ctx.arc(cx, cy, r, 0, Math.PI * 2)
          ctx.stroke()
        }
        // Rotazione in corso: linee di partenza e attuale, angolo (orario positivo)
        if (drag?.mode === 'rotate' && drag.tile.axCorSag === tile.axCorSag) {
          const a0 = drag.startAngle
          const a1 = a0 + drag.angle
          ctx.beginPath()
          ctx.moveTo(cx, cy)
          ctx.lineTo(cx + outer * Math.cos(a0), cy - outer * Math.sin(a0))
          ctx.moveTo(cx, cy)
          ctx.lineTo(cx + outer * Math.cos(a1), cy - outer * Math.sin(a1))
          ctx.stroke()
          ctx.fillStyle = 'rgba(47, 60, 255, 0.18)'
          ctx.beginPath()
          ctx.moveTo(cx, cy)
          ctx.arc(cx, cy, inner, -a0, -a1, drag.angle > 0)
          ctx.closePath()
          ctx.fill()
          const label = `${(-drag.angle * 180 / Math.PI).toFixed(1)}°`
          const tx = cx + (outer + 22) * Math.cos(a1)
          const ty = cy - (outer + 22) * Math.sin(a1)
          ctx.font = '600 16px system-ui, sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.lineWidth = 3
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'
          ctx.strokeText(label, tx, ty)
          ctx.fillStyle = '#ffffff'
          ctx.fillText(label, tx, ty)
        }
        // Centro (trascinabile per spostare la mesh)
        ctx.beginPath()
        ctx.arc(cx, cy, CENTER_PX, 0, Math.PI * 2)
        ctx.fillStyle = CENTER_COLOR
        ctx.fill()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = '#ffffff'
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(cx - 5, cy)
        ctx.lineTo(cx + 5, cy)
        ctx.moveTo(cx, cy - 5)
        ctx.lineTo(cx, cy + 5)
        ctx.stroke()
        ctx.restore()
      }
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [getNv, getCanvas])

  return <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
}
