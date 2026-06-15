@echo off
cd /d "%~dp0"
echo Eseguo lo script di setup PowerShell...
powershell -ExecutionPolicy Bypass -File "%~dp0InstallAndRun.ps1"
pause
