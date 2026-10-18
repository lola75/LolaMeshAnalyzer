// Contrasto/luminosita' delle slice 2D separato da quello della vista 3D.
//
// NiiVue converte il volume in una texture RGBA gia' "finestrata" (cal_min..cal_max) e la usa sia
// per il rendering 3D sia per le slice. Qui si genera una seconda texture con la finestra delle
// slice (stesso calcolo di NiiVue, refreshLayers, con i cal_min/cal_max delle slice) e la si
// collega al posto della prima solo mentre NiiVue disegna le slice 2D.
// La texture vale per il volume con cui e' stata creata: caricando un altro volume si torna alla
// finestra comune finche' non se ne imposta una nuova.

const slicesUseOwnTexture = (nv) =>
  nv.sliceWindow && nv.sliceWindow.volume === nv.volumes[0] && !nv.opts.is2DSliceShader

export function enableSliceWindow(nv) {
  nv.sliceWindow = null // { volume, texture, range }
  let pending = null
  let frame = 0

  const draw2DMain = nv.draw2DMain.bind(nv)
  nv.draw2DMain = (...args) => {
    if (!slicesUseOwnTexture(nv)) return draw2DMain(...args)
    const gl = nv.gl
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_3D, nv.sliceWindow.texture)
    try {
      return draw2DMain(...args)
    } finally {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_3D, nv.volumeTexture)
    }
  }

  // Al massimo un ricalcolo per fotogramma (i cursori inviano molti valori trascinando)
  nv.setSliceWindow = (range) => {
    pending = range
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      buildSliceTexture(nv, pending)
      nv.drawScene()
    })
  }
}

function buildSliceTexture(nv, range) {
  const gl = nv.gl
  const volume = nv.volumes[0]
  const previous = nv.sliceWindow
  nv.sliceWindow = null
  if (previous) gl.deleteTexture(previous.texture)
  if (!range || !volume || nv.opts.is2DSliceShader) return

  // Texture e gradiente del 3D messi da parte: refreshLayers li cancellerebbe e ricreerebbe
  const volumeTexture = nv.volumeTexture
  const gradientTexture = nv.gradientTexture
  const [calMin, calMax] = [volume.cal_min, volume.cal_max]
  nv.volumeTexture = null
  nv.gradientTexture = null
  volume.cal_min = range[0]
  volume.cal_max = range[1]
  try {
    nv.refreshLayers(volume, 0)
    nv.sliceWindow = { volume, texture: nv.volumeTexture, range }
    if (nv.gradientTexture && nv.gradientTexture !== gradientTexture) gl.deleteTexture(nv.gradientTexture)
  } finally {
    volume.cal_min = calMin
    volume.cal_max = calMax
    nv.volumeTexture = volumeTexture
    nv.gradientTexture = gradientTexture
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_3D, volumeTexture)
    gl.activeTexture(gl.TEXTURE6)
    gl.bindTexture(gl.TEXTURE_3D, gradientTexture)
  }
}
