import React, { useEffect, useRef, useState } from 'react'

// Selettore del colore di una mesh, uguale in tutte le pagine: pallino del colore attuale che apre
// la tavolozza, un colore personalizzato e (se la mesh e' stata ricolorata) il ritorno al colore
// originale (onReset: anche i colori propri della mesh, se ne aveva). I colori sono stringhe '#rrggbb'.

export const MESH_PALETTE = [
  '#f2c200', '#f59e0b', '#ef4444', '#ec4899', '#a855f7', '#3b82f6',
  '#06b6d4', '#22c55e', '#84cc16', '#f8fafc', '#94a3b8', '#334155',
]

export const hexFromNumber = (value) => `#${(value >>> 0).toString(16).padStart(6, '0').slice(-6)}`
export const numberFromHex = (hex) => parseInt(hex.replace('#', ''), 16)
export const hexFromRgb = ([r, g, b]) => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
export const rgbFromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

export default function MeshColorPicker({ value, onChange, onReset = null, originalColor = null, label = 'Colore mesh', className = 'h-4 w-4' }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const current = (value || '#999999').toLowerCase()

  useEffect(() => {
    if (!open) return undefined
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const pick = (color) => {
    onChange(color.toLowerCase())
    setOpen(false)
  }

  return (
    // i clic restano qui: la riga dell'elenco sotto non viene selezionata
    <span ref={rootRef} className="relative inline-flex shrink-0" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`${label}: cambia colore`}
        aria-expanded={open}
        title="Cambia colore"
        className={`${className} rounded-full border border-black/20 shadow-sm transition hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500`}
        style={{ backgroundColor: current }}
      />
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-[188px] space-y-2 rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-700 shadow-xl">
          <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label={`${label}: tavolozza`}>
            {MESH_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={current === color}
                aria-label={color}
                title={color}
                onClick={() => pick(color)}
                className={`h-5 w-5 rounded-md border shadow-sm transition ${current === color ? 'border-sky-600 ring-2 ring-sky-400' : 'border-slate-300 hover:scale-110'}`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <label className="flex items-center justify-between gap-2">
            <span>Personalizzato</span>
            <input
              type="color"
              value={current}
              onChange={(event) => onChange(event.target.value.toLowerCase())}
              className="h-6 w-9 cursor-pointer rounded border border-slate-300 bg-white p-0"
              aria-label={`${label}: colore personalizzato`}
            />
          </label>
          {onReset && (
            <button
              type="button"
              onClick={() => {
                onReset()
                setOpen(false)
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 hover:bg-slate-50"
            >
              {originalColor && <span className="h-3 w-3 rounded-full border border-black/20" style={{ backgroundColor: originalColor }} />}
              Colore originale
            </button>
          )}
        </div>
      )}
    </span>
  )
}
