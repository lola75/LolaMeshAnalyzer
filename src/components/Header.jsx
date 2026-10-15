import React from 'react'
import ChatButton from './ChatButton'

export default function Header({ invertedCount = 0, onExportInvertedLog, onClearInvertedLog, dentaxUrl, onOpenDentax, onConfigureDentax, onOpenMMXSettings }) {
  return (
    <header className="bg-white border-b border-slate-200">
      <div className="mx-auto px-5 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <svg className="w-7 h-7 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2 1m0 0l-2-1m2 1v2.5" />
            </svg>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Analizzatore di Mesh</h1>
              <p className="text-slate-500 text-xs">Workspace 3D</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1 text-slate-700 text-sm">
            <div className="flex flex-wrap items-center justify-end gap-1">
            <button
              onClick={onExportInvertedLog}
              className="px-3 py-2 bg-slate-50 rounded-lg hover:bg-slate-100 text-slate-600 flex items-center gap-2"
              title="Esporta registro normali invertite"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v12m0 0l3-3m-3 3l-3-3M21 21H3" />
              </svg>
              <span className="hidden lg:inline">Esporta</span>
              {invertedCount > 0 && (
                <span className="ml-2 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-red-100 bg-red-600 rounded-full">
                  {invertedCount}
                </span>
              )}
            </button>
            <button
              onClick={() => onOpenDentax && onOpenDentax(dentaxUrl)}
              className="px-3 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 text-xs flex items-center gap-2"
              title={dentaxUrl || 'Configura URL DENTAX'}
            >
              DENTALX
            </button>
            <button
              onClick={() => onConfigureDentax && onConfigureDentax()}
              className="px-2 py-2 bg-slate-50 rounded-lg hover:bg-slate-100 text-slate-600 text-sm"
              title="Configura URL DENTAX"
            >
              ✎
            </button>
            <button
              onClick={onClearInvertedLog}
              className="px-3 py-2 bg-slate-50 rounded-lg hover:bg-slate-100 text-slate-600 text-xs"
              title="Svuota registro"
            >
              <span className="hidden lg:inline">Svuota registro</span>
              <span className="lg:hidden">Pulisci</span>
            </button>
            <ChatButton />
            <button
              onClick={() => onOpenMMXSettings && onOpenMMXSettings()}
              className="px-2 py-2 bg-slate-50 rounded-lg hover:bg-slate-100 text-slate-600 text-sm"
              title="Impostazioni MMX Dental"
            >
              ⚙
            </button>
            <span className="hidden sm:inline px-2 py-1 text-slate-400 text-xs">v1.0</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
