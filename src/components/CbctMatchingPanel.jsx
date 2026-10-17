import React from 'react'
import CbctMeshPreview from './CbctMeshPreview'

export const MATCHING_ASSISTED = 'assisted'
export const MATCHING_POINTS = 'points'

const optionButton = (selected) => `w-full px-3 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 ${
  selected
    ? 'bg-sky-600 border-sky-600 text-white shadow-sm'
    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
}`

// Pannello "Matching: STL su DICOM": oggetto da allineare, opzioni di matching, Annulla / Applica.
export default function CbctMatchingPanel({ matching, busy, error, onAssisted, onPoints, onCancel, onApply }) {
  const { type, fileName, buffer, color, method, result } = matching
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 pt-4 pb-3 border-b border-slate-200">
        <h2 className="text-base font-semibold text-slate-900">Matching: STL su DICOM</h2>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border-b border-slate-200 flex justify-between gap-2">
            <span>{type}</span>
            <span className="text-slate-400 truncate" title={fileName}>{fileName}</span>
          </div>
          <div className="h-36 bg-slate-900">
            <CbctMeshPreview buffer={buffer} fileName={fileName} color={color} interactive={false} />
          </div>
        </div>

        <section>
          <h3 className="text-sm font-semibold text-slate-900 mb-2 pb-1 border-b border-slate-200">Opzioni Matching</h3>
          <div className="flex flex-col gap-2">
            <button
              className={optionButton(method === MATCHING_ASSISTED)}
              aria-pressed={method === MATCHING_ASSISTED}
              disabled={busy}
              onClick={onAssisted}
              title="Allineamento automatico: estrae i denti dalla CBCT e vi sovrappone la mesh"
            >
              Assistita
            </button>
            <button
              className={optionButton(method === MATCHING_POINTS)}
              aria-pressed={method === MATCHING_POINTS}
              disabled={busy}
              onClick={onPoints}
              title="Allineamento con punti corrispondenti su CBCT e mesh"
            >
              Per Punti
            </button>
          </div>
          {method === MATCHING_POINTS && (
            <p className="text-xs text-slate-500 mt-2">Selezione dei punti corrispondenti: prossima fase in sviluppo.</p>
          )}
          {result && (
            <p className="text-xs text-slate-700 mt-3">
              Variazione: <span className="font-semibold tabular-nums">{result.rms.toFixed(3)} mm</span>
            </p>
          )}
          {result?.uncertain && (
            <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
              ⚠ Matching incerto: parte della mesh risulta dentro osso o denti.
              Controlla le slice e, se non coincide, premi di nuovo “Assistita”.
            </div>
          )}
          {error && (
            <div className="mt-3 p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
          )}
        </section>
      </div>

      <div className="p-3 border-t border-slate-200 grid grid-cols-2 gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-2 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
        >
          Annulla
        </button>
        <button
          onClick={onApply}
          disabled={busy || !result}
          className="px-3 py-2 rounded-lg text-sm bg-sky-600 text-white hover:bg-sky-700 disabled:bg-slate-300"
        >
          Applica
        </button>
      </div>
    </div>
  )
}
