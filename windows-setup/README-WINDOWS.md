# Installazione Windows per Analizzatore di Mesh 3D

Questa cartella contiene tutte le istruzioni e gli script necessari per scaricare, installare e avviare l'applicazione su un PC Windows.

## Requisiti di sistema

- Windows 10 o successivo
- Connessione a internet per scaricare Node.js e i pacchetti npm
- Node.js 16 o versione successiva
- npm incluso in Node.js

## Dipendenze del progetto

Il progetto usa le seguenti dipendenze principali:

- `express`
- `react`
- `react-dom`
- `three`

Dev dependencies richieste per lo sviluppo e la build:

- `@types/node`
- `@vitejs/plugin-react`
- `autoprefixer`
- `concurrently`
- `electron`
- `electron-builder`
- `electron-is-dev`
- `postcss`
- `tailwindcss`
- `vite`
- `wait-on`

## File principali del progetto

```
package.json
vite.config.js
postcss.config.js
tailwind.config.js
README.md
server.js
index.html
public/main.js
public/preload.js
src/main.jsx
src/App.jsx
src/components/
src/utils/
assets/
```

## Istruzioni di installazione

### 1) Installare Node.js

Scarica e installa Node.js 16+ da:

https://nodejs.org/

Dopo l'installazione, apri PowerShell e verifica:

```powershell
node --version
npm --version
```

### 2) Installare le dipendenze npm

Apri PowerShell e spostati nella cartella del progetto:

```powershell
cd "d:\Sviluppo app\Analizzatore di mesh"
```

Esegui:

```powershell
npm install
```

### 3) Avviare l'app in sviluppo

Esegui:

```powershell
npm run dev
```

L'app sarà disponibile su `http://localhost:5173`.

### 4) Build di produzione e preview locale

Esegui:

```powershell
npm run build
npm run preview
```

Poi apri `http://localhost:4173` o la porta indicata in console.

## Script inclusi in questa cartella

- `install-deps.bat`: installa Node.js (solo avvia la pagina web di download) e poi esegue `npm install`
- `install-deps.ps1`: installa le dipendenze npm da PowerShell
- `run-dev.bat`: avvia `npm run dev`
- `run-electron-dev.bat`: avvia `npm run electron-dev`
- `build-and-preview.bat`: esegue `npm run build` e `npm run preview`
- `build-electron.bat`: crea il pacchetto Windows usando `npm run electron-build`

## Come usare gli script

### Con PowerShell

```powershell
cd "d:\Sviluppo app\Analizzatore di mesh\windows-setup"
.\install-deps.ps1
```

### Con il prompt dei comandi

```cmd
cd "d:\Sviluppo app\Analizzatore di mesh\windows-setup"
install-deps.bat
```

## Eseguire Electron in sviluppo

Dopo l'installazione delle dipendenze, apri PowerShell o il prompt dei comandi nella cartella `windows-setup` e esegui:

```powershell
.
un-electron-dev.bat
```

Questo avvierà il progetto in modalità sviluppo con Electron.

## Note aggiuntive

- Se vuoi eseguire l'app come desktop app Electron, la cartella del progetto contiene già gli script di build in `package.json`.
- Per creare il pacchetto Windows usa `.uild-electron.bat` dopo aver installato le dipendenze.
