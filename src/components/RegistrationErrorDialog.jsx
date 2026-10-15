import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// Distanza oltre la quale un vertice è considerato fuori dall'area di sovrapposizione (mm)
const OVERLAP_DISTANCE = 2
// Raggio della regione di misura attorno a ogni punto CTRL+click (mm)
const REGION_RADIUS = 1.5
const NO_OVERLAP_COLOR = [0.78, 0.8, 0.84]
const OVER_SCALE_COLOR = [1, 0, 1]

// Scala colori come nell'esempio: blu (0) → verde → giallo → arancio → rosso → magenta (max)
const COLOR_STOPS = [
  [0.0, [0.04, 0.39, 1.0]],
  [0.2, [0.12, 0.82, 0.29]],
  [0.4, [1.0, 0.93, 0.0]],
  [0.6, [1.0, 0.55, 0.0]],
  [0.8, [1.0, 0.1, 0.1]],
  [1.0, [1.0, 0.0, 0.8]],
]

const colorForRatio = (t) => {
  if (t > 1) return OVER_SCALE_COLOR
  const v = Math.max(0, t)
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    const [t1, c1] = COLOR_STOPS[i]
    if (v <= t1) {
      const [t0, c0] = COLOR_STOPS[i - 1]
      const k = (v - t0) / (t1 - t0)
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k]
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1][1]
}

const cssGradient = `linear-gradient(to top, ${COLOR_STOPS.map(([t, c]) => `rgb(${c.map((x) => Math.round(x * 255)).join(',')}) ${t * 100}%`).join(', ')})`

const cellHash = (ix, iy, iz) => ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) | 0

// Distanza punto-triangolo (Ericson, Real-Time Collision Detection)
const pointTriangleDistanceSq = (px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) => {
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = cx - ax, acy = cy - ay, acz = cz - az
  const apx = px - ax, apy = py - ay, apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  let qx, qy, qz
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az } else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz
    const d3 = abx * bpx + aby * bpy + abz * bpz
    const d4 = acx * bpx + acy * bpy + acz * bpz
    if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz } else {
      const vc = d1 * d4 - d3 * d2
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3)
        qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v
      } else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz
        const d5 = abx * cpx + aby * cpy + abz * cpz
        const d6 = acx * cpx + acy * cpy + acz * cpz
        if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz } else {
          const vb = d5 * d2 - d1 * d6
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6)
            qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w
          } else {
            const va = d3 * d6 - d5 * d4
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
              qx = bx + (cx - bx) * w; qy = by + (cy - by) * w; qz = bz + (cz - bz) * w
            } else {
              const denom = 1 / (va + vb + vc)
              const v = vb * denom
              const w = vc * denom
              qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w
            }
          }
        }
      }
    }
  }
  const dx = px - qx, dy = py - qy, dz = pz - qz
  return dx * dx + dy * dy + dz * dz
}

// Per ogni vertice (univoco) della mesh allineata calcola la distanza dalla superficie della mesh fissa
export function computeRegistrationError(sourceGeometry, targetGeometry, maxSearch = OVERLAP_DISTANCE) {
  const tPos = targetGeometry.getAttribute('position').array
  const tIndex = targetGeometry.index?.array
  const triCount = tIndex ? tIndex.length / 3 : tPos.length / 9
  const vi = (t, k) => (tIndex ? tIndex[t * 3 + k] : t * 3 + k) * 3

  let edgeSum = 0
  const sampleStep = Math.max(1, Math.floor(triCount / 2000))
  let samples = 0
  for (let t = 0; t < triCount; t += sampleStep) {
    const a = vi(t, 0), b = vi(t, 1)
    edgeSum += Math.hypot(tPos[a] - tPos[b], tPos[a + 1] - tPos[b + 1], tPos[a + 2] - tPos[b + 2])
    samples++
  }
  const avgEdge = samples ? edgeSum / samples : 1
  const cellSize = Math.max(avgEdge * 1.5, maxSearch / 6, 1e-6)

  const grid = new Map()
  for (let t = 0; t < triCount; t++) {
    const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2)
    const x0 = Math.floor(Math.min(tPos[a], tPos[b], tPos[c]) / cellSize)
    const x1 = Math.floor(Math.max(tPos[a], tPos[b], tPos[c]) / cellSize)
    const y0 = Math.floor(Math.min(tPos[a + 1], tPos[b + 1], tPos[c + 1]) / cellSize)
    const y1 = Math.floor(Math.max(tPos[a + 1], tPos[b + 1], tPos[c + 1]) / cellSize)
    const z0 = Math.floor(Math.min(tPos[a + 2], tPos[b + 2], tPos[c + 2]) / cellSize)
    const z1 = Math.floor(Math.max(tPos[a + 2], tPos[b + 2], tPos[c + 2]) / cellSize)
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) for (let iz = z0; iz <= z1; iz++) {
      const key = cellHash(ix, iy, iz)
      const bucket = grid.get(key)
      if (bucket) bucket.push(t)
      else grid.set(key, [t])
    }
  }

  const stamp = new Int32Array(triCount).fill(-1)
  const maxRing = Math.ceil(maxSearch / cellSize) + 1
  const maxSearchSq = maxSearch * maxSearch
  let queryId = 0

  const query = (px, py, pz) => {
    const cx = Math.floor(px / cellSize), cy = Math.floor(py / cellSize), cz = Math.floor(pz / cellSize)
    let best = Infinity
    const id = queryId++
    for (let r = 0; r <= maxRing; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue
        const bucket = grid.get(cellHash(cx + dx, cy + dy, cz + dz))
        if (!bucket) continue
        for (let i = 0; i < bucket.length; i++) {
          const t = bucket[i]
          if (stamp[t] === id) continue
          stamp[t] = id
          const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2)
          const d = pointTriangleDistanceSq(px, py, pz,
            tPos[a], tPos[a + 1], tPos[a + 2], tPos[b], tPos[b + 1], tPos[b + 2], tPos[c], tPos[c + 1], tPos[c + 2])
          if (d < best) best = d
        }
      }
      const reach = r * cellSize
      if (best <= reach * reach || reach * reach > maxSearchSq) break
    }
    return best <= maxSearchSq ? Math.sqrt(best) : Infinity
  }

  // Vertici duplicati (STL non indicizzati) calcolati una sola volta
  const sPos = sourceGeometry.getAttribute('position').array
  const vertexCount = sPos.length / 3
  const vertexToUnique = new Int32Array(vertexCount)
  const uniqueMap = new Map()
  const uniquePositions = []
  for (let v = 0; v < vertexCount; v++) {
    const key = `${sPos[v * 3]},${sPos[v * 3 + 1]},${sPos[v * 3 + 2]}`
    let u = uniqueMap.get(key)
    if (u === undefined) {
      u = uniquePositions.length / 3
      uniqueMap.set(key, u)
      uniquePositions.push(sPos[v * 3], sPos[v * 3 + 1], sPos[v * 3 + 2])
    }
    vertexToUnique[v] = u
  }
  const uniqueCount = uniquePositions.length / 3
  const uniqueDistances = new Float32Array(uniqueCount)
  for (let u = 0; u < uniqueCount; u++) {
    uniqueDistances[u] = query(uniquePositions[u * 3], uniquePositions[u * 3 + 1], uniquePositions[u * 3 + 2])
  }

  return {
    vertexToUnique,
    uniquePositions: new Float32Array(uniquePositions),
    uniqueDistances,
  }
}

const computeStats = (errorData, regionPoints) => {
  if (!errorData) return null
  const { uniquePositions, uniqueDistances } = errorData
  const r2 = REGION_RADIUS * REGION_RADIUS
  let sum = 0, min = Infinity, max = 0, count = 0, considered = 0
  for (let u = 0; u < uniqueDistances.length; u++) {
    if (regionPoints.length > 0) {
      const x = uniquePositions[u * 3], y = uniquePositions[u * 3 + 1], z = uniquePositions[u * 3 + 2]
      const inside = regionPoints.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2 <= r2)
      if (!inside) continue
    }
    considered++
    const d = uniqueDistances[u]
    if (!Number.isFinite(d)) continue
    sum += d
    count++
    if (d < min) min = d
    if (d > max) max = d
  }
  return {
    mean: count ? sum / count : 0,
    min: count ? min : 0,
    max,
    overlap: considered ? (count / considered) * 100 : 0,
  }
}

export default function RegistrationErrorDialog({ sourceGeometry, targetGeometry, onConfirm, onEdit, onClose }) {
  const containerRef = useRef(null)
  const colorAttrRef = useRef(null)
  const regionGroupRef = useRef(null)
  const markerSizeRef = useRef(0.2)
  const [errorData, setErrorData] = useState(null)
  const [computing, setComputing] = useState(true)
  const [scaleMax, setScaleMax] = useState(1)
  const [regionPoints, setRegionPoints] = useState([])

  useEffect(() => {
    setComputing(true)
    const timer = window.setTimeout(() => {
      try {
        setErrorData(computeRegistrationError(sourceGeometry, targetGeometry))
      } catch (err) {
        console.error('Calcolo errore registrazione fallito', err)
        setErrorData(null)
      } finally {
        setComputing(false)
      }
    }, 30)
    return () => window.clearTimeout(timer)
  }, [sourceGeometry, targetGeometry])

  const stats = useMemo(() => computeStats(errorData, regionPoints), [errorData, regionPoints])

  // Scena 3D: mesh fissa semitrasparente + mesh allineata colorata in base all'errore
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const width = container.clientWidth
    const height = container.clientHeight
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.9))
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1)
    keyLight.position.set(3, 5, 8)
    scene.add(keyLight)
    const backLight = new THREE.DirectionalLight(0xffffff, 0.4)
    backLight.position.set(-4, -2, -6)
    scene.add(backLight)

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 10000)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    renderer.setSize(width, height)
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(renderer.domElement)

    const group = new THREE.Group()
    scene.add(group)

    const source = sourceGeometry.clone()
    if (!source.getAttribute('normal')) source.computeVertexNormals()
    const colors = new Float32Array(source.getAttribute('position').count * 3)
    for (let i = 0; i < colors.length; i += 3) colors.set(NO_OVERLAP_COLOR, i)
    const colorAttr = new THREE.BufferAttribute(colors, 3)
    source.setAttribute('color', colorAttr)
    colorAttrRef.current = colorAttr
    const sourceMaterial = new THREE.MeshPhongMaterial({ vertexColors: true, side: THREE.DoubleSide, shininess: 40, specular: 0x333333 })
    const sourceMesh = new THREE.Mesh(source, sourceMaterial)
    group.add(sourceMesh)

    const target = targetGeometry.clone()
    if (!target.getAttribute('normal')) target.computeVertexNormals()
    const targetMaterial = new THREE.MeshPhongMaterial({
      color: 0xdfe6ee, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide,
    })
    const targetMesh = new THREE.Mesh(target, targetMaterial)
    targetMesh.renderOrder = 2
    group.add(targetMesh)

    const regionGroup = new THREE.Group()
    group.add(regionGroup)
    regionGroupRef.current = regionGroup

    const box = new THREE.Box3().setFromObject(sourceMesh).expandByObject(targetMesh)
    const center = box.getCenter(new THREE.Vector3())
    const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1
    group.position.copy(center).negate()
    markerSizeRef.current = radius * 0.015
    camera.position.set(0, 0, radius / Math.tan((camera.fov * Math.PI) / 360) * 1.1)
    camera.near = radius / 100
    camera.far = radius * 100
    camera.updateProjectionMatrix()

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.zoomSpeed = 1.2

    // SHIFT + rotella cambia la scala della barra colori invece dello zoom
    const onWheel = (e) => {
      if (!e.shiftKey) return
      e.preventDefault()
      e.stopImmediatePropagation()
      const delta = e.deltaY || e.deltaX
      setScaleMax((s) => Math.min(5, Math.max(0.05, +(s * (delta > 0 ? 1.15 : 1 / 1.15)).toFixed(3))))
    }
    container.addEventListener('wheel', onWheel, { capture: true, passive: false })

    // CTRL + click sinistro aggiunge punto di misura, CTRL + click destro rimuove l'ultimo,
    // ALT + click destro li rimuove tutti
    const raycaster = new THREE.Raycaster()
    const onPointerDown = (e) => {
      if (e.button === 2 && e.altKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setRegionPoints([])
        return
      }
      if (e.button === 2 && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setRegionPoints((pts) => pts.slice(0, -1))
        return
      }
      if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return
      const rect = renderer.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObject(sourceMesh, false)[0]
      if (!hit) return
      e.preventDefault()
      e.stopImmediatePropagation()
      const local = group.worldToLocal(hit.point.clone())
      setRegionPoints((pts) => [...pts, local])
    }
    const onContextMenu = (e) => e.preventDefault()
    container.addEventListener('pointerdown', onPointerDown, { capture: true })
    container.addEventListener('contextmenu', onContextMenu)

    const onResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    let frame = 0
    const animate = () => {
      frame = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(frame)
      container.removeEventListener('wheel', onWheel, { capture: true })
      container.removeEventListener('pointerdown', onPointerDown, { capture: true })
      container.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      source.dispose()
      target.dispose()
      sourceMaterial.dispose()
      targetMaterial.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement)
      colorAttrRef.current = null
      regionGroupRef.current = null
    }
  }, [sourceGeometry, targetGeometry])

  // Aggiorna i colori quando cambia la scala o arrivano i risultati
  useEffect(() => {
    const colorAttr = colorAttrRef.current
    if (!colorAttr || !errorData) return
    const { vertexToUnique, uniqueDistances } = errorData
    const arr = colorAttr.array
    for (let v = 0; v < vertexToUnique.length; v++) {
      const d = uniqueDistances[vertexToUnique[v]]
      arr.set(Number.isFinite(d) ? colorForRatio(d / scaleMax) : NO_OVERLAP_COLOR, v * 3)
    }
    colorAttr.needsUpdate = true
  }, [errorData, scaleMax])

  // Marker delle regioni di misura
  useEffect(() => {
    const regionGroup = regionGroupRef.current
    if (!regionGroup) return
    regionGroup.children.forEach((child) => {
      child.geometry.dispose()
      child.material.dispose()
    })
    regionGroup.clear()
    regionPoints.forEach((p) => {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(markerSizeRef.current, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xcc0000 })
      )
      marker.position.copy(p)
      regionGroup.add(marker)
      const area = new THREE.Mesh(
        new THREE.SphereGeometry(REGION_RADIUS, 24, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false })
      )
      area.position.copy(p)
      regionGroup.add(area)
    })
  }, [regionPoints])

  const ticks = [1, 0.8, 0.6, 0.4, 0.2, 0]
  const fmt = (v) => `${v.toFixed(2)} mm`

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="registration-error-title"
        className="flex w-full max-w-6xl flex-col bg-[#2f6db3] shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-3">
          <h2 id="registration-error-title" className="text-2xl font-semibold text-white">Errore Registrazione</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            className="p-1 text-white hover:bg-white/10"
          >
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M5 5l14 14M19 5L5 19" />
            </svg>
          </button>
        </div>

        <div className="relative mx-5 h-[60vh] min-h-[360px] render-bg">
          <div ref={containerRef} className="absolute inset-0" />

          {computing && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-white">
              ⏳ Calcolo errore di registrazione...
            </div>
          )}

          <div className="pointer-events-none absolute right-6 top-14 flex select-none flex-col items-start text-[11px] text-white">
            <div className="mb-2">Error [mm]</div>
            <div className="flex">
              <div className="flex flex-col">
                <div className="h-4 w-4" style={{ background: 'rgb(255,0,255)' }} />
                <div className="h-64 w-4" style={{ background: cssGradient }} />
              </div>
              <div className="relative ml-2 h-[272px] w-12">
                <div className="absolute top-0">&gt;{scaleMax.toFixed(2)}</div>
                {ticks.map((t) => (
                  <div key={t} className="absolute" style={{ top: `${16 + (1 - t) * 256 - 6}px` }}>
                    — {(t * scaleMax).toFixed(2)}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pointer-events-none absolute bottom-3 left-3 font-mono text-sm text-white">
            {stats && (
              <>
                <div>Media: {fmt(stats.mean)}</div>
                <div>Min:&nbsp;&nbsp; {fmt(stats.min)}</div>
                <div>Max:&nbsp;&nbsp; {fmt(stats.max)}</div>
                <div className="mt-1 text-xs text-white/80">Sovrapposizione: {stats.overlap.toFixed(0)}%</div>
              </>
            )}
          </div>

          <div className="pointer-events-none absolute bottom-3 right-6 text-sm leading-tight text-white">
            <div>{regionPoints.length > 0 ? `Misurazioni entro una regione (${regionPoints.length} punti)` : 'Misurazioni su tutta l’area sovrapposta'}</div>
            <div>CTRL + click sinistro per aggiungere punti</div>
            <div>ALT + click destro per rimuovere tutti i punti</div>
            <div>CTRL + click destro per rimuovere l’ultimo punto</div>
            <div>SHIFT + Rotella mouse per cambiare la scala della barra del colore</div>
          </div>
        </div>

        <div className="flex justify-center gap-9 px-5 py-5">
          <button
            type="button"
            onClick={onConfirm}
            className="flex w-40 items-center justify-center gap-2 border border-white px-4 py-1.5 text-sm font-semibold text-white hover:bg-white/10"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 12l5 5L20 6" />
            </svg>
            OK
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="flex w-40 items-center justify-center gap-2 border border-white px-4 py-1.5 text-sm font-semibold text-white hover:bg-white/10"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M5 5l14 14M19 5L5 19" />
            </svg>
            Modifica
          </button>
        </div>
      </div>
    </div>
  )
}
