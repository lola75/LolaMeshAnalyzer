@echo off
REM Script per avviare il server di sviluppo Vite
cd /d "%~dp0\.."
if not exist package.json (
  echo Errore: package.json non trovato. Assicurati di eseguire lo script dalla cartella windows-setup.
  pause
  exit /b 1
)

echo Avvio dell'app in modalita di sviluppo...
npm run dev
