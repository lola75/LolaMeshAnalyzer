const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const isDev = require('electron-is-dev')
const path = require('path')
const fs = require('fs')
const http = require('http')
const { spawn } = require('child_process')

let mainWindow
let meshServer1Process = null
let meshServer1StartPromise = null

function isMeshServer1Online() {
  return new Promise((resolve) => {
    const request = http.get('http://127.0.0.1:8000/health', (response) => {
      response.resume()
      resolve(response.statusCode >= 200 && response.statusCode < 300)
    })
    request.setTimeout(1000, () => request.destroy())
    request.once('error', () => {
      resolve(false)
    })
  })
}

async function startMeshServer1() {
  if (await isMeshServer1Online()) {
    return { success: true, alreadyRunning: true }
  }

  const serverDirectories = [
    path.join(app.getAppPath(), 'mio server'),
    path.join(path.dirname(process.execPath), 'mio server'),
  ]
  const serverDirectory = serverDirectories.find((directory) =>
    fs.existsSync(path.join(directory, 'server.py'))
  )
  if (!serverDirectory) {
    return {
      success: false,
      error: 'Cartella "mio server" o file server.py non trovato accanto all’app.',
    }
  }

  const pythonCandidates = [
    path.join(serverDirectory, '.venv', 'Scripts', 'python.exe'),
    path.join(serverDirectory, '.venv_py311', 'Scripts', 'python.exe'),
  ]
  const pythonExecutable = pythonCandidates.find((candidate) => fs.existsSync(candidate))
    || (process.platform === 'win32' ? 'python' : 'python3')

  const child = spawn(pythonExecutable, [path.join(serverDirectory, 'server.py')], {
    cwd: serverDirectory,
    env: { ...process.env, PORT: '8000' },
    stdio: 'ignore',
    windowsHide: true,
  })
  meshServer1Process = child

  let launchError = null
  let exitInfo = null
  child.once('error', (error) => {
    launchError = error
  })
  child.once('exit', (code, signal) => {
    exitInfo = `Il processo è terminato (codice ${code ?? 'n/d'}, segnale ${signal ?? 'n/d'}).`
    if (meshServer1Process === child) meshServer1Process = null
  })

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isMeshServer1Online()) {
      return { success: true, alreadyRunning: false }
    }
    if (launchError) {
      meshServer1Process = null
      return { success: false, error: `Avvio di Server 1 non riuscito: ${launchError.message}` }
    }
    if (exitInfo) {
      meshServer1Process = null
      return { success: false, error: `Server 1 non è partito. ${exitInfo}` }
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  if (meshServer1Process === child && !child.killed) {
    child.kill()
    meshServer1Process = null
  }
  return { success: false, error: 'Server 1 non risponde sulla porta 8000 dopo 20 secondi.' }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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

ipcMain.handle('start-mesh-server1', async () => {
  if (!meshServer1StartPromise) {
    meshServer1StartPromise = startMeshServer1()
      .catch((error) => ({ success: false, error: error.message }))
      .finally(() => {
        meshServer1StartPromise = null
      })
  }
  return meshServer1StartPromise
})

app.on('before-quit', () => {
  if (meshServer1Process && !meshServer1Process.killed) {
    meshServer1Process.kill()
  }
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
