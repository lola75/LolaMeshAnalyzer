// Trasparenza del volume solo nella vista 3D di NiiVue.
//
// L'opacita' del volume (setOpacity) vale anche per le slice. Il rendering 3D moltiplica invece la
// trasparenza finale per l'uniform backOpacity del suo shader: qui la si abbassa solo mentre NiiVue
// disegna il 3D (nv.renderOpacity, 0..1), poi torna al valore normale. Le slice restano opache.

export function enableRenderOpacity(nv) {
  nv.renderOpacity = 1
  const draw3D = nv.draw3D.bind(nv)
  nv.draw3D = (...args) => {
    const shader = nv.renderShader
    const volume = nv.volumes?.[0]
    if (!shader || !volume || nv.renderOpacity >= 1) return draw3D(...args)
    const gl = nv.gl
    shader.use(gl)
    gl.uniform1f(shader.uniforms.backOpacity, volume.opacity * nv.renderOpacity)
    try {
      return draw3D(...args)
    } finally {
      shader.use(gl)
      gl.uniform1f(shader.uniforms.backOpacity, volume.opacity)
    }
  }
}
