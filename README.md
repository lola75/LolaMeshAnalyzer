# Analizzatore di Mesh 3D

Un'applicazione web moderna e accattivante per caricare, visualizzare e analizzare file 3D (STL, OBJ, PLY) con editor di metadati integrato.

## ✨ Caratteristiche

- 📦 **Supporto Multi-Formato**: Carica file STL, OBJ e PLY
- 🎨 **Visualizzazione 3D**: Rendering interattivo con Three.js
- 📊 **Analisi Metadati**: Estrazione automatica di informazioni sul modello
- ✏️ **Editor Metadati**: Modifica e gestisci i metadati del modello
- 🎭 **UI Moderna**: Interfaccia accattivante con Tailwind CSS
- 🎮 **Interazioni Intuitive**: Zoom e rotazione del modello con mouse
- 📥 **Esportazione**: Salva metadati in formato JSON

## 🚀 Avvio Rapido

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

MIT

## 🤝 Contributi

Le contribuzioni sono benvenute! Apri una issue o invia una pull request.

## 📧 Contatti

Per domande o suggerimenti, crea una issue nel repository.

---

**Versione**: 1.0.0  
**Ultimo aggiornamento**: Maggio 2026
