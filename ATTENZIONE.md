# ATTENZIONE - Istruzioni di installazione

Queste istruzioni servono per installare e usare l'applicazione su un altro computer Windows.

## 1. Copia del progetto
- Copia l'intera cartella del progetto in un percorso locale sul nuovo PC.
- Mantieni la struttura delle cartelle, in particolare:
  - `package.json`
  - `mio server/`
  - `src/`
  - `public/`
  - `node_modules/` (verrà ricreata con `npm install`)

## 2. Prerequisiti
- Windows 10 o successivo
- Node.js 18+ (consigliato)
- Python 3.11.x

## 3. Installazione frontend
Apri un terminale nella cartella principale del progetto:

```powershell
cd "C:\Percorso\Alla\Cartella\Analizzatore di mesh"
npm install
```

## 4. Installazione backend Python
Apri un terminale nella cartella `mio server`:

```powershell
cd "C:\Percorso\Alla\Cartella\Analizzatore di mesh\mio server"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt
```

### Dipendenze Python principali
- `fastapi`
- `uvicorn`
- `meshlib`
- `python-multipart`
- `numpy`

## 5. Avvio del server backend
Il server Python deve essere avviato manualmente prima di usare l'interfaccia React.

Esegui uno dei seguenti comandi:

```powershell
cd "C:\Percorso\Alla\Cartella\Analizzatore di mesh\mio server"
.\.venv\Scripts\Activate.ps1
python server.py
```

Oppure usa il file di avvio rapido:

```powershell
..\mio server\run_server.bat
```

Il server sarà disponibile su `http://127.0.0.1:8000`.

## 6. Avvio dell'app frontend
Apri un terminale nella cartella principale del progetto e avvia:

```powershell
cd "C:\Percorso\Alla\Cartella\Analizzatore di mesh"
npm run local
```

Apri quindi `http://localhost:5173` nel browser.

## 7. Uso rapido in sviluppo
- Avvia il backend: `mio server\run_server.bat`
- Avvia il frontend: `npm run local`
- Carica mesh e utilizza i comandi dell'interfaccia

## 8. Build di produzione e app Windows
Per creare la build frontend:

```powershell
npm run build
npm run preview
```

Per creare l'eseguibile Windows (Electron):

```powershell
npm run electron-build
```

## 9. Endpoint backend principali
- `GET /health`
- `POST /upload-mesh`
- `POST /simplify`
- `POST /align-points`
- `POST /align-icp`
- `POST /align-ransac`

## 10. Note importanti
- Il backend utilizza `MeshLib` per il processamento mesh.
- Nel codice del server non sono presenti riferimenti attivi a Open3D.
- Se nella cartella `.venv` sono presenti file Open3D, si tratta di pacchetti installati nell'ambiente locale e non di codice utilizzato dal progetto.
- Il frontend e il backend non si avviano automaticamente insieme: è necessario avviare prima il server Python e poi il client React.
- Usa `mio server\run_server.bat` per un avvio semplificato del backend.
