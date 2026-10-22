import React from 'react'
import MeshModifier from './MeshModifier'
import Print3DTools from './Print3DTools'

// "Utilità di stampa 3D" (Strumenti): stessa pagina del Modificatore mesh (caricamento delle mesh,
// vista 3D con tutte le sue impostazioni, storico, Applica / Ignora modifiche) senza i suoi gruppi
// di strumenti nella colonna di destra; gli strumenti per la stampa 3D si aggiungeranno al loro posto.
// initialMeshes: mesh di ritorno dal Modificatore; onOpenModifier(meshes): pulsante "Modifica Mesh"
// onApply(geometry, { name }): Applica modifiche porta il risultato nella pagina principale
export default function Print3DPage({ onClose, onApply = null, initialMeshes = null, onOpenModifier = null }) {
  return (
    <div className="fixed inset-0 z-50">
      <MeshModifier
        geometry={null}
        initialMeshes={initialMeshes}
        onOpenModifier={onOpenModifier}
        title="Utilità di stampa 3D"
        hideStandardTools
        extraSidebar={({ meshes, setMeshes, meshesRef, sceneRef, cameraRef, canvasHandlersRef, viewportOverlay, callMeshServer, showMessage, setToolGrid }) => (
          <Print3DTools
            meshes={meshes}
            setMeshes={setMeshes}
            meshesRef={meshesRef}
            sceneRef={sceneRef}
            cameraRef={cameraRef}
            canvasHandlersRef={canvasHandlersRef}
            setToolGrid={setToolGrid}
            viewportOverlay={viewportOverlay}
            callMeshServer={callMeshServer}
            showMessage={showMessage}
            onAction={(name) => showMessage(`ℹ️ "${name}": funzione in preparazione.`)}
          />
        )}
        requireEditConsent={false}
        onApply={onApply}
        onClose={onClose}
      />
    </div>
  )
}
