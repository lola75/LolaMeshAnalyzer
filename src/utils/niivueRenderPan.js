// Rotella premuta e trascinata sulla vista 3D di NiiVue: spostamento della scena sullo schermo.
// Usa nv.position, la traslazione (in mm, assi dello schermo) che NiiVue applica dopo la camera:
// la scena segue il mouse con la scala attuale (anche dopo lo zoom). Sulle slice 2D non fa nulla.

export function attachRenderDragPan(nv, canvas) {
  const container = canvas.parentElement ?? canvas
  let drag = null

  const onMove = (event) => {
    if (!drag) return
    event.preventDefault()
    const dx = (event.clientX - drag.startX) * drag.mmPerPixel
    const dy = (event.clientY - drag.startY) * drag.mmPerPixel
    // asse x dello schermo invertito nella matrice di NiiVue; y verso l'alto
    nv.position = [drag.start[0] - dx, drag.start[1] - dy, drag.start[2]]
    nv.drawScene()
  }
  const onUp = () => {
    drag = null
    window.removeEventListener('mousemove', onMove, true)
    window.removeEventListener('mouseup', onUp, true)
  }
  const onDown = (event) => {
    if (event.button !== 1) return
    const rect = canvas.getBoundingClientRect()
    const dpr = canvas.width / rect.width || 1
    const x = (event.clientX - rect.left) * dpr
    const y = (event.clientY - rect.top) * dpr
    if (!nv.screenSlices?.length || nv.inRenderTile(x, y) < 0) return
    const tile = nv.screenSlices[nv.inRenderTile(x, y)]
    const [, , w, h] = tile?.leftTopWidthHeight ?? [0, 0, canvas.width, canvas.height]
    // mm visibili sul lato corto del riquadro (come la proiezione ortografica di NiiVue)
    const viewScale = (0.8 * nv.furthestFromPivot) / nv.scene.volScaleMultiplier
    const shortSidePx = (Math.min(w || canvas.width, h || canvas.height)) / dpr
    event.preventDefault() // niente scorrimento automatico del browser
    event.stopPropagation()
    drag = {
      startX: event.clientX,
      startY: event.clientY,
      start: [...(nv.position ?? [0, 0, 0])],
      mmPerPixel: (2 * viewScale) / shortSidePx,
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

export function resetRenderPan(nv) {
  if (nv) nv.position = [0, 0, 0]
}
