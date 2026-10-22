import React, { useEffect, useRef, useState } from 'react'

// Pannello "Crea modello di stampa articolato" (Utilita' di stampa 3D): impostazioni dell'ordine del
// modello articolato. onConfirm(impostazioni) quando si conferma, onCancel per chiudere.

export const ARTICULATED_DEFAULTS = { abutment: 'none', articulator: 'rod', modelType: 'solid', baseHeight: 5, label: '' }
const BASE_HEIGHTS = [3, 4, 5, 6, 7, 8, 10, 12, 15]

// icone disegnate (niente immagini esterne)
function ArticulatorIcon({ none = false }) {
  return (
    <svg viewBox="0 0 32 24" className={`h-6 w-8 shrink-0 ${none ? 'text-slate-400' : 'text-sky-700'}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M6 4v16M6 4h4M6 20h4" />
      <path d="M13 2v13M13 2h3" />
      <path d="M24 8v13M24 21h-3" />
      {none && (
        <g strokeWidth="2">
          <circle cx="25" cy="17" r="5" fill="white" />
          <path d="M21.5 20.5l7-7" />
        </g>
      )}
    </svg>
  )
}

function ModelIcon({ type }) {
  return (
    <svg viewBox="0 0 40 24" className="h-6 w-10 shrink-0" aria-hidden="true">
      <defs>
        <pattern id="honeycomb" width="4" height="4" patternUnits="userSpaceOnUse">
          <path d="M0 2h4M2 0v4" stroke="#7aa7d9" strokeWidth="0.8" />
        </pattern>
      </defs>
      {/* arcata a ferro di cavallo vista di tre quarti */}
      <path
        d="M6 6c0 9 6 14 14 14s14-5 14-14l-6 1c0 6-3 9-8 9s-8-3-8-9z"
        fill={type === 'solid' ? '#9cc3ec' : type === 'honeycomb' ? 'url(#honeycomb)' : 'white'}
        stroke="#3b6fb6"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {type === 'hollow' && <path d="M9 8c1 6 5 10 11 10s10-4 11-10" fill="none" stroke="#3b6fb6" strokeWidth="1" strokeDasharray="2 1.5" />}
    </svg>
  )
}

function Field({ label, required = false, children }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-slate-700">
        {required && <span className="mr-0.5 text-red-500">*</span>}
        {label}
      </div>
      {children}
    </div>
  )
}

const choice = (active) => `rounded-lg border px-3 py-2 text-xs font-medium transition ${active ? 'border-sky-500 bg-sky-50 text-sky-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`

// onBack: nel wizard "Indietro" torna al passo precedente (altrimenti riporta i valori iniziali)
// initialSettings: valori gia' scelti (tornando a questo passo); confirmLabel: testo del pulsante di conferma
export default function ArticulatedModelPanel({ onConfirm, onCancel, onBack = null, busy = false, initialSettings = null, confirmLabel = 'Conferma' }) {
  const [settings, setSettings] = useState(initialSettings ?? ARTICULATED_DEFAULTS)
  const [articulatorOpen, setArticulatorOpen] = useState(false)
  const menuRef = useRef(null)
  const set = (patch) => setSettings((s) => ({ ...s, ...patch }))

  useEffect(() => {
    if (!articulatorOpen) return undefined
    const close = (event) => {
      if (!menuRef.current?.contains(event.target)) setArticulatorOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [articulatorOpen])

  const articulators = [
    { id: 'rod', label: 'Asta di supporto' },
    { id: 'none', label: 'Nessuno' },
  ]
  const current = articulators.find((a) => a.id === settings.articulator)

  return (
    <section className="space-y-4 rounded-xl border border-sky-200 bg-sky-50/40 p-3" aria-label="Crea modello di stampa articolato">
      <h5 className="text-sm font-semibold text-slate-900">Crea modello articolato</h5>

      <Field label="Tipo di moncone" required>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo di moncone">
          {[['none', 'Nessuno'], ['extra', 'Moncone aggiuntivo']].map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={settings.abutment === id} className={choice(settings.abutment === id)} onClick={() => set({ abutment: id })}>
              {label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Articolatore" required>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setArticulatorOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={articulatorOpen}
            className={`flex w-full items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 ${articulatorOpen ? 'border-sky-500 ring-1 ring-sky-300' : 'border-slate-300 hover:border-slate-400'}`}
          >
            <ArticulatorIcon none={current.id === 'none'} />
            <span className="flex-1 text-left">{current.label}</span>
            <span className={`text-[10px] text-slate-500 transition ${articulatorOpen ? 'rotate-180' : ''}`} aria-hidden="true">▼</span>
          </button>
          {articulatorOpen && (
            <ul role="listbox" aria-label="Articolatore" className="absolute left-0 right-0 top-full z-30 mt-1.5 space-y-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl">
              {articulators.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={settings.articulator === a.id}
                    onClick={() => {
                      set({ articulator: a.id })
                      setArticulatorOpen(false)
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm ${settings.articulator === a.id ? 'bg-sky-50 font-semibold text-sky-800' : 'text-slate-700 hover:bg-slate-50'}`}
                  >
                    <ArticulatorIcon none={a.id === 'none'} />
                    {a.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Field>

      <Field label="Tipo modello" required>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo modello">
          {[['hollow', 'Cavo'], ['solid', 'Solido'], ['honeycomb', 'Nido d\'ape']].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={settings.modelType === id}
              onClick={() => set({ modelType: id })}
              className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs font-medium transition ${settings.modelType === id ? 'border-sky-500 bg-sky-50 text-sky-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              <ModelIcon type={id} />
              <span className="flex-1 text-left">{label}</span>
              <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border ${settings.modelType === id ? 'border-sky-600' : 'border-slate-400'}`} aria-hidden="true">
                {settings.modelType === id && <span className="h-1.5 w-1.5 rounded-full bg-sky-600" />}
              </span>
            </button>
          ))}
        </div>
      </Field>

      <Field label="Altezza base (mm)" required>
        <select
          value={settings.baseHeight}
          onChange={(e) => set({ baseHeight: Number(e.target.value) })}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
          aria-label="Altezza base in millimetri"
        >
          {BASE_HEIGHTS.map((h) => <option key={h} value={h}>{h.toFixed(1)}</option>)}
        </select>
      </Field>

      <Field label="Etichetta modello">
        <input
          type="text"
          value={settings.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="Testo da incidere sul modello"
          maxLength={40}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
        />
      </Field>

      <div className="grid grid-cols-3 gap-2 pt-1">
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
          Annulla
        </button>
        <button type="button" onClick={() => (onBack ? onBack() : setSettings(ARTICULATED_DEFAULTS))} title={onBack ? 'Torna al passo precedente' : 'Torna ai valori iniziali'} className="rounded-lg border border-sky-400 bg-white px-2 py-2 text-xs font-medium text-sky-700 hover:bg-sky-50">
          Indietro
        </button>
        <button type="button" disabled={busy} onClick={() => onConfirm?.(settings)} className="rounded-lg border border-sky-700 bg-sky-600 px-2 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          {confirmLabel}
        </button>
      </div>
    </section>
  )
}
