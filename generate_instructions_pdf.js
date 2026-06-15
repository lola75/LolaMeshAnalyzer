const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'INSTRUCTIONS.pdf');
const text = `Istruzioni per avviare il progetto

Queste istruzioni spiegano come avviare l'applicazione copiata su un altro computer.

Prerequisiti
- Installare Node.js (versione consigliata >= 18). Verifica con node -v e npm -v.

Passaggi per eseguire il progetto
1. Apri un terminale nella cartella del progetto (dove si trova package.json).
2. Installa le dipendenze:
   npm install
3. Avvia in modalità sviluppo:
   npm run local
   oppure
   npm run dev
4. In alternativa, per avviare l'app Electron in dev:
   npm run electron-dev
5. Per buildare e provare il server statico locale:
   npm run build
   npm run preview
   oppure
   npm run deploy:local

Uso del file batch
- Puoi avviare l'app con il file AvviaApp.bat presente nella cartella del progetto.
  Doppio clic o esegui:
  .\\AvviaApp.bat

Creare un eseguibile Windows
- Esempio: npm run electron-build

Convertire queste istruzioni in PDF
- Apri INSTRUCTIONS.html nel browser e stampa/salva come PDF.
`;

const lines = text.split('\n');
const objects = [];
objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
const contentLines = ['BT', '/F1 12 Tf', '50 790 Td'];
for (const line of lines) {
  const safe = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  contentLines.push(`(${safe}) Tj`);
  contentLines.push('0 -16 Td');
}
contentLines.push('ET');
const contentStream = contentLines.join('\n');
objects.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n');
objects.push(`4 0 obj\n<< /Length ${Buffer.byteLength(contentStream, 'latin1')} >>\nstream\n${contentStream}\nendstream\nendobj\n`);
objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

const buf = [];
buf.push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
const positions = [];
for (const obj of objects) {
  positions.push(buf.reduce((acc, cur) => acc + Buffer.byteLength(cur, 'latin1'), 0));
  buf.push(obj);
}

const xrefStart = buf.reduce((acc, cur) => acc + Buffer.byteLength(cur, 'latin1'), 0);
buf.push('xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n');
for (const pos of positions) {
  buf.push(`${pos.toString().padStart(10, '0')} 00000 n \n`);
}
buf.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

fs.writeFileSync(filePath, Buffer.from(buf.join(''), 'latin1'));
console.log('INSTRUCTIONS.pdf generated at', filePath);
