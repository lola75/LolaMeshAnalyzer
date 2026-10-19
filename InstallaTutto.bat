@echo off
REM Installazione e verifica completa (Node.js, Python 3.11, npm, server mesh e CBCT,
REM segmentazione automatica facoltativa). Dettagli in InstallaTutto.ps1
cd /d "%~dp0"
title Installazione LolaMeshAnalyzer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0InstallaTutto.ps1" %*
pause
