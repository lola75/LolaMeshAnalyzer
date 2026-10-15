# LolaMeshAnalyzer

Applicazione desktop e web per caricare, visualizzare, modificare e allineare mesh 3D (STL, OBJ, PLY), pensata per il flusso di lavoro di odontoiatria digitale e chirurgia guidata.

## ✨ Caratteristiche

### Visualizzazione e analisi
- 📦 **Supporto multi-formato**: carica file STL, OBJ e PLY (anche con colori per vertice)
- 🎨 **Visualizzazione 3D**: rendering interattivo con Three.js su sfondo sfumato, rotazione, traslazione e zoom
- 🔍 **Analisi della mesh**: conteggio facce, normali invertite e fori individuati
- 🧱 **Texture e triangoli**: texture predefinite o da file, visualizzazione del wireframe
- 📊 **Metadati**: estrazione automatica ed editor dei metadati, esportazione in JSON

### Modifica mesh
- 🩹 **Ripara mesh** e riempimento fori
- 🧹 **Rimuovi componenti isolati**
- 📉 **Semplificazione**: riduzione del numero di triangoli
- ✂️ **Taglio** e 🪞 **specchiatura**
- 🖌️ **Offset con pennello**
- ↩️ Annulla/ripeti, confronto prima/dopo, salvataggio in STL, PLY o OBJ

### Allineamento mesh
- 📍 **Per punti**: allineamento rigido da almeno 3 coppie di punti corrispondenti, rifinito automaticamente con ICP point-to-plane sulle superfici
- 📐 **Affine tramite punti**: da almeno 4 punti non complanari
- 🤖 **Allineamento automatico**: registrazione delle superfici senza punti (ITK + ICP)
- 🎯 **Pre-allineamento e allineamento fine ICP** nel modificatore mesh
- 🌈 **Errore di registrazione**: al termine dell'allineamento mostra la mappa colori della distanza tra le mesh (0 → >1 mm), con Media, Min, Max e percentuale di sovrapposizione
  - CTRL + click sinistro per misurare solo in una regione, CTRL/ALT + click destro per rimuovere i punti
  - SHIFT + rotella per cambiare la scala della barra colori
  - **OK** per accettare, **Modifica** per scartare e correggere i punti
- 📈 Statistiche di allineamento (metodo, iterazioni, RMSE, coppie) e salvataggio della mesh allineata

### Area di lavoro
- 🦷 **MMX Dental** e ⌖ **Chirurgia guidata**
- ◎ Collegamenti configurabili a **scanner intraorale** e **scanner facciale**
- 💬 Chat integrata tra utenti
- 🐍 **Server Python** (FastAPI + MeshLib + SimpleITK) per le elaborazioni di allineamento, avviato automaticamente dall'app desktop

## 🚀 Avvio Rapido

### Installazione automatica su un nuovo PC (Windows)

1. Installa **Node.js LTS** (https://nodejs.org) e **Python 3.11** (https://www.python.org, spunta "Add Python to PATH")
2. Fai doppio clic su **`InstallaTutto.bat`**: installa le librerie dell'app (`npm install`) e crea l'ambiente Python del server in `mio server\.venv` con le versioni di `mio server/requirements.txt`
3. Avvia l'app con `AvviaApp.bat` e il server con `mio server\run_server.bat`
4. App desktop: `npm run electron-dev` da un Prompt dei comandi (non dal terminale di VS Code, che imposta `ELECTRON_RUN_AS_NODE`)

Se Electron non si avvia dopo `npm install` (con Node 24 l'estrazione può interrompersi), esegui `RiparaElectron.ps1`: `InstallaTutto.bat` lo fa già in automatico.


### Prerequisiti
- Node.js 16+ e npm

### Installazione

```bash
cd "Analizzatore di mesh"
npm install
```

### Avvio in sviluppo

```bash
npm run dev
# oppure
npm run local
```

L'app si aprirà automaticamente su `http://localhost:5173`

### Preview locale

```bash
npm run build
npm run preview
```

Apri `http://localhost:4173` (o la porta mostrata in console) per vedere la build di produzione.

### Build per produzione

```bash
npm run build
```

## 📖 Utilizzo

1. **Carica un file**: Clicca nell'area di upload o trascina un file STL, OBJ, PLY
2. **Visualizza**: Osserva il modello 3D nel viewer interattivo
3. **Analizza**: Leggi i metadati estratti automaticamente
4. **Modifica**: Edita i metadati personalizzati
5. **Scarica**: Esporta i metadati in formato JSON

## 🎮 Controlli

- **Rotazione**: Trascina il mouse sul viewer
- **Zoom**: Rotella del mouse
- **Reset**: Ricarica il file

## 📁 Struttura del Progetto

```
src/
├── components/
│   ├── Header.jsx          # Intestazione app
│   ├── FileUploader.jsx    # Caricamento file
│   ├── MeshViewer.jsx      # Viewer 3D
│   └── MetadataEditor.jsx  # Editor metadati
├── utils/
│   ├── loaders/
│   │   ├── stlLoader.js    # Parser STL
│   │   ├── objLoader.js    # Parser OBJ
│   │   └── plyLoader.js    # Parser PLY
│   └── metadataExtractor.js # Estrazione metadati
├── styles/
│   └── globals.css         # Stili globali
├── App.jsx                 # Componente principale
└── main.jsx                # Entry point
```

## 🛠️ Tecnologie

- **React 18**: Framework UI
- **Vite**: Build tool
- **Three.js**: Grafica 3D
- **Tailwind CSS**: Styling
- **JavaScript ES6+**: Linguaggio

## 📦 Formati Supportati

### STL (Stereolitography)
- Binary e ASCII
- Geometria triangolare
- Ideale per stampa 3D

### OBJ (Wavefront)
- Supporto vertici e normali
- Geometria poligonale
- Compatibile con materiali

### PLY (Polygon File Format)
- Supporto vertici e colori
- Dati RGB incorporati
- Formato flessibile

## 🎨 Personalizzazione

### Tema
Modifica i colori in `tailwind.config.js`:
- `primary`: #6366f1 (Indigo)
- `secondary`: #8b5cf6 (Purple)
- `dark`: #0f172a
- `light`: #f8fafc

### Lighting
Adjust lighting in `src/components/MeshViewer.jsx` per cambiare illuminazione 3D

## 📝 Licenza

Rilasciato con licenza MIT: vedi il file [LICENSE](LICENSE).

## 🤝 Contributi

Le contribuzioni sono benvenute! Apri una issue o invia una pull request.

## 📧 Contatti

Per domande o suggerimenti, crea una issue nel repository.

---

**Versione**: 1.0.0  
**Ultimo aggiornamento**: Ottobre 2026
