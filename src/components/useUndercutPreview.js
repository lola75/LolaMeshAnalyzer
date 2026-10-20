import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { computeUndercuts, undercutColor } from '../utils/undercuts'

// Rimozione Sottosquadri: mappa colori dei sottosquadri sulla mesh e freccia della direzione di
// inserzione nella vista 3D del Modificatore. `direction`: [x, y, z] nel riferimento della scena
// (verso da cui arriva la guida); null = nessuna anteprima.
export default function useUndercutPreview({ active, meshIndex, meshes, meshesRef, sceneRef, direction }) {
  const [state, setState] = useState({ computing: false, maxDepth: 0, undercutPercent: 0 })
  const cacheRef = useRef({ geometry: null, key: '', depth: null })

  useEffect(() => {
    if (!active || !direction) return undefined
    // il Modificatore ricostruisce la scena nello stesso aggiornamento (i suoi effetti partono dopo
    // questo): si aspetta il giro successivo per lavorare sulla mesh nuova
    let teardown = null
    const start = setTimeout(() => { teardown = setup() }, 0)
    return () => {
      clearTimeout(start)
      teardown?.()
    }
  }, [active, meshIndex, meshes, direction])

  const setup = () => {
    const sceneMesh = meshesRef.current[meshIndex]
    const scene = sceneRef.current
    const normalization = sceneMesh?.userData.normalization
    if (!sceneMesh || !scene || !normalization) return null
    let cancelled = false
    const geometry = sceneMesh.geometry
    const position = geometry.getAttribute('position')
    const scale = normalization.scale

    // direzione nel riferimento della mesh (la mesh puo' essere ruotata nella scena)
    sceneMesh.updateMatrixWorld(true)
    const up = new THREE.Vector3(...direction).transformDirection(new THREE.Matrix4().copy(sceneMesh.matrixWorld).invert()).normalize()
    const key = up.toArray().map((v) => v.toFixed(4)).join(',')

    const objects = []
    const arrowGroup = new THREE.Group()
    // freccia della direzione di inserzione, al centro del modello
    geometry.computeBoundingBox()
    const box = geometry.boundingBox
    const center = box.getCenter(new THREE.Vector3())
    const length = box.getSize(new THREE.Vector3()).length() * 0.35
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.4, metalness: 0.2 })
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(length * 0.012, length * 0.012, length * 0.8, 16), gold)
    shaft.position.y = length * 0.4
    const head = new THREE.Mesh(new THREE.ConeGeometry(length * 0.05, length * 0.2, 24), gold)
    head.position.y = length * 0.9
    const base = new THREE.Mesh(new THREE.SphereGeometry(length * 0.045, 20, 14), new THREE.MeshStandardMaterial({ color: 0xb07a10, roughness: 0.5 }))
    arrowGroup.add(shaft, head, base)
    arrowGroup.position.copy(center)
    arrowGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up)
    arrowGroup.traverse((object) => { object.raycast = () => {} })
    sceneMesh.add(arrowGroup)
    objects.push(arrowGroup)

    // mappa colori: copia della mesh con i colori dei sottosquadri al posto del materiale normale
    const show = (depth) => {
      if (cancelled) return
      const colors = new Float32Array(position.count * 3)
      const rgb = [0, 0, 0]
      let max = 0
      let undercut = 0
      for (let v = 0; v < position.count; v++) {
        colors.set(undercutColor(depth[v], rgb), v * 3)
        if (depth[v] > 0.01) undercut++
        if (depth[v] > max) max = depth[v]
      }
      const overlayGeometry = new THREE.BufferGeometry()
      overlayGeometry.setAttribute('position', position)
      const normal = geometry.getAttribute('normal')
      if (normal) overlayGeometry.setAttribute('normal', normal)
      if (geometry.index) overlayGeometry.setIndex(geometry.index)
      overlayGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      if (!normal) overlayGeometry.computeVertexNormals()
      const overlay = new THREE.Mesh(overlayGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }))
      overlay.raycast = () => {}
      sceneMesh.add(overlay)
      objects.push(overlay)
      sceneMesh.material.visible = false
      setState({ computing: false, maxDepth: max, undercutPercent: (100 * undercut) / position.count })
    }

    const cache = cacheRef.current
    if (cache.geometry === geometry && cache.key === key) {
      show(cache.depth)
    } else {
      setState((s) => ({ ...s, computing: true }))
      // dopo il disegno del messaggio "calcolo...": la mappa richiede qualche istante
      const timer = setTimeout(() => {
        if (cancelled) return
        const mm = new Float32Array(position.count * 3)
        for (let i = 0; i < position.count * 3; i++) mm[i] = position.array[i] / scale // coordinate della scena -> mm
        const depth = computeUndercuts(mm, geometry.index ? geometry.index.array : null, up.toArray())
        cacheRef.current = { geometry, key, depth }
        show(depth)
      }, 30)
      objects.push({ dispose: () => clearTimeout(timer) })
    }

    return () => {
      cancelled = true
      sceneMesh.material.visible = true
      for (const object of objects) {
        if (object.dispose && !object.isObject3D) {
          object.dispose()
          continue
        }
        object.removeFromParent()
        object.traverse((child) => {
          if (child.geometry && child.geometry !== geometry) {
            // la mappa condivide posizioni, normali e indice con la mesh: si toglie solo il colore
            if (child.geometry.getAttribute('position') === position) child.geometry.deleteAttribute('color')
            else child.geometry.dispose()
          }
          child.material?.dispose()
        })
      }
    }
  }

  return state
}
