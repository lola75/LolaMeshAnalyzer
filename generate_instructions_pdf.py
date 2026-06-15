from pathlib import Path

text = '''Istruzioni per avviare il progetto

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
'''

lines = text.splitlines()
objects = []
objects.append('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
objects.append('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
content_lines = ['BT', '/F1 12 Tf', '50 780 Td']
for line in lines:
    safe = line.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    content_lines.append(f'({safe}) Tj')
    content_lines.append('0 -16 Td')
content_lines.append('ET')
content_stream = '\n'.join(content_lines)
stream_bytes = content_stream.encode('latin1')
objects.append('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n')
objects.append(f'4 0 obj\n<< /Length {len(stream_bytes)} >>\nstream\n{content_stream}\nendstream\nendobj\n')
objects.append('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n')

buf = bytearray()
buf.extend(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
positions = []
for obj in objects:
    positions.append(len(buf))
    buf.extend(obj.encode('latin1'))

xref_start = len(buf)

with open('INSTRUCTIONS.pdf', 'wb') as f:
    f.write(buf)
    f.write(b'xref\n0 %d\n0000000000 65535 f \n' % (len(objects)+1))
    for pos in positions:
        f.write(f'{pos:010d} 00000 n \n'.encode('latin1'))
    f.write(b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objects)+1, xref_start))

print('INSTRUCTIONS.pdf generated')
