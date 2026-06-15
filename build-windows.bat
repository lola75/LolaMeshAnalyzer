@echo off
cd /d "d:\Sviluppo app\Analizzatore di mesh"
setlocal
set CSC_IDENTITY_AUTO_DISCOVERY=false
set WIN_CSC_KEY_PASSWORD=
set WIN_CSC_LINK=
npm run build
npx electron-builder --win portable --publish never
pause
