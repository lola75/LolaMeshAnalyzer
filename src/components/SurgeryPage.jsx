import React, { useState, useEffect } from 'react'

// VERIFICARE LA NOTA SUI MARCHI PRIMA DEL RILASCIO: pagina che avvia RealGuide (programma esterno) dal percorso nelle Impostazioni MMX.
export default function SurgeryPage({ onClose }) {
  const [isLaunching, setIsLaunching] = useState(false)
  const [launchMessage, setLaunchMessage] = useState('')
  const [config, setConfig] = useState(null)

  useEffect(() => {
    const stored = localStorage.getItem('mmx-config')
    if (stored) {
      try {
        setConfig(JSON.parse(stored))
      } catch (err) {
        console.error('Errore lettura configurazione:', err)
      }
    }
  }, [])

  const handleLaunchRealguide = async () => {
    setIsLaunching(true)
    setLaunchMessage('')

    try {
      const result = await window.electron.launchRealguide(config?.realguideVirtualPath)
      if (result.success) {
        setLaunchMessage('✓ Realguide avviato con successo')
      } else {
        setLaunchMessage(`✗ Errore: ${result.error}`)
      }
    } catch (err) {
      setLaunchMessage(`✗ Errore: ${err.message}`)
    } finally {
      setIsLaunching(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-2xl font-bold text-slate-900">Chirurgia Guidata</h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 text-2xl"
          >
            ✕
          </button>
        </div>
        <div className="p-6">
          <div className="text-center text-slate-600">
            <p className="text-lg mb-4">Strumento Realguide</p>
            <p className="text-sm mb-6">Clicca il pulsante sottostante per avviare Realguide</p>
            
            <button
              onClick={handleLaunchRealguide}
              disabled={isLaunching}
              className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-slate-400 transition-colors font-semibold"
            >
              {isLaunching ? 'Avvio in corso...' : 'Avvia Realguide'}
            </button>

            {launchMessage && (
              <p className={`mt-4 text-sm ${launchMessage.includes('✓') ? 'text-green-600' : 'text-red-600'}`}>
                {launchMessage}
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-3 p-6 border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 text-slate-900 rounded-lg hover:bg-slate-300 transition-colors"
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  )
}
