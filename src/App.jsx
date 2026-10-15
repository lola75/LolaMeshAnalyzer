import React, { useState, useEffect } from 'react'
import FileUploader from './components/FileUploader'
import MeshViewer from './components/MeshViewer'
import MetadataEditor from './components/MetadataEditor'
import Header from './components/Header'
import ITKPage from './components/ITKPage'
import MMXDentalPage from './components/MMXDentalPage'
import SurgeryPage from './components/SurgeryPage'
import MMXSettings from './components/MMXSettings'
import SettingsModal from './components/SettingsModal'
import PasswordPromptModal from './components/PasswordPromptModal'
import SplashScreen from './components/SplashScreen'
import ChatWindow from './components/ChatWindow'
import ScoreBar from './components/ScoreBar'
import { ChatProvider } from './contexts/ChatContext'

function AppContent() {
  const [meshData, setMeshData] = useState(null)
  const [metadata, setMetadata] = useState(null)
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
  const [showMMXSettings, setShowMMXSettings] = useState(false)
  const dentaxTimerRef = React.useRef(null)

  const handleFileLoaded = (data) => {
    setMeshData(data.geometry)
    setMetadata(data.metadata)
  }

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
    setMetadata(newMetadata)
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
              onFileLoaded={(data) => { handleFileLoaded(data); registerUpload(data); }}
              onInvertedDetected={registerInvertedNormals}
              showFormatInfo={false}
            />

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
                <h2>{metadata?.fileName || 'Visualizzatore 3D'}</h2>
              </div>
              {metadata?.fileType && (
                <span className="workspace-file-type">{metadata.fileType.toUpperCase()}</span>
              )}
            </div>
            {meshData ? (
              <MeshViewer geometry={meshData} requireEditConsent={editConsentRequired} />
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
