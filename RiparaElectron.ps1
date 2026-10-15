<#
Ripara l'installazione di Electron quando "npm install" non estrae il programma
(con Node 24 l'estrazione si ferma al primo file senza dare errore).
Usa l'archivio gia' scaricato nella cache di Electron, altrimenti lo scarica da GitHub.
#>
param(
    [string]$ElectronDir = (Join-Path $PSScriptRoot 'node_modules\electron')
)

$ErrorActionPreference = 'Stop'

$packageJson = Join-Path $ElectronDir 'package.json'
if (-not (Test-Path $packageJson)) {
    Write-Host "[ERRORE] Electron non trovato in $ElectronDir. Esegui prima npm install." -ForegroundColor Red
    exit 1
}

$exe = Join-Path $ElectronDir 'dist\electron.exe'
$pathTxt = Join-Path $ElectronDir 'path.txt'
if ((Test-Path $exe) -and (Test-Path $pathTxt)) {
    Write-Host '[OK] Electron installato correttamente.'
    exit 0
}

$version = (Get-Content $packageJson -Raw | ConvertFrom-Json).version
$zipName = "electron-v$version-win32-x64.zip"
Write-Host "Riparazione di Electron $version..."

$zipPath = $null
$cacheDir = Join-Path $env:LOCALAPPDATA 'electron\Cache'
if (Test-Path $cacheDir) {
    $cached = Get-ChildItem $cacheDir -Recurse -Filter $zipName -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cached) { $zipPath = $cached.FullName }
}

$downloaded = $false
if (-not $zipPath) {
    $url = "https://github.com/electron/electron/releases/download/v$version/$zipName"
    $zipPath = Join-Path $env:TEMP $zipName
    Write-Host "Download di $url ..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
    $downloaded = $true
}

$distDir = Join-Path $ElectronDir 'dist'
if (Test-Path $distDir) { Remove-Item -Recurse -Force $distDir }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $distDir)
[System.IO.File]::WriteAllText($pathTxt, 'electron.exe')
if ($downloaded) { Remove-Item -Force $zipPath -ErrorAction SilentlyContinue }

if (-not (Test-Path $exe)) {
    Write-Host '[ERRORE] Riparazione di Electron non riuscita.' -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Electron $version riparato."
exit 0
