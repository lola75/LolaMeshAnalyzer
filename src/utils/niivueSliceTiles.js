// Slice 2D del layout personalizzato di NiiVue (Matching) come riquadri indipendenti:
// - ogni slice occupa tutto il suo riquadro (sfondo nero e bordo colorato);
//   la slice intera e' contenuta nel riquadro e centrata;
// - zoom proprio per ogni riquadro: tasto destro premuto e trascinato in avanti (+) o indietro (-).
//   Lo zoom tiene fermo il cursore (crosshair), cosi' si ingrandisce il punto che interessa;
// - spostamento dell'immagine nel riquadro: rotella premuta e trascinata;
// - nv.sliceTileFocus (punto in mm, es. centro della mesh del goniometro): se impostato, ogni slice
//   e' centrata su quel punto.
// Senza layout personalizzato NiiVue resta invariato.

const TILE_COLORS = { 0: [0.85, 0.15, 0.15], 1: [0.25, 0.35, 0.95], 2: [0.15, 0.7, 0.35] } // assiale, coronale, sagittale
const BORDER_PX = 2
const MIN_ZOOM = 0.2
const MAX_ZOOM = 20
const DRAG_ZOOM_SPEED = 0.01 // per pixel trascinato

const isSlice = (sliceType) => sliceType === 0 || sliceType === 1 || sliceType === 2
const layoutHasSlice = (nv, sliceType) => (nv.customLayout ?? []).some((v) => v.sliceType === sliceType)

export function enableSliceTiles(nv) {
  nv.sliceTileZoom = { 0: 1, 1: 1, 2: 1 }
  nv.sliceTilePan = { 0: [0, 0], 1: [0, 0], 2: [0, 0] } // mm nel piano della slice
  nv.sliceTileFocus = null
  let currentTile = null // riquadro che NiiVue sta disegnando

  // Il riquadro intero e' l'area della slice (NiiVue la ridurrebbe alle proporzioni del volume)
  const calculateWidthHeight = nv.calculateWidthHeight.bind(nv)
  nv.calculateWidthHeight = (sliceType, volScale, width, height) =>
    isSlice(sliceType) && layoutHasSlice(nv, sliceType)
      ? [width, height]
      : calculateWidthHeight(sliceType, volScale, width, height)

  // Campo visivo in mm: proporzioni del riquadro, slice intera contenuta, poi zoom del riquadro
  const screenFieldOfViewExtendedMM = nv.screenFieldOfViewExtendedMM.bind(nv)
  nv.screenFieldOfViewExtendedMM = (axCorSag = 0) => {
    const screen = screenFieldOfViewExtendedMM(axCorSag)
    if (!currentTile) return screen
    const [, , width, height] = currentTile.ltwh
    const zoom = nv.sliceTileZoom[axCorSag] ?? 1
    const sliceW = screen.mxMM[0] - screen.mnMM[0]
    const sliceH = screen.mxMM[1] - screen.mnMM[1]
    const mmPerPixel = Math.max(sliceW / width, sliceH / height) / zoom
    const viewW = width * mmPerPixel
    const viewH = height * mmPerPixel
    // Centro: dal centro della slice verso il cursore man mano che si ingrandisce;
    // rimpicciolendo la slice resta centrata nel riquadro
    let centerX
    let centerY
    if (nv.sliceTileFocus) {
      ;[centerX, centerY] = nv.swizzleVec3MM([...nv.sliceTileFocus], axCorSag)
    } else {
      const cross = nv.swizzleVec3MM(nv.frac2mm(nv.scene.crosshairPos), axCorSag)
      const follow = Math.max(0, 1 - 1 / zoom)
      const cx = (screen.mnMM[0] + screen.mxMM[0]) / 2
      const cy = (screen.mnMM[1] + screen.mxMM[1]) / 2
      centerX = cx + (cross[0] - cx) * follow
      centerY = cy + (cross[1] - cy) * follow
    }
    const [panX, panY] = nv.sliceTilePan[axCorSag] ?? [0, 0]
    centerX -= panX
    centerY -= panY
    screen.mnMM[0] = centerX - viewW / 2
    screen.mxMM[0] = centerX + viewW / 2
    screen.mnMM[1] = centerY - viewH / 2
    screen.mxMM[1] = centerY + viewH / 2
    screen.fovMM[0] = viewW
    screen.fovMM[1] = viewH
    return screen
  }

  const draw2DMain = nv.draw2DMain.bind(nv)
  nv.draw2DMain = (ltwh, axCorSag, customMM = NaN) => {
    if (!isSlice(axCorSag) || !layoutHasSlice(nv, axCorSag) || !ltwh[2] || !ltwh[3]) {
      return draw2DMain(ltwh, axCorSag, customMM)
    }
    fillTile(nv.gl, ltwh, TILE_COLORS[axCorSag])
    currentTile = { ltwh }
    try {
      return draw2DMain(ltwh, axCorSag, customMM)
    } finally {
      currentTile = null
    }
  }
}

// Bordo colorato e interno nero (coordinate del riquadro dall'alto, WebGL dal basso)
function fillTile(gl, [left, top, width, height], color) {
  const bottom = gl.canvas.height - top - height
  const clear = gl.getParameter(gl.COLOR_CLEAR_VALUE)
  gl.enable(gl.SCISSOR_TEST)
  gl.scissor(left, bottom, width, height)
  gl.clearColor(color[0], color[1], color[2], 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.scissor(left + BORDER_PX, bottom + BORDER_PX, width - 2 * BORDER_PX, height - 2 * BORDER_PX)
  gl.clearColor(0, 0, 0, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.disable(gl.SCISSOR_TEST)
  gl.clearColor(clear[0], clear[1], clear[2], clear[3])
}

export function resetSliceTileZoom(nv) {
  if (!nv?.sliceTileZoom) return
  nv.sliceTileZoom = { 0: 1, 1: 1, 2: 1 }
  nv.sliceTilePan = { 0: [0, 0], 1: [0, 0], 2: [0, 0] }
}

// Trascinamento su un riquadro 2D del layout personalizzato:
// tasto destro = zoom di quel riquadro, rotella premuta = spostamento dell'immagine.
// isActive(): false per lasciare questi tasti a NiiVue.
export function attachSliceTileDragZoom(nv, canvas, isActive = () => true) {
  const container = canvas.parentElement ?? canvas
  let drag = null

  const tileAt = (event) => {
    const rect = canvas.getBoundingClientRect()
    const dpr = canvas.width / rect.width || 1
    const x = (event.clientX - rect.left) * dpr
    const y = (event.clientY - rect.top) * dpr
    return (nv.screenSlices ?? []).find(({ leftTopWidthHeight: [l, t, w, h], axCorSag }) =>
      isSlice(axCorSag) && layoutHasSlice(nv, axCorSag) && x >= l && x < l + w && y >= t && y < t + h)
  }

  const onMove = (event) => {
    if (!drag) return
    event.preventDefault()
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (drag.mode === 'pan') {
      // l'immagine segue il mouse: pixel -> mm con la scala attuale del riquadro
      const { leftTopWidthHeight: [, , w, h], fovMM } = drag.tile
      const rect = canvas.getBoundingClientRect()
      const dpr = canvas.width / rect.width || 1
      nv.sliceTilePan[drag.axCorSag] = [
        drag.startPan[0] + ((dx * dpr) / w) * fovMM[0],
        drag.startPan[1] - ((dy * dpr) / h) * fovMM[1],
      ]
    } else {
      const zoom = drag.startZoom * Math.exp(-dy * DRAG_ZOOM_SPEED) // in avanti (verso l'alto) = +
      nv.sliceTileZoom[drag.axCorSag] = Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM)
    }
    nv.drawScene()
  }
  const onUp = () => {
    drag = null
    window.removeEventListener('mousemove', onMove, true)
    window.removeEventListener('mouseup', onUp, true)
  }
  const onDown = (event) => {
    if ((event.button !== 1 && event.button !== 2) || !nv.sliceTileZoom || !isActive()) return
    const tile = tileAt(event)
    if (!tile || !tile.fovMM) return
    event.preventDefault() // niente scorrimento automatico del browser con la rotella
    event.stopPropagation() // NiiVue non deve iniziare un suo trascinamento
    drag = {
      mode: event.button === 1 ? 'pan' : 'zoom',
      tile,
      axCorSag: tile.axCorSag,
      startX: event.clientX,
      startY: event.clientY,
      startZoom: nv.sliceTileZoom[tile.axCorSag] ?? 1,
      startPan: [...(nv.sliceTilePan[tile.axCorSag] ?? [0, 0])],
    }
    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('mouseup', onUp, true)
  }
  container.addEventListener('mousedown', onDown, true)
  return () => {
    onUp()
    container.removeEventListener('mousedown', onDown, true)
  }
}
