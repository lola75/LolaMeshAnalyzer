import React, { useEffect, useRef } from 'react'
import { Niivue, NVMesh, SLICE_TYPE } from '@niivue/niivue'

// Visualizzatore 3D di una sola mesh (vista destra del Matching e anteprima nel pannello).
// buffer: contenuto del file STL/PLY/OBJ; il formato si ricava da fileName.
const DEFAULT_BACK_COLOR = [0.09, 0.16, 0.28, 1]

export default function CbctMeshPreview({ buffer, fileName, color, backColor = DEFAULT_BACK_COLOR, interactive = true, className = '' }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!buffer) return undefined
    let cancelled = false
    const nv = new Niivue({ backColor, show3Dcrosshair: false, isOrientCube: false, loadingText: '' })
    nv.attachToCanvas(canvasRef.current)
    nv.setSliceType(SLICE_TYPE.RENDER)
    if (!interactive) nv.opts.dragMode = 0
    NVMesh.readMesh(buffer.slice(0), fileName, nv.gl, 1, new Uint8Array([...color, 255]))
      .then((mesh) => {
        if (cancelled) return
        nv.addMesh(mesh)
        nv.setRenderAzimuthElevation(180, 15) // vista frontale
      })
      .catch((err) => console.warn('Anteprima mesh non riuscita:', err))
    return () => {
      cancelled = true
      try {
        nv.cleanup()
      } catch {
        // contesto gia' rilasciato
      }
    }
  }, [buffer, fileName, color, backColor, interactive])

  return (
    <canvas
      ref={canvasRef}
      className={`block w-full h-full ${interactive ? '' : 'pointer-events-none'} ${className}`}
    />
  )
}
