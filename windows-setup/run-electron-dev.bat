@echo off
REM Script per avviare l'app Electron in modalità sviluppo
cd /d "%~dp0\.."
if not exist package.json (
  echo Errore: package.json non trovato. Assicurati di eseguire lo script dalla cartella windows-setup.
  pause
  exit /b 1
)

echo Avvio dell'app Electron in sviluppo...
npm run electron-dev
