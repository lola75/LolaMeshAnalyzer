# MeshLib Local Server

Questa cartella contiene un server Python locale che usa MeshLib per analizzare e processare file mesh.

## Installazione

Prerequisito consigliato: Python 3.11 a 64 bit su Windows. Dalla cartella `mio server`:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

`requirements.txt` include FastAPI, Uvicorn, python-multipart, NumPy, Open3D e SimpleITK. MeshLib viene installata dal wheel Windows x64 incluso in questa cartella. Il backend usa il pacchetto `SimpleITK` per le funzionalità ITK.

## Avvio

Esegui il server con uno dei seguenti comandi:

```powershell
.\run_server.bat
```

Per avviare un secondo backend separato su `http://127.0.0.1:8001`, usa:

```powershell
.\run_server2.bat
```

oppure, se preferisci avviare manualmente:

```powershell
.\.venv\Scripts\python.exe server.py
```

Se vuoi creare un ambiente Python separato per Server 2, usa:

```powershell
.\install_server2.bat
```

Il server principale sarà disponibile su `http://127.0.0.1:8000` e il secondo server su `http://127.0.0.1:8001`.

## Endpoint principali

- `GET /health` - controlla che il server sia attivo
- `POST /upload-mesh` - carica una mesh e riceve i metadati
- `POST /simplify` - semplifica una mesh e restituisce un file PLY

## Esempio di uso

Con `curl`:

```powershell
curl -F "file=@path\to\mesh.stl" http://127.0.0.1:8000/upload-mesh
```
