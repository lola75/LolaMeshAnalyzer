import React from 'react'

export default function FileFormatInfo({ className = '' }) {
  return (
    <div className={`grid grid-cols-1 gap-3 text-xs text-slate-600 ${className}`}>
      <div className="bg-white/5 rounded-lg p-3 border border-slate-200">
        <p className="font-semibold text-slate-700 mb-1">📦 STL</p>
        <p>Stereolitografia - Geometria triangolare</p>
      </div>
      <div className="bg-white/5 rounded-lg p-3 border border-slate-200">
        <p className="font-semibold text-slate-700 mb-1">🎨 OBJ</p>
        <p>Wavefront - Con supporto per materiali</p>
      </div>
      <div className="bg-white/5 rounded-lg p-3 border border-slate-200">
        <p className="font-semibold text-slate-700 mb-1">🌈 PLY</p>
        <p>Polygon File Format - Vertici e colori</p>
      </div>
    </div>
  )
}
