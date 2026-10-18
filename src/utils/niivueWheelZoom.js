// Rotella del mouse sulla vista 3D di NiiVue: zoom avanti/indietro.
// NiiVue usa la rotella solo per scorrere le slice (sulla vista 3D non fa nulla di visibile):
// qui la si intercetta prima di NiiVue quando il puntatore e' sulla vista 3D; sulle slice 2D
// resta il comportamento normale.

const ZOOM_STEP = 1.1
const MIN_ZOOM = 0.2
const MAX_ZOOM = 20

export function attachRenderWheelZoom(nv, canvas) {
  const container = canvas.parentElement ?? canvas
  const onWheel = (event) => {
    const rect = canvas.getBoundingClientRect()
    const dpr = canvas.width / rect.width || 1
    const x = (event.clientX - rect.left) * dpr
    const y = (event.clientY - rect.top) * dpr
    if (!nv.screenSlices?.length || nv.inRenderTile(x, y) < 0) return
    event.preventDefault()
    event.stopPropagation()
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
    const zoom = Math.min(Math.max(nv.scene.volScaleMultiplier * factor, MIN_ZOOM), MAX_ZOOM)
    nv.setScale(zoom)
  }
  container.addEventListener('wheel', onWheel, { capture: true, passive: false })
  return () => container.removeEventListener('wheel', onWheel, { capture: true })
}
