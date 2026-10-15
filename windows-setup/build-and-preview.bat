@echo off
REM Script per build di produzione e preview locale
cd /d "%~dp0\.."
if not exist package.json (
  echo Errore: package.json non trovato. Assicurati di eseguire lo script dalla cartella windows-setup.
  pause
  exit /b 1
)

echo Eseguo build di produzione...
npm run build
if errorlevel 1 (
  echo Errore durante npm run build.
  pause
  exit /b 1
)

echo Avvio preview locale...
npm run preview
