import React from 'react'

const button = 'px-3 py-1.5 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent'

const colorCss = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`

// Passo 2 del Wizard volume: importazione degli oggetti 3D (scansioni, ceratura, guide...)
export default function CbctMeshStep({ busy, objects, selectedId, onSelect, onImport, onRemove, onToggleVisible, onEdit }) {
  const selected = objects.find((o) => o.id === selectedId)
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
                  <input
                    type="checkbox"
                    checked={object.visible}
                    onChange={() => onToggleVisible(object.id)}
                    onClick={(event) => event.stopPropagation()}
                    title={object.visible ? 'Nascondi oggetto' : 'Mostra oggetto'}
                    aria-label={`${object.visible ? 'Nascondi' : 'Mostra'} ${object.type}`}
                    className="w-4 h-4 shrink-0 accent-sky-600 cursor-pointer"
                  />
                  <span
                    className={`w-3 h-3 rounded-full shrink-0 border border-black/10 ${object.visible ? '' : 'opacity-30'}`}
                    style={{ background: colorCss(object.color) }}
                  />
                  <div className={`flex-1 min-w-0 ${object.visible ? '' : 'opacity-50'}`}>
                    <div className="text-sm text-slate-900 truncate">{object.type}</div>
                    <div className="text-[11px] text-slate-500 truncate" title={object.fileName}>{object.fileName}</div>
                  </div>
                  <button
                    className="w-6 h-6 rounded text-slate-400 hover:text-sky-700 hover:bg-sky-50 disabled:opacity-40"
                    title="Modifica oggetto (Modificatore mesh)"
                    aria-label={`Modifica ${object.type}`}
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation()
                      onEdit(object.id)
                    }}
                  >
                    ✎
                  </button>
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
        <button
          className={button}
          disabled={busy || !selected}
          title={selected ? `Modifica ${selected.type} con il Modificatore mesh` : 'Seleziona un oggetto nella lista'}
          onClick={() => onEdit(selected.id)}
        >
          Modifica
        </button>
        <button className={button} disabled title="Prossima fase in sviluppo">Matching</button>
        <button className={button} disabled title="Prossima fase in sviluppo">Operazioni Booleane</button>
      </section>
    </div>
  )
}
