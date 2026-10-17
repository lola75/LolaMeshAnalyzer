import React from 'react'

// Preset e cursori di contrasto/luminosita' (finestra minimo-massimo) del volume CBCT
export default function CbctContrastControls({ meta, presets, windowRange, step, onPreset, onWindow }) {
  return (
    <>
      <div className="flex gap-2 mb-3 flex-wrap">
        {presets.map((preset) => (
          <button
            key={preset.id}
            onClick={() => onPreset(preset)}
            className="px-2 py-1 rounded-lg text-xs border border-slate-300 text-slate-700 hover:bg-slate-100"
          >
            {preset.label}
          </button>
        ))}
      </div>
      {windowRange && (
        <div className="flex flex-col gap-2 text-xs text-slate-600">
          <label className="flex flex-col gap-1">
            <span>Minimo: {Math.round(windowRange[0])}</span>
            <input
              type="range"
              min={meta.min}
              max={meta.max}
              step={step}
              value={windowRange[0]}
              onChange={(e) => onWindow(Math.min(Number(e.target.value), windowRange[1] - step), windowRange[1])}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Massimo: {Math.round(windowRange[1])}</span>
            <input
              type="range"
              min={meta.min}
              max={meta.max}
              step={step}
              value={windowRange[1]}
              onChange={(e) => onWindow(windowRange[0], Math.max(Number(e.target.value), windowRange[0] + step))}
            />
          </label>
        </div>
      )}
    </>
  )
}
