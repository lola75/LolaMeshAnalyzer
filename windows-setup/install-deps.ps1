# Script PowerShell per installare le dipendenze npm del progetto Analizzatore di Mesh 3D
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location "$repoRoot\.."

if (-Not (Test-Path package.json)) {
    Write-Error "Errore: package.json non trovato. Assicurati di eseguire lo script dalla cartella windows-setup."
    exit 1
}

Write-Host "Verifico Node.js e npm..." -ForegroundColor Cyan
$nodeVersion = & node --version 2>$null
$npmVersion = & npm --version 2>$null
if (-Not $nodeVersion -or -Not $npmVersion) {
    Write-Warning "Node.js o npm non sono installati. Scarica Node.js 16+ da https://nodejs.org/ e riprova."
    Start-Process "https://nodejs.org/"
    exit 1
}

Write-Host "Node.js trovato: $nodeVersion" -ForegroundColor Green
Write-Host "npm trovato: $npmVersion" -ForegroundColor Green

Write-Host "Installazione dipendenze npm..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Error "Errore durante npm install. Controlla l'output e riprova."
    exit $LASTEXITCODE
}

Write-Host "Installazione completata." -ForegroundColor Green
