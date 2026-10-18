import { SLICE_TYPE } from '@niivue/niivue'

// Selezione di punti sulla vista 3D di NiiVue e proiezione di punti (mm) sullo schermo.

const CLICK_TOLERANCE_PX = 4 // oltre questo spostamento il gesto e' una rotazione, non un clic

// Un clic (senza trascinamento) sulla vista 3D chiama onPick([x, y, z] in mm) con il punto della
// superficie colpita: volume o mesh. NiiVue fa il depth picking solo col doppio clic: qui lo si
// richiede al clic singolo come fa NiiVue (posizione del mouse + mouseDepthPicker + ridisegno).
// Il picking sposta il cursore 3D solo se colpisce qualcosa: se il cursore non cambia, il clic
// era sullo sfondo e non si aggiunge nessun punto.
export function attachRenderPointPicker(nv, canvas, onPick) {
  const container = canvas.parentElement ?? canvas
  let down = null

  const onMouseDown = (event) => {
    down = event.button === 0 ? [event.clientX, event.clientY] : null
  }
  const onMouseUp = (event) => {
    if (!down || event.button !== 0) return
    const moved = Math.hypot(event.clientX - down[0], event.clientY - down[1])
    down = null
    if (moved > CLICK_TOLERANCE_PX) return
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left // pixel CSS
    const y = event.clientY - rect.top
    const dpr = canvas.width / rect.width || 1
    if (!nv.screenSlices?.length || nv.inRenderTile(x * dpr, y * dpr) < 0) return
    // dopo la gestione del rilascio da parte di NiiVue
    setTimeout(() => {
      const before = Array.from(nv.scene.crosshairPos)
      nv.updateMousePos(x, y)
      nv.uiData.mouseDepthPicker = true
      nv.drawScene()
      nv.drawScene()
      const after = Array.from(nv.scene.crosshairPos)
      if (after.every((value, i) => value === before[i])) return
      const mm = nv.frac2mm(nv.scene.crosshairPos, 0, true)
      onPick([mm[0], mm[1], mm[2]])
    }, 0)
  }

  container.addEventListener('mousedown', onMouseDown, true)
  container.addEventListener('mouseup', onMouseUp, true)
  return () => {
    container.removeEventListener('mousedown', onMouseDown, true)
    container.removeEventListener('mouseup', onMouseUp, true)
  }
}

// Funzione mm -> [x, y] in pixel CSS del canvas per la vista 3D attuale (null se non c'e' vista 3D)
export function makeMmProjector(nv, canvas) {
  const tile = nv.screenSlices?.find((slice) => slice.axCorSag === SLICE_TYPE.RENDER)
  if (!tile) return null
  const viewport = tile.leftTopWidthHeight
  const [mvp] = nv.calculateMvpMatrix(null, viewport, nv.scene.renderAzimuth, nv.scene.renderElevation)
  const scale = canvas.width / canvas.getBoundingClientRect().width || 1
  return ([x, y, z]) => {
    const cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12]
    const cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13]
    const w = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15] || 1
    return [
      ((cx / w + 1) * 0.5 * viewport[2] + viewport[0]) / scale,
      ((1 - cy / w) * 0.5 * viewport[3] + viewport[1]) / scale,
    ]
  }
}
