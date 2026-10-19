<#
Installazione e verifica completa di LolaMeshAnalyzer su un PC Windows (64 bit).

Controlla cosa manca e installa solo quello: si puo' rieseguire quante volte serve.
  1. Programmi: Node.js (18 o superiore) e Python 3.11 a 64 bit (con winget, se manca)
  2. App: librerie npm ed Electron
  3. Server mesh (porte 8000/8001): ambiente "mio server\.venv"
  4. Server CBCT (porta 8002): ambiente "mio server\.venv_cbct"
  5. Segmentazione automatica (facoltativa, circa 4-5 GB): ambiente "mio server\.venv_seg2"
     con PyTorch (CUDA se c'e' una scheda NVIDIA) e pesi DentalSegmentator da Zenodo
  6. Verifica finale di tutto, con riepilogo

Uso:  doppio clic su InstallaTutto.bat
      oppure: powershell -ExecutionPolicy Bypass -File InstallaTutto.ps1 [-Segmentazione Si|No]
Registro completo in InstallaTutto.log
#>
param(
    [ValidateSet('Chiedi', 'Si', 'No')]
    [string]$Segmentazione = 'Chiedi'
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$ServerDir = Join-Path $Root 'mio server'
Set-Location $Root
try { Start-Transcript -Path (Join-Path $Root 'InstallaTutto.log') -Force | Out-Null } catch {}

$Results = [ordered]@{}
function Step($title) { Write-Host ''; Write-Host "=== $title ===" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[ATTENZIONE] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[ERRORE] $msg" -ForegroundColor Red }
function Ask($question) {
    $answer = Read-Host "$question (S/n)"
    return ($answer -eq '' -or $answer -match '^[sS]')
}
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
# Esegue un programma esterno (output a video); errore se il codice di uscita non e' 0
function Run($exe, [string[]]$arguments) {
    & $exe @arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Comando non riuscito ($LASTEXITCODE): $exe $($arguments -join ' ')" }
}

Write-Host '=================================================='
Write-Host '  Installazione LolaMeshAnalyzer'
Write-Host "  Cartella: $Root"
Write-Host '=================================================='

if (-not [Environment]::Is64BitOperatingSystem) {
    Fail 'Serve Windows a 64 bit.'
    exit 1
}

# ---------------------------------------------------------------- 1. Programmi
Step '1. Programmi necessari'
$HasWinget = [bool](Get-Command winget -ErrorAction SilentlyContinue)

function Get-NodeMajor {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return 0 }
    $v = (& node -v) -replace '^v', ''
    return [int]($v.Split('.')[0])
}
if ((Get-NodeMajor) -lt 18) {
    Warn 'Node.js 18 o superiore non trovato.'
    if ($HasWinget -and (Ask 'Installo Node.js LTS con winget?')) {
        Run 'winget' @('install', '--id', 'OpenJS.NodeJS.LTS', '-e', '--accept-package-agreements', '--accept-source-agreements')
        Refresh-Path
    }
}
if ((Get-NodeMajor) -ge 18) {
    Ok "Node.js $(& node -v), npm $(& npm -v)"
    $Results['Node.js'] = 'OK'
} else {
    Fail 'Node.js mancante: installalo da https://nodejs.org (versione LTS) e riesegui lo script.'
    Start-Process 'https://nodejs.org/'
    exit 1
}

# Python 3.11 a 64 bit: py launcher, percorso standard o python nel PATH
function Find-Python311 {
    $candidates = @()
    if (Get-Command py -ErrorAction SilentlyContinue) {
        try { $p = (& py -3.11 -c 'import sys; print(sys.executable)' 2>$null); if ($LASTEXITCODE -eq 0 -and $p) { $candidates += $p.Trim() } } catch {}
    }
    $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python311\python.exe')
    $candidates += 'C:\Program Files\Python311\python.exe'
    if (Get-Command python -ErrorAction SilentlyContinue) { $candidates += (Get-Command python).Source }
    foreach ($c in $candidates) {
        if (-not $c -or -not (Test-Path $c)) { continue }
        try {
            $info = (& $c -c 'import sys, struct; print(sys.version_info[0], sys.version_info[1], struct.calcsize(chr(80)) * 8)' 2>$null)
            if ($info -and $info.Trim() -eq '3 11 64') { return $c }
        } catch {}
    }
    return $null
}
$Python = Find-Python311
if (-not $Python) {
    Warn 'Python 3.11 a 64 bit non trovato (le librerie dei server richiedono proprio la 3.11).'
    if ($HasWinget -and (Ask 'Installo Python 3.11 con winget?')) {
        Run 'winget' @('install', '--id', 'Python.Python.3.11', '-e', '--accept-package-agreements', '--accept-source-agreements')
        Refresh-Path
        $Python = Find-Python311
    }
}
if ($Python) {
    Ok "Python 3.11: $Python"
    $Results['Python 3.11'] = 'OK'
} else {
    Fail 'Python 3.11 mancante: installalo da https://www.python.org/downloads/release/python-3119/ (Windows installer 64-bit) e riesegui lo script.'
    Start-Process 'https://www.python.org/downloads/release/python-3119/'
    exit 1
}

# ---------------------------------------------------------------- 2. App (npm, Electron)
Step '2. Librerie dell''app (npm) ed Electron'
try {
    Run 'npm' @('install', '--no-fund', '--no-audit')
    Ok 'Librerie npm installate'
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'RiparaElectron.ps1')
    if ($LASTEXITCODE -eq 0) { $Results['App (npm + Electron)'] = 'OK' }
    else { Warn 'Electron non pronto: l''app funziona comunque nel browser (AvviaApp.bat).'; $Results['App (npm + Electron)'] = 'Electron mancante' }
} catch {
    Fail $_.Exception.Message
    $Results['App (npm + Electron)'] = 'ERRORE'
}

# ---------------------------------------------------------------- ambienti Python
# Crea l'ambiente (se manca o e' rotto) e installa i requisiti; poi verifica gli import
function Ensure-Venv($name, $requirements, $checkImports, [scriptblock]$beforeRequirements) {
    $venv = Join-Path $ServerDir $name
    $venvPython = Join-Path $venv 'Scripts\python.exe'
    $healthy = $false
    if (Test-Path $venvPython) {
        try { & $venvPython -c 'import sys' 2>$null; $healthy = ($LASTEXITCODE -eq 0) } catch {}
        if (-not $healthy) { Warn "$name non funziona (Python spostato o aggiornato?): lo ricreo."; Remove-Item -Recurse -Force $venv }
    }
    if (-not $healthy) {
        Write-Host "Creazione ambiente $name..."
        Run $Python @('-m', 'venv', $venv)
    }
    Run $venvPython @('-m', 'pip', 'install', '--upgrade', 'pip', '--quiet')
    if ($beforeRequirements) { & $beforeRequirements $venvPython }
    Write-Host "Installazione librerie da $requirements (puo' richiedere alcuni minuti)..."
    Run $venvPython @('-m', 'pip', 'install', '-r', (Join-Path $ServerDir $requirements))
    Run $venvPython @('-c', "import $checkImports; print('import verificati')")
    return $venvPython
}

# ---------------------------------------------------------------- 3. Server mesh
Step '3. Server mesh (porte 8000 e 8001)'
try {
    Ensure-Venv '.venv' 'requirements.txt' 'meshlib.mrmeshpy, fastapi, uvicorn, numpy, open3d, SimpleITK' | Out-Null
    Ok 'Server mesh pronto (.venv)'
    $Results['Server mesh'] = 'OK'
} catch {
    Fail $_.Exception.Message
    $Results['Server mesh'] = 'ERRORE'
}

# ---------------------------------------------------------------- 4. Server CBCT
Step '4. Server CBCT (porta 8002)'
try {
    Ensure-Venv '.venv_cbct' 'requirements_cbct.txt' 'fastapi, uvicorn, multipart, numpy, SimpleITK, open3d, skimage' | Out-Null
    Ok 'Server CBCT pronto (.venv_cbct)'
    $Results['Server CBCT'] = 'OK'
} catch {
    Fail $_.Exception.Message
    $Results['Server CBCT'] = 'ERRORE'
}

# ---------------------------------------------------------------- 5. Segmentazione automatica
Step '5. Segmentazione automatica (DentalSegmentator)'
$ModelZip = Join-Path $ServerDir '.models_seg2\Dataset112_DentalSegmentator_v100.zip'
$ModelUrl = 'https://zenodo.org/records/10829675/files/Dataset112_DentalSegmentator_v100.zip?download=1'
$ModelMd5 = 'B71CD5230168D28A4F71B078265B76BE'
$Checkpoint = Join-Path $ServerDir '.models_seg2\extracted\Dataset112_DentalSegmentator_v100\nnUNetTrainer__nnUNetPlans__3d_fullres\fold_0\checkpoint_final.pth'
$HasNvidia = [bool](Get-Command nvidia-smi -ErrorAction SilentlyContinue)

$doSeg = $Segmentazione -eq 'Si'
if ($Segmentazione -eq 'Chiedi') {
    $gpuText = 'nessuna scheda NVIDIA: calcolo sul processore, molto lento'
    if ($HasNvidia) { $gpuText = 'scheda NVIDIA trovata: calcolo veloce' }
    Write-Host "Richiede circa 4-5 GB di download ($gpuText)."
    $doSeg = Ask 'Installo la segmentazione automatica?'
}
if (-not $doSeg) {
    Write-Host 'Saltata: il passo Segmentazione dell''app mostrera'' "Non disponibile".'
    $Results['Segmentazione automatica'] = 'non installata (scelta)'
} else {
    try {
        $torchIndex = 'https://download.pytorch.org/whl/cpu'
        if ($HasNvidia) { $torchIndex = 'https://download.pytorch.org/whl/cu126' }
        $installTorch = {
            param($venvPython)
            Write-Host "Installazione PyTorch da $torchIndex (download grande)..."
            Run $venvPython @('-m', 'pip', 'install', 'torch==2.14.1', '--index-url', $torchIndex)
        }
        $segPython = Ensure-Venv '.venv_seg2' 'requirements_seg2.txt' 'torch, nnunetv2, SimpleITK' $installTorch

        if (-not (Test-Path $Checkpoint)) {
            New-Item -ItemType Directory -Force -Path (Split-Path $ModelZip) | Out-Null
            $hashOk = (Test-Path $ModelZip) -and ((Get-FileHash $ModelZip -Algorithm MD5).Hash -eq $ModelMd5)
            if (-not $hashOk) {
                Write-Host 'Download dei pesi DentalSegmentator da Zenodo (230 MB)...'
                $ProgressPreference = 'SilentlyContinue' # senza barra il download e' molto piu' veloce
                Invoke-WebRequest -Uri $ModelUrl -OutFile $ModelZip -UseBasicParsing
                $ProgressPreference = 'Continue'
                if ((Get-FileHash $ModelZip -Algorithm MD5).Hash -ne $ModelMd5) { throw 'Pesi scaricati non integri (MD5 diverso): riprova.' }
                Ok 'Pesi scaricati, MD5 verificato'
            }
            Write-Host 'Estrazione dei pesi...'
            Expand-Archive -Path $ModelZip -DestinationPath (Join-Path $ServerDir '.models_seg2\extracted') -Force
        }
        if (-not (Test-Path $Checkpoint)) { throw 'Pesi del modello non trovati dopo l''estrazione.' }
        Ok 'Pesi del modello presenti'

        $gpu = (& $segPython -c "import torch; print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')").Trim()
        if ($HasNvidia -and $gpu -eq 'CPU') { Warn 'PyTorch non vede la scheda NVIDIA: aggiorna il driver NVIDIA. Funziona comunque, ma lentamente.' }
        Ok "Segmentazione automatica pronta (calcolo su: $gpu)"
        $Results['Segmentazione automatica'] = "OK ($gpu)"
    } catch {
        Fail $_.Exception.Message
        $Results['Segmentazione automatica'] = 'ERRORE'
    }
}

# ---------------------------------------------------------------- 6. Verifica finale
Step '6. Verifica finale'
# avvio di prova del server CBCT su una porta libera: deve rispondere a /health
try {
    $cbctPython = Join-Path $ServerDir '.venv_cbct\Scripts\python.exe'
    # con l'app aperta la prova si salta: il server di prova svuoterebbe i file temporanei CBCT
    $appRunning = [bool](Get-NetTCPConnection -LocalPort 8002 -State Listen -ErrorAction SilentlyContinue)
    if ($appRunning) {
        Warn 'Server CBCT gia'' in esecuzione (app aperta): avvio di prova saltato.'
        $Results['Avvio di prova server CBCT'] = 'saltato (app aperta)'
    } elseif (Test-Path $cbctPython) {
        $env:PORT = '8092'
        $proc = Start-Process -FilePath $cbctPython -ArgumentList "`"$(Join-Path $ServerDir 'cbct_server.py')`"" -WorkingDirectory $ServerDir -PassThru -WindowStyle Hidden
        Remove-Item Env:PORT
        $answer = $null
        for ($i = 0; $i -lt 40 -and -not $answer; $i++) {
            Start-Sleep -Milliseconds 500
            try { $answer = Invoke-RestMethod -Uri 'http://127.0.0.1:8092/health' -TimeoutSec 2 } catch {}
        }
        Get-CimInstance Win32_Process -Filter "ParentProcessId=$($proc.Id)" -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        if ($answer) { Ok 'Il server CBCT si avvia e risponde'; $Results['Avvio di prova server CBCT'] = 'OK' }
        else { Fail 'Il server CBCT non risponde all''avvio di prova'; $Results['Avvio di prova server CBCT'] = 'ERRORE' }
    }
} catch {
    Fail $_.Exception.Message
    $Results['Avvio di prova server CBCT'] = 'ERRORE'
}

Write-Host ''
Write-Host '==================== RIEPILOGO ====================' -ForegroundColor Cyan
$failed = $false
foreach ($key in $Results.Keys) {
    $value = $Results[$key]
    $color = 'Green'
    if ($value -like 'ERRORE*') { $color = 'Red'; $failed = $true }
    elseif ($value -notlike 'OK*') { $color = 'Yellow' }
    Write-Host ('  {0,-30} {1}' -f $key, $value) -ForegroundColor $color
}
Write-Host '===================================================' -ForegroundColor Cyan
if ($failed) {
    Write-Host 'Alcune parti non sono state installate: vedi i messaggi sopra e InstallaTutto.log, poi riesegui lo script.' -ForegroundColor Red
} else {
    Write-Host 'Tutto pronto.' -ForegroundColor Green
    Write-Host '  App desktop (avvia da sola i server):  AvviaAppDesktop.bat'
    Write-Host '  App nel browser:                       AvviaApp.bat (+ i run_*.bat in "mio server")'
}
try { Stop-Transcript | Out-Null } catch {}
if ($failed) { exit 1 }
exit 0
