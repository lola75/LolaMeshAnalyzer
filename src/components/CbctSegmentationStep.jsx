import React from 'react'
import { OBJECT_TYPES } from './CbctImportObjectDialog'

// Passo 3 del Wizard volume: segmentazione per soglia e creazione del modello 3D.
// seg: { low, high, seed, minIslandMm3, fillHoles, maskVisible, type, spacingMm, smoothing, maxTriangles }

export const ISLAND_OPTIONS = [
  { value: 0, label: 'Nessuna' },
  { value: 10, label: '< 10 mm³' },
  { value: 100, label: '< 100 mm³' },
  { value: 1000, label: '< 1000 mm³' },
]
export const QUALITY_OPTIONS = [
  { value: 0.3, label: 'Normale (0.3 mm)' },
  { value: 0.2, label: 'Alta (0.2 mm)' },
]
export const TRIANGLE_OPTIONS = [100_000, 300_000, 1_000_000]

const button = 'px-3 py-1.5 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent'
const small = 'px-2 py-1 rounded-lg text-xs border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40'

const formatVolume = (mm3) => (mm3 >= 1000 ? `${(mm3 / 1000).toFixed(1)} cm³` : `${Math.round(mm3)} mm³`)

export default function CbctSegmentationStep({ meta, seg, step, busy, previewing, volumeMm3, presets, onChange, onSeedFromCursor, onClearSeed, onCreate }) {
  const set = (patch) => onChange(patch)
  return (
    <div className="flex flex-col gap-5">
      <section>
        <h2 className="text-sm font-semibold text-slate-900 mb-1">Soglia</h2>
        <p className="text-xs text-slate-500 mb-2">La zona selezionata è colorata in rosso sopra la CBCT.</p>
        <div className="flex gap-2 mb-3 flex-wrap">
          {presets.map((preset) => (
            <button key={preset.id} className={small} disabled={busy} onClick={() => set(preset.range())}>
              {preset.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 text-xs text-slate-600">
          <label className="flex flex-col gap-1">
            <span>Minimo: {Math.round(seg.low)}</span>
            <input
              type="range"
              min={meta.min}
              max={meta.max}
              step={step}
              value={seg.low}
              disabled={busy}
              onChange={(e) => set({ low: Math.min(Number(e.target.value), seg.high - step) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Massimo: {Math.round(seg.high)}</span>
            <input
              type="range"
              min={meta.min}
              max={meta.max}
              step={step}
              value={seg.high}
              disabled={busy}
              onChange={(e) => set({ high: Math.max(Number(e.target.value), seg.low + step) })}
            />
          </label>
        </div>
        <label className="flex items-center gap-2 mt-3 text-sm text-slate-700">
          <input
            type="checkbox"
            className="accent-sky-600"
            checked={seg.maskVisible}
            onChange={(e) => set({ maskVisible: e.target.checked })}
          />
          Mostra la zona selezionata
        </label>
        <p className="text-xs text-slate-600 mt-2 h-4">
          {previewing ? 'Calcolo dell’anteprima...' : volumeMm3 != null ? `Volume selezionato: ${formatVolume(volumeMm3)}` : ''}
        </p>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-900 mb-1">Regione</h2>
        <p className="text-xs text-slate-500 mb-2">
          Clic su una slice per mettere il cursore sulla struttura (es. la mandibola), poi “Solo regione del cursore”:
          resta solo la parte collegata a quel punto.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button className={button} disabled={busy} onClick={onSeedFromCursor}>
            Solo regione del cursore
          </button>
          <button className={button} disabled={busy || !seg.seed} onClick={onClearSeed}>
            Tutta la soglia
          </button>
        </div>
        {seg.seed && (
          <p className="text-[11px] text-sky-700 mt-1">
            Regione collegata al punto {seg.seed.map((v) => v.toFixed(1)).join(', ')} mm
          </p>
        )}
        <label className="flex items-center justify-between gap-2 mt-3 text-sm text-slate-700">
          <span>Rimuovi isole</span>
          <select
            className="px-2 py-1 rounded-lg border border-slate-300 text-sm disabled:opacity-40"
            value={seg.minIslandMm3}
            disabled={busy || Boolean(seg.seed)}
            title={seg.seed ? 'Con la regione del cursore resta già un solo pezzo' : 'Elimina i pezzi staccati più piccoli di questo volume'}
            onChange={(e) => set({ minIslandMm3: Number(e.target.value) })}
          >
            {ISLAND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 mt-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="accent-sky-600"
            checked={seg.fillHoles}
            disabled={busy}
            onChange={(e) => set({ fillHoles: e.target.checked })}
          />
          Riempi le cavità interne
        </label>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Crea modello 3D</h2>
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm text-slate-700">
          <span>Tipo</span>
          <select
            className="px-2 py-1 rounded-lg border border-slate-300 text-sm"
            value={seg.type}
            disabled={busy}
            onChange={(e) => set({ type: e.target.value })}
          >
            {OBJECT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <span>Qualità</span>
          <select
            className="px-2 py-1 rounded-lg border border-slate-300 text-sm"
            value={seg.spacingMm}
            disabled={busy}
            onChange={(e) => set({ spacingMm: Number(e.target.value) })}
          >
            {QUALITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <span>Triangoli</span>
          <select
            className="px-2 py-1 rounded-lg border border-slate-300 text-sm"
            value={seg.maxTriangles}
            disabled={busy}
            onChange={(e) => set({ maxTriangles: Number(e.target.value) })}
          >
            {TRIANGLE_OPTIONS.map((value) => <option key={value} value={value}>max {value.toLocaleString('it-IT')}</option>)}
          </select>
          <span>Levigatura</span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={seg.smoothing}
              disabled={busy}
              onChange={(e) => set({ smoothing: Number(e.target.value) })}
              className="flex-1"
            />
            <span className="text-xs tabular-nums w-5 text-right">{seg.smoothing}</span>
          </div>
        </div>
        <button
          className="w-full mt-3 px-3 py-2 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 disabled:bg-slate-300"
          disabled={busy || previewing}
          onClick={onCreate}
        >
          Crea modello 3D
        </button>
        <p className="text-[11px] text-slate-500 mt-1">
          Il modello viene aggiunto agli Oggetti 3D (passo 2): da lì si nasconde, modifica ed esporta.
        </p>
      </section>
    </div>
  )
}
