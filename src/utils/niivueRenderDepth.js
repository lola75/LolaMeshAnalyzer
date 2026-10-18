// Vista 3D di NiiVue: profondita' visibile indipendente dallo zoom.
//
// NiiVue calcola la proiezione ortografica con piani near/far proporzionali a
// furthestFromPivot / zoom: ingrandendo, lo "spessore" di scena visibile si assottiglia e le parti
// piu' vicine alla camera vengono tagliate (es. l'antagonista guardando l'arcata dall'alto).
// Qui calculateMvpMatrix viene sostituita da una copia identica (stesse rotazioni, stessa
// inquadratura e stesso zoom) in cui camera e piani near/far dipendono solo dalla grandezza della
// scena, con margine per gli oggetti che escono dal volume. NiiVue usa questa funzione per volume,
// mesh, cursore 3D e picking, quindi resta tutto coerente.

const CAMERA_DISTANCE = 4 // in unita' di 0.8 * furthestFromPivot (NiiVue: 1.8, diviso lo zoom)
const FAR_PLANE = 10
const NEAR_PLANE = 0.01

// Matrici 4x4 in ordine per colonne, come gl-matrix / WebGL
const multiply = (a, b) => {
  const out = new Float32Array(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k]
      out[col * 4 + row] = sum
    }
  }
  return out
}

const identity = () => {
  const out = new Float32Array(16)
  out[0] = out[5] = out[10] = out[15] = 1
  return out
}

const translation = ([x, y, z]) => {
  const out = identity()
  out[12] = x
  out[13] = y
  out[14] = z
  return out
}

const rotationX = (rad) => {
  const out = identity()
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  out[5] = c
  out[6] = s
  out[9] = -s
  out[10] = c
  return out
}

const rotationZ = (rad) => {
  const out = identity()
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  out[0] = c
  out[1] = s
  out[4] = -s
  out[5] = c
  return out
}

// Come mat4.ortho di gl-matrix
const ortho = (left, right, bottom, top, near, far) => {
  const out = new Float32Array(16)
  const lr = 1 / (left - right)
  const bt = 1 / (bottom - top)
  const nf = 1 / (near - far)
  out[0] = -2 * lr
  out[5] = -2 * bt
  out[10] = 2 * nf
  out[12] = (left + right) * lr
  out[13] = (top + bottom) * bt
  out[14] = (far + near) * nf
  out[15] = 1
  return out
}

const invert = (a) => {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a
  const b00 = a00 * a11 - a01 * a10
  const b01 = a00 * a12 - a02 * a10
  const b02 = a00 * a13 - a03 * a10
  const b03 = a01 * a12 - a02 * a11
  const b04 = a01 * a13 - a03 * a11
  const b05 = a02 * a13 - a03 * a12
  const b06 = a20 * a31 - a21 * a30
  const b07 = a20 * a32 - a22 * a30
  const b08 = a20 * a33 - a23 * a30
  const b09 = a21 * a32 - a22 * a31
  const b10 = a21 * a33 - a23 * a31
  const b11 = a22 * a33 - a23 * a32
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  const inv = det ? 1 / det : 0
  return Float32Array.from([
    (a11 * b11 - a12 * b10 + a13 * b09) * inv,
    (a02 * b10 - a01 * b11 - a03 * b09) * inv,
    (a31 * b05 - a32 * b04 + a33 * b03) * inv,
    (a22 * b04 - a21 * b05 - a23 * b03) * inv,
    (a12 * b08 - a10 * b11 - a13 * b07) * inv,
    (a00 * b11 - a02 * b08 + a03 * b07) * inv,
    (a32 * b02 - a30 * b05 - a33 * b01) * inv,
    (a20 * b05 - a22 * b02 + a23 * b01) * inv,
    (a10 * b10 - a11 * b08 + a13 * b06) * inv,
    (a01 * b08 - a00 * b10 - a03 * b06) * inv,
    (a30 * b04 - a31 * b02 + a33 * b00) * inv,
    (a21 * b02 - a20 * b04 - a23 * b00) * inv,
    (a11 * b07 - a10 * b09 - a12 * b06) * inv,
    (a00 * b09 - a01 * b07 + a02 * b06) * inv,
    (a31 * b01 - a30 * b03 - a32 * b00) * inv,
    (a20 * b03 - a21 * b01 + a22 * b00) * inv,
  ])
}

const transpose = (a) => Float32Array.from([
  a[0], a[4], a[8], a[12], a[1], a[5], a[9], a[13], a[2], a[6], a[10], a[14], a[3], a[7], a[11], a[15],
])

const deg2rad = (deg) => (deg * Math.PI) / 180

// Stessa matrice di NiiVue.calculateMvpMatrix, con profondita' indipendente dallo zoom
export function renderMatrices({ canvasWidth, canvasHeight, leftTopWidthHeight, azimuth, elevation, furthestFromPivot, pivot3D, volScaleMultiplier, position }) {
  let ltwh = leftTopWidthHeight
  if (!ltwh[2] || !ltwh[3]) ltwh = [0, 0, canvasWidth, canvasHeight]
  const whratio = ltwh[2] / ltwh[3]
  const sceneScale = 0.8 * furthestFromPivot
  const viewScale = sceneScale / volScaleMultiplier // inquadratura: dipende dallo zoom
  const near = NEAR_PLANE * sceneScale
  const far = FAR_PLANE * sceneScale
  const projection = whratio < 1
    ? ortho(-viewScale, viewScale, -viewScale / whratio, viewScale / whratio, far, near)
    : ortho(-viewScale * whratio, viewScale * whratio, -viewScale, viewScale, far, near)

  let model = identity()
  model[0] = -1
  model = multiply(model, translation([0, 0, -CAMERA_DISTANCE * sceneScale]))
  if (position) model = multiply(model, translation(position))
  model = multiply(model, rotationX(deg2rad(270 - elevation)))
  model = multiply(model, rotationZ(deg2rad(azimuth - 180)))
  model = multiply(model, translation([-pivot3D[0], -pivot3D[1], -pivot3D[2]]))

  const normal = transpose(invert(model))
  return [multiply(projection, model), model, normal]
}

export function fixRenderDepthRange(nv) {
  nv.calculateMvpMatrix = function calculateMvpMatrix(_unused, leftTopWidthHeight = [0, 0, 0, 0], azimuth, elevation) {
    return renderMatrices({
      canvasWidth: this.gl.canvas.width,
      canvasHeight: this.gl.canvas.height,
      leftTopWidthHeight,
      azimuth,
      elevation,
      furthestFromPivot: this.furthestFromPivot,
      pivot3D: this.pivot3D,
      volScaleMultiplier: this.scene.volScaleMultiplier,
      position: this.position,
    })
  }
}
