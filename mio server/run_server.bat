@echo off
REM Avvia il server MeshLib locale su 127.0.0.1:8000
cd /d "%~dp0"
setlocal
set "PORT=8000"
set "PY="
if exist ".venv\Scripts\python.exe" (
  set "PY=.venv\Scripts\python.exe"
) else if exist ".venv_py311\Scripts\python.exe" (
  set "PY=.venv_py311\Scripts\python.exe"
) else (
  set "PY=python"
)

echo Using Python: %PY%
echo Using PORT: %PORT%
"%PY%" "%~dp0server.py"
if errorlevel 1 (
  echo.
  echo Il server si e' chiuso con codice di errore %ERRORLEVEL%.
  echo Premi un tasto per chiudere...
  pause >nul
)

endlocalnpm run dev

