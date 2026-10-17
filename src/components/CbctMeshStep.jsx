import React from 'react'

const button = 'px-3 py-1.5 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent'

const colorCss = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`

// Passo 2 del Wizard volume: importazione degli oggetti 3D (scansioni, ceratura, guide...)
export default function CbctMeshStep({ busy, objects, selectedId, onSelect, onImport, onRemove }) {
  return (
    <div className="flex flex-col gap-4 min-h-full">
      <section>
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Importa oggetti 3D</h2>
        <button
          className="w-full px-3 py-2 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 disabled:bg-slate-300"
          disabled={busy}
          onClick={onImport}
        >
          Importa
        </button>
      </section>

      <section className="flex-1">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Oggetti 3D</h2>
        {objects.length === 0 ? (
          <p className="text-xs text-slate-500">Nessun oggetto importato. Premi “Importa” per aggiungere STL, PLY o OBJ.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {objects.map((object) => (
              <li key={object.id}>
                <div
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border cursor-pointer ${selectedId === object.id ? 'border-sky-500 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'}`}
                  onClick={() => onSelect(object.id)}
                >
                  <span className="w-3 h-3 rounded-full shrink-0 border border-black/10" style={{ background: colorCss(object.color) }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-900 truncate">{object.type}</div>
                    <div className="text-[11px] text-slate-500 truncate" title={object.fileName}>{object.fileName}</div>
                  </div>
                  <button
                    className="w-6 h-6 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40"
                    title="Rimuovi oggetto"
                    aria-label={`Rimuovi ${object.type}`}
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation()
                      onRemove(object.id)
                    }}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <button className={button} disabled title="Prossima fase in sviluppo">Modifica</button>
        <button className={button} disabled title="Prossima fase in sviluppo">Matching</button>
        <button className={button} disabled title="Prossima fase in sviluppo">Operazioni Booleane</button>
      </section>
    </div>
  )
}
