import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'

// Ricopia i colori per vertice da `source` a `target` (es. dopo un remesh sul server, che lavora in
// STL e quindi senza colori): ogni vertice nuovo prende il colore del punto piu' vicino della mesh
// originale, interpolato tra i vertici del suo triangolo. Restituisce target (modificata).
export function transferVertexColors(source, target) {
  const sourceColors = source.getAttribute('color')
  if (!sourceColors) return target
  const bvhGeometry = new THREE.BufferGeometry()
  bvhGeometry.setAttribute('position', source.getAttribute('position').clone())
  bvhGeometry.setAttribute('color', sourceColors.clone())
  if (source.index) bvhGeometry.setIndex(source.index.clone())
  const bvh = new MeshBVH(bvhGeometry)
  const index = bvhGeometry.index
  const positions = bvhGeometry.getAttribute('position')
  const colors = bvhGeometry.getAttribute('color')
  const out = new Float32Array(target.getAttribute('position').count * 3)
  const point = new THREE.Vector3()
  const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 }
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const bary = new THREE.Vector3()
  const targetPositions = target.getAttribute('position')
  for (let i = 0; i < targetPositions.count; i++) {
    point.fromBufferAttribute(targetPositions, i)
    if (!bvh.closestPointToPoint(point, hit)) continue
    const corner = (k) => (index ? index.getX(hit.faceIndex * 3 + k) : hit.faceIndex * 3 + k)
    const [ia, ib, ic] = [corner(0), corner(1), corner(2)]
    a.fromBufferAttribute(positions, ia)
    b.fromBufferAttribute(positions, ib)
    c.fromBufferAttribute(positions, ic)
    THREE.Triangle.getBarycoord(hit.point, a, b, c, bary)
    for (let k = 0; k < 3; k++) {
      out[i * 3 + k] = colors.getComponent(ia, k) * bary.x + colors.getComponent(ib, k) * bary.y + colors.getComponent(ic, k) * bary.z
    }
  }
  target.setAttribute('color', new THREE.BufferAttribute(out, 3))
  bvhGeometry.dispose()
  return target
}
