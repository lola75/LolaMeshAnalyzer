import React, { useRef, useState } from 'react'
import { loadSTL } from '../utils/loaders/stlLoader'
import { loadOBJ } from '../utils/loaders/objLoader'
import { loadPLY } from '../utils/loaders/plyLoader'
import { extractMetadata } from '../utils/metadataExtractor'
import { analyzeNormals } from '../utils/normalAnalyzer'
import FileFormatInfo from './FileFormatInfo'

export default function FileUploader({
  onFileLoaded,
  onInvertedDetected,
  showFormatInfo = true,
  formatInfoClassName = '',
  multiple = false
}) {
  const fileInputRef = useRef(null)
  const [isLoading, setIsLoading] = useState(false)
  const [fileName, setFileName] = useState(null)
  const [error, setError] = useState(null)

  const validateGeometry = (geometry) => {
    if (!geometry || typeof geometry.getAttribute !== 'function') {
      throw new Error('Geometria non valida')
    }
    const positionAttribute = geometry.getAttribute('position')
    if (!positionAttribute || positionAttribute.count === 0) {
      throw new Error('Geometria vuota o non valida')
    }
  }

  const loadGeometry = (extension, arrayBuffer) => {
    switch (extension) {
      case 'stl':
        return loadSTL(arrayBuffer)
      case 'obj':
        return loadOBJ(new TextDecoder().decode(arrayBuffer))
      case 'ply':
        return loadPLY(arrayBuffer)
      default:
        throw new Error('Estensione non supportata')
    }
  }

  // Uno o piu' file: ognuno viene caricato e passato a onFileLoaded (la pagina li aggiunge)
  const loadFile = async (file) => {
    const extension = file.name.split('.').pop().toLowerCase()
    if (!['stl', 'obj', 'ply'].includes(extension)) {
      throw new Error('formato non supportato (usa STL, OBJ o PLY)')
    }
    const arrayBuffer = await file.arrayBuffer()
    const geometry = loadGeometry(extension, arrayBuffer)
    validateGeometry(geometry)
    const metadata = extractMetadata(geometry, file, extension)

    let analysisResult = null
    try {
      analysisResult = analyzeNormals(geometry)
      if (analysisResult && analysisResult.hasIssues && typeof onInvertedDetected === 'function') {
        onInvertedDetected({
          fileName: file.name,
          fileSize: file.size,
          fileType: extension,
          invertedCount: analysisResult.invertedCount,
          totalFaces: analysisResult.totalFaces,
          percentage: analysisResult.percentage,
          summary: analysisResult.message
        })
      }
    } catch (err) {
      console.warn('Analisi normali fallita:', err)
    }

    onFileLoaded({
      geometry,
      metadata,
      fileName: file.name,
      fileSize: file.size,
      fileType: extension,
      file,
      analysis: analysisResult
    })
  }

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    setIsLoading(true)
    setError(null)
    const loaded = []
    const failed = []
    for (const file of files) {
      try {
        await loadFile(file)
        loaded.push(file.name)
      } catch (err) {
        console.error(err)
        failed.push(`${file.name}: ${err.message}`)
      }
    }
    setFileName(loaded.length === 0 ? null : loaded.length === 1 ? loaded[0] : `${loaded.length} file`)
    if (failed.length) setError(`Errore nel caricamento di ${failed.join(' · ')}`)
    setIsLoading(false)
    e.target.value = ''
  }

  const handleClick = () => {
    if (!isLoading) {
      fileInputRef.current?.click()
    }
  }

  return (
    <div className="space-y-4">
      <div
        onClick={handleClick}
        className="relative group cursor-pointer"
      >
        <div className="relative bg-slate-50 rounded-lg p-4 flex flex-col items-center justify-center space-y-2 border border-dashed border-slate-200 group-hover:border-sky-400 transition">
          <svg className={`w-7 h-7 ${isLoading ? 'animate-spin text-sky-500' : 'text-slate-400 group-hover:text-sky-500'} transition`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <div className="text-center">
            <p className="text-slate-800 text-xs font-medium">
              {isLoading ? 'Caricamento...' : multiple ? 'Apri una o più mesh' : 'Apri una mesh'}
            </p>
            <p className="text-slate-500 text-xs mt-1">
              Trascina o fai clic
            </p>
            <p className="text-slate-400 text-[10px] mt-1">STL · OBJ · PLY</p>
          </div>
        </div>
      </div>

      {fileName && (
        <div className="bg-transparent rounded-lg p-4 border border-slate-200">
          <p className="text-sm text-slate-700">
            <span className="font-semibold text-sky-600">File caricato:</span> {fileName}
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".stl,.obj,.ply"
        multiple={multiple}
        onChange={handleFileSelect}
        className="hidden"
      />

      {showFormatInfo && <FileFormatInfo className={formatInfoClassName} />}
    </div>
  )
}
