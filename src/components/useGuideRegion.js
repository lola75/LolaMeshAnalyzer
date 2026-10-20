import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { basisFor } from '../utils/undercuts'

// Generazione Guida: scelta della regione della guida sul modello senza sottosquadri.
// - Curva: clic sul modello per aggiungere punti (linea dorata che segue la superficie); clic vicino
//   al primo punto per chiudere: la regione e' la superficie racchiusa dalla linea, fino alla linea
//   compresa (anche a meta' delle pareti verticali). Backspace toglie l'ultimo punto.
// - Pennello: si colora la regione trascinando sul modello (Maiusc per cancellare, Ctrl + rotella
//   per il diametro).
// - Lazo: si disegna un contorno sullo schermo, si aggiunge cio' che sta dentro (Maiusc toglie).
// La regione e' un flag per vertice della mesh `meshIndex` (coordinate in mm della mesh).
// Annulla / Ripeti: ogni punto della curva, pennellata o lazo e' un passo della cronologia.

const REGION_COLOR = [0.45, 0.72, 1]
const BASE_COLOR = [0.92, 0.92, 0.93]
const CURVE_COLOR = 0xd4a017
const SAMPLE_MM = 0.4 // passo dei punti della linea sulla superficie
const HISTORY_LIMIT = 100
const SMOOTH_PASSES = 4 // lisciatura della linea tra i punti cliccati
const LIFT_MM = 0.08 // la linea sta appena sopra la superficie

// ricerca del punto piu' vicino sulla mesh (three-mesh-bvh), una per geometria
const bvhCache = new WeakMap()
function surfaceBVH(geometry) {
  let bvh = bvhCache.get(geometry)
  if (!bvh) {
    // copia: il BVH riordina l'indice dei triangoli
    const copy = new THREE.BufferGeometry()
    copy.setAttribute('position', geometry.getAttribute('position'))
    if (geometry.index) copy.setIndex(geometry.index.clone())
    bvh = new MeshBVH(copy)
    bvhCache.set(geometry, bvh)
  }
  return bvh
}

// vicini di ogni vertice (CSR) e lato piu' lungo, una volta per geometria
const graphCache = new WeakMap()
function meshGraph(geometry) {
  if (graphCache.has(geometry)) return graphCache.get(geometry)
  const index = geometry.index
  let graph = null
  if (index) {
    const position = geometry.getAttribute('position').array
    const n = geometry.getAttribute('position').count
    const ids = index.array
    const degree = new Uint32Array(n + 1)
    for (let t = 0; t < ids.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        degree[ids[t + k]] += 2
      }
    }
    const start = new Uint32Array(n + 1)
    for (let v = 0; v < n; v++) start[v + 1] = start[v] + degree[v]
    const fill = start.slice(0, n)
    const neighbors = new Uint32Array(start[n])
    let maxEdge = 0
    for (let t = 0; t < ids.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const p = ids[t + k]
        const q = ids[t + ((k + 1) % 3)]
        neighbors[fill[p]++] = q
        neighbors[fill[q]++] = p
        const dx = position[p * 3] - position[q * 3]
        const dy = position[p * 3 + 1] - position[q * 3 + 1]
        const dz = position[p * 3 + 2] - position[q * 3 + 2]
        maxEdge = Math.max(maxEdge, Math.hypot(dx, dy, dz))
      }
    }
    graph = { start, neighbors, maxEdge }
  }
  graphCache.set(geometry, graph)
  return graph
}

// Superficie racchiusa da una linea chiusa sulla mesh: i vertici entro meta' lato dalla linea fanno
// da "argine", la superficie si divide in parti (allagamento lungo i lati) e si tengono quelle che,
// viste dalla direzione di inserzione, stanno per lo piu' dentro la linea. null = mesh con lati
// troppo lunghi (si usa la vista dall'alto).
function surfaceInsideCurve(geometry, path, planar, counts) {
  const graph = meshGraph(geometry)
  if (!graph || graph.maxEdge > 1.5) return null
  const position = geometry.getAttribute('position').array
  const n = geometry.getAttribute('position').count
  const radius = graph.maxEdge * 0.6
  const step = radius / 3
  // griglia di ricerca dei vertici
  const cells = new Map()
  // chiave numerica della cella (1024 celle per asse: oltre 30 cm, piu' del modello)
  const cellKey = (ix, iy, iz) => ((ix & 1023) << 20) | ((iy & 1023) << 10) | (iz & 1023)
  const keyOf = (x, y, z) => cellKey(Math.floor(x / radius), Math.floor(y / radius), Math.floor(z / radius))
  for (let v = 0; v < n; v++) {
    const key = keyOf(position[v * 3], position[v * 3 + 1], position[v * 3 + 2])
    const list = cells.get(key)
    if (list) list.push(v)
    else cells.set(key, [v])
  }
  const barrier = new Uint8Array(n)
  const mark = (x, y, z) => {
    const ix = Math.floor(x / radius), iy = Math.floor(y / radius), iz = Math.floor(z / radius)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = cells.get(cellKey(ix + dx, iy + dy, iz + dz))
          if (!list) continue
          for (const v of list) {
            if (Math.hypot(position[v * 3] - x, position[v * 3 + 1] - y, position[v * 3 + 2] - z) <= radius) barrier[v] = 1
          }
        }
      }
    }
  }
  for (let i = 0; i < path.length; i++) {
    const p = path[i]
    const q = path[(i + 1) % path.length]
    const steps = Math.max(1, Math.ceil(p.distanceTo(q) / step))
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      mark(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, p.z + (q.z - p.z) * t)
    }
  }
  // contorno visto dall'alto, semplificato: serve solo a decidere quali parti stanno dentro
  const stride = Math.max(1, Math.ceil(path.planar.length / 300))
  const outline = path.planar.filter((_, i) => i % stride === 0)
  // parti della superficie separate dall'argine
  const label = new Int32Array(n).fill(-1)
  const stack = []
  const parts = []
  for (let seed = 0; seed < n; seed++) {
    if (barrier[seed] || label[seed] >= 0) continue
    const id = parts.length
    const part = { inside: 0, total: 0 }
    parts.push(part)
    label[seed] = id
    stack.push(seed)
    while (stack.length) {
      const v = stack.pop()
      if (counts(v)) {
        part.total++
        const [x, y] = planar([position[v * 3], position[v * 3 + 1], position[v * 3 + 2]])
        if (pointInPolygon(x, y, outline)) part.inside++
      }
      for (let e = graph.start[v]; e < graph.start[v + 1]; e++) {
        const w = graph.neighbors[e]
        if (barrier[w] || label[w] >= 0) continue
        label[w] = id
        stack.push(w)
      }
    }
  }
  const flags = new Uint8Array(n)
  for (let v = 0; v < n; v++) {
    if (barrier[v]) flags[v] = 1
    else if (parts[label[v]].total > 0 && parts[label[v]].inside > parts[label[v]].total / 2) flags[v] = 1
  }
  return flags
}

function pointInPolygon(x, y, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export default function useGuideRegion({ active, tool, meshIndex, meshes, meshesRef, sceneRef, cameraRef, canvasHandlersRef, up, cursorSize, onCursorSize }) {
  const [info, setInfo] = useState({ selected: 0, points: 0, closed: false, canUndo: false, canRedo: false })
  // regione per geometria: { geometry, flags, points: [[x,y,z] mm], closed }
  const regionRef = useRef(null)
  const settingsRef = useRef({})
  settingsRef.current = { tool, cursorSize, onCursorSize }
  const redrawRef = useRef(null)

  const geometry = meshes[meshIndex]?.geometry || null
  const region = () => {
    if (!geometry) return null
    if (regionRef.current?.geometry !== geometry) {
      regionRef.current = { geometry, flags: new Uint8Array(geometry.getAttribute('position').count), points: [], closed: false, undo: [], redo: [] }
    }
    return regionRef.current
  }
  const publish = () => {
    const r = regionRef.current
    if (!r) return setInfo({ selected: 0, points: 0, closed: false, canUndo: false, canRedo: false })
    let selected = 0
    for (let v = 0; v < r.flags.length; v++) selected += r.flags[v]
    setInfo({ selected, points: r.points.length, closed: r.closed, canUndo: r.undo.length > 0, canRedo: r.redo.length > 0 })
  }
  // stato della regione prima di una modifica (la nuova modifica cancella i passi da ripetere)
  const snapshot = (r) => ({ points: r.points.slice(), closed: r.closed, flags: r.flags.slice() })
  const remember = (r) => {
    r.undo.push(snapshot(r))
    if (r.undo.length > HISTORY_LIMIT) r.undo.shift()
    r.redo = []
  }
  const restore = (r, state) => {
    r.points = state.points
    r.closed = state.closed
    r.flags.set(state.flags)
  }
  const step = (from, to) => {
    const r = region()
    if (!r || r[from].length === 0) return
    r[to].push(snapshot(r))
    restore(r, r[from].pop())
    publish()
    redrawRef.current?.()
  }
  const undo = () => step('undo', 'redo')
  const redo = () => step('redo', 'undo')

  useEffect(() => {
    region()
    publish()
  }, [geometry])

  useEffect(() => {
    if (!active || !geometry || !up) return undefined
    // la scena viene ricostruita dal Modificatore nello stesso aggiornamento: si aspetta
    let teardown = null
    const start = setTimeout(() => { teardown = setup() }, 0)
    return () => {
      clearTimeout(start)
      teardown?.()
    }
  }, [active, meshIndex, meshes, up])

  // linea della curva e cerchio del pennello cambiano con i parametri senza ricostruire nulla
  useEffect(() => { redrawRef.current?.() }, [tool, cursorSize])

  const setup = () => {
    const sceneMesh = meshesRef.current[meshIndex]
    const scene = sceneRef.current
    const normalization = sceneMesh?.userData.normalization
    const r = region()
    if (!sceneMesh || !scene || !normalization || !r) return null
    const { center, scale } = normalization
    const mm = geometry.getAttribute('position').array
    // vertici rivolti all'opposto della direzione di inserzione (il fondo del modello senza
    // sottosquadri, che sta sotto la stessa zona): mai nella regione di Curva e Lazo
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
    const vertexNormals = geometry.getAttribute('normal').array
    const facesDown = (v) => vertexNormals[v * 3] * up[0] + vertexNormals[v * 3 + 1] * up[1] + vertexNormals[v * 3 + 2] * up[2] < -0.3
    const count = r.flags.length
    const basis = basisFor(up)
    const { a, b, u } = basis
    const objects = []

    // colori della regione su una copia della mesh (stesse posizioni e triangoli)
    const sceneGeometry = sceneMesh.geometry
    const colors = new Float32Array(count * 3)
    const colorAttribute = new THREE.BufferAttribute(colors, 3)
    const overlayGeometry = new THREE.BufferGeometry()
    overlayGeometry.setAttribute('position', sceneGeometry.getAttribute('position'))
    if (sceneGeometry.getAttribute('normal')) overlayGeometry.setAttribute('normal', sceneGeometry.getAttribute('normal'))
    if (sceneGeometry.index) overlayGeometry.setIndex(sceneGeometry.index)
    overlayGeometry.setAttribute('color', colorAttribute)
    if (!sceneGeometry.getAttribute('normal')) overlayGeometry.computeVertexNormals()
    const overlay = new THREE.Mesh(overlayGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide }))
    overlay.raycast = () => {}
    sceneMesh.add(overlay)
    objects.push(overlay)
    const materialWasVisible = sceneMesh.material.visible
    sceneMesh.material.visible = false
    const paintColors = () => {
      for (let v = 0; v < count; v++) colors.set(r.flags[v] ? REGION_COLOR : BASE_COLOR, v * 3)
      colorAttribute.needsUpdate = true
    }
    paintColors()

    // la linea segue la superficie: ogni punto va sul punto piu' vicino del modello (in 3D, non in
    // verticale: sulle pareti quasi verticali dei sottosquadri riempiti la proiezione dall'alto
    // salterebbe tra cima e piede dei gradini)
    const bvh = surfaceBVH(geometry)
    const bvhIndex = bvh.geometry.index
    const bvhPosition = bvh.geometry.getAttribute('position')
    const closest = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 }
    const triangle = new THREE.Triangle()
    const normal = new THREE.Vector3()
    const toSurface = (p) => {
      if (!bvh.closestPointToPoint(p, closest)) return null
      const corner = (k) => (bvhIndex ? bvhIndex.getX(closest.faceIndex * 3 + k) : closest.faceIndex * 3 + k)
      triangle.a.fromBufferAttribute(bvhPosition, corner(0))
      triangle.b.fromBufferAttribute(bvhPosition, corner(1))
      triangle.c.fromBufferAttribute(bvhPosition, corner(2))
      triangle.getNormal(normal)
      return { point: closest.point.clone(), normal: normal.clone() }
    }
    const toScene = (p) => new THREE.Vector3((p[0] - center.x) * scale, (p[1] - center.y) * scale, (p[2] - center.z) * scale)
    const vectorToScene = (v) => toScene([v.x, v.y, v.z])
    const planar = (p) => [p[0] * a[0] + p[1] * a[1] + p[2] * a[2], p[0] * b[0] + p[1] * b[1] + p[2] * b[2]]

    // curva: tubo dorato sulla superficie e sfere nei punti
    const curveGroup = new THREE.Group()
    sceneMesh.add(curveGroup)
    objects.push(curveGroup)
    const gold = new THREE.MeshStandardMaterial({ color: CURVE_COLOR, roughness: 0.4, metalness: 0.2 })
    // punti della linea sulla superficie (mm): { point, normal }
    const surfacePath = () => {
      const points = r.points
      // punti ogni SAMPLE_MM sui tratti tra i clic, portati sulla superficie; poi lisciatura
      // (i punti cliccati restano fermi) e di nuovo sulla superficie
      const samples = []
      const fixed = []
      const segments = r.closed ? points.length : points.length - 1
      const p0 = new THREE.Vector3()
      const p1 = new THREE.Vector3()
      for (let s = 0; s < segments; s++) {
        p0.fromArray(points[s])
        p1.fromArray(points[(s + 1) % points.length])
        const steps = Math.max(1, Math.ceil(p0.distanceTo(p1) / SAMPLE_MM))
        for (let k = 0; k < steps; k++) {
          samples.push(new THREE.Vector3().lerpVectors(p0, p1, k / steps))
          fixed.push(k === 0)
        }
      }
      if (!r.closed) {
        samples.push(new THREE.Vector3().fromArray(points[points.length - 1]))
        fixed.push(true)
      }
      let onModel = samples.map((p) => toSurface(p) || { point: p, normal: new THREE.Vector3() })
      const m = onModel.length
      for (let pass = 0; pass < SMOOTH_PASSES && m > 2; pass++) {
        const smoothed = onModel.map(({ point }, i) => {
          if (fixed[i] || (!r.closed && (i === 0 || i === m - 1))) return point
          const before = onModel[(i - 1 + m) % m].point
          const after = onModel[(i + 1) % m].point
          return new THREE.Vector3().addVectors(before, after).multiplyScalar(0.25).addScaledVector(point, 0.5)
        })
        onModel = smoothed.map((p, i) => (fixed[i] ? onModel[i] : toSurface(p) || onModel[i]))
      }
      return onModel
    }
    const drawCurve = () => {
      for (const child of [...curveGroup.children]) {
        child.removeFromParent()
        child.geometry.dispose()
      }
      const points = r.points
      if (points.length === 0) return
      const radius = 0.15 * scale
      for (const p of points) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(radius * 2.2, 12, 8), gold)
        dot.position.copy(toScene(p))
        curveGroup.add(dot)
      }
      const onModel = surfacePath()
      const path = onModel.map(({ point, normal: n }) => vectorToScene(point.clone().addScaledVector(n, LIFT_MM)))
      if (path.length >= 2) {
        const curve = new THREE.CatmullRomCurve3(path, r.closed, 'centripetal')
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(4000, path.length * 2), radius, 6, r.closed), gold)
        curveGroup.add(tube)
      }
      curveGroup.traverse((object) => { object.raycast = () => {} })
    }
    drawCurve()

    // regione dalla curva chiusa: la superficie racchiusa dalla linea (con una maglia regolare),
    // altrimenti i vertici dentro il poligono visto dalla direzione di inserzione
    const regionFromCurve = () => {
      const path = surfacePath().map(({ point }) => point)
      path.planar = path.map((p) => planar([p.x, p.y, p.z]))
      const inside = surfaceInsideCurve(geometry, path, planar, (v) => !facesDown(v))
      if (inside) {
        r.flags.set(inside)
        return
      }
      const polygon = r.points.map(planar)
      for (let v = 0; v < count; v++) {
        const p = [mm[v * 3], mm[v * 3 + 1], mm[v * 3 + 2]]
        const [x, y] = planar(p)
        r.flags[v] = !facesDown(v) && pointInPolygon(x, y, polygon) ? 1 : 0
      }
    }

    // cerchio del pennello
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0x0ea5e9, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 }),
    )
    ring.renderOrder = 999
    ring.visible = false
    ring.raycast = () => {}
    sceneMesh.add(ring)
    objects.push(ring)

    // lazo: linea vicino alla telecamera
    const lassoGeometry = new THREE.BufferGeometry()
    const lasso = new THREE.Line(lassoGeometry, new THREE.LineBasicMaterial({ color: 0x0ea5e9, depthTest: false }))
    lasso.renderOrder = 999
    lasso.frustumCulled = false
    lasso.raycast = () => {}
    scene.add(lasso)
    objects.push(lasso)

    const raycaster = new THREE.Raycaster()
    const ndcOf = (event) => {
      const rect = event.target.getBoundingClientRect()
      return new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    }
    const pick = (event) => {
      raycaster.setFromCamera(ndcOf(event), cameraRef.current)
      const hit = raycaster.intersectObject(sceneMesh, false)[0]
      if (!hit) return null
      const local = sceneMesh.worldToLocal(hit.point.clone())
      const normal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 0, 1)
      return { local, normal, mm: [local.x / scale + center.x, local.y / scale + center.y, local.z / scale + center.z] }
    }
    const screenOf = (p, event) => {
      const rect = event.target.getBoundingClientRect()
      const world = sceneMesh.localToWorld(toScene(p)).project(cameraRef.current)
      return [(world.x + 1) * 0.5 * rect.width, (1 - world.y) * 0.5 * rect.height]
    }

    let painting = null // { erase }
    let lassoPoints = null // [[ndcX, ndcY]]
    const frame = { id: 0, event: null }
    const showRing = (hit, erase) => {
      if (!hit) {
        ring.visible = false
        return
      }
      const radius = (settingsRef.current.cursorSize / 2) * scale
      ring.scale.setScalar(radius)
      ring.position.copy(hit.local)
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal)
      ring.material.color.set(erase ? 0xef4444 : 0x0ea5e9)
      ring.visible = true
    }
    const paintAt = (hit, erase) => {
      const radius = settingsRef.current.cursorSize / 2
      const r2 = radius * radius
      const [hx, hy, hz] = hit.mm
      for (let v = 0; v < count; v++) {
        const dx = mm[v * 3] - hx
        const dy = mm[v * 3 + 1] - hy
        const dz = mm[v * 3 + 2] - hz
        if (dx * dx + dy * dy + dz * dz <= r2) r.flags[v] = erase ? 0 : 1
      }
      paintColors()
    }
    const setLasso = () => {
      const camera = cameraRef.current
      const points = (lassoPoints || []).map(([x, y]) => new THREE.Vector3(x, y, 0.5).unproject(camera))
      if (points.length > 1) points.push(points[0].clone())
      lassoGeometry.setFromPoints(points)
    }

    const handlers = {
      down: (event) => {
        const current = settingsRef.current.tool
        if (current === 'Pennello') {
          const hit = pick(event)
          if (!hit) return false // sfondo: la vista ruota
          remember(r)
          painting = { erase: event.shiftKey }
          paintAt(hit, painting.erase)
          return true
        }
        if (current === 'Lazo') {
          const p = ndcOf(event)
          lassoPoints = [[p.x, p.y]]
          painting = { erase: event.shiftKey }
          setLasso()
          return true
        }
        return false // Curva: i punti si aggiungono al clic, il trascinamento ruota la vista
      },
      move: (event) => {
        const current = settingsRef.current.tool
        if (current === 'Lazo') {
          if (!lassoPoints) return
          const p = ndcOf(event)
          lassoPoints.push([p.x, p.y])
          setLasso()
          return
        }
        if (current !== 'Pennello') return
        // vista che ruota (tasto premuto senza pennellata): niente ricerca sulla mesh, la rotazione
        // resta fluida
        if (!painting && event.buttons !== 0) {
          ring.visible = false
          return
        }
        frame.event = event
        if (frame.id) return
        frame.id = requestAnimationFrame(() => {
          frame.id = 0
          const hit = pick(frame.event)
          const erase = painting ? painting.erase : frame.event.shiftKey
          showRing(hit, erase)
          if (hit && painting) paintAt(hit, erase)
        })
      },
      up: () => {
        if (lassoPoints && lassoPoints.length >= 3) {
          remember(r)
          // vertici proiettati sullo schermo dentro il lazo
          const camera = cameraRef.current
          sceneMesh.updateMatrixWorld(true)
          const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(sceneMesh.matrixWorld)
          const position = sceneGeometry.getAttribute('position')
          const v3 = new THREE.Vector3()
          for (let v = 0; v < count; v++) {
            v3.fromBufferAttribute(position, v).applyMatrix4(matrix)
            if (pointInPolygon(v3.x, v3.y, lassoPoints) && (painting.erase || !facesDown(v))) r.flags[v] = painting.erase ? 0 : 1
          }
          paintColors()
        }
        lassoPoints = null
        setLasso()
        painting = null
        publish()
      },
      click: (event) => {
        if (settingsRef.current.tool !== 'Curva' || r.closed) return
        const points = r.points
        // clic vicino al primo punto: curva chiusa
        if (points.length >= 3) {
          const [fx, fy] = screenOf(points[0], event)
          const rect = event.target.getBoundingClientRect()
          if (Math.hypot(event.clientX - rect.left - fx, event.clientY - rect.top - fy) < 12) {
            remember(r)
            r.closed = true
            regionFromCurve()
            paintColors()
            drawCurve()
            publish()
            return
          }
        }
        const hit = pick(event)
        if (!hit) return
        remember(r)
        r.points.push(hit.mm)
        drawCurve()
        publish()
      },
      leave: () => { ring.visible = false },
      wheel: (deltaY) => {
        const { tool: current, cursorSize: size, onCursorSize: change } = settingsRef.current
        if (current !== 'Pennello' || deltaY === 0 || !change) return false
        const next = Math.round(size * (deltaY < 0 ? 1.1 : 1 / 1.1) * 2) / 2
        change(Math.min(15, Math.max(0.5, next === size ? size + (deltaY < 0 ? 0.5 : -0.5) : next)))
        return true
      },
    }
    canvasHandlersRef.current = handlers
    redrawRef.current = () => {
      if (settingsRef.current.tool !== 'Pennello') ring.visible = false
      paintColors()
      drawCurve()
    }
    // Ctrl+Z o Backspace: annulla l'ultimo passo (punto della curva, pennellata o lazo);
    // Ctrl+Y o Ctrl+Maiusc+Z: ripete
    const onKey = (event) => {
      const ctrl = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      const undoKey = (ctrl && !event.shiftKey && key === 'z') || (!ctrl && event.key === 'Backspace')
      const redoKey = ctrl && (key === 'y' || (event.shiftKey && key === 'z'))
      if (!undoKey && !redoKey) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return
      // niente da annullare / ripetere nella regione: il tasto resta agli altri gestori
      if ((undoKey ? r.undo : r.redo).length === 0) return
      event.preventDefault()
      // il tasto non deve far scattare anche l'annulla del visualizzatore sotto
      event.stopImmediatePropagation()
      if (undoKey) undo()
      else redo()
    }
    // in cattura: parte prima degli altri gestori dei tasti registrati sulla finestra
    window.addEventListener('keydown', onKey, true)

    return () => {
      if (frame.id) cancelAnimationFrame(frame.id)
      window.removeEventListener('keydown', onKey, true)
      if (canvasHandlersRef.current === handlers) canvasHandlersRef.current = null
      redrawRef.current = null
      sceneMesh.material.visible = materialWasVisible
      for (const object of objects) {
        object.removeFromParent()
        object.traverse((child) => {
          if (child.geometry && child.geometry !== sceneGeometry) {
            // la copia colorata condivide posizioni, normali e indice con la mesh
            if (child === overlay) child.geometry.deleteAttribute('color')
            else child.geometry.dispose()
          }
          child.material?.dispose()
        })
      }
      gold.dispose()
    }
  }

  const reset = () => {
    const r = region()
    if (!r) return
    if (r.points.length === 0 && !r.flags.includes(1)) return
    remember(r)
    r.flags.fill(0)
    r.points = []
    r.closed = false
    publish()
    redrawRef.current?.()
  }

  return { ...info, reset, undo, redo, flags: () => region()?.flags || null }
}
