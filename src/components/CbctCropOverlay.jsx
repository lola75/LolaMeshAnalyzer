import React, { useEffect, useRef, useState } from 'react'

// Livello trasparente sopra il visualizzatore 3D per disegnare il contorno del ritaglio.
// I punti sono in pixel CSS rispetto al riquadro del visualizzatore.
// Clic = un punto; tasto premuto e trascinato = un punto ogni 5 mm lungo il percorso
// (getStepPx: quanti pixel valgono 5 mm con lo zoom attuale del 3D).
export default function CbctCropOverlay({ points, closed, keepInside, getStepPx, onAddPoint, onAddPoints, onRemoveLastPoint, onClose, onCancel }) {
  const canvasRef = useRef(null)
  const [hover, setHover] = useState(null)
  const drawRef = useRef(null) // { last: [x, y], step } mentre il tasto e' premuto

  useEffect(() => {
    const canvas = canvasRef.current
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.round(rect.width * window.devicePixelRatio)
      canvas.height = Math.round(rect.height * window.devicePixelRatio)
      draw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    return () => observer.disconnect()
  })

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onCancel()
      else if (event.key === 'Backspace') {
        event.preventDefault()
        onRemoveLastPoint()
      } else if (event.key === 'Enter' && points.length >= 3) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [points, onCancel, onRemoveLastPoint, onClose])

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (points.length === 0) return
    const color = keepInside ? '34, 197, 94' : '239, 68, 68'
    ctx.beginPath()
    ctx.moveTo(points[0][0], points[0][1])
    points.slice(1).forEach(([x, y]) => ctx.lineTo(x, y))
    if (!closed && hover) ctx.lineTo(hover[0], hover[1])
    if (closed || points.length >= 3) ctx.closePath()
    ctx.fillStyle = `rgba(${color}, 0.22)`
    ctx.fill()
    ctx.strokeStyle = `rgb(${color})`
    ctx.lineWidth = 2
    ctx.setLineDash(closed ? [] : [6, 4])
    ctx.stroke()
    ctx.setLineDash([])
    points.forEach(([x, y]) => {
      ctx.beginPath()
      ctx.arc(x, y, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'
      ctx.fill()
    })
  }

  useEffect(draw, [points, closed, keepInside, hover])

  const localPoint = (event) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return [event.clientX - rect.left, event.clientY - rect.top]
  }

  // fine del trascinamento anche se il tasto si rilascia fuori dal visualizzatore
  useEffect(() => {
    const stop = () => { drawRef.current = null }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  // punti intermedi a passo fisso dall'ultimo punto verso il mouse
  const addPathPoints = (target) => {
    const draw = drawRef.current
    if (!draw) return
    let [x, y] = draw.last
    let dx = target[0] - x
    let dy = target[1] - y
    let distance = Math.hypot(dx, dy)
    if (distance < draw.step) return
    const added = []
    while (distance >= draw.step) {
      x += (dx / distance) * draw.step
      y += (dy / distance) * draw.step
      added.push([x, y])
      dx = target[0] - x
      dy = target[1] - y
      distance = Math.hypot(dx, dy)
    }
    draw.last = [x, y]
    onAddPoints(added)
  }

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ cursor: closed ? 'default' : 'crosshair' }}
      onMouseDown={(event) => {
        if (closed || event.button !== 0) return
        const point = localPoint(event)
        onAddPoint(point)
        const step = getStepPx?.()
        drawRef.current = step > 0 ? { last: point, step: Math.max(step, 3) } : null
      }}
      onDoubleClick={() => {
        // Il doppio clic ha gia' aggiunto due punti uguali: si toglie il duplicato e si chiude
        if (closed) return
        onRemoveLastPoint()
        onClose()
      }}
      onMouseMove={(event) => {
        const point = localPoint(event)
        setHover(point)
        if (drawRef.current && event.buttons & 1) addPathPoints(point)
      }}
      onMouseLeave={() => setHover(null)}
      onContextMenu={(event) => event.preventDefault()}
    />
  )
}
