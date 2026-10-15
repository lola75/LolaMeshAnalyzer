import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

// Specchia: riflessione della mesh rispetto a un piano (punto + normale),
// con i cursori 3D per spostare e ruotare il piano nella vista.

// Riflessione x' = x - 2((x - p)·n) n
export function mirrorMatrix(point, normal) {
  const n = normal.clone().normalize()
  const d = 2 * point.dot(n)
  return new THREE.Matrix4().set(
    1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z, d * n.x,
    -2 * n.y * n.x, 1 - 2 * n.y * n.y, -2 * n.y * n.z, d * n.y,
    -2 * n.z * n.x, -2 * n.z * n.y, 1 - 2 * n.z * n.z, d * n.z,
    0, 0, 0, 1
  )
}

// Geometria specchiata; l'ordine dei vertici di ogni triangolo viene invertito
// perché le normali restino rivolte verso l'esterno.
export function mirrorGeometry(geometry, point, normal) {
  const mirrored = geometry.clone()
  mirrored.applyMatrix4(mirrorMatrix(point, normal))
  if (mirrored.index) {
    const index = mirrored.index.array
    for (let i = 0; i + 2 < index.length; i += 3) {
      const b = index[i + 1]
      index[i + 1] = index[i + 2]
      index[i + 2] = b
    }
    mirrored.index.needsUpdate = true
  } else {
    Object.values(mirrored.attributes).forEach((attribute) => {
      const { array, itemSize } = attribute
      for (let t = 0; t + 3 * itemSize <= array.length; t += 3 * itemSize) {
        for (let k = 0; k < itemSize; k++) {
          const b = array[t + itemSize + k]
          array[t + itemSize + k] = array[t + 2 * itemSize + k]
          array[t + 2 * itemSize + k] = b
        }
      }
      attribute.needsUpdate = true
    })
  }
  mirrored.computeVertexNormals()
  mirrored.computeBoundingBox()
  mirrored.computeBoundingSphere()
  return mirrored
}

const circlePoints = (radius, plane) => {
  const points = []
  for (let i = 0; i <= 96; i++) {
    const angle = (i / 96) * Math.PI * 2
    const c = Math.cos(angle) * radius
    const s = Math.sin(angle) * radius
    if (plane === 'xy') points.push(c, s, 0)
    else if (plane === 'xz') points.push(c, 0, s)
    else points.push(0, c, s)
  }
  return points
}

// Cursori del piano di specchiatura. Nel sistema del gruppo la normale del piano è +Z:
// - cerchio magenta: il piano
// - asse blu con frecce verdi: trascinando le frecce il piano si sposta lungo la normale
// - anelli rosso e verde: trascinandoli il piano ruota
// - punto rosso: trascinandolo il piano si sposta parallelamente allo schermo
export function createMirrorGizmo(radius, resolution) {
  const group = new THREE.Group()
  const pickables = []
  const disposables = []

  const dashed = (points, color, width, dash) => {
    const geometry = new LineGeometry()
    geometry.setPositions(points)
    const material = new LineMaterial({
      color,
      linewidth: width,
      resolution,
      dashed: true,
      dashSize: dash,
      gapSize: dash * 0.8,
      depthTest: false,
      transparent: true,
      toneMapped: false,
    })
    const line = new Line2(geometry, material)
    line.computeLineDistances()
    line.renderOrder = 30
    line.raycast = () => {}
    disposables.push(geometry, material)
    group.add(line)
    return line
  }
  const solid = (geometry, color, opacity = 1) => {
    const material = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity, toneMapped: false })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.renderOrder = 31
    mesh.raycast = () => {}
    disposables.push(geometry, material)
    group.add(mesh)
    return mesh
  }
  // zona invisibile più grande del cursore, per prenderlo facilmente con il mouse
  const pickMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false })
  disposables.push(pickMaterial)
  const pick = (geometry, handle) => {
    const mesh = new THREE.Mesh(geometry, pickMaterial)
    mesh.userData.handle = handle
    disposables.push(geometry)
    group.add(mesh)
    pickables.push(mesh)
    return mesh
  }

  const axisLength = radius * 0.75
  const ringRadius = radius * 0.6

  dashed(circlePoints(radius, 'xy'), 0xd946ef, 2, radius * 0.035)
  dashed([0, 0, -axisLength, 0, 0, axisLength], 0x1d4ed8, 4, radius * 0.05)
  dashed(circlePoints(ringRadius, 'xz'), 0xdc2626, 3.5, radius * 0.05) // rotazione attorno a Y
  dashed(circlePoints(ringRadius, 'yz'), 0x22c55e, 3.5, radius * 0.05) // rotazione attorno a X

  for (const sign of [1, -1]) {
    const arrow = solid(new THREE.ConeGeometry(radius * 0.035, radius * 0.1, 16), 0x22c55e)
    arrow.rotation.x = (sign * Math.PI) / 2 // il cono punta verso +Y: lo giro lungo ±Z
    arrow.position.z = sign * axisLength
    pick(new THREE.SphereGeometry(radius * 0.08, 12, 8), 'axis').position.z = sign * axisLength
  }
  const indicator = solid(new THREE.ConeGeometry(radius * 0.04, radius * 0.2, 16), 0xfacc15, 0.85)
  indicator.rotation.x = Math.PI / 2
  indicator.position.z = radius * 0.12
  solid(new THREE.SphereGeometry(radius * 0.03, 16, 12), 0xdc2626)
  pick(new THREE.SphereGeometry(radius * 0.07, 12, 8), 'center')

  pick(new THREE.TorusGeometry(ringRadius, radius * 0.035, 8, 64), 'rotY').rotation.x = Math.PI / 2
  pick(new THREE.TorusGeometry(ringRadius, radius * 0.035, 8, 64), 'rotX').rotation.y = Math.PI / 2

  return {
    group,
    pickables,
    dispose: () => {
      group.removeFromParent()
      disposables.forEach((item) => item.dispose())
    },
  }
}
