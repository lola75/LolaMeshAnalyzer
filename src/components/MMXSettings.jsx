import React, { useState, useEffect } from 'react'

// VERIFICARE LA NOTA SUI MARCHI PRIMA DEL RILASCIO: i percorsi di Meshmixer e RealGuide (meshmixerPath, realguideVirtualPath).
export default function MMXSettings({ isOpen, onClose }) {
  const [config, setConfig] = useState({
    meshmixerPath: '',
    realguideVirtualPath: '',
    autoLaunch: false,
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('mmx-config')
    if (stored) {
      setConfig(JSON.parse(stored))
    }
  }, [isOpen])

  const handleSave = () => {
    localStorage.setItem('mmx-config', JSON.stringify(config))
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setConfig(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-2xl font-bold text-slate-900">Impostazioni Strumenti</h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 text-2xl"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-96 overflow-y-auto">
          <div>
            <label className="block text-sm font-semibold text-slate-900 mb-2">
              Percorso Meshmixer (opzionale)
            </label>
            <input
              type="text"
              name="meshmixerPath"
              value={config.meshmixerPath}
              onChange={handleChange}
              placeholder="Es: C:\Program Files\Autodesk\Meshmixer\meshmixer.exe"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-slate-500 mt-2">
              Se vuoto, cercherà automaticamente nei percorsi standard di Meshmixer.
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-900 mb-2">
              Percorso Realguide Virtual (opzionale)
            </label>
            <input
              type="text"
              name="realguideVirtualPath"
              value={config.realguideVirtualPath}
              onChange={handleChange}
              placeholder="Es: C:\Program Files\RealGuide\RealGuide.exe"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-slate-500 mt-2">
              Se vuoto, cercherà automaticamente nei percorsi standard di Realguide.
            </p>
          </div>

          <div>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                name="autoLaunch"
                checked={config.autoLaunch}
                onChange={handleChange}
                className="w-4 h-4 rounded border-slate-300 text-purple-600"
              />
              <span className="text-sm font-semibold text-slate-900">Avvia automaticamente gli strumenti all'apertura dell'app</span>
            </label>
          </div>

          {saved && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
              ✓ Impostazioni salvate con successo
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 p-6 border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 text-slate-900 rounded-lg hover:bg-slate-300 transition-colors"
          >
            Chiudi
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-semibold"
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  )
}
