import React from 'react'

// Passo 3 del Wizard volume: segmentazione automatica con DentalSegmentator (nnU-Net).
// Tutto il metodo 2 sta in questo componente e nelle funzioni "seg2" di CbctPage.

export const SEG2_STRUCTURES = [
  { label: 1, name: 'Cranio superiore e mascella', color: [232, 214, 180] },
  { label: 2, name: 'Mandibola', color: [250, 190, 110] },
  { label: 3, name: 'Denti superiori', color: [235, 240, 255] },
  { label: 4, name: 'Denti inferiori', color: [140, 200, 255] },
  { label: 5, name: 'Canale mandibolare', color: [255, 70, 70] },
]

const QUALITY_OPTIONS = [
  { value: 0.3, label: 'Normale (0.3 mm)' },
  { value: 0.2, label: 'Alta (0.2 mm)' },
]
const TRIANGLE_OPTIONS = [100_000, 300_000, 1_000_000]

const colorCss = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`
const formatVolume = (mm3) => (mm3 >= 1000 ? `${(mm3 / 1000).toFixed(1)} cm³` : `${Math.round(mm3)} mm³`)

export default function CbctSegmentation2Step({ seg2, busy, onRun, onToggle, onChange, onCreate }) {
  const { status, checking, result, visible } = seg2
  const ready = status?.ready
  return (
    <div className="flex flex-col gap-5">
      <section className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2">
        <p className="font-semibold text-slate-800 mb-1">Segmentazione automatica (test)</p>
        <p>
          Rete neurale DentalSegmentator: riconosce mandibola, mascella, denti superiori e inferiori e
          canale mandibolare. Calcolo sul PC, nessun dato inviato.
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          Modello: Dot G. et al., DentalSegmentator, J. Dent. 2024 · pesi CC BY 4.0 (doi 10.5281/zenodo.10829675).
        </p>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Avvio</h2>
        {checking && <p className="text-xs text-slate-500 mb-2">Verifica dell’ambiente (PyTorch e modello)...</p>}
        {status && !checking && (
          <p className={`text-xs mb-2 ${ready ? 'text-emerald-700' : 'text-red-700'}`}>
            {ready
              ? status.gpu ? `Pronto · scheda video: ${status.gpu}` : 'Pronto · senza scheda video NVIDIA: il calcolo può richiedere molti minuti'
              : `Non disponibile: ${!status.python ? 'manca l’ambiente .venv_seg2' : !status.model ? 'manca il modello' : status.error}`}
          </p>
        )}
        <label className="flex items-center justify-between gap-2 text-sm text-slate-700 mb-2">
          <span>Precisione</span>
          <select
            className="px-2 py-1 rounded-lg border border-slate-300 text-sm"
            value={seg2.quality}
            disabled={busy}
            onChange={(e) => onChange({ quality: e.target.value })}
          >
            <option value="normal">Normale</option>
            <option value="max">Massima (circa 8 volte più lenta)</option>
          </select>
        </label>
        <button
          className="w-full px-3 py-2 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 disabled:bg-slate-300"
          disabled={busy || !ready}
          onClick={onRun}
        >
          {result ? 'Ripeti la segmentazione automatica' : 'Avvia segmentazione automatica'}
        </button>
        {result && (
          <p className="text-[11px] text-slate-500 mt-1">Ultimo calcolo: {result.seconds} s su {result.device}.</p>
        )}
      </section>

      {result && (
        <section>
          <h2 className="text-sm font-semibold text-slate-900 mb-2">Strutture trovate</h2>
          <ul className="flex flex-col gap-1">
            {SEG2_STRUCTURES.map((structure) => {
              const found = result.labels.find((l) => l.label === structure.label)
              const present = found && found.volumeMm3 > 0
              return (
                <li key={structure.label} className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-slate-200">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-sky-600"
                    checked={Boolean(visible[structure.label])}
                    disabled={!present}
                    onChange={() => onToggle(structure.label)}
                    title="Mostra/nascondi sopra la CBCT"
                  />
                  <span className="w-3 h-3 rounded-full border border-black/10 shrink-0" style={{ background: colorCss(structure.color) }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-900 truncate">{structure.name}</div>
                    <div className="text-[11px] text-slate-500">{present ? formatVolume(found.volumeMm3) : 'non trovata'}</div>
                  </div>
                  <button
                    className="px-2 py-1 rounded-lg text-xs border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                    disabled={busy || !present}
                    onClick={() => onCreate(structure)}
                    title="Crea il modello 3D e aggiungilo agli Oggetti 3D"
                  >
                    Crea 3D
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {result && (
        <section>
          <h2 className="text-sm font-semibold text-slate-900 mb-2">Modelli 3D</h2>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm text-slate-700">
            <span>Qualità</span>
            <select
              className="px-2 py-1 rounded-lg border border-slate-300 text-sm"
              value={seg2.spacingMm}
              disabled={busy}
              onChange={(e) => onChange({ spacingMm: Number(e.target.value) })}
            >
              {QUALITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span>Triangoli</span>
            <select
              className="px-2 py-1 rounded-lg border border-slate-300 text-sm"
              value={seg2.maxTriangles}
              disabled={busy}
              onChange={(e) => onChange({ maxTriangles: Number(e.target.value) })}
            >
              {TRIANGLE_OPTIONS.map((v) => <option key={v} value={v}>max {v.toLocaleString('it-IT')}</option>)}
            </select>
            <span>Levigatura</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={seg2.smoothing}
                disabled={busy}
                onChange={(e) => onChange({ smoothing: Number(e.target.value) })}
                className="flex-1"
              />
              <span className="text-xs tabular-nums w-6 text-right">{seg2.smoothing}</span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            I modelli creati vanno negli Oggetti 3D (passo 2): da lì si nascondono, modificano ed esportano.
          </p>
        </section>
      )}
    </div>
  )
}
