import React from 'react'
import MeshModifier from './MeshModifier'
import MarkerScanTools from './MarkerScanTools'

// Pagina "Crea Marker Scan" (Strumenti > CBCT): stessa pagina del Modificatore mesh (caricamento
// delle mesh, vista 3D, storico, Applica / Ignora modifiche) senza i suoi gruppi di strumenti, al
// posto dei quali ci sono gli strumenti della guida (Rimozione Sottosquadri, Generazione Guida).
export default function MarkerScanPage({ onClose }) {
  return (
    <div className="fixed inset-0 z-50">
      <MeshModifier
        geometry={null}
        title="Crea Marker Scan"
        hideStandardTools
        gridOverlay
        extraSidebar={({ meshes, setMeshes, canvasHandlersRef, viewportOverlay, callMeshServer, rendererRef, meshesRef, sceneRef, cameraRef, showMessage }) => (
          <MarkerScanTools
            meshes={meshes}
            setMeshes={setMeshes}
            canvasHandlersRef={canvasHandlersRef}
            viewportOverlay={viewportOverlay}
            callMeshServer={callMeshServer}
            rendererRef={rendererRef}
            meshesRef={meshesRef}
            sceneRef={sceneRef}
            cameraRef={cameraRef}
            onAction={(name) => showMessage(`ℹ️ "${name}": funzione in preparazione.`)}
            showMessage={showMessage}
          />
        )}
        requireEditConsent={false}
        onClose={onClose}
      />
    </div>
  )
}
