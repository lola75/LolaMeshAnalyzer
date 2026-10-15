import React, { useState } from 'react'

export default function MetadataEditor({ metadata, onChange }) {
  const [editMode, setEditMode] = useState({})
  const [localMetadata, setLocalMetadata] = useState(metadata || {})

  const handleEdit = (key) => {
    setEditMode(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleChange = (key, value) => {
    const updated = { ...localMetadata, [key]: value }
    setLocalMetadata(updated)
    onChange(updated)
  }

  const downloadMetadata = () => {
    const jsonData = JSON.stringify(localMetadata, null, 2)
    const blob = new Blob([jsonData], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `metadati-${localMetadata.fileName || 'mesh'}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const formatValue = (value) => {
    if (typeof value === 'number') {
      return Number.isInteger(value) ? value : value.toFixed(2)
    }
    return value
  }

  const metadataFields = [
    { key: 'fileName', label: '📄 Nome File', editable: true },
    { key: 'fileType', label: '📦 Tipo', editable: false },
    { key: 'fileSize', label: '💾 Dimensione', editable: false },
    { key: 'vertices', label: '📍 Vertici', editable: false },
    { key: 'triangles', label: '△ Triangoli', editable: false },
    { key: 'bounds', label: '📐 Dimensioni', editable: false },
    { key: 'author', label: '👤 Autore', editable: true },
    { key: 'description', label: '📝 Descrizione', editable: true },
    { key: 'tags', label: '🏷️ Tag', editable: true },
  ]

  if (!metadata) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-slate-500">Carica un file per visualizzare i metadati</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-slate-900">Metadati</h2>
        <span className="text-xs bg-sky-100 text-sky-700 px-2 py-1 rounded-full">
          {Object.keys(metadata).length} proprietà
        </span>
      </div>

      <div className="space-y-3">
        {metadataFields.map(field => {
          const value = localMetadata[field.key]
          const isEditing = editMode[field.key]

          if (value === undefined) return null

          let displayValue = value
          if (field.key === 'fileSize') {
            displayValue = `${(value / 1024).toFixed(2)} KB`
          } else if (field.key === 'bounds') {
            displayValue = value ? `${formatValue(value.x.toFixed(2))} × ${formatValue(value.y.toFixed(2))} × ${formatValue(value.z.toFixed(2))}` : 'N/A'
          }

          return (
            <div key={field.key} className="bg-slate-50 rounded-lg p-3 border border-slate-200 hover:border-sky-300 transition">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  {field.label}
                </label>
                {field.editable && (
                  <button
                    onClick={() => handleEdit(field.key)}
                    className="text-xs text-sky-600 hover:text-sky-700 transition"
                  >
                    {isEditing ? '✓ Salva' : '✏️ Modifica'}
                  </button>
                )}
              </div>

              {isEditing ? (
                <input
                  type="text"
                  value={localMetadata[field.key]}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  className="mt-2 w-full bg-white text-slate-900 text-xs px-2 py-1 rounded border border-slate-300 focus:border-sky-500 focus:outline-none"
                  autoFocus
                />
              ) : (
                <p className="text-xs text-slate-600 mt-1 break-words">
                  {String(displayValue)}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Custom Fields */}
      <div className="mt-6 pt-6 border-t border-slate-200">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Campo Personalizzato</h3>
        <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
          <input
            type="text"
            placeholder="Nome campo..."
            className="w-full bg-white text-slate-900 text-xs px-2 py-1 rounded border border-slate-300 focus:border-sky-500 focus:outline-none mb-2"
          />
          <textarea
            placeholder="Valore..."
            className="w-full bg-white text-slate-900 text-xs px-2 py-1 rounded border border-slate-300 focus:border-sky-500 focus:outline-none resize-none h-16"
          />
          <button className="mt-2 w-full bg-sky-600 hover:bg-sky-700 text-white text-xs font-medium py-2 rounded transition">
            + Aggiungi Campo
          </button>
        </div>
      </div>

      {/* Export */}
      <div className="mt-6 pt-6 border-t border-slate-200">
        <button 
          onClick={downloadMetadata}
          className="w-full bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-700 hover:to-indigo-700 text-white text-xs font-medium py-2 rounded-lg transition">
          📥 Scarica Metadati JSON
        </button>
      </div>
    </div>
  )
}
