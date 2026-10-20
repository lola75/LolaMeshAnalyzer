import React from 'react'
import { FREEFORM_BRUSHES } from '../utils/freeformSculpt'

// Pannello dello strumento Free Form del Modificatore mesh.
export default function MeshFreeformPanel({ meshName, diagonal, settings, onSettings, freeform, onApply, onClose }) {
  const { ready, preparing, error, strokes, canUndo } = freeform
  // limiti dei cursori in base alla grandezza della mesh (mm)
  const maxRadius = Math.max(1, Math.round(diagonal * 0.15))
  const radiusStep = maxRadius > 20 ? 0.5 : 0.1
  const active = FREEFORM_BRUSHES.find((b) => b.id === settings.brush)
  return (
    <div className="absolute bottom-8 left-8 w-[360px] bg-white/95 border border-slate-200 rounded-2xl shadow-2xl backdrop-blur-sm text-slate-800">
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-200">
        <div>
          <div className="text-sm font-semibold text-slate-900">Free Form</div>
          <div className="text-xs text-slate-500 truncate max-w-[260px]">{meshName}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-7 w-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100"
          aria-label="Chiudi Free Form"
        >
          ×
        </button>
      </div>

      <div className="px-4 py-3 space-y-3">
        {error ? (
          <div className="text-xs text-red-700">❌ Preparazione non riuscita: {error}</div>
        ) : !ready || preparing ? (
          <div className="text-xs text-slate-600">⏳ Preparazione della mesh in corso...</div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-1.5">
              {FREEFORM_BRUSHES.map((brush) => (
                <button
                  key={brush.id}
                  type="button"
                  title={brush.hint}
                  aria-pressed={settings.brush === brush.id}
                  onClick={() => onSettings({ brush: brush.id })}
                  className={`px-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${settings.brush === brush.id ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}
                >
                  {brush.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">{active?.hint}. Trascina sulla mesh col tasto sinistro; sullo sfondo la vista ruota. Ctrl + rotella cambia il raggio.</p>

            <div className="grid grid-cols-[100px_1fr_auto] items-center gap-x-3 gap-y-3 text-sm">
              <label className="text-slate-600" htmlFor="freeform-radius">Raggio</label>
              <input
                id="freeform-radius"
                type="range"
                min={radiusStep}
                max={maxRadius}
                step={radiusStep}
                value={Math.min(settings.radius, maxRadius)}
                onChange={(e) => onSettings({ radius: Number(e.target.value) })}
              />
              <span className="w-16 text-right tabular-nums text-xs">{settings.radius.toLocaleString('it-IT')} mm</span>
              <label className="text-slate-600" htmlFor="freeform-strength">Intensità</label>
              <input
                id="freeform-strength"
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={settings.strength}
                onChange={(e) => onSettings({ strength: Number(e.target.value) })}
              />
              <span className="w-16 text-right tabular-nums text-xs">{Math.round(settings.strength * 100)}%</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={freeform.undo}
                disabled={!canUndo}
                className="px-3 py-1.5 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              >
                Annulla tratto
              </button>
              <button
                type="button"
                onClick={freeform.discard}
                disabled={strokes === 0}
                className="px-3 py-1.5 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              >
                Annulla tutto
              </button>
            </div>
            <button
              type="button"
              onClick={onApply}
              disabled={strokes === 0}
              className="w-full px-3 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:bg-slate-300"
            >
              Applica {strokes > 0 ? `(${strokes} ${strokes === 1 ? 'tratto' : 'tratti'})` : ''}
            </button>
            <p className="text-[11px] text-slate-500">
              Le pennellate restano in prova finché non premi Applica. Gli altri strumenti si sbloccano dopo Applica o Annulla tutto.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
