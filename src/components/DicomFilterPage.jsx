import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiUrl, checkServerHealth } from '../utils/meshLibBackend'
import { readErrorDetail, newProgressId, postFormWithProgress } from '../utils/cbctHttp'
import CbctLoadingProgress from './CbctLoadingProgress'

// "Filtra immagini DICOM" (Strumenti > CBCT): carica una cartella CBCT o uno ZIP, mostra tutti i
// gruppi di immagini (volume assiale, scout, ricostruzioni MPR...) e salva quelli scelti copiando
// i file DICOM originali senza modificarli (server CBCT, dicom_browser.py).

const SERVER_URL = 'http://127.0.0.1:8002'

const KIND_STYLES = {
  volume: { badge: 'bg-sky-600 text-white', ring: 'ring-sky-400', dot: 'bg-sky-500' },
  scout: { badge: 'bg-amber-500 text-white', ring: 'ring-amber-400', dot: 'bg-amber-500' },
  mpr: { badge: 'bg-violet-600 text-white', ring: 'ring-violet-400', dot: 'bg-violet-500' },
  single: { badge: 'bg-emerald-600 text-white', ring: 'ring-emerald-400', dot: 'bg-emerald-500' },
  other: { badge: 'bg-slate-600 text-white', ring: 'ring-slate-400', dot: 'bg-slate-500' },
}

const formatBytes = (bytes) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const formatDate = (date, time) => {
  if (!/^\d{8}$/.test(date || '')) return ''
  const d = `${date.slice(6, 8)}/${date.slice(4, 6)}/${date.slice(0, 4)}`
  return /^\d{4}/.test(time || '') ? `${d} ${time.slice(0, 2)}:${time.slice(2, 4)}` : d
}

const imageUrl = (sid, series, frame, thumb) =>
  apiUrl(SERVER_URL, `/dicom/${sid}/series/${series}/image/${frame}.png${thumb ? '?thumb=true' : ''}`)

export default function DicomFilterPage({ onClose }) {
  const isDesktop = typeof window.electron?.selectCbctSource === 'function'
  const canChooseFolder = typeof window.electron?.selectFolder === 'function'
  const [serverStatus, setServerStatus] = useState('checking')
  const [data, setData] = useState(null) // { id, source, series, skippedFiles }
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(() => new Set())
  const [viewer, setViewer] = useState(null) // { index, frame }
  const [loading, setLoading] = useState(null) // { message, progress }
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const folderInputRef = useRef(null)
  const zipInputRef = useRef(null)
  const sessionRef = useRef(null)

  const checkServer = useCallback(async () => {
    setServerStatus('checking')
    try {
      if (typeof window.electron?.startCbctServer === 'function') {
        const result = await window.electron.startCbctServer()
        if (!result?.success) throw new Error(result?.error || 'Avvio del server CBCT non riuscito.')
      }
      const online = await checkServerHealth(SERVER_URL)
      setServerStatus(online ? 'online' : 'offline')
      if (!online && !isDesktop) setError('Server CBCT offline. Avvialo con "mio server\\run_cbct_server.bat".')
    } catch (err) {
      setServerStatus('offline')
      setError(err.message)
    }
  }, [isDesktop])

  useEffect(() => {
    checkServer()
    // alla chiusura della pagina il server libera i file temporanei
    return () => {
      if (sessionRef.current) fetch(apiUrl(SERVER_URL, `/dicom/${sessionRef.current}`), { method: 'DELETE' }).catch(() => {})
    }
  }, [checkServer])

  const pollProgress = (progressId, from, to) => {
    let stopped = false
    const tick = async () => {
      if (stopped) return
      try {
        const status = await (await fetch(apiUrl(SERVER_URL, `/cbct/progress/${progressId}`))).json()
        if (!stopped && typeof status?.value === 'number') {
          setLoading((l) => l && { message: status.message || l.message, progress: Math.max(l.progress ?? 0, from + ((to - from) * status.value) / 100) })
        }
      } catch {
        // riprova al prossimo giro
      }
      if (!stopped) setTimeout(tick, 250)
    }
    setTimeout(tick, 150)
    return () => { stopped = true }
  }

  const finishLoad = async (response) => {
    if (!response.ok) throw new Error(await readErrorDetail(response))
    const result = await response.json()
    if (sessionRef.current && sessionRef.current !== result.id) {
      fetch(apiUrl(SERVER_URL, `/dicom/${sessionRef.current}`), { method: 'DELETE' }).catch(() => {})
    }
    sessionRef.current = result.id
    setData(result)
    setSelected(new Set())
    setFilter('all')
    setNotice(null)
  }

  const runLoad = async (request, uploadShare = 0) => {
    setError(null)
    setNotice(null)
    setLoading({ message: uploadShare ? 'Invio dei file...' : 'Lettura della cartella...', progress: 0 })
    const progressId = newProgressId()
    const stop = pollProgress(progressId, uploadShare, 100)
    try {
      await finishLoad(await request(progressId))
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'Server CBCT non raggiungibile: premi "Riprova".' : err.message)
    } finally {
      stop()
      setLoading(null)
    }
  }

  const openSource = async (kind) => {
    if (isDesktop) {
      const result = await window.electron.selectCbctSource({ kind })
      if (result?.canceled || !result?.path) return
      runLoad((progressId) => fetch(apiUrl(SERVER_URL, '/dicom/scan-path'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: result.path, progressId }),
      }))
      return
    }
    const input = kind === 'zip' ? zipInputRef.current : folderInputRef.current
    input.value = ''
    input.click()
  }

  const uploadFiles = (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    runLoad((progressId) => {
      const form = new FormData()
      files.forEach((file) => form.append('files', file, file.name))
      return postFormWithProgress(apiUrl(SERVER_URL, `/dicom/scan-upload?progressId=${encodeURIComponent(progressId)}`), form, (fraction) => {
        setLoading((l) => l && { message: fraction >= 1 ? 'Lettura delle intestazioni DICOM...' : 'Invio dei file...', progress: Math.max(l.progress ?? 0, 20 * fraction) })
      })
    }, 20)
  }

  const series = data?.series || []
  const counts = useMemo(() => series.reduce((acc, s) => ({ ...acc, [s.kind]: (acc[s.kind] || 0) + 1 }), {}), [series])
  const visible = filter === 'all' ? series : series.filter((s) => s.kind === filter)
  const chosen = series.filter((s) => selected.has(s.index))
  const chosenImages = chosen.reduce((sum, s) => sum + s.images, 0)
  const chosenBytes = chosen.reduce((sum, s) => sum + s.bytes, 0)

  const toggle = (index) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    return next
  })

  const exportToFolder = async () => {
    const choice = await window.electron.selectFolder({ title: 'Cartella in cui salvare le serie DICOM' })
    if (choice?.canceled || !choice?.path) return
    setError(null)
    setNotice(null)
    setLoading({ message: 'Copia dei file DICOM...', progress: 0 })
    const progressId = newProgressId()
    const stop = pollProgress(progressId, 0, 100)
    try {
      const response = await fetch(apiUrl(SERVER_URL, `/dicom/${data.id}/export?progressId=${encodeURIComponent(progressId)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ series: [...selected], destination: choice.path }),
      })
      if (!response.ok) throw new Error(await readErrorDetail(response))
      const result = await response.json()
      setNotice(`Salvati ${result.files} file DICOM originali in ${result.folders.length} ${result.folders.length === 1 ? 'cartella' : 'cartelle'} dentro ${choice.path}.`)
    } catch (err) {
      setError(err.message)
    } finally {
      stop()
      setLoading(null)
    }
  }

  const exportZip = async () => {
    setError(null)
    setNotice(null)
    setLoading({ message: 'Preparazione dello ZIP...', progress: null })
    try {
      const response = await fetch(apiUrl(SERVER_URL, `/dicom/${data.id}/export.zip?series=${[...selected].join(',')}`))
      if (!response.ok) throw new Error(await readErrorDetail(response))
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'serie_dicom.zip'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      setNotice(`ZIP creato con ${chosen.length} ${chosen.length === 1 ? 'serie' : 'serie'} (file DICOM originali, non modificati).`)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(null)
    }
  }

  const canLoad = serverStatus === 'online' && !loading

  return (
    <div className="alignment-workspace fixed inset-0 z-50 flex flex-col">
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200 p-4">
        <div className="mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Filtra immagini DICOM</h1>
            <p className="text-sm text-slate-600 mt-1">Esplora tutti i gruppi di immagini di una CBCT e salva quelli che ti servono, con i file originali intatti</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-block px-3 py-1 text-sm font-medium rounded-full ${serverStatus === 'online' ? 'bg-emerald-100 text-emerald-800' : 'bg-yellow-100 text-yellow-800'}`}>
              {serverStatus === 'checking' ? '⏳ Avvio server CBCT...' : serverStatus === 'online' ? '✓ Server CBCT online' : '⚠ Server CBCT offline'}
            </span>
            <button
              onClick={checkServer}
              disabled={serverStatus === 'checking' || Boolean(loading)}
              className="px-3 py-1 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Riprova
            </button>
            <button onClick={onClose} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700">Chiudi</button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex gap-4 p-4">
        {/* Pannello di sinistra: caricamento e filtri */}
        <aside className="alignment-card border w-72 shrink-0 flex flex-col min-h-0 overflow-y-auto p-4 gap-5">
          <section>
            <h2 className="text-sm font-semibold text-slate-900 mb-2">Carica CBCT</h2>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => openSource('folder')} disabled={!canLoad} className="px-3 py-2 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 disabled:bg-slate-300">Cartella DICOM</button>
              <button onClick={() => openSource('zip')} disabled={!canLoad} className="px-3 py-2 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 disabled:bg-slate-300">File ZIP</button>
            </div>
            <input ref={folderInputRef} type="file" webkitdirectory="" multiple className="hidden" onChange={(e) => uploadFiles(e.target.files)} />
            <input ref={zipInputRef} type="file" accept=".zip" className="hidden" onChange={(e) => uploadFiles(e.target.files)} />
            <p className="text-xs text-slate-500 mt-2">Vengono letti tutti i file. Gli originali non vengono mai modificati.</p>
          </section>

          {data && (
            <section className="rounded-xl bg-gradient-to-br from-sky-50 to-indigo-50 border border-sky-100 p-3">
              <div className="text-xs text-slate-500 truncate" title={data.source}>{data.source}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-900 tabular-nums">{series.length}</span>
                <span className="text-sm text-slate-600">{series.length === 1 ? 'gruppo' : 'gruppi'} di immagini</span>
              </div>
              <div className="text-xs text-slate-600 tabular-nums">
                {series.reduce((sum, s) => sum + s.images, 0).toLocaleString('it-IT')} immagini · {formatBytes(series.reduce((sum, s) => sum + s.bytes, 0))}
              </div>
              {data.skippedFiles > 0 && <div className="text-[11px] text-slate-500 mt-1">{data.skippedFiles} file non DICOM ignorati</div>}
            </section>
          )}

          {data && (
            <section>
              <h2 className="text-sm font-semibold text-slate-900 mb-2">Mostra</h2>
              <div className="flex flex-col gap-1">
                {[['all', 'Tutti i gruppi', series.length], ...Object.entries(counts).map(([kind, n]) => [kind, series.find((s) => s.kind === kind)?.kindLabel, n])].map(([kind, label, n]) => (
                  <button
                    key={kind}
                    onClick={() => setFilter(kind)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${filter === kind ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${kind === 'all' ? 'bg-gradient-to-br from-sky-400 to-violet-500' : KIND_STYLES[kind].dot}`} />
                    <span className="flex-1">{label}</span>
                    <span className={`text-xs tabular-nums ${filter === kind ? 'text-white/70' : 'text-slate-400'}`}>{n}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
          {notice && !error && <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">{notice}</div>}
        </aside>

        {/* Gruppi di immagini */}
        <section className="relative flex-1 min-w-0 flex flex-col rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 overflow-hidden">
          {!data ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-white/70 p-8">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-sky-500/30 to-violet-500/30 border border-white/10 flex items-center justify-center text-4xl mb-4">◫</div>
              <h3 className="text-lg font-semibold text-white">Nessuna CBCT caricata</h3>
              <p className="text-sm max-w-sm mt-1">Apri una cartella DICOM o un file ZIP: compariranno tutti i gruppi di immagini (volume assiale, scout, ricostruzioni MPR...).</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
                <h3 className="text-sm font-semibold text-white">{visible.length} {visible.length === 1 ? 'gruppo' : 'gruppi'}</h3>
                <div className="flex gap-2">
                  <button onClick={() => setSelected(new Set(visible.map((s) => s.index)))} className="px-3 py-1 rounded-lg text-xs text-white/80 border border-white/15 hover:bg-white/10">Seleziona tutti</button>
                  <button onClick={() => setSelected(new Set())} disabled={!selected.size} className="px-3 py-1 rounded-lg text-xs text-white/80 border border-white/15 hover:bg-white/10 disabled:opacity-40">Nessuno</button>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-28">
                <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
                  {visible.map((s) => {
                    const style = KIND_STYLES[s.kind]
                    const isSelected = selected.has(s.index)
                    return (
                      <article
                        key={s.index}
                        className={`group relative rounded-xl overflow-hidden bg-slate-800/60 border transition-all cursor-pointer hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/40 ${isSelected ? `border-transparent ring-2 ${style.ring}` : 'border-white/10 hover:border-white/25'}`}
                        onClick={() => setViewer({ index: s.index, frame: Math.floor(s.images / 2) })}
                      >
                        <div className="relative aspect-square bg-black flex items-center justify-center">
                          <img
                            src={imageUrl(data.id, s.index, Math.floor(s.images / 2), true)}
                            alt={`Anteprima ${s.description}`}
                            loading="lazy"
                            className="max-w-full max-h-full object-contain transition-transform duration-300 group-hover:scale-105"
                          />
                          <span className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-[11px] font-semibold shadow ${style.badge}`}>{s.kindLabel}</span>
                          <label
                            className="absolute top-2 left-2 w-7 h-7 rounded-lg bg-black/60 backdrop-blur flex items-center justify-center cursor-pointer"
                            onClick={(e) => e.stopPropagation()}
                            title="Seleziona per il salvataggio"
                          >
                            <input type="checkbox" className="w-4 h-4 accent-sky-500" checked={isSelected} onChange={() => toggle(s.index)} />
                          </label>
                          <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-[11px] text-white tabular-nums">{s.images} {s.images === 1 ? 'immagine' : 'immagini'}</span>
                        </div>
                        <div className="p-3">
                          <div className="flex items-baseline gap-2">
                            <span className="text-[11px] text-white/40 tabular-nums">#{s.number || '–'}</span>
                            <h4 className="text-sm font-semibold text-white truncate" title={s.description}>{s.description}</h4>
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1 text-[11px] text-white/60">
                            <span className="px-1.5 py-0.5 rounded bg-white/5">{s.orientation}</span>
                            <span className="px-1.5 py-0.5 rounded bg-white/5 tabular-nums">{s.columns}×{s.rows}</span>
                            {s.pixelSpacing.length > 0 && <span className="px-1.5 py-0.5 rounded bg-white/5 tabular-nums">{s.pixelSpacing[0]} mm</span>}
                            <span className="px-1.5 py-0.5 rounded bg-white/5">{s.modality}</span>
                            <span className="px-1.5 py-0.5 rounded bg-white/5 tabular-nums">{formatBytes(s.bytes)}</span>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </div>

              {/* Barra di salvataggio */}
              {selected.size > 0 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[min(720px,calc(100%-2rem))] flex items-center gap-4 px-5 py-3 rounded-2xl bg-white/95 backdrop-blur border border-slate-200 shadow-2xl">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900">{chosen.length} {chosen.length === 1 ? 'gruppo selezionato' : 'gruppi selezionati'}</div>
                    <div className="text-xs text-slate-500 tabular-nums">{chosenImages.toLocaleString('it-IT')} immagini · {formatBytes(chosenBytes)} · file DICOM originali</div>
                  </div>
                  {canChooseFolder && (
                    <button onClick={exportToFolder} disabled={Boolean(loading)} className="px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:bg-slate-300">Salva in cartella</button>
                  )}
                  <button onClick={exportZip} disabled={Boolean(loading)} className={`px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 ${canChooseFolder ? 'border border-slate-300 text-slate-700 hover:bg-slate-100' : 'bg-sky-600 text-white hover:bg-sky-700'}`}>Scarica ZIP</button>
                </div>
              )}
            </>
          )}
          {loading && <CbctLoadingProgress message={loading.message} progress={loading.progress} />}
        </section>
      </div>

      {viewer && data && (
        <SeriesViewer
          sid={data.id}
          series={series[viewer.index]}
          frame={viewer.frame}
          selected={selected.has(viewer.index)}
          onFrame={(frame) => setViewer((v) => ({ ...v, frame }))}
          onToggle={() => toggle(viewer.index)}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  )
}

// Visualizzatore di un gruppo: scorrimento delle immagini con cursore, rotella e frecce
function SeriesViewer({ sid, series, frame, selected, onFrame, onToggle, onClose }) {
  const last = series.images - 1
  const clamp = (value) => Math.min(last, Math.max(0, value))
  const style = KIND_STYLES[series.kind]

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') onFrame(clamp(frame + 1))
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') onFrame(clamp(frame - 1))
      else if (event.key === 'Home') onFrame(0)
      else if (event.key === 'End') onFrame(last)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // immagini vicine caricate in anticipo: lo scorrimento resta fluido
  useEffect(() => {
    for (const f of [frame + 1, frame + 2, frame - 1]) {
      if (f >= 0 && f <= last) new Image().src = imageUrl(sid, series.index, f, false)
    }
  }, [sid, series.index, frame, last])

  const details = [
    ['Tipo', series.kindLabel],
    ['Descrizione', series.description],
    ['Serie n.', series.number || '–'],
    ['Modalità', series.modality],
    ['Orientamento', series.orientation],
    ['Immagini', `${series.images}${series.files !== series.images ? ` (${series.files} file)` : ''}`],
    ['Dimensione', `${series.columns} × ${series.rows} px`],
    ['Pixel', series.pixelSpacing.length ? `${series.pixelSpacing.join(' × ')} mm` : '–'],
    ['Spessore', series.thickness ? `${series.thickness} mm` : '–'],
    ['Passo tra immagini', series.sliceStep ? `${series.sliceStep} mm` : '–'],
    ['Image Type', series.imageType || '–'],
    ['Data', formatDate(series.date, series.time) || '–'],
    ['Produttore', series.manufacturer || '–'],
    ['Peso', formatBytes(series.bytes)],
  ]

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-6" onClick={onClose}>
      <div className="w-full max-w-6xl h-full max-h-[880px] flex rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex-1 min-w-0 flex flex-col">
          <div
            className="relative flex-1 min-h-0 bg-black flex items-center justify-center"
            onWheel={(e) => onFrame(clamp(frame + (e.deltaY > 0 ? 1 : -1)))}
          >
            <img src={imageUrl(sid, series.index, frame, false)} alt={`Immagine ${frame + 1}`} className="max-w-full max-h-full object-contain select-none" draggable={false} />
            <span className={`absolute top-3 left-3 px-2.5 py-1 rounded-full text-xs font-semibold ${style.badge}`}>{series.kindLabel}</span>
            <span className="absolute top-3 right-3 px-2.5 py-1 rounded-md bg-black/60 text-xs text-white tabular-nums">{frame + 1} / {series.images}</span>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 border-t border-white/10">
            <button onClick={() => onFrame(clamp(frame - 1))} disabled={frame === 0} className="w-8 h-8 rounded-lg text-white/80 border border-white/15 hover:bg-white/10 disabled:opacity-30" aria-label="Immagine precedente">‹</button>
            <input type="range" min={0} max={last} value={frame} onChange={(e) => onFrame(Number(e.target.value))} disabled={last === 0} className="flex-1 accent-sky-500" aria-label="Scorri le immagini" />
            <button onClick={() => onFrame(clamp(frame + 1))} disabled={frame === last} className="w-8 h-8 rounded-lg text-white/80 border border-white/15 hover:bg-white/10 disabled:opacity-30" aria-label="Immagine successiva">›</button>
          </div>
        </div>
        <aside className="w-72 shrink-0 flex flex-col border-l border-white/10 bg-slate-900/90">
          <div className="flex items-start justify-between gap-2 p-4 border-b border-white/10">
            <h3 className="text-base font-semibold text-white leading-snug">{series.description}</h3>
            <button onClick={onClose} className="w-7 h-7 shrink-0 rounded-md text-white/60 hover:text-white hover:bg-white/10" aria-label="Chiudi">×</button>
          </div>
          <dl className="flex-1 overflow-y-auto p-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
            {details.map(([label, value]) => (
              <React.Fragment key={label}>
                <dt className="text-white/40">{label}</dt>
                <dd className="text-white/85 break-words">{value}</dd>
              </React.Fragment>
            ))}
          </dl>
          <div className="p-4 border-t border-white/10">
            <button
              onClick={onToggle}
              className={`w-full px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${selected ? 'bg-sky-600 text-white hover:bg-sky-700' : 'border border-white/20 text-white hover:bg-white/10'}`}
            >
              {selected ? '✓ Selezionato per il salvataggio' : 'Seleziona per il salvataggio'}
            </button>
            <p className="text-[11px] text-white/40 mt-2">Rotella, frecce o cursore per scorrere le immagini. Esc per chiudere.</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
