# Istruzioni per avviare il progetto

Queste istruzioni spiegano come avviare l'applicazione copiata su un altro computer.

**Prerequisiti**
- Installare Node.js (versione consigliata >= 18). Verifica:

```powershell
node -v
npm -v
```

**Passaggi per eseguire il progetto**
1. Apri un terminale nella cartella del progetto (dove si trova `package.json`).
2. Installa le dipendenze:

```powershell
npm install
```

3. Avvia in modalità sviluppo (apre Vite):

```powershell
npm run local
# oppure
npm run dev
```

4. In alternativa, per avviare l'app Electron in dev:

```powershell
npm run electron-dev
```

5. Per buildare e provare il server statico locale:

```powershell
npm run build
npm run preview
# o
npm run deploy:local
```

**Uso del file batch**
- Puoi avviare l'app con il file `AvviaApp.bat` presente nella cartella del progetto. Doppio clic o esegui:

```powershell
.\\AvviaApp.bat
```

**Creare un eseguibile Windows**
- Richiede le dipendenze di sviluppo e un ambiente di build adeguato. Esempio:

```powershell
npm run electron-build
```

Questo eseguirà la build e produrrà un artefatto nella cartella `dist` (o in base alla configurazione di `electron-builder`).

**Convertire queste istruzioni in PDF**
Opzione rapida (consigliata):
1. Apri `INSTRUCTIONS.html` nel browser.
2. Premi `Ctrl+P` (Stampa) e scegli "Salva come PDF".

Opzione con strumenti (facoltativa):
- Se hai `pandoc` o `wkhtmltopdf` puoi usarli per convertire direttamente `INSTRUCTIONS.md` o `INSTRUCTIONS.html` in PDF.

Esempio con `wkhtmltopdf`:

```powershell
wkhtmltopdf INSTRUCTIONS.html INSTRUCTIONS.pdf
```

Esempio con `pandoc` (richiede LaTeX per output PDF di qualità):

```powershell
pandoc INSTRUCTIONS.md -o INSTRUCTIONS.pdf
```

---
Se vuoi, posso generare direttamente il PDF qui e aggiungerlo alla cartella del progetto (attenzione: sarà un file binario aggiunto al repository). Vuoi che lo faccia ora?