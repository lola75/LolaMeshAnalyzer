@echo off
setlocal
cd /d "%~dp0"
title Installazione LolaMeshAnalyzer

echo ==================================================
echo   Installazione LolaMeshAnalyzer
echo ==================================================
echo.

REM --- 1. Controllo Node.js -------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo [ERRORE] Node.js non trovato.
  echo Installa la versione LTS da https://nodejs.org e riesegui questo script.
  start "" "https://nodejs.org/"
  goto :errore
)
for /f "delims=" %%v in ('node -v') do echo [OK] Node.js %%v

REM --- 2. Controllo Python 3.11 ---------------------------------------
set "PY="
py -3.11 --version >nul 2>&1 && set "PY=py -3.11"
if not defined PY (
  python --version 2>&1 | findstr /b /c:"Python 3.11" >nul && set "PY=python"
)
if not defined PY (
  echo [ERRORE] Python 3.11 non trovato.
  echo Installa Python 3.11 da https://www.python.org/downloads/
  echo e spunta "Add Python to PATH" durante l'installazione.
  start "" "https://www.python.org/downloads/release/python-3119/"
  goto :errore
)
for /f "delims=" %%v in ('%PY% --version') do echo [OK] %%v
echo.

REM --- 3. Librerie dell'app (npm) -------------------------------------
echo [1/2] Installazione librerie dell'app (npm install)...
call npm install
if errorlevel 1 (
  echo [ERRORE] npm install non riuscito.
  goto :errore
)
echo [OK] Librerie dell'app installate.
echo.

REM --- 4. Ambiente Python del server ----------------------------------
echo [2/2] Preparazione del server Python...
pushd "mio server"
if not exist ".venv\Scripts\python.exe" (
  echo Creazione ambiente virtuale .venv...
  %PY% -m venv .venv
  if errorlevel 1 (
    popd
    echo [ERRORE] Creazione dell'ambiente virtuale non riuscita.
    goto :errore
  )
)
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  popd
  echo [ERRORE] Installazione delle librerie Python non riuscita.
  goto :errore
)
".venv\Scripts\python.exe" -c "import meshlib.mrmeshpy, fastapi, uvicorn, numpy, open3d, SimpleITK; print('[OK] Librerie del server verificate')"
if errorlevel 1 (
  popd
  echo [ERRORE] Le librerie del server non si importano correttamente.
  goto :errore
)
popd
echo.

echo ==================================================
echo   Installazione completata.
echo   Avvio app:    AvviaApp.bat
echo   Avvio server: mio server\run_server.bat
echo ==================================================
pause
exit /b 0

:errore
echo.
echo Installazione interrotta.
pause
exit /b 1
