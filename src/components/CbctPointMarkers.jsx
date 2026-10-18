import React, { useEffect, useRef } from 'react'
import { makeMmProjector } from '../utils/niivuePicking'

// Marcatori numerati (1, 2, 3...) sopra la vista 3D di NiiVue; seguono rotazione e zoom.
// getNv / getCanvas: funzioni che restituiscono l'istanza NiiVue e il suo canvas.
export default function CbctPointMarkers({ getNv, getCanvas, points, color = '#f59e0b' }) {
  const overlayRef = useRef(null)
  const pointsRef = useRef(points)
  pointsRef.current = points

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
      const project = pointsRef.current.length ? makeMmProjector(nv, canvas) : null
      if (!project) return
      // il canvas di NiiVue puo' non coincidere con il livello dei marcatori
      const canvasRect = canvas.getBoundingClientRect()
      const offsetX = canvasRect.left - rect.left
      const offsetY = canvasRect.top - rect.top
      ctx.font = 'bold 11px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      pointsRef.current.forEach((point, index) => {
        const [x, y] = project(point)
        const px = x + offsetX
        const py = y + offsetY
        ctx.beginPath()
        ctx.arc(px, py, 9, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
        ctx.shadowBlur = 4
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.lineWidth = 1.5
        ctx.strokeStyle = '#ffffff'
        ctx.stroke()
        ctx.fillStyle = '#0f172a'
        ctx.fillText(String(index + 1), px, py + 0.5)
      })
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [getNv, getCanvas, color])

  return <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
}
