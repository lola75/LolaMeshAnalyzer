import React, { useEffect, useState } from 'react'

// Tipi di oggetto 3D (stessi nomi e ordine di RealGuide)
export const OBJECT_TYPES = [
  'Face Scan',
  'Marker Scan',
  'Anatomy',
  'Antagonist',
  'Waxup-Prosthesis',
  'Antagonist Waxup',
  'Bone Surface',
  'Bone Graft',
  'Surgical Guide',
  'Bone Reduction Guide',
  'Acrylic Flange',
  'Bar',
  'Altro',
]

export const POSITION_MATCHING = 'matching'
export const POSITION_ORIGINAL = 'original'

const choiceButton = (selected) => `flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
  selected
    ? 'bg-sky-600 border-sky-600 text-white shadow-sm'
    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
}`

// Finestra "Importa oggetto": tipo di oggetto e posizionamento, poi OK apre la scelta del file.
// onMatchingClick / onOriginalPositionClick: chiamate a ogni clic sul pulsante corrispondente.
// objects: oggetti gia' importati; sceglierne uno nel menu fa prendere al nuovo oggetto la stessa
// posizione (stesso spostamento) di quell'oggetto.
export default function CbctImportObjectDialog({ objects = [], onConfirm, onCancel, onMatchingClick, onOriginalPositionClick }) {
  const [type, setType] = useState(OBJECT_TYPES[0])
  const [position, setPosition] = useState(POSITION_MATCHING)
  const [referenceId, setReferenceId] = useState('')

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 backdrop-blur-[1px]" onMouseDown={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-object-title"
        className="w-[min(560px,92vw)] rounded-2xl bg-white shadow-2xl border border-slate-200"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-200">
          <h2 id="import-object-title" className="text-lg font-semibold text-slate-900">Importa oggetto</h2>
          <button onClick={onCancel} aria-label="Chiudi" className="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900">✕</button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Nome oggetto:</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="w-60 px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              autoFocus
            >
              {OBJECT_TYPES.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Posizione oggetto:</span>
            <div className="flex gap-2" role="radiogroup" aria-label="Posizione oggetto">
              <button
                role="radio"
                aria-checked={position === POSITION_MATCHING}
                className={choiceButton(position === POSITION_MATCHING)}
                onClick={() => {
                  setPosition(POSITION_MATCHING)
                  setReferenceId('') // Matching e "posizione di un altro oggetto" sono alternativi
                  onMatchingClick?.(type)
                }}
              >
                Matching
              </button>
              <button
                role="radio"
                aria-checked={position === POSITION_ORIGINAL}
                className={choiceButton(position === POSITION_ORIGINAL)}
                onClick={() => {
                  setPosition(POSITION_ORIGINAL)
                  onOriginalPositionClick?.(type)
                }}
              >
                Mantieni posizione originale
              </button>
              <select
                aria-label="Prendi la posizione di un oggetto già importato"
                title="Prendi la posizione di un oggetto già importato"
                className="flex-1 min-w-0 px-2 py-2 rounded-lg border border-slate-300 text-sm bg-white disabled:bg-slate-50 disabled:text-slate-400"
                value={referenceId}
                disabled={objects.length === 0}
                onChange={(event) => {
                  setReferenceId(event.target.value)
                  if (event.target.value) setPosition(POSITION_ORIGINAL)
                }}
              >
                <option value="">{objects.length ? '— posizione del file —' : ''}</option>
                {objects.map((object) => (
                  <option key={object.id} value={String(object.id)}>
                    {object.type} — {object.fileName}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-center gap-3 px-5 py-4 border-t border-slate-200">
          <button
            onClick={() => onConfirm({ type, position, referenceId: position === POSITION_MATCHING ? '' : referenceId })}
            className="w-32 px-4 py-2 rounded-lg text-sm font-medium bg-sky-600 text-white hover:bg-sky-700"
          >
            ✓ OK
          </button>
          <button
            onClick={onCancel}
            className="w-32 px-4 py-2 rounded-lg text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-100"
          >
            ✕ Annulla
          </button>
        </div>
      </div>
    </div>
  )
}
