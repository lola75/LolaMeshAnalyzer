import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'

// Cubo di orientamento della vista 3D (in basso a sinistra): il cubo segue la telecamera e mostra da
// che lato si guarda; le frecce ruotano la vista di 90 gradi in quella direzione partendo dalla
// posizione attuale, le frecce curve ruotano di 90 gradi sul piano dello schermo, la casa torna
// alla vista frontale.
//
// cameraRef: telecamera della vista; onRotate('up' | 'down' | 'left' | 'right' | 'cw' | 'ccw');
// onHome(): vista frontale.

const SIZE = 46 // lato del cubo (px)
const FACES = [
  { label: 'FRONTE', transform: `translateZ(${SIZE / 2}px)` },
  { label: 'RETRO', transform: `rotateY(180deg) translateZ(${SIZE / 2}px)` },
  { label: 'DESTRA', transform: `rotateY(90deg) translateZ(${SIZE / 2}px)` },
  { label: 'SINISTRA', transform: `rotateY(-90deg) translateZ(${SIZE / 2}px)` },
  { label: 'SOPRA', transform: `rotateX(90deg) translateZ(${SIZE / 2}px)` },
  { label: 'SOTTO', transform: `rotateX(-90deg) translateZ(${SIZE / 2}px)` },
]

// frecce attorno al cubo: pallini scuri ben visibili sullo sfondo blu della vista
const arrowButton = 'absolute flex h-7 w-7 items-center justify-center rounded-full bg-slate-800/85 text-white shadow-md ring-1 ring-white/40 transition hover:scale-110 hover:bg-sky-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300'
// barra sotto il cubo: rotazioni sullo schermo e vista frontale
const barButton = 'flex h-8 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-800 shadow-md transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500'

function Triangle({ rotate }) {
  return (
    <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" style={{ transform: `rotate(${rotate}deg)` }} aria-hidden="true">
      <path d="M6 2 L10.5 9.5 L1.5 9.5 Z" fill="currentColor" />
    </svg>
  )
}

function Curved({ mirror }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" style={mirror ? { transform: 'scaleX(-1)' } : undefined} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </svg>
  )
}

export default function ViewRotateWidget({ cameraRef, onRotate, onHome, className = '' }) {
  const cubeRef = useRef(null)

  // il cubo segue l'orientamento della telecamera (senza ridisegnare React a ogni fotogramma)
  useEffect(() => {
    let frame = 0
    const inverse = new THREE.Matrix4()
    const flip = new THREE.Matrix4().makeScale(1, -1, 1) // CSS: y verso il basso
    const css = new THREE.Matrix4()
    const tick = () => {
      const camera = cameraRef?.current
      const cube = cubeRef.current
      if (camera && cube) {
        inverse.makeRotationFromQuaternion(camera.quaternion).invert()
        css.multiplyMatrices(flip, inverse).multiply(flip)
        cube.style.transform = `matrix3d(${css.elements.map((v) => v.toFixed(6)).join(',')})`
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [cameraRef])

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`} role="group" aria-label="Orientamento della vista">
      <div className="relative h-[132px] w-[132px] select-none rounded-full border border-white/50 bg-white/45 shadow-lg backdrop-blur-sm">
        {/* cubo */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: SIZE, height: SIZE, perspective: 400 }}>
          <div ref={cubeRef} className="relative h-full w-full" style={{ transformStyle: 'preserve-3d' }}>
            {FACES.map((face) => (
              <div
                key={face.label}
                className="absolute inset-0 flex items-center justify-center border border-slate-400 bg-gradient-to-br from-slate-50 to-slate-200 text-[7.5px] font-bold tracking-wide text-slate-600"
                style={{ transform: face.transform, backfaceVisibility: 'hidden' }}
              >
                {face.label}
              </div>
            ))}
          </div>
        </div>
        {/* frecce: 90 gradi nella direzione */}
        <button type="button" className={`${arrowButton} left-1/2 top-1.5 -translate-x-1/2 hover:-translate-x-1/2`} onClick={() => onRotate('up')} title="Ruota la vista di 90° verso l'alto" aria-label="Ruota 90° verso l'alto"><Triangle rotate={0} /></button>
        <button type="button" className={`${arrowButton} bottom-1.5 left-1/2 -translate-x-1/2 hover:-translate-x-1/2`} onClick={() => onRotate('down')} title="Ruota la vista di 90° verso il basso" aria-label="Ruota 90° verso il basso"><Triangle rotate={180} /></button>
        <button type="button" className={`${arrowButton} left-1.5 top-1/2 -translate-y-1/2 hover:-translate-y-1/2`} onClick={() => onRotate('left')} title="Ruota la vista di 90° verso sinistra" aria-label="Ruota 90° verso sinistra"><Triangle rotate={-90} /></button>
        <button type="button" className={`${arrowButton} right-1.5 top-1/2 -translate-y-1/2 hover:-translate-y-1/2`} onClick={() => onRotate('right')} title="Ruota la vista di 90° verso destra" aria-label="Ruota 90° verso destra"><Triangle rotate={90} /></button>
      </div>
      {/* barra: rotazioni di 90 gradi sullo schermo e vista frontale */}
      <div className="flex items-center gap-1.5">
        <button type="button" className={barButton} onClick={() => onRotate('ccw')} title="Ruota di 90° in senso antiorario" aria-label="Ruota 90° in senso antiorario"><Curved mirror /></button>
        <button type="button" className={barButton} onClick={onHome} title="Vista frontale" aria-label="Vista frontale">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" />
          </svg>
        </button>
        <button type="button" className={barButton} onClick={() => onRotate('cw')} title="Ruota di 90° in senso orario" aria-label="Ruota 90° in senso orario"><Curved /></button>
      </div>
    </div>
  )
}
