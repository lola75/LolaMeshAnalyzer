import React from 'react'

// Pannello "Inverti Normali" del Modificatore mesh: pennello per colorare la zona da invertire,
// oppure inversione di tutta la mesh. Le facce viste dal retro sono azzurre nella vista.
export default function MeshNormalsPanel({ meshName, ready, diameter, onDiameter, selectedCount, selectedTriangles, onClear, onInvertSelection, onFlipSelected, onFlipAll, onClose }) {
  const { value, min, max, step, decimals } = diameter
  const button = 'px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed'
  return (
    <div className="absolute bottom-8 left-[164px] w-[360px] bg-white/95 border border-slate-200 rounded-2xl shadow-2xl backdrop-blur-sm text-slate-800">
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-200">
        <div>
          <div className="text-sm font-semibold text-slate-900">Inverti Normali</div>
          <div className="text-xs text-slate-500 truncate max-w-[260px]">{meshName}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-7 w-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100"
          aria-label="Chiudi Inverti Normali"
        >
          ×
        </button>
      </div>

      <div className="px-4 py-3 space-y-3">
        {!ready ? (
          <div className="text-xs text-slate-600">⏳ Preparazione del pennello in corso...</div>
        ) : (
          <>
            <div className="text-xs text-slate-500">
              Tieni premuto il tasto sinistro sulla mesh e trascina per colorare la zona da invertire (Shift: cancella).
              Le facce <span className="font-semibold text-sky-600">azzurre</span> sono viste dal retro: lì la normale è
              rivolta dall&apos;altra parte. Ctrl + rotella cambia il diametro.
            </div>

            <div className="grid grid-cols-[130px_1fr] items-center gap-x-3 text-sm">
              <label className="text-slate-600" htmlFor="normals-brush-diameter">Dimensione Strumento</label>
              <div className="flex items-center gap-2">
                <input
                  id="normals-brush-diameter"
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={value}
                  onChange={(e) => onDiameter(e.target.value)}
                  className="flex-1 min-w-0 accent-sky-600"
                />
                <input
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={Number(value.toFixed(decimals))}
                  onChange={(e) => onDiameter(e.target.value)}
                  className="w-16 px-1.5 py-0.5 border border-slate-300 rounded-md text-sm text-right tabular-nums"
                  aria-label="Dimensione dello strumento in mm"
                />
                <span className="text-slate-500">mm</span>
              </div>
            </div>

            <div className="text-xs text-slate-600 tabular-nums">
              Zona colorata: <span className="font-semibold text-[#964B00]">{selectedTriangles.toLocaleString('it-IT')}</span> triangoli
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={onClear} disabled={selectedCount === 0} className={button}>Cancella Selezione</button>
              <button type="button" onClick={onInvertSelection} className={button}>Inverti Selezione</button>
            </div>

            <button
              type="button"
              onClick={onFlipSelected}
              disabled={selectedTriangles === 0}
              className="w-full px-3 py-2.5 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Inverti normali della zona
            </button>
            <button type="button" onClick={onFlipAll} className={`${button} w-full`}>
              Inverti tutta la mesh
            </button>
          </>
        )}
      </div>
    </div>
  )
}
