# Guida installazione - Analizzatore di Mesh 3D

Questa guida installa sia l'interfaccia web (React/Vite) sia il server Python locale usato per le operazioni MeshLib e l'allineamento. Le istruzioni sono per Windows 10/11 a 64 bit.

## Prerequisiti e download

| Componente | Versione consigliata | Link |
|---|---|---|
| Node.js con npm | LTS supportata, 20 o superiore | [Download Node.js](https://nodejs.org/en/download/) |
| Python | 3.11 a 64 bit | [Download Python per Windows](https://www.python.org/downloads/windows/) |
| Browser | Edge, Chrome o Firefox aggiornato | [Microsoft Edge](https://www.microsoft.com/edge/download), [Google Chrome](https://www.google.com/chrome/) |

Durante l'installazione di Python selezionare **Add Python to PATH**. Il comando `py -3.11` usato sotto richiede il Python Launcher, incluso nell'installer ufficiale.

## Dipendenze del progetto

Le versioni JavaScript sono dichiarate in `package.json` e bloccate da `package-lock.json`; installarle con `npm ci` invece di installarle singolarmente.

### Interfaccia web ed Electron (npm)

| Pacchetto | Uso | Link |
|---|---|---|
| `react`, `react-dom` | Interfaccia utente | [react](https://www.npmjs.com/package/react), [react-dom](https://www.npmjs.com/package/react-dom) |
| `three` | Rendering 3D | [three](https://www.npmjs.com/package/three) |
| `vite`, `@vitejs/plugin-react` | Server di sviluppo e build | [vite](https://www.npmjs.com/package/vite), [plugin React](https://www.npmjs.com/package/@vitejs/plugin-react) |
| `tailwindcss`, `autoprefixer`, `postcss` | Stili CSS | [Tailwind CSS](https://www.npmjs.com/package/tailwindcss), [Autoprefixer](https://www.npmjs.com/package/autoprefixer), [PostCSS](https://www.npmjs.com/package/postcss) |
| `express` | Server HTTP Node.js | [express](https://www.npmjs.com/package/express) |
| `socket.io`, `socket.io-client` | Comunicazione in tempo reale | [socket.io](https://www.npmjs.com/package/socket.io), [socket.io-client](https://www.npmjs.com/package/socket.io-client) |
| `electron`, `electron-builder`, `electron-is-dev` | Applicazione desktop e pacchettizzazione | [electron](https://www.npmjs.com/package/electron), [electron-builder](https://www.npmjs.com/package/electron-builder), [electron-is-dev](https://www.npmjs.com/package/electron-is-dev) |
| `concurrently`, `wait-on` | Avvio coordinato e attesa dei servizi | [concurrently](https://www.npmjs.com/package/concurrently), [wait-on](https://www.npmjs.com/package/wait-on) |
| `@types/node` | Tipi Node.js per gli strumenti di sviluppo | [@types/node](https://www.npmjs.com/package/@types/node) |

### Server mesh locale (Python)

| Pacchetto | Uso | Link |
|---|---|---|
| `fastapi` | API HTTP del server | [PyPI](https://pypi.org/project/fastapi/), [documentazione](https://fastapi.tiangolo.com/) |
| `uvicorn` | Server ASGI per FastAPI | [PyPI](https://pypi.org/project/uvicorn/), [documentazione](https://www.uvicorn.org/) |
| `python-multipart` | Ricezione di file caricati con form-data | [PyPI](https://pypi.org/project/python-multipart/) |
| `meshlib` | Lettura, analisi e lavorazione delle mesh (wheel Windows x64 3.0.4.121 incluso) | [Wheel incluso nel progetto](../mio%20server/meshlib-3.0.4.121-py38.py39.py310.py311.py312.py313-none-win_amd64.whl), [PyPI](https://pypi.org/project/meshlib/), [sito/documentazione MeshLib](https://meshlib.io/) |
| `numpy` | Calcolo numerico e gestione coordinate | [PyPI](https://pypi.org/project/numpy/) |
| `open3d` | Operazioni 3D e fallback ICP | [PyPI](https://pypi.org/project/open3d/), [documentazione](https://www.open3d.org/docs/) |
| `SimpleITK` | Registrazione rigida basata su ITK | [PyPI](https://pypi.org/project/SimpleITK/), [sito/documentazione](https://simpleitk.org/) |

**Nota su ITK:** il codice importa `SimpleITK` (`import SimpleITK as sitk`), perciò la dipendenza da installare è il pacchetto PyPI `SimpleITK`, non `itk`. MeshLib è installata dal wheel Windows x64 incluso in `mio server`; non serve scaricarne una seconda copia.

## Installazione

Aprire PowerShell nella cartella principale del progetto.

### 1. Installare le dipendenze dell'interfaccia

```powershell
npm ci
```

### 2. Creare l'ambiente Python e installare le librerie mesh

```powershell
py -3.11 -m venv ".\mio server\.venv"
& ".\mio server\.venv\Scripts\python.exe" -m pip install --upgrade pip
Push-Location ".\mio server"
& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt
Pop-Location
```

Il file `requirements.txt` usa il wheel MeshLib presente nella stessa cartella, quindi eseguire l'installazione da `mio server` come sopra. Per un ambiente virtuale separato per il secondo server, dalla cartella principale eseguire `.\mio server\install_server2.bat`.

### 3. Avviare l'applicazione

In PowerShell dalla cartella principale, avviare il backend:

```powershell
& ".\mio server\run_server.bat"
```

In una seconda finestra PowerShell avviare il frontend:

```powershell
npm run dev
```

Aprire l'indirizzo mostrato da Vite, normalmente [http://localhost:5173](http://localhost:5173). Il server mesh locale è su [http://127.0.0.1:8000](http://127.0.0.1:8000); il controllo di stato è [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health).

Per generare la build web: `npm run build`. Per avviare il backend da solo, usare `.\mio server\run_server.bat`.

## Verifica e problemi comuni

- Verificare gli strumenti: `node --version`, `npm --version`, `py -3.11 --version`.
- Se `py -3.11` non è riconosciuto, installare Python 3.11 includendo Python Launcher, quindi riaprire PowerShell.
- Se `pip` non trova MeshLib, verificare che il file `meshlib-3.0.4.121-py38.py39.py310.py311.py312.py313-none-win_amd64.whl` sia presente in `mio server` e ripetere il comando da quella directory.
- Per errori di importazione, verificare che il server sia avviato con `mio server\.venv\Scripts\python.exe` e che l'installazione delle dipendenze sia terminata senza errori.
- Non cancellare `package-lock.json`: `npm ci` lo usa per riprodurre le versioni previste dal progetto.

## File della guida

- `GUIDA_INSTALLAZIONE.html`: guida leggibile nel browser e stampabile con **Ctrl+P**.
- `genera_pdf.ps1`: script per generare un PDF usando Chrome o Edge installato nel computer.
