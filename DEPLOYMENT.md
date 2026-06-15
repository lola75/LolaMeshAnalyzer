# 🚀 Guida al Deployment Online

L'app **Analizzatore di Mesh 3D** è pronta per il deployment online. Scegli uno dei metodi seguenti:

---

## 📋 Opzione 1: GitHub Pages (Gratuito, Automatico)

### Setup:
1. Pussha il codice su GitHub
2. Vai a **Settings → Pages**
3. Seleziona **Deploy from a branch**
4. Branch: `main`, Folder: `/root`
5. Salva

### Workflow Automatico:
Il file `.github/workflows/deploy-pages.yml` automatizza il deploy ad ogni push su `main`.

**URL**: `https://username.github.io/Analizzatore-di-mesh`

---

## 🌐 Opzione 2: Vercel (Gratuito, Zero-Config)

### Setup Rapido:
```bash
npm install -g vercel
vercel
```

### Setup Avanzato:
1. Vai a https://vercel.com
2. Importa il repo GitHub
3. Vercel detecta automaticamente Vite
4. Deploy in un click

**Vantaggi:**
- Deploy automatico su ogni push
- SSL gratis
- Dominio personalizzato
- CDN globale

---

## 🐳 Opzione 3: Docker + Render/Railway

### Dockerfile:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["node", "server.js"]
```

### Deploy:
1. Crea account su [Render.com](https://render.com) o [Railway.app](https://railway.app)
2. Connetti il repo GitHub
3. Deploy automatico

---

## 🖥️ Opzione 4: Server Locale Permanente

### Esegui il server:
```bash
npm run build
npm install express
node server.js
```

### Con PM2 (per mantenere online):
```bash
npm install -g pm2
pm2 start server.js --name "mesh-analyzer"
pm2 startup
pm2 save
```

**URL**: `http://localhost:3000`

---

## 📱 Opzione 5: Netlify (Gratuito)

### Setup:
1. Vai a https://app.netlify.com
2. Connetti repository GitHub
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Deploy

---

## ✅ Checklist Pre-Deploy

- [ ] `npm run build` genera cartella `dist/`
- [ ] Test locale: `node server.js`
- [ ] Repository GitHub aggiornato
- [ ] File `.gitignore` esclude `node_modules/`, `dist/`
- [ ] Branch principale è `main` o `master`

---

## 🔗 Link Online (Una volta Deployato)

| Piattaforma | URL |
|------------|-----|
| GitHub Pages | `https://[username].github.io/[repo]` |
| Vercel | `https://[progetto].vercel.app` |
| Netlify | `https://[progetto].netlify.app` |
| Render/Railway | Assegnato automaticamente |

---

## 📊 Confronto Piattaforme

| Piattaforma | Prezzo | Facilità | CDN | SSL |
|------------|--------|---------|-----|-----|
| **GitHub Pages** | Gratuito | ⭐⭐⭐⭐⭐ | ✓ | ✓ |
| **Vercel** | Gratuito+ | ⭐⭐⭐⭐⭐ | ✓ | ✓ |
| **Netlify** | Gratuito+ | ⭐⭐⭐⭐ | ✓ | ✓ |
| **Render** | Gratuito+ | ⭐⭐⭐⭐ | ✓ | ✓ |

---

## 🎯 Consigliato: Vercel

**Perché?**
- ✅ Setup istantaneo
- ✅ Deployment automatico
- ✅ Preview URL per ogni PR
- ✅ Funzioni serverless
- ✅ Analytics integrato
- ✅ Dominio personalizzato gratuito

### Deploy su Vercel in 2 minuti:
```bash
npm install -g vercel
vercel
# Segui i prompts...
```

---

**Domande?** Vedi il README.md principale.
