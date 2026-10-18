// Mesh visibili da entrambi i lati nella vista 3D di NiiVue.
//
// Le scansioni intraorali (Anatomy, Antagonist...) sono superfici aperte. NiiVue disegna le mesh
// con il back-face culling: guardate dal retro (es. l'antagonista visto dall'arcata inferiore)
// spariscono, tranne le parti girate per caso verso la camera. Qui:
// 1. il culling resta spento mentre NiiVue disegna le mesh (wrapper su drawMesh3D);
// 2. lo shader predefinito (Phong) e' sostituito da una copia che illumina anche il retro
//    delle facce, girando la normale quando la faccia e' vista da dietro.

const TWO_SIDED_PHONG = `#version 300 es
precision highp int;
precision highp float;
uniform float opacity;
in vec4 vClr;
in vec3 vN;
out vec4 color;
void main() {
	vec3 r = vec3(0.0, 0.0, 1.0);
	float ambient = 0.35;
	float diffuse = 0.5;
	float specular = 0.2;
	float shininess = 10.0;
	vec3 n = normalize(vN);
	if (!gl_FrontFacing) n = -n; // retro della superficie: stessa luce del davanti
	vec3 lightPosition = vec3(0.0, 10.0, -5.0);
	vec3 l = normalize(lightPosition);
	float lightNormDot = dot(n, l);
	vec3 a = vClr.rgb * ambient;
	vec3 d = max(lightNormDot, 0.0) * vClr.rgb * diffuse;
	float s = specular * pow(max(dot(reflect(l, n), r), 0.0), shininess);
	color = vec4(a + d + s, opacity);
}`

export function enableTwoSidedMeshes(nv) {
  const gl = nv.gl
  // Shader predefinito (indice 0, usato da tutte le mesh) con illuminazione a due lati.
  // Nome diverso da "Phong": createCustomMeshShader toglie dall'elenco lo shader omonimo
  // (gli altri scalerebbero di posizione); poi lo si mette al posto 0.
  const shader = nv.createCustomMeshShader(TWO_SIDED_PHONG, 'Phong due lati')
  nv.meshShaders[0] = { ...shader, Name: 'Phong' }

  const drawMesh3D = nv.drawMesh3D.bind(nv)
  nv.drawMesh3D = (...args) => {
    const enable = gl.enable
    gl.enable = (capability) => {
      if (capability !== gl.CULL_FACE) enable.call(gl, capability)
    }
    gl.disable(gl.CULL_FACE)
    try {
      return drawMesh3D(...args)
    } finally {
      gl.enable = enable
    }
  }
}
