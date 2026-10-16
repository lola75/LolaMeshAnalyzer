@echo off
REM Crea l'ambiente Python separato per il server CBCT (.venv_cbct)
cd /d "%~dp0"
set "BASEPY=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
if not exist "%BASEPY%" set "BASEPY=python"
if not exist ".venv_cbct\Scripts\python.exe" (
  "%BASEPY%" -m venv .venv_cbct
  if errorlevel 1 (
    echo Impossibile creare .venv_cbct: serve Python 3.11 a 64 bit.
    pause
    exit /b 1
  )
)
".venv_cbct\Scripts\python.exe" -m pip install --upgrade pip
".venv_cbct\Scripts\python.exe" -m pip install -r requirements_cbct.txt
if errorlevel 1 (
  echo Installazione delle dipendenze CBCT non riuscita.
  pause
  exit /b 1
)
echo Server CBCT pronto. Avvialo con run_cbct_server.bat
pause
