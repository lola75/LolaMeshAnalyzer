@echo off
REM Crea un ambiente virtuale separato per Server 2 e installa le dipendenze da zero.
cd /d "%~dp0"
if not exist ".venv2\Scripts\python.exe" (
  python -m venv .venv2
)
if exist ".venv2\Scripts\python.exe" (
  ".venv2\Scripts\python.exe" -m pip install --upgrade pip
  ".venv2\Scripts\python.exe" -m pip install -r requirements.txt
) else (
  echo ERRORE: non e' stato possibile creare o trovare l'ambiente .venv2.
)
