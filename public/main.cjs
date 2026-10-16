const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
// electron-is-dev v3 è solo ESM: si usa il controllo integrato di Electron
const isDev = !app.isPackaged
const path = require('path')
const fs = require('fs')
const http = require('http')
const { spawn } = require('child_process')

// Sui portatili con doppia scheda video usa quella dedicata (serve per il volume CBCT)
app.commandLine.appendSwitch('force_high_performance_gpu')

let mainWindow

// Server Python locali avviati dall'app. I venv sono provati nell'ordine indicato
// (stesso ordine dei file run_server*.bat).
const PYTHON_SERVERS = {
  server1: { name: 'Server 1', script: 'server.py', port: 8000, venvs: ['.venv', '.venv_py311'] },
  server2: { name: 'Server 2', script: 'server.py', port: 8001, venvs: ['.venv_py311', '.venv2', '.venv'] },
  cbct: {
    name: 'Server CBCT',
    script: 'cbct_server.py',
    port: 8002,
    venvs: ['.venv_cbct'],
    missingVenvError: 'Ambiente Python CBCT non installato. Esegui "mio server\\install_cbct.bat".',
  },
}
const serverProcesses = {}
const serverStartPromises = {}

function isServerOnline(port) {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${port}/health`, (response) => {
      response.resume()
      resolve(response.statusCode >= 200 && response.statusCode < 300)
    })
    request.setTimeout(1000, () => request.destroy())
    request.once('error', () => {
      resolve(false)
    })
  })
}

// Su Windows il python.exe del venv è un lanciatore che avvia un secondo processo:
// child.kill() chiuderebbe solo il lanciatore, quindi si termina l'intero albero
function stopPythonServer(serverId) {
  const child = serverProcesses[serverId]
  serverProcesses[serverId] = null
  if (!child || child.exitCode !== null || !child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else {
    child.kill()
  }
}

async function startPythonServer(serverId) {
  const config = PYTHON_SERVERS[serverId]
  if (!config) return { success: false, error: `Server sconosciuto: ${serverId}` }
  if (await isServerOnline(config.port)) {
    return { success: true, alreadyRunning: true }
  }

  const serverDirectories = [
    path.join(app.getAppPath(), 'mio server'),
    path.join(path.dirname(process.execPath), 'mio server'),
  ]
  const serverDirectory = serverDirectories.find((directory) =>
    fs.existsSync(path.join(directory, config.script))
  )
  if (!serverDirectory) {
    return { success: false, error: `File ${config.script} non trovato nella cartella "mio server" accanto all’app.` }
  }

  const pythonExecutable = config.venvs
    .map((venv) => path.join(serverDirectory, venv, 'Scripts', 'python.exe'))
    .find((candidate) => fs.existsSync(candidate))
  if (!pythonExecutable) {
    return {
      success: false,
      error: config.missingVenvError
        || `${config.name}: nessun ambiente Python trovato (${config.venvs.join(', ')}) in "mio server".`,
    }
  }

  const child = spawn(pythonExecutable, [path.join(serverDirectory, config.script)], {
    cwd: serverDirectory,
    env: { ...process.env, PORT: String(config.port) },
    stdio: 'ignore',
    windowsHide: true,
  })
  serverProcesses[serverId] = child

  let launchError = null
  let exitInfo = null
  child.once('error', (error) => {
    launchError = error
  })
  child.once('exit', (code, signal) => {
    exitInfo = `Il processo è terminato (codice ${code ?? 'n/d'}, segnale ${signal ?? 'n/d'}).`
    if (serverProcesses[serverId] === child) serverProcesses[serverId] = null
  })

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isServerOnline(config.port)) {
      return { success: true, alreadyRunning: false }
    }
    if (launchError) {
      serverProcesses[serverId] = null
      return { success: false, error: `Avvio di ${config.name} non riuscito: ${launchError.message}` }
    }
    if (exitInfo) {
      serverProcesses[serverId] = null
      return { success: false, error: `${config.name} non è partito. ${exitInfo}` }
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  if (serverProcesses[serverId] === child) stopPythonServer(serverId)
  return { success: false, error: `${config.name} non risponde sulla porta ${config.port} dopo 20 secondi.` }
}

// Un solo avvio alla volta per server, anche se più pagine lo chiedono insieme
function requestServerStart(serverId) {
  if (!serverStartPromises[serverId]) {
    serverStartPromises[serverId] = startPythonServer(serverId)
      .catch((error) => ({ success: false, error: error.message }))
      .finally(() => {
        serverStartPromises[serverId] = null
      })
  }
  return serverStartPromises[serverId]
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'assets/icon.png'),
  })

  const startUrl = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../dist/index.html')}`

  mainWindow.loadURL(startUrl)

  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('ready', createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

ipcMain.handle('start-mesh-server1', () => requestServerStart('server1'))

ipcMain.handle('start-mesh-server', (event, serverId) => {
  if (serverId !== 'server1' && serverId !== 'server2') {
    return { success: false, error: `Server mesh sconosciuto: ${serverId}` }
  }
  return requestServerStart(serverId)
})

ipcMain.handle('start-cbct-server', () => requestServerStart('cbct'))

// Selezione della sorgente CBCT: cartella DICOM oppure file ZIP
ipcMain.handle('select-cbct-source', async (event, { kind }) => {
  const isZip = kind === 'zip'
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: isZip ? 'Seleziona lo ZIP della CBCT' : 'Seleziona la cartella DICOM della CBCT',
    properties: isZip ? ['openFile'] : ['openDirectory'],
    filters: isZip ? [{ name: 'Archivio ZIP', extensions: ['zip'] }] : undefined,
  })
  if (canceled || !filePaths?.length) return { canceled: true }
  return { canceled: false, path: filePaths[0] }
})

app.on('before-quit', () => {
  Object.keys(PYTHON_SERVERS).forEach(stopPythonServer)
})

// IPC handler per salvare il log su file (Save As)
ipcMain.handle('save-inverted-log', async (event, { defaultPath, content }) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Salva registro normali invertite',
      defaultPath: defaultPath || 'inverted-normals-log.txt',
      filters: [
        { name: 'Text', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (canceled || !filePath) return { success: false }

    fs.writeFileSync(filePath, content, 'utf8')
    return { success: true, filePath }
  } catch (err) {
    console.error('Errore salvataggio log:', err)
    return { success: false, error: err.message }
  }
})

// IPC handler per salvare la mesh modificata (STL binario o ASCII) con "Salva con nome"
ipcMain.handle('save-mesh-file', async (event, { defaultPath, data }) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Salva mesh',
      defaultPath: defaultPath || 'mesh.stl',
      filters: [
        { name: 'STL', extensions: ['stl'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (canceled || !filePath) return { success: false }

    if (typeof data === 'string') {
      fs.writeFileSync(filePath, data, 'utf8')
    } else {
      fs.writeFileSync(filePath, Buffer.from(data))
    }
    return { success: true, filePath }
  } catch (err) {
    console.error('Errore salvataggio mesh:', err)
    return { success: false, error: err.message }
  }
})

// IPC handler per aprire link esterni con shell.openExternal
ipcMain.handle('open-external', async (event, { url }) => {
  try {
    if (!url) return { success: false, error: 'No URL provided' }
    await shell.openExternal(url)
    return { success: true }
  } catch (err) {
    console.error('Errore openExternal:', err)
    return { success: false, error: err.message }
  }
})
