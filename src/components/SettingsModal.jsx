import React, { useState, useEffect } from 'react'

function isValidUrl(s) {
  if (!s) return false
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch (err) {
    return false
  }
}

export default function SettingsModal({ open, onClose, dentaxUrl, scannerIntraoralUrl, scannerFaccialeUrl, editConsentRequired, onSave }) {
  const [value, setValue] = useState(dentaxUrl || '')
  const [scannerIntraoralValue, setScannerIntraoralValue] = useState(scannerIntraoralUrl || '')
  const [scannerFaccialeValue, setScannerFaccialeValue] = useState(scannerFaccialeUrl || '')
  const [requireConsent, setRequireConsent] = useState(editConsentRequired ?? true)
  const [valid, setValid] = useState(true)

  useEffect(() => {
    setValue(dentaxUrl || '')
    setScannerIntraoralValue(scannerIntraoralUrl || '')
    setScannerFaccialeValue(scannerFaccialeUrl || '')
    setRequireConsent(editConsentRequired ?? true)
  }, [dentaxUrl, scannerIntraoralUrl, scannerFaccialeUrl, editConsentRequired, open])

  useEffect(() => {
    setValid(isValidUrl(value.trim()))
  }, [value])

  if (!open) return null

  const handleSave = () => {
    const trimmed = value.trim()
    if (!isValidUrl(trimmed)) return
    onSave({
      dentaxUrl: trimmed,
      scannerIntraoralUrl: scannerIntraoralValue.trim(),
      scannerFaccialeUrl: scannerFaccialeValue.trim(),
      editConsentRequired: requireConsent,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25">
      <div className="bg-white rounded-3xl p-6 w-full max-w-md border border-slate-200 shadow-2xl">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Impostazioni</h3>
        <label className="text-sm text-slate-600">URL DENTAX</label>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://..."
          className="w-full mt-2 mb-4 p-2 rounded bg-slate-100 text-slate-900 border border-slate-300 focus:border-sky-500 focus:outline-none"
        />
        <label className="text-sm text-slate-600">URL Scanner Intraorale</label>
        <input
          type="text"
          value={scannerIntraoralValue}
          onChange={(e) => setScannerIntraoralValue(e.target.value)}
          placeholder="https://..."
          className="w-full mt-2 mb-4 p-2 rounded bg-slate-100 text-slate-900 border border-slate-300 focus:border-sky-500 focus:outline-none"
        />
        <label className="text-sm text-slate-600">URL Scanner facciale</label>
        <input
          type="text"
          value={scannerFaccialeValue}
          onChange={(e) => setScannerFaccialeValue(e.target.value)}
          placeholder="https://..."
          className="w-full mt-2 mb-4 p-2 rounded bg-slate-100 text-slate-900 border border-slate-300 focus:border-sky-500 focus:outline-none"
        />
        <div className="mt-4 flex items-start gap-3">
          <input
            id="require-consent"
            type="checkbox"
            checked={requireConsent}
            onChange={(e) => setRequireConsent(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
          />
          <label htmlFor="require-consent" className="text-sm text-slate-700">
            Richiedi consenso esplicito prima di abilitare la modifica della mesh
          </label>
        </div>
        {!valid && (
          <div className="text-xs text-red-600 mb-2">URL DENTAX non valido. Deve iniziare con http:// o https://</div>
        )}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-3 py-2 bg-slate-100 text-slate-700 rounded">Annulla</button>
          <button
            onClick={handleSave}
            disabled={!valid}
            className={`px-3 py-2 rounded ${valid ? 'bg-sky-600 hover:bg-sky-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  )
}
