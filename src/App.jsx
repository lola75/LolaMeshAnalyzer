import React, { useState, useEffect, useMemo } from 'react'
import FileUploader from './components/FileUploader'
import MeshViewer from './components/MeshViewer'
import MetadataEditor from './components/MetadataEditor'
import Header from './components/Header'
import ITKPage from './components/ITKPage'
import MMXDentalPage from './components/MMXDentalPage'
import SurgeryPage from './components/SurgeryPage'
import CbctPage from './components/CbctPage'
import DicomFilterPage from './components/DicomFilterPage'
import MarkerScanPage from './components/MarkerScanPage'
import MMXSettings from './components/MMXSettings'
import SettingsModal from './components/SettingsModal'
import PasswordPromptModal from './components/PasswordPromptModal'
import SplashScreen from './components/SplashScreen'
import ChatWindow from './components/ChatWindow'
import ScoreBar from './components/ScoreBar'
import MeshModifier from './components/MeshModifier'
import { extractMetadata } from './utils/metadataExtractor'
import MeshColorPicker, { hexFromNumber, numberFromHex } from './components/MeshColorPicker'
import { ChatProvider } from './contexts/ChatContext'

// Colori delle mesh caricate (la prima ha il colore di sempre)
const MESH_COLORS = [0xffaa7f, 0x7faaff, 0x9be37f, 0xd38bff, 0xffd166, 0x5fd3c4, 0xff7fa8, 0xb0b8c4]

function AppContent() {
  // Mesh caricate nel visualizzatore: [{ id, name, geometry, metadata, color }]; la mesh attiva
  // e' quella mostrata nelle analisi e nei metadati. Visibilita' a parte, per non ridisegnare la scena.
  const [loadedMeshes, setLoadedMeshes] = useState([])
  const [activeMeshId, setActiveMeshId] = useState(null)
  const [meshVisibility, setMeshVisibility] = useState({})
  const activeMesh = loadedMeshes.find((m) => m.id === activeMeshId) || null
  const meshData = activeMesh?.geometry || null
  const metadata = activeMesh?.metadata || null
  const [showSplash, setShowSplash] = useState(true)
  const [invertedNormalsLog, setInvertedNormalsLog] = useState([])
  const [uploadHistory, setUploadHistory] = useState([])
  const [dentaxUrl, setDentaxUrl] = useState('https://ai.dentalx.com/eur/#/login')
  const [scannerIntraoralUrl, setScannerIntraoralUrl] = useState('')
  const [scannerFaccialeUrl, setScannerFaccialeUrl] = useState('')
  const [editConsentRequired, setEditConsentRequired] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false)
  const [dentaxNoticeVisible, setDentaxNoticeVisible] = useState(false)
  const [showITK, setShowITK] = useState(false)
  const [showMMX, setShowMMX] = useState(false)
  const [showSurgery, setShowSurgery] = useState(false)
  const [showCbct, setShowCbct] = useState(false)
  const [cbctMenuOpen, setCbctMenuOpen] = useState(false)
  const cbctMenuTimerRef = React.useRef(null)
  // sottomenu CBCT: si apre al passaggio del mouse e si chiude poco dopo che il mouse si allontana
  const openCbctMenu = () => {
    clearTimeout(cbctMenuTimerRef.current)
    setCbctMenuOpen(true)
  }
  const closeCbctMenuSoon = () => {
    clearTimeout(cbctMenuTimerRef.current)
    cbctMenuTimerRef.current = setTimeout(() => setCbctMenuOpen(false), 200)
  }
  const [showDicomFilter, setShowDicomFilter] = useState(false)
  const [showMarkerScan, setShowMarkerScan] = useState(false)
  const [markerScanMeshes, setMarkerScanMeshes] = useState(null) // mesh portate dal Modificatore
  const [markerScanKey, setMarkerScanKey] = useState(0) // nuova pagina quando arrivano mesh nuove
  const [modifierMeshes, setModifierMeshes] = useState(null) // Modificatore aperto da Crea Marker Scan
  const [showMMXSettings, setShowMMXSettings] = useState(false)
  const dentaxTimerRef = React.useRef(null)

  const handleFileLoaded = (data) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    setLoadedMeshes((list) => [
      ...list,
      { id, name: data.fileName, geometry: data.geometry, metadata: data.metadata, color: MESH_COLORS[list.length % MESH_COLORS.length] },
    ])
    setMeshVisibility((v) => ({ ...v, [id]: true }))
    setActiveMeshId(id)
  }

  // colore scelto dall'utente (vale anche sulle mesh con colori propri); il colore di partenza
  // resta per "Colore originale"
  const setMeshColor = (id, hex) => {
    setLoadedMeshes((list) => list.map((m) => (m.id === id
      ? { ...m, color: numberFromHex(hex), forceColor: true, originalColor: m.forceColor ? m.originalColor : m.color }
      : m)))
  }
  const resetMeshColor = (id) => {
    setLoadedMeshes((list) => list.map((m) => (m.id === id ? { ...m, color: m.originalColor ?? m.color, forceColor: false, originalColor: undefined } : m)))
  }

  const removeLoadedMesh = (id) => {
    const next = loadedMeshes.filter((m) => m.id !== id)
    setLoadedMeshes(next)
    if (id === activeMeshId) setActiveMeshId(next.length ? next[next.length - 1].id : null)
  }

  const removeAllLoadedMeshes = () => {
    setLoadedMeshes([])
    setMeshVisibility({})
    setActiveMeshId(null)
  }

  // Modifica Mesh con piu' mesh: la mesh scelta viene sostituita da quella modificata
  const applyMeshEdit = (id, geometry) => {
    setLoadedMeshes((list) => list.map((m) => (m.id === id ? { ...m, geometry } : m)))
    setActiveMeshId(id)
  }

  // Altre mesh nella vista (oltre a quella attiva) e mesh tra cui scegliere per la modifica
  const extraMeshes = useMemo(
    () => loadedMeshes.filter((m) => m.id !== activeMeshId).map((m) => ({ id: m.id, geometry: m.geometry, color: m.color, forceColor: !!m.forceColor })),
    [loadedMeshes, activeMeshId]
  )
  const editableMeshes = useMemo(
    () => loadedMeshes.map((m) => ({ id: m.id, name: m.name, geometry: m.geometry, color: m.color })),
    [loadedMeshes]
  )

  // Registra ogni upload nella cronologia (usata per il punteggio mensile)
  const registerUpload = (data) => {
    const summary = data.analysis?.message || ''
    const bad = !!(data.analysis && (data.analysis.hasIssues || (data.analysis.holeCount && data.analysis.holeCount > 0)))
    setUploadHistory(prev => [
      ...prev,
      {
        timestamp: new Date().toISOString(),
        fileName: data.fileName,
        fileType: data.fileType,
        bad,
        invertedCount: data.analysis?.invertedCount || 0,
        holeCount: data.analysis?.holeCount || 0,
        totalFaces: data.analysis?.totalFaces || 0,
        summary
      }
    ])

    // Se il file presenta problemi (normali invertite o fori), aggiungilo anche al registro delle normali invertite
    try {
      if (bad) {
        setInvertedNormalsLog(prev => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            fileName: data.fileName,
            fileType: data.fileType,
            invertedCount: data.analysis?.invertedCount || 0,
            holeCount: data.analysis?.holeCount || 0,
            totalFaces: data.analysis?.totalFaces || 0,
            summary: data.analysis?.message || 'Problemi rilevati'
          }
        ])
      }
    } catch (err) {
      console.warn('Errore durante l\'integrazione del registro upload:', err)
    }
  }

  const handleMetadataChange = (newMetadata) => {
    setLoadedMeshes((list) => list.map((m) => (m.id === activeMeshId ? { ...m, metadata: newMetadata } : m)))
  }

  const registerInvertedNormals = (entry) => {
    setInvertedNormalsLog(prev => [
      ...prev,
      {
        timestamp: new Date().toISOString(),
        ...entry
      }
    ])
  }

  const exportInvertedLog = () => {
    const entries = uploadHistory.length > 0 ? uploadHistory : invertedNormalsLog
    if (!entries || entries.length === 0) return

    const lines = entries.map((e, i) => {
      const parts = []
      parts.push(`${i + 1}. ${e.timestamp}`)
      parts.push(e.fileName || e.name || 'unknown')
      if (e.fileType || e.type) parts.push(e.fileType || e.type)
      if (typeof e.totalFaces !== 'undefined') parts.push(`faces:${e.totalFaces}`)
      if (typeof e.invertedCount !== 'undefined') parts.push(`inverted:${e.invertedCount}`)
      if (typeof e.holeCount !== 'undefined') parts.push(`holes:${e.holeCount}`)
      if (typeof e.bad !== 'undefined') parts.push(`bad:${e.bad ? 'yes' : 'no'}`)
      parts.push(e.summary || e.message || '')
      return parts.join(' | ')
    })
    const content = [`Registro upload mesh ${new Date().toLocaleString()}`, '', ...lines].join('\n')

    // Se siamo in Electron e l'API è disponibile, usa Save As nativo
    if (window?.electron?.saveInvertedLog) {
      window.electron.saveInvertedLog({ defaultPath: 'mesh-upload-register.txt', content })
        .then(res => {
          if (!res || !res.success) {
            // fallback browser download
            const blob = new Blob([content], { type: 'text/plain' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'mesh-upload-register.txt'
            a.click()
            URL.revokeObjectURL(url)
          }
        })
        .catch(() => {
          const blob = new Blob([content], { type: 'text/plain' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = 'inverted-normals-log.txt'
          a.click()
          URL.revokeObjectURL(url)
        })
      return
    }

    // Fallback browser download
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mesh-upload-register.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  const clearInvertedLog = () => {
    if (!confirm('Sicuro di voler svuotare il registro delle normali invertite?')) return
    setInvertedNormalsLog([])
  }

  const openExternalUrl = async (url) => {
    if (!url) return
    if (window?.electron?.openExternal) {
      try {
        await window.electron.openExternal({ url })
        return
      } catch (err) {
        console.warn('openExternal fallito, fallback a window.open', err)
      }
    }
    window.open(url, '_blank', 'noopener')
  }

  const openDentax = async (url) => openExternalUrl(url || dentaxUrl)
  const openScannerIntraorale = async () => openExternalUrl(scannerIntraoralUrl)
  const openScannerFacciale = async () => openExternalUrl(scannerFaccialeUrl)

  const handleDentaxClick = (url) => {
    // Mostra il messaggio per 3 secondi, poi apre il link
    if (dentaxTimerRef.current) {
      clearTimeout(dentaxTimerRef.current)
      dentaxTimerRef.current = null
    }
    setDentaxNoticeVisible(true)
    dentaxTimerRef.current = setTimeout(() => {
      setDentaxNoticeVisible(false)
      openDentax(url)
      dentaxTimerRef.current = null
    }, 3000)
  }

  const cancelDentax = () => {
    if (dentaxTimerRef.current) {
      clearTimeout(dentaxTimerRef.current)
      dentaxTimerRef.current = null
    }
    setDentaxNoticeVisible(false)
  }

  const openSettings = () => setShowPasswordPrompt(true)

  const confirmDentaxPassword = (password) => {
    const ACCESS_PASSWORD = 'Lola'
    if (password === ACCESS_PASSWORD) {
      setShowPasswordPrompt(false)
      setShowSettings(true)
      return true
    }
    return false
  }

  const saveDentaxUrl = (value) => {
    try {
      localStorage.setItem('dentaxUrl', value)
    } catch (err) {
      console.warn('Impossibile salvare dentaxUrl:', err)
    }
    setDentaxUrl(value)
  }

  const saveSettings = ({ dentaxUrl: url, scannerIntraoralUrl: intraoralUrl, scannerFaccialeUrl: faccialeUrl, editConsentRequired: consentRequired }) => {
    saveDentaxUrl(url)
    try {
      localStorage.setItem('scannerIntraoralUrl', intraoralUrl || '')
      localStorage.setItem('scannerFaccialeUrl', faccialeUrl || '')
      localStorage.setItem('editConsentRequired', JSON.stringify(!!consentRequired))
    } catch (err) {
      console.warn('Impossibile salvare impostazioni scanner o editConsentRequired:', err)
    }
    setScannerIntraoralUrl(intraoralUrl || '')
    setScannerFaccialeUrl(faccialeUrl || '')
    setEditConsentRequired(!!consentRequired)
  }

  // Persistenza del registro in localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('invertedNormalsLog')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setInvertedNormalsLog(parsed)
        }
      }
      const d = localStorage.getItem('dentaxUrl')
      const intraoral = localStorage.getItem('scannerIntraoralUrl')
      const facciale = localStorage.getItem('scannerFaccialeUrl')
      const uh = localStorage.getItem('uploadHistory')
      if (uh) {
        const parsedUh = JSON.parse(uh)
        if (Array.isArray(parsedUh) && parsedUh.length > 0) setUploadHistory(parsedUh)
      }
      if (d) setDentaxUrl(d)
      if (intraoral !== null) setScannerIntraoralUrl(intraoral)
      if (facciale !== null) setScannerFaccialeUrl(facciale)
      const consentStored = localStorage.getItem('editConsentRequired')
      if (consentStored !== null) {
        setEditConsentRequired(JSON.parse(consentStored))
      }
    } catch (err) {
      console.warn('Impossibile leggere invertedNormalsLog da localStorage:', err)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('invertedNormalsLog', JSON.stringify(invertedNormalsLog))
    } catch (err) {
      console.warn('Impossibile salvare invertedNormalsLog in localStorage:', err)
    }
  }, [invertedNormalsLog])

  useEffect(() => {
    try {
      localStorage.setItem('uploadHistory', JSON.stringify(uploadHistory))
    } catch (err) {
      console.warn('Impossibile salvare uploadHistory in localStorage:', err)
    }
  }, [uploadHistory])

  return (
    <div className="min-h-screen bg-transparent flex flex-col">
      {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
      <Header
        invertedCount={invertedNormalsLog.length}
        onExportInvertedLog={exportInvertedLog}
        onClearInvertedLog={clearInvertedLog}
        dentaxUrl={dentaxUrl}
        onOpenDentax={handleDentaxClick}
        onConfigureDentax={openSettings}
        onOpenMMXSettings={() => setShowMMXSettings(true)}
      />
      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        dentaxUrl={dentaxUrl}
        scannerIntraoralUrl={scannerIntraoralUrl}
        scannerFaccialeUrl={scannerFaccialeUrl}
        editConsentRequired={editConsentRequired}
        onSave={saveSettings}
      />
      <PasswordPromptModal
        open={showPasswordPrompt}
        onClose={() => setShowPasswordPrompt(false)}
        onConfirm={confirmDentaxPassword}
      />
      {dentaxNoticeVisible && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pointer-events-none">
          <div className="mb-8 md:mb-0 bg-yellow-500 text-slate-900 px-6 py-4 rounded-lg shadow-lg pointer-events-auto flex items-center gap-4">
            <div>Stai accedendo ad uno spazio web con app create dal Dott. David Cao e lo staff DENTALX</div>
            <button
              onClick={cancelDentax}
              className="ml-2 bg-slate-900/80 text-white px-3 py-1 rounded text-sm"
            >
              Annulla
            </button>
          </div>
        </div>
      )}
      <main className="workspace-shell">
        <div className="workspace-grid">
          <aside className="workspace-panel workspace-tools">
            <div className="workspace-section-heading">
              <span className="workspace-eyebrow">LIBRERIA</span>
              <h2>File mesh</h2>
            </div>
            <FileUploader
              multiple
              onFileLoaded={(data) => { handleFileLoaded(data); registerUpload(data); }}
              onInvertedDetected={registerInvertedNormals}
              showFormatInfo={false}
            />
            {loadedMeshes.length > 0 && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-slate-700">Mesh caricate ({loadedMeshes.length})</span>
                  {loadedMeshes.length > 1 && (
                    <button onClick={removeAllLoadedMeshes} className="text-[11px] text-slate-500 hover:text-red-600">
                      Rimuovi tutte
                    </button>
                  )}
                </div>
                <ul className="flex flex-col gap-1">
                  {loadedMeshes.map((m) => {
                    const active = m.id === activeMeshId
                    const visible = meshVisibility[m.id] !== false
                    return (
                      <li
                        key={m.id}
                        onClick={() => setActiveMeshId(m.id)}
                        title={active ? 'Mesh attiva (analisi e metadati)' : 'Clic per renderla la mesh attiva'}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border cursor-pointer text-xs ${active ? 'border-sky-500 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'}`}
                      >
                        <input
                          type="checkbox"
                          checked={visible}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => setMeshVisibility((v) => ({ ...v, [m.id]: !visible }))}
                          title={visible ? 'Nascondi' : 'Mostra'}
                          className="w-3.5 h-3.5 accent-sky-600"
                        />
                        <MeshColorPicker
                          value={hexFromNumber(m.color)}
                          onChange={(hex) => setMeshColor(m.id, hex)}
                          onReset={m.forceColor ? () => resetMeshColor(m.id) : null}
                          originalColor={m.forceColor ? hexFromNumber(m.originalColor) : null}
                          label={`Colore di ${m.name}`}
                          className="h-3.5 w-3.5"
                        />
                        <span className={`flex-1 truncate ${visible ? 'text-slate-800' : 'text-slate-400'}`}>{m.name}</span>
                        {active && <span className="text-[10px] font-semibold text-sky-700">attiva</span>}
                        <button
                          onClick={(e) => { e.stopPropagation(); removeLoadedMesh(m.id) }}
                          title="Rimuovi dalla vista"
                          aria-label={`Rimuovi ${m.name}`}
                          className="w-5 h-5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                        >
                          ×
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            <div className="workspace-divider" />
            <div className="workspace-section-heading">
              <span className="workspace-eyebrow">WORKSPACE</span>
              <h2>Strumenti</h2>
            </div>
            <nav className="workspace-action-list" aria-label="Strumenti mesh">
              <button className="workspace-action" onClick={() => setShowITK(true)}>
                <span className="workspace-action-icon" aria-hidden="true">↔</span>
                <span>Allineamento automatico</span>
              </button>
              <div onMouseEnter={openCbctMenu} onMouseLeave={closeCbctMenuSoon}>
              <button
                className="workspace-action"
                onClick={() => setCbctMenuOpen((open) => !open)}
                aria-expanded={cbctMenuOpen}
              >
                <span className="workspace-action-icon" aria-hidden="true">◫</span>
                <span className="flex-1">CBCT</span>
                <span className="workspace-action-chevron" aria-hidden="true">{cbctMenuOpen ? '▾' : '▸'}</span>
              </button>
              {cbctMenuOpen && (
                <div className="workspace-submenu" role="group" aria-label="CBCT">
                  <button className="workspace-subaction" onClick={() => setShowCbct(true)}>
                    Apri CBCT
                  </button>
                  <button className="workspace-subaction" onClick={() => setShowDicomFilter(true)}>
                    Filtra immagini DICOM
                  </button>
                  <button className="workspace-subaction" onClick={() => { setMarkerScanMeshes(null); setShowMarkerScan(true) }}>
                    Crea Marker Scan
                  </button>
                </div>
              )}
              </div>
              <button className="workspace-action" onClick={() => setShowMMX(true)}>
                <span className="workspace-action-icon" aria-hidden="true">◈</span>
                <span>MMX Dental</span>
              </button>
              <button className="workspace-action" onClick={() => setShowSurgery(true)}>
                <span className="workspace-action-icon" aria-hidden="true">⌖</span>
                <span>Chirurgia guidata</span>
              </button>
              <button
                className="workspace-action"
                onClick={openScannerIntraorale}
                title={scannerIntraoralUrl || 'Configura URL Scanner Intraorale'}
              >
                <span className="workspace-action-icon" aria-hidden="true">◎</span>
                <span>Scanner intraorale</span>
              </button>
              <button
                className="workspace-action"
                onClick={openScannerFacciale}
                title={scannerFaccialeUrl || 'Configura URL Scanner facciale'}
              >
                <span className="workspace-action-icon" aria-hidden="true">◎</span>
                <span>Scanner facciale</span>
              </button>
              <button className="workspace-action" onClick={() => setShowMMXSettings(true)}>
                <span className="workspace-action-icon" aria-hidden="true">⚙</span>
                <span>Impostazioni MMX</span>
              </button>
            </nav>

            <div className="workspace-score">
              <ScoreBar uploadHistory={uploadHistory} />
            </div>
          </aside>

          <section className="workspace-panel workspace-viewer" aria-label="Visualizzatore 3D">
            <div className="workspace-viewer-heading">
              <div>
                <span className="workspace-eyebrow">ANALISI</span>
                <h2>{loadedMeshes.length > 1 ? `${loadedMeshes.length} mesh · attiva: ${metadata?.fileName || activeMesh?.name}` : metadata?.fileName || 'Visualizzatore 3D'}</h2>
              </div>
              {metadata?.fileType && (
                <span className="workspace-file-type">{metadata.fileType.toUpperCase()}</span>
              )}
            </div>
            {meshData ? (
              <MeshViewer
                geometry={meshData}
                requireEditConsent={editConsentRequired}
                primaryColor={activeMesh.color}
                primaryForceColor={!!activeMesh.forceColor}
                primaryVisible={meshVisibility[activeMeshId] !== false}
                extraMeshes={extraMeshes}
                extraVisible={meshVisibility}
                editableMeshes={editableMeshes}
                editTargetId={activeMeshId}
                onApplyEdit={applyMeshEdit}
                onOpenMarkerScan={(list) => {
                  setMarkerScanMeshes(list)
                  setMarkerScanKey((k) => k + 1)
                  setShowMarkerScan(true)
                }}
              />
            ) : (
              <div className="workspace-empty-viewer">
                <div className="workspace-empty-icon" aria-hidden="true">◇</div>
                <h3>Nessuna mesh aperta</h3>
                <p>Carica un file STL, OBJ o PLY dal pannello a sinistra per iniziare l’analisi.</p>
              </div>
            )}
            <div className="workspace-viewer-footer">
              {meshData
                ? 'Trascina per ruotare · Rotella per ingrandire · Tasto destro per spostare'
                : 'I file vengono elaborati localmente nell’applicazione'}
            </div>
          </section>

          <aside className="workspace-panel workspace-details">
            <div className="workspace-section-heading">
              <span className="workspace-eyebrow">DETTAGLI</span>
              <h2>Informazioni mesh</h2>
            </div>
            {metadata ? (
              <MetadataEditor metadata={metadata} onChange={handleMetadataChange} />
            ) : (
              <div className="workspace-empty-details">
                <span aria-hidden="true">⌑</span>
                <p>I dati del file appariranno qui dopo il caricamento.</p>
              </div>
            )}
          </aside>
        </div>
      </main>

      {showITK && <ITKPage onClose={() => setShowITK(false)} initialServerId="server1" autoStartServer1 />}
      {showMMX && <MMXDentalPage onClose={() => setShowMMX(false)} />}
      {showSurgery && <SurgeryPage onClose={() => setShowSurgery(false)} />}
      {showCbct && <CbctPage onClose={() => setShowCbct(false)} />}
      {showDicomFilter && <DicomFilterPage onClose={() => setShowDicomFilter(false)} />}
      {showMarkerScan && (
        <MarkerScanPage
          key={markerScanKey}
          initialMeshes={markerScanMeshes}
          onOpenModifier={setModifierMeshes}
          onClose={() => {
            setShowMarkerScan(false)
            setMarkerScanMeshes(null)
          }}
        />
      )}

      {/* Modificatore aperto da Crea Marker Scan: sopra la pagina, che resta com'era sotto.
          Applica modifiche aggiunge la mesh alla pagina principale (ed eventualmente la salva su
          file); il pulsante "Crea Marker Scan" riporta le mesh modificate in Crea Marker Scan. */}
      {modifierMeshes && (
        <div className="fixed inset-0 z-[60]">
          <MeshModifier
            geometry={null}
            initialMeshes={modifierMeshes}
            requireEditConsent={false}
            onClose={() => setModifierMeshes(null)}
            onApply={(geometry) => {
              const fileName = 'Marker Scan modificato.stl'
              handleFileLoaded({ fileName, geometry, metadata: extractMetadata(geometry, { name: fileName, size: 0 }, 'stl') })
              setModifierMeshes(null)
            }}
            onOpenMarkerScan={(list) => {
              setMarkerScanMeshes(list)
              setMarkerScanKey((k) => k + 1)
              setShowMarkerScan(true)
              setModifierMeshes(null)
            }}
          />
        </div>
      )}
      <MMXSettings isOpen={showMMXSettings} onClose={() => setShowMMXSettings(false)} />

      <ChatWindow />
    </div>
  )
}

export default function App() {
  return (
    <ChatProvider>
      <AppContent />
    </ChatProvider>
  )
}
