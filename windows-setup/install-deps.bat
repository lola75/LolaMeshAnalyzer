@echo off
REM Script per installare dipendenze npm per il progetto Analizzatore di Mesh 3D
SETLOCAL
cd /d "%~dp0\.."
if not exist package.json (
  echo Errore: package.json non trovato. Assicurati di eseguire lo script dalla cartella windows-setup.
  pause
  exit /b 1
)

echo Aprendo la pagina per scaricare Node.js se non è già installato...
start "" "https://nodejs.org/"

echo Installando le dipendenze npm...
npm install
if errorlevel 1 (
  echo Errore durante npm install.
  pause
  exit /b 1
)

echo Installazione completata.
pause
