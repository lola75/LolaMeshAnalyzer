import React, { useEffect, useRef, useState } from 'react'
import { LIGHTING_STYLES, onLightingChange, readLightingSettings, saveLightingSettings } from '../utils/viewerLighting'

// Pulsante "Luce" sopra una vista 3D: stile di illuminazione e luminosita', uguali per tutte le viste.
// variant 'dark': stile dei pulsanti scuri della barra della pagina principale
export default function LightingControl({ className = '', variant = 'light' }) {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState(readLightingSettings)
  const rootRef = useRef(null)

  useEffect(() => onLightingChange(setSettings), [])
  useEffect(() => {
    if (!open) return undefined
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [open])

  const change = (patch) => saveLightingSettings({ ...settings, ...patch })

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Illuminazione della vista"
        className={variant === 'dark'
          ? `flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition ${open ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`
          : 'flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white/90 px-2.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-white'}
      >
        <svg viewBox="0 0 24 24" className={variant === 'dark' ? 'h-3.5 w-3.5' : 'h-4 w-4'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
        </svg>
        Luce
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-56 space-y-3 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-xl">
          <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Stile di illuminazione">
            {Object.entries(LIGHTING_STYLES).map(([id, style]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={settings.style === id}
                onClick={() => change({ style: id })}
                className={`rounded-md border px-1.5 py-1 font-medium ${settings.style === id ? 'border-sky-500 bg-sky-600 text-white' : 'border-slate-300 bg-white hover:bg-slate-50'}`}
              >
                {style.label}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="mb-1 flex justify-between">
              <span>Luminosità</span>
              <span className="tabular-nums text-slate-500">{Math.round(settings.brightness * 100)}%</span>
            </span>
            <input
              type="range"
              min={0.4}
              max={1.8}
              step={0.05}
              value={settings.brightness}
              onChange={(e) => change({ brightness: Number(e.target.value) })}
              className="w-full accent-sky-600"
            />
          </label>
          <button type="button" onClick={() => change({ style: 'studio', brightness: 1 })} className="w-full rounded-md border border-slate-200 px-2 py-1 hover:bg-slate-50">
            Ripristina
          </button>
        </div>
      )}
    </div>
  )
}
