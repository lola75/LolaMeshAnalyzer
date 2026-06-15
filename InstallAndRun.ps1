<#
Script di setup per Windows:
- Verifica che Node.js sia installato
- Esegue `npm install`
- Opzionalmente avvia il server di sviluppo o crea la build
#>

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $scriptDir

Write-Host "--- Script di setup: InstallAndRun.ps1 ---" -ForegroundColor Cyan

function Require-Command {
    param([string]$name)
    return (Get-Command $name -ErrorAction SilentlyContinue) -ne $null
}

if (-not (Require-Command "node")) {
    Write-Host "Node.js non è installato o non è nel PATH." -ForegroundColor Red
    Write-Host "Installa Node.js da https://nodejs.org/ e riesegui questo script." -ForegroundColor Yellow
    Start-Process "https://nodejs.org/" -ErrorAction SilentlyContinue
    exit 1
}

if (-not (Test-Path "package.json")) {
    Write-Host "Impossibile trovare package.json nella cartella corrente: $scriptDir" -ForegroundColor Red
    exit 1
}

Write-Host "Node.js trovato:" -NoNewline; & node -v
Write-Host "NPM trovato:" -NoNewline; & npm -v

Write-Host "\nInstallazione dipendenze..." -ForegroundColor Green
$install = Start-Process npm -ArgumentList 'install' -NoNewWindow -Wait -PassThru
if ($install.ExitCode -ne 0) {
    Write-Host "'npm install' è terminato con errore (code $($install.ExitCode))." -ForegroundColor Red
    exit $install.ExitCode
}

Write-Host "Dipendenze installate con successo." -ForegroundColor Green

$runDev = Read-Host "Vuoi avviare il server di sviluppo ora? (S/n)"
if ($runDev -eq '' -or $runDev -match '^[sS]') {
    Write-Host "Avvio del server di sviluppo in una nuova finestra..." -ForegroundColor Cyan
    Start-Process cmd.exe -ArgumentList '/k','npm run local' -WorkingDirectory $scriptDir
    Write-Host "Finestra di sviluppo avviata. Chiudi questa finestra se vuoi continuare qui." -ForegroundColor Gray
}

$doBuild = Read-Host "Vuoi creare una build di produzione / eseguibile ora? (S/n)"
if ($doBuild -match '^[sS]') {
    Write-Host "Eseguo 'npm run electron-build' (richiede strumenti di build)..." -ForegroundColor Cyan
    $build = Start-Process npm -ArgumentList 'run','electron-build' -NoNewWindow -Wait -PassThru
    if ($build.ExitCode -ne 0) {
        Write-Host "Build terminata con errore (code $($build.ExitCode))." -ForegroundColor Red
        exit $build.ExitCode
    }
    Write-Host "Build completata." -ForegroundColor Green
}

Write-Host "Setup completato." -ForegroundColor Green
