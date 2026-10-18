import React, { useCallback, useEffect, useRef } from 'react'
import { Niivue, NVMesh, SLICE_TYPE } from '@niivue/niivue'
import { attachRenderWheelZoom } from '../utils/niivueWheelZoom'
import { fixRenderDepthRange } from '../utils/niivueRenderDepth'
import { enableTwoSidedMeshes } from '../utils/niivueTwoSidedMeshes'
import { attachRenderPointPicker } from '../utils/niivuePicking'
import CbctPointMarkers from './CbctPointMarkers'

// Visualizzatore 3D di una sola mesh (vista destra del Matching e anteprima nel pannello).
// buffer: contenuto del file STL/PLY/OBJ; il formato si ricava da fileName.
// onPick: se presente, un clic sulla mesh restituisce il punto (mm, coordinate del file);
// points: punti da mostrare come marcatori numerati.
const DEFAULT_BACK_COLOR = [0.09, 0.16, 0.28, 1]

export default function CbctMeshPreview({ buffer, fileName, color, backColor = DEFAULT_BACK_COLOR, interactive = true, onPick, points, className = '' }) {
  const canvasRef = useRef(null)
  const nvRef = useRef(null)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const getNv = useCallback(() => nvRef.current, [])
  const getCanvas = useCallback(() => canvasRef.current, [])

  useEffect(() => {
    if (!buffer) return undefined
    let cancelled = false
    const nv = new Niivue({ backColor, show3Dcrosshair: false, isOrientCube: false, loadingText: '' })
    nv.attachToCanvas(canvasRef.current)
    fixRenderDepthRange(nv)
    enableTwoSidedMeshes(nv)
    nv.setSliceType(SLICE_TYPE.RENDER)
    nvRef.current = nv
    if (!interactive) nv.opts.dragMode = 0
    const detachWheelZoom = interactive ? attachRenderWheelZoom(nv, canvasRef.current) : () => {}
    const detachPicker = interactive
      ? attachRenderPointPicker(nv, canvasRef.current, (mm) => onPickRef.current?.(mm))
      : () => {}
    NVMesh.readMesh(buffer.slice(0), fileName, nv.gl, 1, new Uint8Array([...color, 255]))
      .then((mesh) => {
        if (cancelled) return
        nv.addMesh(mesh)
        nv.setRenderAzimuthElevation(180, 15) // vista frontale
      })
      .catch((err) => console.warn('Anteprima mesh non riuscita:', err))
    return () => {
      cancelled = true
      detachWheelZoom()
      detachPicker()
      nvRef.current = null
      try {
        nv.cleanup()
      } catch {
        // contesto gia' rilasciato
      }
    }
  }, [buffer, fileName, color, backColor, interactive])

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className={`block w-full h-full ${interactive ? '' : 'pointer-events-none'} ${className}`}
      />
      {points?.length > 0 && <CbctPointMarkers getNv={getNv} getCanvas={getCanvas} points={points} color="#38bdf8" />}
    </div>
  )
}
