@echo off
REM Avvia il server CBCT locale su 127.0.0.1:8002
cd /d "%~dp0"
setlocal
set "PORT=8002"
if not exist ".venv_cbct\Scripts\python.exe" (
  echo Ambiente .venv_cbct non trovato. Esegui prima install_cbct.bat
  pause
  exit /b 1
)
".venv_cbct\Scripts\python.exe" "%~dp0cbct_server.py"
if errorlevel 1 (
  echo.
  echo Il server CBCT si e' chiuso con codice di errore %ERRORLEVEL%.
  echo Premi un tasto per chiudere...
  pause >nul
)
endlocal
