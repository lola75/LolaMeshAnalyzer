import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

// Illuminazione delle viste 3D (Modificatore, Crea Marker Scan, pagina principale).
// Luci "da studio" legate alla telecamera, cosi' il lato che si guarda e' sempre illuminato bene:
// - principale dall'alto a sinistra (da' le ombre che fanno leggere la forma);
// - riempimento piu' debole da destra in basso (le ombre non diventano nere);
// - contorno da dietro il modello (stacca i bordi dallo sfondo);
// poca luce diffusa e riflessi morbidi da una "stanza" virtuale (environment).
// Stile e luminosita' sono condivisi da tutte le viste e restano salvati.

// Campo visivo delle viste 3D: stretto, come nei CAD dentali, cosi' il modello non
// si deforma quando e' vicino ai bordi dello schermo (con 75 gradi ai bordi si allungava di circa
// il 60%, con 15 gradi meno del 2%); la telecamera sta piu' lontana e la grandezza resta la stessa
export const VIEW_FOV = 15

// Orientamento delle scansioni dentali (come in Meshmixer): l'asse Z del file e' verso l'alto
// (arcata superiore sopra l'inferiore) e gli incisivi guardano verso +Y. La vista frontale guarda
// i denti di fronte, con Z in alto. Si orienta la telecamera, i dati non cambiano.
export const DENTAL_UP = [0, 0, 1]
export const DENTAL_FRONT = [0, 1, 0] // dal modello verso la telecamera, nella vista frontale

// orientamento della telecamera nella vista frontale
export function dentalFrontQuaternion() {
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...DENTAL_FRONT), new THREE.Vector3(), new THREE.Vector3(...DENTAL_UP))
  return new THREE.Quaternion().setFromRotationMatrix(m)
}

// mm (unita' della scena) per pixel alla distanza `depth` dalla telecamera
export const worldPerPixel = (camera, depth, heightPx) => (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, heightPx)

export const LIGHTING_STYLES = {
  studio: { label: 'Studio', key: 2.4, fill: 0.8, rim: 1.1, hemi: 0.35, ambient: 0.12, environment: 0.5 },
  morbida: { label: 'Morbida', key: 1.6, fill: 1.0, rim: 0.6, hemi: 0.6, ambient: 0.3, environment: 0.7 },
  contrasto: { label: 'Contrasto', key: 3.0, fill: 0.35, rim: 1.4, hemi: 0.2, ambient: 0.05, environment: 0.3 },
}

const STORAGE_KEY = 'lolamesh.lighting'
const CHANGE_EVENT = 'lolamesh-lighting'
const DEFAULT_SETTINGS = { style: 'studio', brightness: 1 }

export function readLightingSettings() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null')
    if (saved && LIGHTING_STYLES[saved.style] && Number.isFinite(saved.brightness)) return saved
  } catch {
    // archivio del browser non disponibile o valore non valido
  }
  return DEFAULT_SETTINGS
}

export function saveLightingSettings(settings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // archivio non disponibile: la scelta vale solo per questa sessione
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: settings }))
}

export function onLightingChange(callback) {
  const listener = (event) => callback(event.detail)
  window.addEventListener(CHANGE_EVENT, listener)
  return () => window.removeEventListener(CHANGE_EVENT, listener)
}

// Mette le luci nella scena (le principali come figlie della telecamera) e le regola secondo le
// impostazioni salvate; le aggiorna quando cambiano. Restituisce la funzione di pulizia.
export function setupViewerLighting(scene, camera, renderer) {
  if (!camera.parent) scene.add(camera) // le luci figlie della telecamera devono stare nella scena
  const objects = []
  const target = new THREE.Object3D()
  target.position.set(0, 0, -4) // davanti alla telecamera, dove sta il modello
  camera.add(target)
  objects.push(target)
  const directional = (x, y, z) => {
    const light = new THREE.DirectionalLight(0xffffff, 1)
    light.position.set(x, y, z)
    light.target = target
    camera.add(light)
    objects.push(light)
    return light
  }
  const key = directional(-1.6, 2.2, 1.2)
  const fill = directional(2.2, -0.6, 0.8)
  const rim = directional(0.4, 1.8, -9) // dietro il modello, verso la telecamera
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1)
  const ambient = new THREE.AmbientLight(0xffffff, 1)
  scene.add(hemi, ambient)
  objects.push(hemi, ambient)

  let environment = null
  try {
    const pmrem = new THREE.PMREMGenerator(renderer)
    environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
  } catch (error) {
    console.warn('Riflessi ambiente non disponibili:', error)
  }

  const apply = ({ style, brightness }) => {
    const preset = LIGHTING_STYLES[style] || LIGHTING_STYLES.studio
    const k = Math.max(0.2, Math.min(2, brightness))
    key.intensity = preset.key * k
    fill.intensity = preset.fill * k
    rim.intensity = preset.rim * k
    hemi.intensity = preset.hemi * k
    ambient.intensity = preset.ambient * k
    scene.environment = environment
    // forza dei riflessi sui materiali gia' presenti (MeshStandardMaterial)
    scene.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : []
      for (const material of materials) {
        if ('envMapIntensity' in material) material.envMapIntensity = preset.environment * k
      }
    })
    scene.userData.environmentIntensity = preset.environment * k
  }
  apply(readLightingSettings())
  const stopListening = onLightingChange(apply)

  return {
    // da chiamare dopo aver aggiunto mesh nuove alla scena, per i loro riflessi
    refresh: () => apply(readLightingSettings()),
    dispose: () => {
      stopListening()
      for (const object of objects) object.removeFromParent()
      if (scene.environment === environment) scene.environment = null
      environment?.dispose()
    },
  }
}
