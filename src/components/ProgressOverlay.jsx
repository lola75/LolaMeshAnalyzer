import React, { useEffect, useRef, useState } from 'react'

// Barra di avanzamento sopra la vista 3D per le operazioni lunghe sul server (es. Crea guida).
// Il server non comunica l'avanzamento: la barra segue il tempo trascorso rispetto alla durata
// stimata (si avvicina al 95% senza fermarsi), le fasi sono quelle del calcolo nell'ordine reale e
// a fine lavoro la barra si completa e sparisce.
//
// task: { title, stages: [testo...], expectedMs } mentre l'operazione e' in corso, null altrimenti.
export default function ProgressOverlay({ task }) {
  const [shown, setShown] = useState(null) // { ...task, start, finishing }
  const [now, setNow] = useState(0)
  const frameRef = useRef(0)

  useEffect(() => {
    if (task) {
      setShown({ ...task, start: performance.now(), finishing: false })
      return undefined
    }
    // fine: la barra arriva al 100% e poi sparisce
    setShown((s) => (s ? { ...s, finishing: true } : s))
    const timer = setTimeout(() => setShown(null), 700)
    return () => clearTimeout(timer)
  }, [task])

  useEffect(() => {
    if (!shown || shown.finishing) return undefined
    const tick = () => {
      setNow(performance.now())
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [shown])

  if (!shown) return null
  const elapsed = Math.max(0, now - shown.start)
  const fraction = shown.finishing ? 1 : Math.min(0.95, 1 - Math.exp((-2.2 * elapsed) / Math.max(1000, shown.expectedMs)))
  const stages = shown.stages || []
  const stage = shown.finishing ? stages.length - 1 : Math.min(stages.length - 1, Math.floor((fraction / 0.95) * stages.length))
  const percent = Math.round(fraction * 100)

  return (
    <div className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-500 ${shown.finishing ? 'opacity-0' : 'opacity-100'}`}>
      <style>{`
        @keyframes lolaShimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
        @keyframes lolaPulse { 0%, 100% { opacity: .55; transform: scale(.85); } 50% { opacity: 1; transform: scale(1); } }
      `}</style>
      <div
        className="w-[380px] max-w-[calc(100%-32px)] rounded-2xl border border-white/20 bg-slate-900/70 px-5 py-4 text-white shadow-2xl backdrop-blur-md"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={shown.title}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-400" style={{ animation: 'lolaPulse 1.2s ease-in-out infinite' }} />
            <span className="text-sm font-semibold tracking-wide">{shown.title}</span>
          </div>
          <span className="text-lg font-bold tabular-nums text-sky-300">{percent}%</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-white/10 ring-1 ring-inset ring-white/10">
          <div
            className="h-full rounded-full shadow-[0_0_16px_rgba(56,189,248,0.7)] transition-[width] duration-300 ease-out"
            style={{
              width: `${Math.max(3, percent)}%`,
              backgroundImage: 'linear-gradient(90deg, #0ea5e9, #6366f1, #a855f7, #0ea5e9)',
              backgroundSize: '200% 100%',
              animation: 'lolaShimmer 1.6s linear infinite',
            }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs">
          <span className="truncate text-slate-200">{shown.finishing ? 'Completato' : stages[stage]}</span>
          <span className="shrink-0 tabular-nums text-slate-400">{(elapsed / 1000).toFixed(1)} s</span>
        </div>
        {stages.length > 1 && (
          <div className="mt-2.5 flex gap-1">
            {stages.map((label, i) => (
              <span
                key={label}
                title={label}
                className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i < stage || shown.finishing ? 'bg-sky-400' : i === stage ? 'bg-sky-400/60' : 'bg-white/15'}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
