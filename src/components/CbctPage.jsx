import React, { useEffect, useRef, useState } from 'react'
import { Niivue, SLICE_TYPE, MULTIPLANAR_TYPE, SHOW_RENDER } from '@niivue/niivue'
import { apiUrl, checkServerHealth } from '../utils/meshLibBackend'

const CBCT_SERVER_URL = 'http://127.0.0.1:8002'

const VIEWS = [
  { id: 'multi', label: '4 viste', sliceType: SLICE_TYPE.MULTIPLANAR },
  { id: 'axial', label: 'Assiale', sliceType: SLICE_TYPE.AXIAL },
  { id: 'coronal', label: 'Coronale', sliceType: SLICE_TYPE.CORONAL },
  { id: 'sagittal', label: 'Sagittale', sliceType: SLICE_TYPE.SAGITTAL },
  { id: 'render', label: '3D', sliceType: SLICE_TYPE.RENDER },
]

// Le CBCT non sono calibrate in Hounsfield: i preset sono relativi alla finestra automatica
const WINDOW_PRESETS = [
  { id: 'auto', label: 'Auto', range: (lo) => [lo, null] },
  { id: 'bone', label: 'Osso e denti', range: (lo, hi) => [lo + 0.35 * (hi - lo), hi] },
  { id: 'soft', label: 'Tessuti molli', range: (lo, hi) => [lo, lo + 0.5 * (hi - lo)] },
]

const readErrorDetail = async (response) => {
  try {
    const body = await response.json()
    return body?.detail || `Errore ${response.status}`
  } catch {
    return `Errore ${response.status}`
  }
}

export default function CbctPage({ onClose }) {
  const canvasRef = useRef(null)
  const nvRef = useRef(null)
  const folderInputRef = useRef(null)
  const zipInputRef = useRef(null)
  const sessionIdRef = useRef(null)

  const [serverStatus, setServerStatus] = useState('checking')
  const [loadingMessage, setLoadingMessage] = useState(null)
  const [error, setError] = useState(null)
  const [meta, setMeta] = useState(null)
  const [view, setView] = useState('multi')
  const [windowRange, setWindowRange] = useState(null)
  const [useReduced, setUseReduced] = useState(true)

  const isDesktop = typeof window.electron?.selectCbctSource === 'function'

  useEffect(() => {
    const nv = new Niivue({
      backColor: [0.05, 0.08, 0.14, 1],
      show3Dcrosshair: true,
      isOrientCube: true,
      multiplanarShowRender: SHOW_RENDER.ALWAYS,
      multiplanarLayout: MULTIPLANAR_TYPE.GRID,
      loadingText: '',
    })
    nv.attachToCanvas(canvasRef.current)
    nv.setSliceType(SLICE_TYPE.MULTIPLANAR)
    // Contrasto cambiato col tasto destro nel visualizzatore: aggiorna i cursori
    nv.onIntensityChange = (volume) => setWindowRange([volume.cal_min, volume.cal_max])
    nvRef.current = nv
    return () => {
      nvRef.current = null
      try {
        nv.cleanup()
      } catch (err) {
        console.warn('Pulizia NiiVue non riuscita:', err)
      }
    }
  }, [])

  const checkServer = async () => {
    setServerStatus('checking')
    try {
      if (typeof window.electron?.startCbctServer === 'function') {
        const result = await window.electron.startCbctServer()
        if (!result?.success) throw new Error(result?.error || 'Avvio del server CBCT non riuscito.')
      }
      const online = await checkServerHealth(CBCT_SERVER_URL)
      setServerStatus(online ? 'online' : 'offline')
      if (!online && !isDesktop) {
        setError('Server CBCT offline. Avvialo con "mio server\\run_cbct_server.bat".')
      }
    } catch (err) {
      setServerStatus('offline')
      setError(err.message)
    }
  }

  useEffect(() => {
    checkServer()
    return () => {
      // Libera il volume temporaneo sul server quando si chiude la pagina
      if (sessionIdRef.current) {
        fetch(apiUrl(CBCT_SERVER_URL, `/cbct/${sessionIdRef.current}`), { method: 'DELETE' }).catch(() => {})
      }
    }
  }, [])

  const applyWindow = (low, high) => {
    const volume = nvRef.current?.volumes?.[0]
    if (!volume) return
    volume.cal_min = low
    volume.cal_max = high
    nvRef.current.updateGLVolume()
    setWindowRange([low, high])
  }

  const showVolume = async (volumeMeta, reduced, keepWindow = null) => {
    setLoadingMessage(reduced ? 'Apertura del volume ridotto nel visualizzatore...' : 'Apertura del volume completo nel visualizzatore...')
    const query = reduced ? '?reduced=true' : ''
    const response = await fetch(apiUrl(CBCT_SERVER_URL, `/cbct/${volumeMeta.id}/volume.nii${query}`))
    if (!response.ok) throw new Error(await readErrorDetail(response))
    const buffer = await response.arrayBuffer()

    const nv = nvRef.current
    if (!nv) return
    for (const volume of [...nv.volumes]) nv.removeVolume(volume)
    nv.gl.getError() // azzera eventuali errori precedenti
    await nv.loadFromArrayBuffer(buffer, 'cbct.nii')
    if (nv.gl.getError() === nv.gl.OUT_OF_MEMORY) {
      for (const volume of [...nv.volumes]) nv.removeVolume(volume)
      throw new Error(reduced
        ? 'Memoria della scheda video insufficiente anche per il volume ridotto.'
        : 'Memoria della scheda video insufficiente per il volume completo. Riattiva "Riduci volume".')
    }

    const previousSession = sessionIdRef.current
    sessionIdRef.current = volumeMeta.id
    if (previousSession && previousSession !== volumeMeta.id) {
      fetch(apiUrl(CBCT_SERVER_URL, `/cbct/${previousSession}`), { method: 'DELETE' }).catch(() => {})
    }

    setMeta(volumeMeta)
    const [low, high] = keepWindow || volumeMeta.suggestedWindow
    applyWindow(low, high)
    nv.setSliceType(VIEWS.find((v) => v.id === view).sliceType)
  }

  const toggleReduced = async () => {
    if (!meta || !meta.reduced) return
    const next = !useReduced
    setError(null)
    try {
      await showVolume(meta, next, windowRange)
      setUseReduced(next)
    } catch (err) {
      setError(err.message)
      // Torna alla versione che funzionava
      try {
        await showVolume(meta, useReduced, windowRange)
      } catch {
        // l'errore originale e' gia' mostrato
      }
    } finally {
      setLoadingMessage(null)
    }
  }

  const runLoad = async (request) => {
    setError(null)
    setLoadingMessage('Lettura della serie DICOM...')
    try {
      const response = await request()
      if (!response.ok) throw new Error(await readErrorDetail(response))
      setUseReduced(true)
      await showVolume(await response.json(), true)
    } catch (err) {
      setError(err.message === 'Failed to fetch'
        ? 'Il server CBCT non risponde. Premi "Riprova" in alto.'
        : err.message)
    } finally {
      setLoadingMessage(null)
    }
  }

  const loadFromPath = (sourcePath) => runLoad(() =>
    fetch(apiUrl(CBCT_SERVER_URL, '/cbct/load-path'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: sourcePath }),
    })
  )

  const loadFromFiles = (fileList) => {
    const files = Array.from(fileList || [])
    if (files.length === 0) return
    runLoad(() => {
      const form = new FormData()
      files.forEach((file) => form.append('files', file, file.name))
      return fetch(apiUrl(CBCT_SERVER_URL, '/cbct/load-upload'), { method: 'POST', body: form })
    })
  }

  const openSource = async (kind) => {
    if (isDesktop) {
      const result = await window.electron.selectCbctSource({ kind })
      if (!result?.canceled && result?.path) loadFromPath(result.path)
      return
    }
    const input = kind === 'zip' ? zipInputRef.current : folderInputRef.current
    input.value = ''
    input.click()
  }

  const changeView = (viewId) => {
    setView(viewId)
    nvRef.current?.setSliceType(VIEWS.find((v) => v.id === viewId).sliceType)
  }

  const applyPreset = (preset) => {
    if (!meta) return
    const [lo, hi] = meta.suggestedWindow
    const [low, high] = preset.range(lo, hi)
    applyWindow(low, high ?? hi)
  }

  const busy = Boolean(loadingMessage)
  const canLoad = serverStatus === 'online' && !busy
  const sliderStep = meta && meta.max - meta.min > 100 ? 1 : 0.01

  return (
    <div className="alignment-workspace fixed inset-0 z-50 flex flex-col">
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200 p-4">
        <div className="mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">CBCT</h1>
            <p className="text-sm text-slate-600 mt-1">Carica una CBCT DICOM da cartella o ZIP e visualizzala in 2D e 3D</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-block px-3 py-1 text-sm font-medium rounded-full ${serverStatus === 'online' ? 'bg-emerald-100 text-emerald-800' : 'bg-yellow-100 text-yellow-800'}`}>
              {serverStatus === 'checking' ? '⏳ Avvio server CBCT...' : serverStatus === 'online' ? '✓ Server CBCT online' : '⚠ Server CBCT offline'}
            </span>
            <button
              onClick={checkServer}
              disabled={serverStatus === 'checking' || busy}
              className="px-3 py-1 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Riprova
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700"
            >
              Chiudi
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex gap-4 p-4">
        <aside className="alignment-card border w-72 shrink-0 overflow-y-auto p-4 flex flex-col gap-5">
          <section>
            <h2 className="text-sm font-semibold text-slate-900 mb-2">Carica CBCT</h2>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => openSource('folder')}
                disabled={!canLoad}
                className="px-3 py-2 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 disabled:bg-slate-300"
              >
                Apri cartella DICOM
              </button>
              <button
                onClick={() => openSource('zip')}
                disabled={!canLoad}
                className="px-3 py-2 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 disabled:bg-slate-300"
              >
                Apri file ZIP
              </button>
            </div>
            <input
              ref={folderInputRef}
              type="file"
              webkitdirectory=""
              multiple
              className="hidden"
              onChange={(e) => loadFromFiles(e.target.files)}
            />
            <input
              ref={zipInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => loadFromFiles(e.target.files)}
            />
            <p className="text-xs text-slate-500 mt-2">I file originali non vengono modificati.</p>
          </section>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
          )}

          {meta && (
            <>
              {meta.reduced && (
                <section>
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-900">Riduci volume</h2>
                    <button
                      role="switch"
                      aria-checked={useReduced}
                      onClick={toggleReduced}
                      disabled={busy}
                      className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${useReduced ? 'bg-sky-600' : 'bg-slate-300'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${useReduced ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {useReduced
                      ? `Visualizzazione a ${meta.reduced.spacing[0]} mm (${meta.reduced.size.join(' × ')}). Il volume completo resta disponibile per le elaborazioni.`
                      : `Volume completo a ${meta.spacing[0]} mm: richiede molta memoria video e può essere lento.`}
                  </p>
                </section>
              )}

              <section>
                <h2 className="text-sm font-semibold text-slate-900 mb-2">Vista</h2>
                <div className="grid grid-cols-2 gap-2">
                  {VIEWS.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => changeView(v.id)}
                      className={`px-2 py-1.5 rounded-lg text-sm border ${view === v.id ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300 text-slate-700 hover:bg-slate-100'}`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h2 className="text-sm font-semibold text-slate-900 mb-2">Contrasto</h2>
                <div className="flex gap-2 mb-3 flex-wrap">
                  {WINDOW_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => applyPreset(preset)}
                      className="px-2 py-1 rounded-lg text-xs border border-slate-300 text-slate-700 hover:bg-slate-100"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                {windowRange && (
                  <div className="flex flex-col gap-2 text-xs text-slate-600">
                    <label className="flex flex-col gap-1">
                      <span>Minimo: {Math.round(windowRange[0])}</span>
                      <input
                        type="range"
                        min={meta.min}
                        max={meta.max}
                        step={sliderStep}
                        value={windowRange[0]}
                        onChange={(e) => applyWindow(Math.min(Number(e.target.value), windowRange[1] - sliderStep), windowRange[1])}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span>Massimo: {Math.round(windowRange[1])}</span>
                      <input
                        type="range"
                        min={meta.min}
                        max={meta.max}
                        step={sliderStep}
                        value={windowRange[1]}
                        onChange={(e) => applyWindow(windowRange[0], Math.max(Number(e.target.value), windowRange[0] + sliderStep))}
                      />
                    </label>
                  </div>
                )}
              </section>

              <section>
                <h2 className="text-sm font-semibold text-slate-900 mb-2">Informazioni volume</h2>
                <dl className="text-xs text-slate-600 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt>Dimensioni</dt><dd>{meta.size.join(' × ')} voxel</dd>
                  <dt>Voxel</dt><dd>{meta.spacing.join(' × ')} mm</dd>
                  <dt>Campo</dt><dd>{meta.physicalSizeMm.join(' × ')} mm</dd>
                  <dt>File</dt><dd>{meta.fileCount}{meta.seriesCount > 1 ? ` (serie più grande di ${meta.seriesCount})` : ''}</dd>
                  {meta.modality && (<><dt>Modalità</dt><dd>{meta.modality}</dd></>)}
                  {meta.manufacturer && (<><dt>Produttore</dt><dd>{meta.manufacturer}{meta.model ? ` ${meta.model}` : ''}</dd></>)}
                  {meta.seriesDescription && (<><dt>Serie</dt><dd>{meta.seriesDescription}</dd></>)}
                </dl>
              </section>
            </>
          )}
        </aside>

        <section className="alignment-card border flex-1 min-w-0 relative overflow-hidden">
          <div className="alignment-viewer-stage absolute inset-0">
            <canvas ref={canvasRef} className="w-full h-full block" />
          </div>
          {!meta && !busy && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 pointer-events-none">
              <div className="text-4xl mb-3" aria-hidden="true">◫</div>
              <h3 className="text-lg font-semibold">Nessuna CBCT aperta</h3>
              <p className="text-sm text-white/60">Apri una cartella DICOM o un file ZIP dal pannello a sinistra.</p>
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
              <div className="px-5 py-3 rounded-lg bg-slate-900/90 text-sm">⏳ {loadingMessage}</div>
            </div>
          )}
          {meta && (
            <div className="absolute bottom-2 left-3 text-xs text-white/70 pointer-events-none">
              Clic per spostare il cursore · Rotella per scorrere le slice · Tasto destro trascinato per il contrasto
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
