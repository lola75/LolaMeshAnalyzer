import React from 'react'
import CbctMeshPreview from './CbctMeshPreview'

export const MATCHING_ASSISTED = 'assisted'
export const MATCHING_POINTS = 'points'

const optionButton = (selected) => `w-full px-3 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 ${
  selected
    ? 'bg-sky-600 border-sky-600 text-white shadow-sm'
    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
}`

export const MIN_POINT_PAIRS = 3
export const MAX_POINT_PAIRS = 6
// Con almeno 4 coppie una coppia sbagliata (es. clic sul dente vicino) ha uno scarto che spicca
const SUSPECT_PAIR_MM = 2.0

// Pannello "Matching: STL su DICOM": oggetto da allineare, opzioni di matching, Annulla / Applica.

export default function CbctMatchingPanel({ matching, busy, error, onAssisted, onPoints, onUndoPoint, onClearPoints, onComputePoints, onCancel, onApply }) {
  const { type, fileName, buffer, color, method, result, cbctPoints, meshPoints } = matching
  const pairsReady = cbctPoints.length === meshPoints.length && cbctPoints.length >= MIN_POINT_PAIRS
  const residuals = result?.pairResiduals ?? []
  const worst = residuals.length >= 4 ? residuals.indexOf(Math.max(...residuals)) : -1
  const suspect = worst >= 0 && residuals[worst] > SUSPECT_PAIR_MM ? worst : -1
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
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2">
                Clic su un punto della CBCT (vista 3D a sinistra), poi sul punto corrispondente della mesh
                (a destra), ad esempio la stessa cuspide. Da {MIN_POINT_PAIRS} a {MAX_POINT_PAIRS} coppie, distribuite su
                tutta l’arcata: più coppie rendono l’allineamento più preciso. Trascina per ruotare.
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="px-2 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
                  Punti CBCT: <span className="font-semibold tabular-nums">{cbctPoints.length}/{MAX_POINT_PAIRS}</span>
                </div>
                <div className="px-2 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-800">
                  Punti mesh: <span className="font-semibold tabular-nums">{meshPoints.length}/{MAX_POINT_PAIRS}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={optionButton(false)}
                  disabled={busy || (cbctPoints.length === 0 && meshPoints.length === 0)}
                  onClick={onUndoPoint}
                >
                  Annulla ultimo
                </button>
                <button
                  className={optionButton(false)}
                  disabled={busy || (cbctPoints.length === 0 && meshPoints.length === 0)}
                  onClick={onClearPoints}
                >
                  Azzera punti
                </button>
              </div>
              <button
                className="w-full px-3 py-2 rounded-lg text-sm font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:bg-slate-300"
                disabled={busy || !pairsReady}
                onClick={onComputePoints}
                title={pairsReady ? undefined : `Servono almeno ${MIN_POINT_PAIRS} punti per vista, in numero uguale`}
              >
                Calcola allineamento
              </button>
            </div>
          )}
          {result && (
            <p className="text-xs text-slate-700 mt-3">
              Variazione: <span className="font-semibold tabular-nums">{result.rms.toFixed(3)} mm</span>
              {typeof result.pairsRms === 'number' && (
                <span className="text-slate-500"> · scarto tra i punti {result.pairsRms.toFixed(2)} mm</span>
              )}
            </p>
          )}
          {method === MATCHING_POINTS && residuals.length > 0 && (
            <div className="mt-2 text-xs text-slate-600">
              <p className="mb-1">Scarto di ogni coppia (prima della rifinitura):</p>
              <div className="flex flex-wrap gap-1">
                {residuals.map((value, index) => (
                  <span
                    key={index}
                    className={`px-1.5 py-0.5 rounded tabular-nums ${index === suspect ? 'bg-red-100 text-red-700 font-semibold' : 'bg-slate-100'}`}
                  >
                    {index + 1}: {value.toFixed(1)} mm
                  </span>
                ))}
              </div>
              {suspect >= 0 && (
                <p className="mt-1 text-red-700">
                  La coppia {suspect + 1} sembra sbagliata: se la Variazione non convince, rifai quei punti.
                </p>
              )}
            </div>
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
