@echo off
REM Avvia l'app desktop (Electron): Vite su localhost:5173 e finestra dell'app,
REM che avvia da sola i server Python (mesh e CBCT). Prima volta: InstallaTutto.bat
cd /d "%~dp0"
if not exist node_modules (
  echo Librerie mancanti: esegui prima InstallaTutto.bat
  pause
  exit /b 1
)
REM niente scheda del browser: l'app si apre nella sua finestra
set "BROWSER=none"
call npm run electron-dev
