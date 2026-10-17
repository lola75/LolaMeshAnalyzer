import React from 'react'

// Barra di avanzamento sopra il visualizzatore. progress = null mostra una barra indeterminata
// (operazioni del server di cui non si conosce la durata).
export default function CbctLoadingProgress({ message, progress }) {
  const known = typeof progress === 'number'
  const percent = known ? Math.round(Math.min(Math.max(progress, 0), 100)) : null

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-slate-950/55 backdrop-blur-[2px] text-white">
      <div className="w-[min(420px,85%)] px-6 py-5 rounded-2xl bg-slate-900/90 border border-white/10 shadow-2xl shadow-sky-950/50">
        <div className="flex items-end justify-between gap-4 mb-3">
          <span className="text-sm text-slate-300 leading-snug">{message}</span>
          {known && (
            <span className="text-3xl font-semibold tabular-nums bg-gradient-to-r from-sky-300 to-cyan-200 bg-clip-text text-transparent">
              {percent}
              <span className="text-lg">%</span>
            </span>
          )}
        </div>
        <div
          className="relative h-2.5 rounded-full bg-white/10 overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={known ? percent : undefined}
          aria-valuetext={message}
        >
          {known ? (
            <div
              className="cbct-progress-fill absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          ) : (
            <div className="cbct-progress-indeterminate absolute inset-y-0 w-1/3 rounded-full" />
          )}
        </div>
      </div>
    </div>
  )
}
