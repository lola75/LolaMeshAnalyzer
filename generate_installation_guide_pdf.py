#!/usr/bin/env python3
"""
Script per generare una guida PDF di installazione dell'app Electron
Utilizza solo librerie standard Python - nessuna dipendenza esterna
"""

from pathlib import Path
from datetime import datetime

# Contenuto della guida di installazione
content = """================================================================================
  GUIDA DI INSTALLAZIONE DELL'APP ELECTRON
  Analizzatore di Mesh 3D - Versione 1.0.0
================================================================================

Data: """ + datetime.now().strftime("%d/%m/%Y") + """
Versione documento: 1.0

================================================================================
SOMMARIO
================================================================================

1. Introduzione
2. Requisiti di sistema
3. METODO 1: Installazione da Eseguibile (Consigliato)
4. METODO 2: Installazione Completa
5. Avvio dell'applicazione
6. Troubleshooting
7. Supporto tecnico

================================================================================
1. INTRODUZIONE
================================================================================

Questo documento spiega come installare l'applicazione "Analizzatore di Mesh 3D"
su un PC Windows. L'app è disponibile in due versioni:

a) ESEGUIBILE STANDALONE (.exe) - Installazione semplice e veloce
   - Nessuna configurazione aggiuntiva richiesta
   - Dimensione: circa 150 MB
   - Tempo installazione: 2-3 minuti

b) VERSIONE COMPLETA - Per sviluppatori o chi vuole il codice sorgente
   - Richiede Node.js
   - Dimensione completa: circa 500 MB
   - Tempo installazione: 10-15 minuti

================================================================================
2. REQUISITI DI SISTEMA
================================================================================

MINIMO:
  - Windows 10 o successivo (64-bit)
  - Processore: Intel/AMD x64
  - RAM: 4 GB
  - Spazio disco: 300 MB

CONSIGLIATO:
  - Windows 10/11 (64-bit)
  - Processore: Intel i5/i7 o equivalente
  - RAM: 8 GB o superiore
  - Spazio disco: 1 GB
  - Connessione internet per primi aggiornamenti

OPTIONAL (Solo per METODO 2):
  - Node.js 18.x o superiore
  - npm 9.x o superiore

================================================================================
3. METODO 1: INSTALLAZIONE DA ESEGUIBILE (CONSIGLIATO)
================================================================================

Questo è il metodo più semplice e veloce.

PASSO 1: Scarica l'eseguibile
  - Ricevi il file "Mesh-Analyzer-1.0.0.exe" via email o chiavetta USB
  - Salva il file in una cartella a tua scelta (es: C:\\Programmi\\)

PASSO 2: Avvia l'installer
  - Doppio click su "Mesh-Analyzer-1.0.0.exe"
  - Se vedi un avviso di Windows Defender:
    - Clicca "Ulteriori informazioni"
    - Clicca "Esegui comunque"

PASSO 3: Segui la procedura di installazione
  - Leggi e accetta i termini di licenza
  - Scegli la cartella di destinazione (consigliato: C:\\Program Files\\)
  - Clicca "Installa"
  - Attendi il completamento

PASSO 4: Crea il collegamento sul desktop (opzionale)
  - L'installer offrirà di creare un collegamento
  - Spunta la casella per creare un'icona sul desktop

PASSO 5: Avvia l'applicazione
  - Doppio click sull'icona dell'app o dal menu Start
  - L'applicazione dovrebbe aprirsi entro 5-10 secondi

FINE! L'app è ora installata e pronta all'uso.

================================================================================
4. METODO 2: INSTALLAZIONE COMPLETA
================================================================================

Questo metodo è per chi ha il codice sorgente e vuole eseguire
direttamente l'app in modalità sviluppo.

PREREQUISITO: Installa Node.js
  1. Vai a: https://nodejs.org/
  2. Scarica la versione LTS (18.x o superiore)
  3. Esegui l'installer e completa l'installazione
  4. Riavvia il computer
  5. Verifica l'installazione:
     - Apri PowerShell
     - Digita: node --version
     - Digita: npm --version
     - Dovrebbero mostrare i numeri di versione

PASSO 1: Prepara la cartella del progetto
  - Copia la cartella del progetto in una posizione comoda
    (es: C:\\Users\\tuonome\\Sviluppo\\Analizzatore-mesh)
  - Assicurati che il percorso non contenga spazi o caratteri speciali

PASSO 2: Installa le dipendenze
  - Apri PowerShell
  - Naviga nella cartella del progetto:
    cd "C:\\Users\\tuonome\\Sviluppo\\Analizzatore-mesh"
  - Digita: npm install
  - Attendi il completamento (può durare 5-10 minuti)

PASSO 3: Avvia l'app
  
  Opzione A - App Desktop (Electron):
    npm run electron
  
  Opzione B - App Web (nel browser):
    npm run dev
    Poi apri il browser a: http://localhost:5173

PASSO 4: Sviluppo o Build
  
  Per la modalità sviluppo con hot-reload:
    npm run electron-dev
  
  Per creare un eseguibile:
    npm run electron-build
    (Il file .exe sarà in ./dist/)

================================================================================
5. AVVIO DELL'APPLICAZIONE
================================================================================

METODO 1 (Exe):
  1. Doppio click sull'icona sul desktop
     oppure
  2. Cerca "Analizzatore di Mesh 3D" nel menu Start

METODO 2 (Versione completa):
  1. Apri PowerShell
  2. Naviga nella cartella del progetto
  3. Digita uno dei comandi:
     - npm run electron (app desktop)
     - npm run dev (app web nel browser)

PRIMO AVVIO:
  - La prima volta potrebbe essere più lento (caricamento risorse)
  - Potrebbe apparire una richiesta di accesso ai file
  - Clicca "Consenti" per procedere

================================================================================
6. TROUBLESHOOTING
================================================================================

PROBLEMA: Windows Defender blocca l'eseguibile
SOLUZIONE:
  1. Clicca "Ulteriori informazioni" nella finestra di avviso
  2. Clicca "Esegui comunque"
  3. Se il problema persiste, aggiungi l'app alle eccezioni di Defender

PROBLEMA: Errore "MSIExec error code 1603" durante l'installazione
SOLUZIONE:
  1. Disinstalla la versione precedente (se presente)
  2. Riavvia il computer
  3. Disabilita antivirus/defender temporaneamente
  4. Riprova l'installazione

PROBLEMA: L'app non si avvia dopo l'installazione
SOLUZIONE:
  1. Riavvia il computer
  2. Prova a reinstallare
  3. Verifica lo spazio su disco (almeno 300 MB liberi)
  4. Controlla i file di log in: %APPDATA%\\Analizzatore di Mesh 3D\\

PROBLEMA: Errore "Node.js not found" (solo METODO 2)
SOLUZIONE:
  1. Verifica che Node.js sia installato: node --version
  2. Se non installato, scaricalo da https://nodejs.org/
  3. Riavvia il computer dopo l'installazione di Node.js
  4. Riprova il comando npm install

PROBLEMA: Porta 5173 già in uso (METODO 2)
SOLUZIONE:
  1. Il sistema userà automaticamente una porta diversa
  2. Controlla il messaggio di output per trovare l'URL
  3. Oppure: Ctrl+C per fermare, riprova

PROBLEMA: Applicazione è lenta o si blocca
SOLUZIONE:
  1. Verifica la disponibilità di RAM (almeno 4 GB)
  2. Chiudi altri programmi pesanti
  3. Prova a ridurre la qualità grafica nelle impostazioni dell'app

================================================================================
7. SUPPORTO TECNICO
================================================================================

Per assistenza:

EMAIL: supporto@isdidegs.com
TELEFONO: +39 XXX XXX XXXX
SITO WEB: www.isdidegs.com

Informazioni utili per il supporto:
  - Sistema operativo: Windows 10/11 (verifica in Impostazioni > Sistema)
  - Versione app: Visualizza in App > Info
  - Descrizione del problema
  - Screenshot dell'errore (se presente)
  - Versione di Node.js (se applicabile): node --version

================================================================================

FINE DELLA GUIDA

Grazie per aver scelto l'Analizzatore di Mesh 3D!

Documento generato il: """ + datetime.now().strftime("%d/%m/%Y %H:%M:%S") + """

================================================================================
"""

# Funzione per creare un PDF semplice (manualmente)
def create_pdf(filename, text_content):
    """
    Crea un PDF semplice usando il formato PDF raw.
    Non usa librerie esterne - solo librerie standard.
    """
    
    lines = text_content.split('\n')
    
    # Oggetti PDF
    objects = []
    
    # Catalogo
    objects.append('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
    
    # Pagine
    objects.append('2 0 obj\n<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>\nendobj\n')
    
    # Pagina 1 - Titolo e introduzione
    content_lines_1 = [
        'BT',
        '/F1 14 Bf',
        '50 750 Td',
        '(GUIDA DI INSTALLAZIONE) Tj',
        '0 -20 Td',
        '/F1 12 Tf',
        '(Analizzatore di Mesh 3D) Tj',
        '0 -30 Td',
        '/F1 10 Tf'
    ]
    
    y_pos = 700
    for line in lines[:60]:  # Prime 60 linee nella pagina 1
        if len(line) > 80:
            # Spezza linee lunghe
            parts = [line[i:i+80] for i in range(0, len(line), 80)]
            for part in parts:
                safe = part.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
                content_lines_1.append(f'({safe}) Tj')
                content_lines_1.append('0 -12 Td')
        else:
            safe = line.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
            content_lines_1.append(f'({safe}) Tj')
            content_lines_1.append('0 -12 Td')
    
    content_lines_1.append('ET')
    content_stream_1 = '\n'.join(content_lines_1)
    stream_bytes_1 = content_stream_1.encode('latin1')
    
    objects.append(f'3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n')
    objects.append(f'4 0 obj\n<< /Length {len(stream_bytes_1)} >>\nstream\n{content_stream_1}\nendstream\nendobj\n')
    objects.append('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n')
    
    # Pagina 2 - Resto del contenuto
    content_lines_2 = [
        'BT',
        '/F1 10 Tf',
        '50 750 Td'
    ]
    
    for line in lines[60:]:  # Resto delle linee nella pagina 2
        if len(line) > 80:
            parts = [line[i:i+80] for i in range(0, len(line), 80)]
            for part in parts:
                safe = part.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
                content_lines_2.append(f'({safe}) Tj')
                content_lines_2.append('0 -12 Td')
        else:
            safe = line.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
            content_lines_2.append(f'({safe}) Tj')
            content_lines_2.append('0 -12 Td')
    
    content_lines_2.append('ET')
    content_stream_2 = '\n'.join(content_lines_2)
    stream_bytes_2 = content_stream_2.encode('latin1')
    
    objects.append(f'6 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 7 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n')
    objects.append(f'7 0 obj\n<< /Length {len(stream_bytes_2)} >>\nstream\n{content_stream_2}\nendstream\nendobj\n')
    
    # Crea il file PDF
    buf = bytearray()
    buf.extend(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    
    positions = []
    for obj in objects:
        positions.append(len(buf))
        buf.extend(obj.encode('latin1'))
    
    xref_start = len(buf)
    
    with open(filename, 'wb') as f:
        f.write(buf)
        f.write(b'xref\n0 %d\n0000000000 65535 f \n' % (len(objects) + 1))
        for pos in positions:
            f.write(f'{pos:010d} 00000 n \n'.encode('latin1'))
        f.write(b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objects) + 1, xref_start))

# Genera il PDF
output_filename = 'GUIDA_INSTALLAZIONE_APP.pdf'
create_pdf(output_filename, content)

print(f'✓ PDF generato con successo: {output_filename}')
print(f'  Dimensione: {Path(output_filename).stat().st_size / 1024:.1f} KB')
print(f'  Percorso: {Path(output_filename).absolute()}')
