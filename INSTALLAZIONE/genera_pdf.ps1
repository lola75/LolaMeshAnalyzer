# Script PowerShell per convertire GUIDA_INSTALLAZIONE.html in PDF
# Questo script usa il browser predefinito per stampare a PDF

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Generatore PDF - Guida Installazione" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$htmlFile = Join-Path $scriptDir "GUIDA_INSTALLAZIONE.html"
$pdfFile = Join-Path $scriptDir "GUIDA_INSTALLAZIONE.pdf"

if (-Not (Test-Path $htmlFile)) {
    Write-Host "❌ Errore: File HTML non trovato!" -ForegroundColor Red
    Write-Host "Percorso atteso: $htmlFile" -ForegroundColor Red
    exit 1
}

Write-Host "✅ File HTML trovato: $htmlFile" -ForegroundColor Green
Write-Host ""

# Prova ad usare Google Chrome se disponibile
$chromeInstalled = Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe"
$edgeInstalled = Test-Path "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

if ($chromeInstalled) {
    Write-Host "📄 Usando Google Chrome per la generazione del PDF..." -ForegroundColor Yellow
    $browser = "C:\Program Files\Google\Chrome\Application\chrome.exe"
    & $browser --headless --disable-gpu --print-to-pdf="$pdfFile" $htmlFile
    Start-Sleep -Seconds 3
} elseif ($edgeInstalled) {
    Write-Host "📄 Usando Microsoft Edge per la generazione del PDF..." -ForegroundColor Yellow
    $browser = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    & $browser --headless --disable-gpu --print-to-pdf="$pdfFile" $htmlFile
    Start-Sleep -Seconds 3
} else {
    Write-Host "⚠️  Chrome/Edge non trovati. Aprendo il file HTML nel browser predefinito..." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Istruzioni manuali:" -ForegroundColor Cyan
    Write-Host "1. Il file HTML si aprirà nel tuo browser predefinito" -ForegroundColor White
    Write-Host "2. Premi Ctrl+P (oppure File → Stampa)" -ForegroundColor White
    Write-Host "3. Seleziona 'Salva come PDF' nel menu delle stampanti" -ForegroundColor White
    Write-Host "4. Scegli la cartella corrente e salva il file" -ForegroundColor White
    Write-Host ""
    
    Start-Process $htmlFile
    exit 0
}

if (Test-Path $pdfFile) {
    Write-Host ""
    Write-Host "✅ PDF generato con successo!" -ForegroundColor Green
    Write-Host "📁 Percorso: $pdfFile" -ForegroundColor Green
    Write-Host ""
    Write-Host "Aprendo il PDF..." -ForegroundColor Yellow
    Start-Process $pdfFile
} else {
    Write-Host ""
    Write-Host "ℹ️  Il PDF non è stato trovato. Prova il metodo manuale:" -ForegroundColor Yellow
    Write-Host "1. Apri $htmlFile nel browser" -ForegroundColor White
    Write-Host "2. Premi Ctrl+P" -ForegroundColor White
    Write-Host "3. Seleziona 'Salva come PDF'" -ForegroundColor White
    
    Start-Process $htmlFile
}
