@echo off
cd /d "%~dp0"
echo Avvio dell'applicazione in locale...
if not exist package.json (
  echo Errore: package.json non trovato. Assicurati di eseguire lo script dalla cartella del progetto.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Errore: cartella node_modules non trovata. Esegui "npm install" prima di avviare.
  pause
  exit /b 1
)
echo Eseguo npm run local...
npm run local
