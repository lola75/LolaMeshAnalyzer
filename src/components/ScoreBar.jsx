import React from 'react'

function interpolateColor(score) {
  // score: 0..10 (10 = perfetto -> verde, 0 = pessimo -> rosso)
  const t = Math.max(0, Math.min(1, score / 10))
  // red (#ef4444) -> rgb(239,68,68)
  // green (#10b981) -> rgb(16,185,129)
  const r = Math.round(239 * (1 - t) + 16 * t)
  const g = Math.round(68 * (1 - t) + 185 * t)
  const b = Math.round(68 * (1 - t) + 129 * t)
  return `rgb(${r}, ${g}, ${b})`
}

export default function ScoreBar({ uploadHistory = [] }) {
  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()

  const monthly = uploadHistory.filter(u => {
    try {
      const d = new Date(u.timestamp)
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear
    } catch (err) {
      return false
    }
  })

  const total = monthly.length
  const badCount = monthly.filter(m => m.bad).length

  const score = total === 0 ? 10 : Math.round((1 - badCount / total) * 10)
  const color = interpolateColor(score)
  const fillPercent = Math.round((score / 10) * 100)
  const visiblePercent = total > 0 && fillPercent === 0 ? 4 : fillPercent

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-slate-600 font-medium">Punteggio mensile</div>
        <div className="text-xs text-slate-500">{score} / 10</div>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden border border-slate-200">
        <div
          className="h-2.5 rounded-full transition-all duration-300"
          style={{
            display: 'block',
            width: `${visiblePercent}%`,
            minWidth: total > 0 ? '16px' : '0',
            backgroundColor: color,
            boxShadow: total > 0 ? `0 0 12px ${color}` : 'none'
          }}
        />
      </div>
      <div className="flex justify-between text-xs text-slate-500 mt-2">
        <div>{total} caricamenti questo mese</div>
        <div>{badCount} con problemi (normali invertite o fori)</div>
      </div>
    </div>
  )
}
