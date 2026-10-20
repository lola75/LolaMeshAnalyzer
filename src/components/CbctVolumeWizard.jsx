import React from 'react'

const sectionTitle = 'text-sm font-semibold text-slate-900 mb-2'
const button = 'px-3 py-1.5 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent'
const primaryButton = 'px-3 py-1.5 rounded-lg text-sm bg-sky-600 text-white hover:bg-sky-700 disabled:bg-slate-300'

const ROTATION_PLANES = [
  { id: 'axial', label: 'Rotazione assiale' },
  { id: 'coronal', label: 'Rotazione coronale' },
  { id: 'sagittal', label: 'Rotazione sagittale' },
]

const ORIENT_AXES = [
  { key: 'rx', label: 'Inclinazione (asse destra-sinistra)' },
  { key: 'ry', label: 'Rollio (asse antero-posteriore)' },
  { key: 'rz', label: 'Rotazione (asse verticale)' },
]

const SPECK_SIZES = [
  { value: 2, label: 'piccoli (< 2 mm³)' },
  { value: 5, label: 'medi (< 5 mm³)' },
  { value: 20, label: 'grandi (< 20 mm³)' },
]

export function Switch({ checked, onChange, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-sky-600' : 'bg-slate-300'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  )
}

// Pannello del Wizard volume (passo 1): riduzione, ritaglio, filtri, orientamento.
export default function CbctVolumeWizard({
  meta,
  busy,
  box,
  onBoxToggle,
  onBoxApply,
  onOperation,
  onUndo,
  crop,
  onCropStart,
  onCropInvert,
  onCropApply,
  onCropCancel,
  orient,
  onOrientStart,
  onOrientChange,
  onOrientApply,
  onOrientCancel,
  speckSize,
  onSpeckSizeChange,
  speckThreshold,
}) {
  const editing = crop.active || orient.active || box.active
  const locked = busy || editing

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Riduci volume</h2>
          <Switch checked={box.active} onChange={onBoxToggle} disabled={busy || crop.active || orient.active} />
        </div>
        <p className="text-xs text-slate-500 mt-1 mb-2">
          {box.active
            ? 'Trascina le maniglie gialle sul 3D per stringere il box. Ruota la vista trascinando fuori dalle maniglie.'
            : 'Attiva per delimitare con un box la zona del volume da tenere.'}
        </p>
        <button
          className={`${primaryButton} w-full`}
          disabled={busy || !box.active || !box.changed}
          onClick={onBoxApply}
        >
          Riduzione permanente
        </button>
      </section>

      <section>
        <h2 className={sectionTitle}>Ritaglio</h2>
        {!crop.active ? (
          <button className={`${primaryButton} w-full`} disabled={locked} onClick={onCropStart}>
            Inizio ritaglio
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2">
              Clic sul 3D per aggiungere punti (o tieni premuto e trascina: un punto ogni 5 mm), doppio clic per chiudere il contorno.
              Backspace toglie l’ultimo punto, Esc annulla.
            </p>
            <div className={`text-xs font-medium px-2 py-1 rounded ${crop.keepInside ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {crop.keepInside ? 'Si tiene solo l’area disegnata' : 'Si elimina l’area disegnata'}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className={button} disabled={busy} onClick={onCropInvert}>Inverti</button>
              <button className={primaryButton} disabled={busy || !crop.closed} onClick={onCropApply}>Ritaglia</button>
            </div>
            <button className={button} disabled={busy} onClick={onCropCancel}>Annulla</button>
          </div>
        )}
      </section>

      <section>
        <h2 className={sectionTitle}>Filtraggio immagine</h2>
        <div className="flex flex-col gap-2">
          <button
            className={button}
            disabled={locked}
            title="Filtro mediano: riduce il rumore granulare mantenendo i bordi (circa 20 secondi sul volume completo)"
            onClick={() => onOperation('median', { radius: 1 }, 'Riduzione del rumore (filtro mediano)...')}
          >
            Riduci rumore
          </button>
          <button
            className={button}
            disabled={locked}
            title="Filtro gaussiano leggero: ammorbidisce l'immagine"
            onClick={() => onOperation('smooth', { sigma: 0.8 }, 'Ammorbidimento dell’immagine...')}
          >
            Ammorbidisci
          </button>
          <div className="flex gap-2">
            <button
              className={`${button} flex-1`}
              disabled={locked || speckThreshold === null}
              title="Elimina i gruppi di voxel isolati più chiari della soglia di contrasto attuale (i puntini che fluttuano nel 3D)"
              onClick={() => onOperation(
                'despeckle',
                { threshold: speckThreshold, minSizeMm3: speckSize },
                'Rimozione dei puntini isolati...'
              )}
            >
              Rimuovi puntini
            </button>
            <select
              className="text-xs border border-slate-300 rounded-lg px-1"
              value={speckSize}
              onChange={(e) => onSpeckSizeChange(Number(e.target.value))}
              disabled={locked}
            >
              {SPECK_SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          {speckThreshold !== null && (
            <p className="text-xs text-slate-500">Soglia: contrasto minimo attuale ({Math.round(speckThreshold)}).</p>
          )}
        </div>
      </section>

      <section>
        <h2 className={sectionTitle}>Cambia orientamento</h2>
        <div className="flex flex-col gap-2">
          <button className={button} disabled={locked} onClick={() => onOperation('flipZ', {}, 'Inversione dell’asse Z...')}>
            Inverti Z
          </button>
          {ROTATION_PLANES.map((plane) => (
            <div key={plane.id} className="flex items-center gap-2">
              <span className="text-xs text-slate-600 flex-1">{plane.label}</span>
              <button
                className={`${button} w-14`}
                disabled={locked}
                onClick={() => onOperation('rotate90', { plane: plane.id, turns: -1 }, 'Rotazione di 90°...')}
              >
                90 −
              </button>
              <button
                className={`${button} w-14`}
                disabled={locked}
                onClick={() => onOperation('rotate90', { plane: plane.id, turns: 1 }, 'Rotazione di 90°...')}
              >
                90 +
              </button>
            </div>
          ))}
          {!orient.active ? (
            <button className={button} disabled={locked} onClick={onOrientStart}>Regola orientamento assi</button>
          ) : (
            <div className="flex flex-col gap-2 border border-slate-200 rounded-lg p-2">
              <p className="text-xs text-slate-600">Anteprima dal vivo. Usa le viste 2D per allineare piano occlusale e linea mediana.</p>
              {ORIENT_AXES.map((axis) => (
                <label key={axis.key} className="flex flex-col gap-1 text-xs text-slate-600">
                  <span>{axis.label}: {orient[axis.key].toFixed(1)}°</span>
                  <input
                    type="range"
                    min={-30}
                    max={30}
                    step={0.5}
                    value={orient[axis.key]}
                    onChange={(e) => onOrientChange(axis.key, Number(e.target.value))}
                    disabled={busy}
                  />
                </label>
              ))}
              <div className="grid grid-cols-2 gap-2">
                <button className={button} disabled={busy} onClick={onOrientCancel}>Annulla</button>
                <button
                  className={primaryButton}
                  disabled={busy || (orient.rx === 0 && orient.ry === 0 && orient.rz === 0)}
                  onClick={onOrientApply}
                >
                  Applica
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <button className={button} disabled={locked || !meta.undoSteps} onClick={onUndo}>
        ↶ Annulla ultima modifica{meta.undoSteps ? ` (${meta.undoSteps})` : ''}
      </button>
    </div>
  )
}
