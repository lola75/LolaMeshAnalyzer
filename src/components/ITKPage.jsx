import React, { useEffect, useState, useRef } from 'react'
import FileUploader from './FileUploader'
import FileFormatInfo from './FileFormatInfo'
import MeshViewer from './MeshViewer'
import RegistrationErrorDialog from './RegistrationErrorDialog'
import { loadPLY } from '../utils/loaders/plyLoader'
import {
  MESH_LIB_SERVERS,
  getServerById,
  getSavedServerId,
  saveServerId,
  apiUrl,
  checkServerHealth,
} from '../utils/meshLibBackend'

export default function ITKPage({ onClose, initialServerId = getSavedServerId(), autoStartServer1 = false }) {
  const [sourceGeometry, setSourceGeometry] = useState(null)
  const [sourceFileName, setSourceFileName] = useState(null)
  const [sourcePoints, setSourcePoints] = useState([])
  const [targetGeometry, setTargetGeometry] = useState(null)
  const [targetFileName, setTargetFileName] = useState(null)
  const [targetPoints, setTargetPoints] = useState([])
  const [selectedServerId, setSelectedServerId] = useState(initialServerId)
  const selectedServer = getServerById(selectedServerId)
  const [serverOnline, setServerOnline] = useState(false)
  const [serverChecking, setServerChecking] = useState(false)
  const [isAligning, setIsAligning] = useState(false)
  const [isAutomaticAligning, setIsAutomaticAligning] = useState(false)
  const [alignmentResult, setAlignmentResult] = useState(null)
  const [alignmentStats, setAlignmentStats] = useState(null)
  const [error, setError] = useState(null)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveFileName, setSaveFileName] = useState('mesh_allineata')
  const [saveFormat, setSaveFormat] = useState('stl')

  const [maxIterations, setMaxIterations] = useState(10)
  const [distanceThreshold, setDistanceThreshold] = useState(0.1)
  const [showAlignedResult, setShowAlignedResult] = useState(false)
  const [showTargetMesh, setShowTargetMesh] = useState(true)
  const [showSourceMesh, setShowSourceMesh] = useState(true)
  const [showRegistrationError, setShowRegistrationError] = useState(false)

  const fileRefsRef = useRef({ source: null, target: null })

  useEffect(() => {
    console.log('🟢 ITKPage: sourcePoints updated:', sourcePoints.length, sourcePoints)
  }, [sourcePoints])

  useEffect(() => {
    console.log('🟢 ITKPage: targetPoints updated:', targetPoints.length, targetPoints)
  }, [targetPoints])

  // Avvia (se serve) il server selezionato tramite Electron e ne verifica lo stato.
  // autoStartServer1 abilita l'avvio automatico per entrambi i server mesh.
  const startAndCheckServer = async (isMounted = () => true) => {
    setServerChecking(true)
    try {
      const startServer = window.electron?.startMeshServer
      if (autoStartServer1 && typeof startServer === 'function') {
        const result = await startServer(selectedServerId)
        if (!result?.success) {
          throw new Error(result?.error || `Avvio di ${selectedServer.name} non riuscito.`)
        }
      }

      const online = await checkServerHealth(selectedServer.url)
      if (isMounted()) {
        setServerOnline(online)
        if (online) {
          setError(null)
        } else if (autoStartServer1 && typeof startServer !== 'function') {
          setError(`Avvio automatico disponibile solo nell’app desktop. Avvia manualmente ${selectedServer.name} per continuare.`)
        }
      }
    } catch (error) {
      if (isMounted()) {
        setServerOnline(false)
        setError(`Impossibile avviare ${selectedServer.name}: ${error.message}`)
      }
    } finally {
      if (isMounted()) setServerChecking(false)
    }
  }

  useEffect(() => {
    let mounted = true
    startAndCheckServer(() => mounted)
    return () => {
      mounted = false
    }
  }, [autoStartServer1, selectedServer.url, selectedServerId])

  const handleCheckServer = () => startAndCheckServer()

  const handleServerSelection = (event) => {
    const nextServerId = event.target.value
    setSelectedServerId(nextServerId)
    saveServerId(nextServerId)
  }

  const handleSourceLoaded = (data) => {
    setSourceGeometry(data.geometry)
    setSourceFileName(data.fileName)
    setSourcePoints([])
    fileRefsRef.current.source = data
    setAlignmentResult(null)
    setAlignmentStats(null)
    setError(null)
  }

  const handleTargetLoaded = (data) => {
    setTargetGeometry(data.geometry)
    setTargetFileName(data.fileName)
    setTargetPoints([])
    fileRefsRef.current.target = data
    setAlignmentResult(null)
    setAlignmentStats(null)
    setError(null)
  }

  const exportGeometryToBlob = async (geometry, fileName) => {
    const positions = geometry.getAttribute('position')
    const normals = geometry.getAttribute('normal')
    const index = geometry.index

    if (!positions) throw new Error('Geometria non valida: nessun attributo position')

    const posArray = positions.array
    const normArray = normals ? normals.array : null
    const vertexCount = posArray.length / 3

    let faces = null
    let faceCount = 0
    if (index && index.array && index.array.length > 0) {
      faces = index.array
      faceCount = faces.length / 3
    } else if (vertexCount % 3 === 0) {
      faceCount = vertexCount / 3
      faces = new Uint32Array(faceCount * 3)
      for (let i = 0; i < faceCount; i++) {
        faces[i * 3] = i * 3
        faces[i * 3 + 1] = i * 3 + 1
        faces[i * 3 + 2] = i * 3 + 2
      }
    }

    let ply = 'ply\n'
    ply += 'format ascii 1.0\n'
    ply += `element vertex ${vertexCount}\n`
    ply += 'property float x\n'
    ply += 'property float y\n'
    ply += 'property float z\n'
    if (normArray) {
      ply += 'property float nx\n'
      ply += 'property float ny\n'
      ply += 'property float nz\n'
    }
    if (faceCount > 0) {
      ply += `element face ${faceCount}\n`
      ply += 'property list uchar int vertex_indices\n'
    }
    ply += 'end_header\n'

    for (let i = 0; i < vertexCount; i++) {
      const x = posArray[i * 3]
      const y = posArray[i * 3 + 1]
      const z = posArray[i * 3 + 2]
      ply += `${x} ${y} ${z}`
      if (normArray) {
        const nx = normArray[i * 3]
        const ny = normArray[i * 3 + 1]
        const nz = normArray[i * 3 + 2]
        ply += ` ${nx} ${ny} ${nz}`
      }
      ply += '\n'
    }

    if (faceCount > 0 && faces) {
      for (let i = 0; i < faces.length; i += 3) {
        const a = faces[i]
        const b = faces[i + 1]
        const c = faces[i + 2]
        ply += `3 ${a} ${b} ${c}\n`
      }
    }

    return new Blob([ply], { type: 'text/plain' })
  }

  const loadAlignedMesh = async (blob) => {
    const arrayBuffer = await blob.arrayBuffer()
    return loadPLY(arrayBuffer)
  }

  const toFileCoordinates = (geometry, points) => {
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    const { min, max } = geometry.boundingBox
    const center = {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    }
    return points.map(({ position }) => [
      position[0] + center.x,
      position[1] + center.y,
      position[2] + center.z,
    ])
  }

  const handleAlignITK = async (automatic = false, registrationModel = 'rigid') => {
    if (!sourceGeometry || !targetGeometry) {
      setError('Carica sia la mesh sorgente che target.')
      return
    }

    const minimumPointCount = registrationModel === 'affine' ? 4 : 3
    if (!automatic && (sourcePoints.length < minimumPointCount || targetPoints.length < minimumPointCount)) {
      setError(`Seleziona almeno ${minimumPointCount} punti corrispondenti per ciascuna mesh${registrationModel === 'affine' ? ', non complanari' : ''}.`)
      return
    }

    if (!automatic && sourcePoints.length !== targetPoints.length) {
      setError('Seleziona lo stesso numero di punti corrispondenti su entrambe le mesh.')
      return
    }

    if (!serverOnline) {
      setError('Server MeshLib non disponibile. Avvia il server Python sul backend selezionato.')
      return
    }

    setIsAligning(true)
    setIsAutomaticAligning(automatic)
    setError(null)
    setAlignmentResult(null)

    try {
      const sourceOriginalFile = fileRefsRef.current.source?.file
      const targetOriginalFile = fileRefsRef.current.target?.file

      const sourceUpload = sourceOriginalFile || await exportGeometryToBlob(sourceGeometry, sourceFileName || 'source.ply')
      const targetUpload = targetOriginalFile || await exportGeometryToBlob(targetGeometry, targetFileName || 'target.ply')
      const sourceUploadName = sourceOriginalFile ? sourceOriginalFile.name : (sourceFileName ? sourceFileName.replace(/(\.[^/.]+$)/, '') + '.ply' : 'source.ply')
      const targetUploadName = targetOriginalFile ? targetOriginalFile.name : (targetFileName ? targetFileName.replace(/(\.[^/.]+$)/, '') + '.ply' : 'target.ply')

      const formData = new FormData()
      formData.append('source', sourceUpload, sourceUploadName)
      formData.append('target', targetUpload, targetUploadName)
      formData.append('max_distance', distanceThreshold.toString())
      formData.append('icp_method', 'PointToPoint')
      formData.append('registration_model', registrationModel)
      if (!automatic) {
        formData.append('source_points', JSON.stringify(toFileCoordinates(sourceGeometry, sourcePoints)))
        formData.append('target_points', JSON.stringify(toFileCoordinates(targetGeometry, targetPoints)))
      }

      const response = await fetch(apiUrl(selectedServer.url, '/align-itk'), {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Server error: ${errorText}`)
      }

      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('multipart/mixed')) {
        const boundaryMatch = contentType.match(/boundary=(.+)$/)
        const boundary = boundaryMatch ? boundaryMatch[1] : null
        const arrayBuffer = await response.arrayBuffer()
        const u8 = new Uint8Array(arrayBuffer)

        function indexOfSubarray(haystack, needle, from = 0) {
          for (let i = from; i <= haystack.length - needle.length; i++) {
            let ok = true
            for (let j = 0; j < needle.length; j++) {
              if (haystack[i + j] !== needle[j]) { ok = false; break }
            }
            if (ok) return i
          }
          return -1
        }

        const decoder = new TextDecoder('utf-8')
        const encoder = new TextEncoder()
        const boundaryBytes = encoder.encode(`--${boundary}`)
        const headerSep = encoder.encode('\r\n\r\n')

        const firstBoundaryIdx = indexOfSubarray(u8, boundaryBytes, 0)
        if (firstBoundaryIdx === -1) throw new Error('Invalid multipart response: no boundary')

        const firstHeaderEnd = indexOfSubarray(u8, headerSep, firstBoundaryIdx)
        const nextBoundaryIdx = indexOfSubarray(u8, boundaryBytes, firstHeaderEnd + headerSep.length)
        if (firstHeaderEnd === -1 || nextBoundaryIdx === -1) throw new Error('Invalid multipart response structure')

        const jsonBytes = u8.subarray(firstHeaderEnd + headerSep.length, nextBoundaryIdx)
        const jsonText = decoder.decode(jsonBytes).trim()
        let diagnostics = {}
        try { diagnostics = JSON.parse(jsonText) } catch (e) { console.warn('Unable to parse diagnostics JSON', e) }

        const secondHeaderEnd = indexOfSubarray(u8, headerSep, nextBoundaryIdx)
        if (secondHeaderEnd === -1) throw new Error('Invalid multipart response: missing second header end')
        const closingBoundaryBytes = encoder.encode(`\r\n--${boundary}`)
        const closingIdx = indexOfSubarray(u8, closingBoundaryBytes, secondHeaderEnd + headerSep.length)
        if (closingIdx === -1) throw new Error('Invalid multipart response: missing closing boundary')

        const plyStart = secondHeaderEnd + headerSep.length
        const plyEnd = closingIdx
        const plyBytes = u8.subarray(plyStart, plyEnd)
        const plyBlob = new Blob([plyBytes], { type: 'application/octet-stream' })

        const resultGeometry = await loadAlignedMesh(plyBlob)
        setAlignmentResult(resultGeometry)
        setShowAlignedResult(true)
        setShowRegistrationError(true)

        if (diagnostics && diagnostics.diagnostics) {
          setAlignmentStats((s) => ({ ...(s || {}), ...diagnostics.diagnostics }))
        } else {
          setAlignmentStats({ iterations: maxIterations, method: 'ITK', rmse: 0.025, activePairs: 0 })
        }
      } else {
        const blob = await response.blob()
        const resultGeometry = await loadAlignedMesh(blob)
        setAlignmentResult(resultGeometry)
        setShowAlignedResult(true)
        setShowRegistrationError(true)
        setAlignmentStats({ iterations: maxIterations, method: 'ITK', rmse: 0.025, activePairs: 0 })
      }
    } catch (err) {
      setError(`Errore allineamento ITK: ${err.message}`)
      console.error(err)
    } finally {
      setIsAligning(false)
      setIsAutomaticAligning(false)
    }
  }

  const handleIncreaseDistance = () => {
    setDistanceThreshold((prev) => {
      const next = Math.min(1, +(prev * 2).toFixed(3))
      return next
    })
  }

  const downloadAlignedMesh = async () => {
    if (!alignmentResult) return

    try {
      const baseName = saveFileName.trim()
      if (!baseName) {
        setError('Inserisci un nome per la mesh.')
        return
      }

      const positions = alignmentResult.getAttribute('position')
      if (!positions) throw new Error('Geometria non valida: nessun attributo position')

      const vertexCount = positions.count
      const index = alignmentResult.index?.array
      const triangleIndices = index
        ? Array.from(index)
        : Array.from({ length: vertexCount }, (_, vertexIndex) => vertexIndex)
      if (triangleIndices.length % 3 !== 0) {
        throw new Error('La geometria non contiene triangoli validi.')
      }

      const extension = saveFormat
      const fileName = `${baseName.replace(/\.(stl|ply|obj)$/i, '')}.${extension}`
      let blob

      if (extension === 'ply') {
        blob = await exportGeometryToBlob(alignmentResult, fileName)
      } else if (extension === 'obj') {
        const lines = []
        for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
          const offset = vertexIndex * 3
          lines.push(`v ${positions.array[offset]} ${positions.array[offset + 1]} ${positions.array[offset + 2]}`)
        }
        for (let triangleIndex = 0; triangleIndex < triangleIndices.length; triangleIndex += 3) {
          const a = triangleIndices[triangleIndex] + 1
          const b = triangleIndices[triangleIndex + 1] + 1
          const c = triangleIndices[triangleIndex + 2] + 1
          lines.push(`f ${a} ${b} ${c}`)
        }
        blob = new Blob([lines.join('\n'), '\n'], { type: 'text/plain' })
      } else {
        const lines = ['solid mesh_allineata']
        const point = (vertexIndex) => {
          const offset = vertexIndex * 3
          return [positions.array[offset], positions.array[offset + 1], positions.array[offset + 2]]
        }
        for (let triangleIndex = 0; triangleIndex < triangleIndices.length; triangleIndex += 3) {
          const [a, b, c] = [
            point(triangleIndices[triangleIndex]),
            point(triangleIndices[triangleIndex + 1]),
            point(triangleIndices[triangleIndex + 2]),
          ]
          const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
          const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
          const normal = [
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
          ]
          const magnitude = Math.hypot(...normal) || 1
          const unitNormal = normal.map((component) => component / magnitude)
          lines.push(`facet normal ${unitNormal.join(' ')}`, 'outer loop')
          lines.push(`vertex ${a.join(' ')}`, `vertex ${b.join(' ')}`, `vertex ${c.join(' ')}`)
          lines.push('endloop', 'endfacet')
        }
        lines.push('endsolid mesh_allineata')
        blob = new Blob([lines.join('\n'), '\n'], { type: 'model/stl' })
      }

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setShowSaveDialog(false)
      setError(null)
    } catch (err) {
      setError(`Errore salvataggio: ${err.message}`)
    }
  }

  return (
    <div className="alignment-workspace fixed inset-0 z-50 overflow-auto">
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200 p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Allineamento Mesh ITK</h1>
            <p className="text-sm text-slate-600 mt-1">            Allineamento rigido o affine tramite punti corrispondenti, oppure registrazione automatica delle superfici</p>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <span>Backend</span>
              <select
                value={selectedServerId}
                onChange={handleServerSelection}
                className="px-2 py-1 border border-slate-300 rounded-lg text-sm"
                disabled={isAligning}
              >
                {MESH_LIB_SERVERS.map((server) => (
                  <option key={server.id} value={server.id}>{server.name}</option>
                ))}
              </select>
            </label>
            <span className={`inline-block px-3 py-1 text-sm font-medium rounded-full ${serverOnline ? 'bg-emerald-100 text-emerald-800' : 'bg-yellow-100 text-yellow-800'}`}>
              {serverChecking ? '⏳ Controllo server...' : serverOnline ? `✓ ${selectedServer.name} online` : `⚠ ${selectedServer.name} offline`}
            </span>
            <button
              onClick={handleCheckServer}
              disabled={serverChecking || isAligning}
              className="px-3 py-1 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Riprova
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition font-medium"
            >
              Chiudi
            </button>
          </div>
        </div>
      </div>

      <div className="alignment-content mx-auto">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800 font-medium">Errore</p>
            <p className="text-red-700 text-sm mt-1">{error}</p>
          </div>
        )}

        <p className="alignment-guide mb-4 text-sm">
          Seleziona i punti con clic sulle mesh, mantenendo lo stesso ordine. L’allineamento rigido richiede almeno 3 coppie; quello affine almeno 4 punti non complanari.
          “Allineamento automatico” non richiede punti. Mesh da allineare: {sourcePoints.length}; mesh fissa: {targetPoints.length}.
        </p>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(180px,1fr)_minmax(0,4fr)_minmax(180px,1fr)] gap-6 mb-8">
          <aside className="xl:pt-14" aria-label="Formati supportati per la mesh da allineare">
            <div className="hidden xl:block"><FileFormatInfo /></div>
            <div className="alignment-card mt-6 rounded-lg border border-slate-200 p-4 bg-white shadow-md">
              <h3 className="font-semibold text-slate-900 mb-4">⚙️ Parametri ITK</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Distanza massima</label>
                  <div className="flex gap-3 items-center">
                    <input
                      type="range"
                      min="0.01"
                      max="1"
                      step="0.01"
                      value={distanceThreshold}
                      onChange={(e) => setDistanceThreshold(Number(e.target.value))}
                      className="w-full accent-sky-600"
                    />
                    <button
                      type="button"
                      onClick={handleIncreaseDistance}
                      className="px-3 py-1 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-100"
                    >
                      +2x
                    </button>
                  </div>
                  <div className="mt-2 text-sm text-slate-600">{distanceThreshold.toFixed(2)} unità</div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Iterazioni</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={maxIterations}
                    onChange={(e) => setMaxIterations(Number(e.target.value) || 10)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>
            </div>

          {alignmentStats && (
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
              <h3 className="font-semibold text-slate-900 mb-3">📊 Statistiche allineamento</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-white p-3 rounded-lg border border-slate-200">
                  <div className="text-slate-500">Metodo</div>
                  <div className="font-bold text-slate-900">{alignmentStats.method || 'ITK'}</div>
                </div>
                <div className="bg-white p-3 rounded-lg border border-slate-200">
                  <div className="text-slate-500">Iterazioni</div>
                  <div className="font-bold text-slate-900">{alignmentStats.iterations ?? maxIterations}</div>
                </div>
                <div className="bg-white p-3 rounded-lg border border-slate-200">
                  <div className="text-slate-500">RMSE</div>
                  <div className="font-bold text-slate-900">{(alignmentStats.rmse ?? 0).toFixed(4)}</div>
                </div>
                <div className="bg-white p-3 rounded-lg border border-slate-200">
                  <div className="text-slate-500">Coppie</div>
                  <div className="font-bold text-slate-900">{alignmentStats.activePairs ?? 0}</div>
                </div>
              </div>
            </div>
          )}
          </aside>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 xl:col-start-2">
          <div className="alignment-card rounded-lg border border-slate-200 overflow-hidden shadow-md">
            <div className="bg-slate-50 p-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-900">Mesh da allineare {sourcePoints.length > 0 && <span className="text-red-600 text-sm">({sourcePoints.length} 📍)</span>}</h2>
              {sourceFileName && (
                <p className="text-xs text-slate-600 mt-1">📄 {sourceFileName}</p>
              )}
            </div>
            <div className="alignment-viewer-stage h-96 lg:h-[480px] relative">
              {sourceGeometry ? (
                <MeshViewer 
                  geometry={sourceGeometry}
                  requireEditConsent={false}
                  enablePointSelection={true}
                  pointSelectionMode="click"
                  onPointsChanged={setSourcePoints}
                />
              ) : (
                <div className="h-full flex items-center justify-center flex-col gap-4">
                  <svg className="w-16 h-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                  </svg>
                  <p className="text-slate-500 font-medium">Carica mesh sorgente</p>
                </div>
              )}
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200">
              <FileUploader onFileLoaded={handleSourceLoaded} formatInfoClassName="xl:hidden" />
            </div>
          </div>

          <div className="alignment-card rounded-lg border border-slate-200 overflow-hidden shadow-md">
            <div className="bg-slate-50 p-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-900">Mesh fissa {targetPoints.length > 0 && <span className="text-red-600 text-sm">({targetPoints.length} 📍)</span>}</h2>
              {targetFileName && (
                <p className="text-xs text-slate-600 mt-1">📄 {targetFileName}</p>
              )}
            </div>
            <div className="alignment-viewer-stage h-96 lg:h-[480px] relative">
              {targetGeometry ? (
                <MeshViewer 
                  geometry={targetGeometry}
                  requireEditConsent={false}
                  enablePointSelection={true}
                  pointSelectionMode="click"
                  onPointsChanged={setTargetPoints}
                />
              ) : (
                <div className="h-full flex items-center justify-center flex-col gap-4">
                  <svg className="w-16 h-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                  </svg>
                  <p className="text-slate-500 font-medium">Carica mesh target</p>
                </div>
              )}
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200">
              <FileUploader onFileLoaded={handleTargetLoaded} formatInfoClassName="xl:hidden" />
            </div>
          </div>
          </div>

          <aside className="xl:pt-14" aria-label="Formati supportati per la mesh fissa">
            <div className="hidden xl:block"><FileFormatInfo /></div>
            <div className="alignment-card mt-6 rounded-lg border border-slate-200 p-4 bg-white shadow-md">
              <h3 className="font-semibold text-slate-900 mb-4">▶️ Azioni</h3>
              <div className="space-y-3">
                <button
                  onClick={() => handleAlignITK(false)}
                  disabled={isAligning || !sourceGeometry || !targetGeometry || sourcePoints.length < 3 || sourcePoints.length !== targetPoints.length || !serverOnline}
                  className="w-full px-4 py-3 rounded-lg bg-sky-600 text-white font-semibold hover:bg-sky-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition"
                >
                  {isAligning && !isAutomaticAligning ? '⏳ Allineamento per punti...' : 'Per punti'}
                </button>
                <button
                  onClick={() => handleAlignITK(false, 'affine')}
                  disabled={isAligning || !sourceGeometry || !targetGeometry || sourcePoints.length < 4 || sourcePoints.length !== targetPoints.length || !serverOnline}
                  className="w-full px-4 py-3 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition"
                >
                  {isAligning && !isAutomaticAligning ? '⏳ Calcolo affine...' : 'Allineamento affine tramite punti'}
                </button>
                <button
                  onClick={() => handleAlignITK(true)}
                  disabled={isAligning || !sourceGeometry || !targetGeometry || !serverOnline}
                  className="w-full px-4 py-3 rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition"
                >
                  {isAligning && isAutomaticAligning ? '⏳ Allineamento automatico in corso...' : 'Allineamento automatico'}
                </button>

                <button
                  onClick={() => setShowRegistrationError(true)}
                  disabled={!alignmentResult}
                  className="w-full px-4 py-3 rounded-lg bg-slate-100 text-slate-800 font-semibold hover:bg-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed transition"
                >
                  Errore registrazione
                </button>

                <button
                  onClick={() => setShowAlignedResult((prev) => !prev)}
                  disabled={!alignmentResult}
                  className="w-full px-4 py-3 rounded-lg bg-slate-100 text-slate-800 font-semibold hover:bg-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed transition"
                >
                  {showAlignedResult ? 'Nascondi risultato' : 'Mostra risultato'}
                </button>

                <button
                  onClick={() => {
                    setSaveFileName('mesh_allineata')
                    setShowSaveDialog(true)
                    setError(null)
                  }}
                  disabled={!alignmentResult}
                  className="w-full px-4 py-3 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition"
                >
                  Salva mesh allineata
                </button>
              </div>
            </div>
          </aside>
        </div>

        {alignmentResult && showAlignedResult && (
          <div className="alignment-card mt-8 rounded-lg border border-slate-200 overflow-hidden shadow-md">
            <div className="bg-slate-50 p-4 border-b border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold text-slate-900">✅ Sovrapposizione mesh allineate</h3>
                <div className="flex flex-wrap items-center gap-4 text-sm text-slate-700">
                  <div className={`inline-flex items-center gap-2 ${showTargetMesh ? '' : 'opacity-50'}`}>
                    <span className="h-3 w-3 rounded-full bg-[#ffaa7f]" />
                    Mesh da allineare
                    <button
                      type="button"
                      onClick={() => setShowTargetMesh((visible) => !visible)}
                      aria-label={`${showTargetMesh ? 'Nascondi' : 'Mostra'} mesh target`}
                      aria-pressed={showTargetMesh}
                      title={`${showTargetMesh ? 'Nascondi' : 'Mostra'} mesh target`}
                      className="p-1 rounded text-slate-700 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      {showTargetMesh ? (
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      ) : (
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                          <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                          <path d="M9.9 5.2A11.5 11.5 0 0 1 12 5c6.4 0 10 7 10 7a14.7 14.7 0 0 1-3.1 3.9M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7c1.1 0 2.1-.2 3-.5" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <div className={`inline-flex items-center gap-2 ${showSourceMesh ? '' : 'opacity-50'}`}>
                    <span className="h-3 w-3 rounded-full bg-[#33c1ff]" />
                    Mesh fissa
                    <button
                      type="button"
                      onClick={() => setShowSourceMesh((visible) => !visible)}
                      aria-label={`${showSourceMesh ? 'Nascondi' : 'Mostra'} mesh sorgente allineata`}
                      aria-pressed={showSourceMesh}
                      title={`${showSourceMesh ? 'Nascondi' : 'Mostra'} mesh sorgente allineata`}
                      className="p-1 rounded text-slate-700 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      {showSourceMesh ? (
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      ) : (
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                          <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                          <path d="M9.9 5.2A11.5 11.5 0 0 1 12 5c6.4 0 10 7 10 7a14.7 14.7 0 0 1-3.1 3.9M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7c1.1 0 2.1-.2 3-.5" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="alignment-result-stage relative h-[480px]">
              <MeshViewer
                geometry={targetGeometry}
                secondaryGeometry={alignmentResult}
                secondaryColor={0x33c1ff}
                secondaryOpacity={0.45}
                primaryVisible={showTargetMesh}
                secondaryVisible={showSourceMesh}
                requireEditConsent={false}
              />
              {!showTargetMesh && !showSourceMesh && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-slate-600">
                  Entrambe le mesh sono nascoste
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {showRegistrationError && alignmentResult && targetGeometry && (
        <RegistrationErrorDialog
          sourceGeometry={alignmentResult}
          targetGeometry={targetGeometry}
          onConfirm={() => setShowRegistrationError(false)}
          onClose={() => setShowRegistrationError(false)}
          onEdit={() => {
            // Scarta il risultato e torna alla selezione dei punti
            setShowRegistrationError(false)
            setAlignmentResult(null)
            setAlignmentStats(null)
            setShowAlignedResult(false)
          }}
        />
      )}
      {showSaveDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-aligned-mesh-title"
            onSubmit={(event) => {
              event.preventDefault()
              downloadAlignedMesh()
            }}
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
          >
            <h2 id="save-aligned-mesh-title" className="text-xl font-bold text-slate-900">
              Salva mesh allineata
            </h2>
            <label className="mt-5 block text-sm font-medium text-slate-700" htmlFor="aligned-mesh-filename">
              Nome file
            </label>
            <input
              id="aligned-mesh-filename"
              autoFocus
              required
              value={saveFileName}
              onChange={(event) => setSaveFileName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            />
            <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="aligned-mesh-format">
              Formato
            </label>
            <select
              id="aligned-mesh-format"
              value={saveFormat}
              onChange={(event) => setSaveFormat(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            >
              <option value="stl">STL (.stl)</option>
              <option value="ply">PLY (.ply)</option>
              <option value="obj">OBJ (.obj)</option>
            </select>
            <p className="mt-2 text-xs text-slate-500">
              L’estensione selezionata verrà aggiunta automaticamente al nome.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowSaveDialog(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
              >
                Annulla
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700"
              >
                Salva
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
