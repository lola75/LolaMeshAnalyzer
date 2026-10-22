import React from 'react'

// Pannelli degli strumenti aggiuntivi del Modificatore mesh:
// Leviga bordo (Smooth Boundary), Crea solido (Make Solid), Ponte (Bridge).

export const EXTRA_TOOLS = {
  smoothBoundary: 'Leviga bordo',
  makeSolid: 'Crea solido',
  bridge: 'Ponte',
}

const number = 'w-16 px-1.5 py-0.5 border border-slate-300 rounded-md text-sm text-right tabular-nums'
const primary = 'w-full px-3 py-2 rounded-lg text-sm font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:bg-slate-300'
const secondary = 'px-3 py-1.5 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40'

export default function MeshExtraToolsPanel({ tool, meshName, busy, params, onParams, info, onApply, onReset, onClose }) {
  const set = (patch) => onParams(patch)
  return (
    <div className="absolute bottom-8 left-[164px] w-[360px] bg-white/95 border border-slate-200 rounded-2xl shadow-2xl backdrop-blur-sm text-slate-800">
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-200">
        <div>
          <div className="text-sm font-semibold text-slate-900">{EXTRA_TOOLS[tool]}</div>
          <div className="text-xs text-slate-500 truncate max-w-[260px]">{meshName}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-7 w-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100"
          aria-label={`Chiudi ${EXTRA_TOOLS[tool]}`}
        >
          ×
        </button>
      </div>

      <div className="px-4 py-3 space-y-3 text-sm">
        {tool === 'smoothBoundary' && (
          <>
            <p className="text-xs text-slate-500">
              Ammorbidisce il contorno aperto della mesh (es. il bordo frastagliato di una scansione) senza restringerlo.
              Sulla mesh: <span className="font-semibold text-green-600">verde</span> i bordi che verranno levigati,
              grigio gli altri.
              {info?.loops != null && ` Bordi aperti: ${info.loops}.`}
            </p>
            <div className="grid grid-cols-[110px_1fr_auto] items-center gap-x-3 gap-y-3">
              <label className="text-slate-600" htmlFor="sb-iterations">Intensità</label>
              <input id="sb-iterations" type="range" min={0} max={100} step={1} value={params.iterations} onChange={(e) => set({ iterations: Number(e.target.value) })} />
              <span className={number}>{params.iterations}</span>
              <label className="text-slate-600" htmlFor="sb-rings" title="Quanti anelli di triangoli vicini al bordo seguono la levigatura">Fascia interna</label>
              <input id="sb-rings" type="range" min={0} max={6} step={1} value={params.rings} onChange={(e) => set({ rings: Number(e.target.value) })} />
              <span className={number}>{params.rings}</span>
            </div>
            <label className="flex items-center justify-between gap-2">
              <span className="text-slate-600">Bordi</span>
              <select className="px-2 py-1 rounded-lg border border-slate-300 text-sm" value={params.loops} onChange={(e) => set({ loops: e.target.value })}>
                <option value="longest">Solo il più lungo (bordo esterno)</option>
                <option value="all">Tutti (anche i fori)</option>
              </select>
            </label>
            <button type="button" className={primary} disabled={busy || info?.loops === 0 || params.iterations === 0} onClick={onApply}>Leviga bordo</button>
          </>
        )}

        {tool === 'makeSolid' && (
          <>
            <p className="text-xs text-slate-500">
              Chiude le aperture e ricostruisce la mesh come solido pieno, senza fori né auto-intersezioni
              (calcolo sul server mesh).
            </p>
            <label className="flex items-center justify-between gap-2">
              <span className="text-slate-600">Precisione</span>
              <select className="px-2 py-1 rounded-lg border border-slate-300 text-sm" value={params.voxelSize} onChange={(e) => set({ voxelSize: Number(e.target.value) })}>
                <option value={0.1}>Alta (0.1 mm)</option>
                <option value={0.2}>Media (0.2 mm)</option>
                <option value={0.3}>Bassa (0.3 mm)</option>
                <option value={0.5}>Molto bassa (0.5 mm)</option>
              </select>
            </label>
            <div className="grid grid-cols-[110px_1fr_auto] items-center gap-x-3">
              <label className="text-slate-600" htmlFor="solid-offset" title="Maggiore di 0 ingrandisce il solido, minore lo restringe">Offset</label>
              <input id="solid-offset" type="range" min={-1} max={2} step={0.05} value={params.offset} onChange={(e) => set({ offset: Number(e.target.value) })} />
              <span className={number}>{params.offset.toFixed(2)} mm</span>
            </div>
            <label className="flex items-center justify-between gap-2">
              <span className="text-slate-600">Triangoli</span>
              <select className="px-2 py-1 rounded-lg border border-slate-300 text-sm" value={params.maxTriangles} onChange={(e) => set({ maxTriangles: Number(e.target.value) })}>
                {[200000, 400000, 1000000].map((v) => <option key={v} value={v}>max {v.toLocaleString('it-IT')}</option>)}
              </select>
            </label>
            <button type="button" className={primary} disabled={busy} onClick={onApply}>{busy ? 'Creazione del solido...' : 'Crea solido'}</button>
          </>
        )}

        {tool === 'bridge' && (
          <>
            <p className="text-xs text-slate-500">
              Clicca vicino a un bordo aperto (punto A), poi vicino a un altro bordo o a un altro tratto dello stesso (punto B):
              i due tratti vengono uniti da una striscia di triangoli. Clic sullo sfondo per ruotare la vista.
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className={`px-2 py-1.5 rounded-lg border ${info?.a != null ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                Punto A: {info?.a != null ? 'scelto' : '—'}
              </div>
              <div className={`px-2 py-1.5 rounded-lg border ${info?.b != null ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                Punto B: {info?.b != null ? 'scelto' : '—'}
              </div>
            </div>
            {info?.gap != null && <p className="text-xs text-slate-600">Distanza tra i punti: {info.gap.toFixed(2)} mm</p>}
            <div className="grid grid-cols-[110px_1fr_auto] items-center gap-x-3">
              <label className="text-slate-600" htmlFor="bridge-width" title="Lunghezza dei due tratti di bordo uniti">Larghezza</label>
              <input id="bridge-width" type="range" min={0.5} max={20} step={0.5} value={params.width} onChange={(e) => set({ width: Number(e.target.value) })} />
              <span className={number}>{params.width} mm</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={secondary} disabled={busy || (info?.a == null && info?.b == null)} onClick={onReset}>Azzera punti</button>
              <button type="button" className={`${primary} !w-auto`} disabled={busy || info?.a == null || info?.b == null} onClick={onApply}>Crea ponte</button>
            </div>
            {info?.error && <p className="text-xs text-red-700">{info.error}</p>}
          </>
        )}
      </div>
    </div>
  )
}
