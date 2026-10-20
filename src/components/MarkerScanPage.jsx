import React from 'react'

// Pagina "Crea Marker Scan" (sottomenu CBCT degli Strumenti): contenuto in progettazione.
export default function MarkerScanPage({ onClose }) {
  return (
    <div className="alignment-workspace fixed inset-0 z-50 flex flex-col">
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200 p-4">
        <div className="mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Crea Marker Scan</h1>
            <p className="text-sm text-slate-600 mt-1">Strumento in preparazione</p>
          </div>
          <button onClick={onClose} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700">
            Chiudi
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-6">
        <div className="max-w-md text-center text-slate-600">
          <div className="text-4xl mb-3" aria-hidden="true">◎</div>
          <h2 className="text-base font-semibold text-slate-800 mb-1">Pagina in preparazione</h2>
          <p className="text-sm">Qui verrà realizzato lo strumento per creare il Marker Scan.</p>
        </div>
      </div>
    </div>
  )
}
