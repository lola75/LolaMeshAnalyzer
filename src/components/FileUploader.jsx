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
  formatInfoClassName = ''
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

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    const extension = file.name.split('.').pop().toLowerCase()
    if (!['stl', 'obj', 'ply'].includes(extension)) {
      setError('Formato non supportato. Usa STL, OBJ o PLY.')
      return
    }

    setIsLoading(true)
    setError(null)
    setFileName(file.name)

    try {
      const arrayBuffer = await file.arrayBuffer()
      let geometry

      switch (extension) {
        case 'stl':
          geometry = loadSTL(arrayBuffer)
          break
        case 'obj':
          geometry = loadOBJ(new TextDecoder().decode(arrayBuffer))
          break
        case 'ply':
          geometry = loadPLY(arrayBuffer)
          break
        default:
          throw new Error('Estensione non supportata')
      }

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
    } catch (err) {
      setError(`Errore nel caricamento: ${err.message}`)
      console.error(err)
      setFileName(null)
    } finally {
      setIsLoading(false)
      e.target.value = ''
    }
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
              {isLoading ? 'Caricamento...' : 'Apri una mesh'}
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
        onChange={handleFileSelect}
        className="hidden"
      />

      {showFormatInfo && <FileFormatInfo className={formatInfoClassName} />}
    </div>
  )
}
