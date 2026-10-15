@echo off
REM Script per creare il pacchetto Windows con Electron Builder
cd /d "%~dp0\.."
if not exist package.json (
  echo Errore: package.json non trovato. Assicurati di eseguire lo script dalla cartella windows-setup.
  pause
  exit /b 1
)

echo Creazione del pacchetto Windows (Electron build)...
npm run electron-build
if errorlevel 1 (
  echo Errore durante npm run electron-build.
  pause
  exit /b 1
)

echo Build Electron completata.
pause
