import React, { useState, useEffect } from 'react'

export default function PasswordPromptModal({ open, onClose, onConfirm }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setPassword('')
      setError('')
    }
  }, [open])

  if (!open) return null

  const handleConfirm = () => {
    if (onConfirm(password)) {
      setPassword('')
      setError('')
      return
    }
    setError('Password errata')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25">
      <div className="bg-white rounded-3xl p-6 w-full max-w-sm border border-slate-200 shadow-2xl">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Accesso URL DENTAX</h3>
        <p className="text-sm text-slate-600 mb-3">
          Inserisci la password per modificare l&apos;URL DENTAX.
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full mt-2 mb-2 p-2 rounded bg-slate-100 text-slate-900 border border-slate-300 focus:border-sky-500 focus:outline-none"
        />
        {error && (
          <div className="text-xs text-red-600 mb-2">{error}</div>
        )}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-3 py-2 bg-slate-100 text-slate-700 rounded">Annulla</button>
          <button
            onClick={handleConfirm}
            className="px-3 py-2 rounded bg-sky-600 hover:bg-sky-700 text-white"
          >
            Conferma
          </button>
        </div>
      </div>
    </div>
  )
}
