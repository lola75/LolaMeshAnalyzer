const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  startMeshServer1: async () => {
    return await ipcRenderer.invoke('start-mesh-server1')
  },
  startMeshServer: async (serverId) => {
    return await ipcRenderer.invoke('start-mesh-server', serverId)
  },
  saveInvertedLog: async ({ defaultPath, content }) => {
    return await ipcRenderer.invoke('save-inverted-log', { defaultPath, content })
  }
  ,
  openExternal: async ({ url }) => {
    return await ipcRenderer.invoke('open-external', { url })
  },
  // VERIFICARE LA NOTA SUI MARCHI PRIMA DEL RILASCIO: avvio di Meshmixer e RealGuide (programmi esterni)
  launchMeshmixer: async (customPath) => {
    return await ipcRenderer.invoke('launch-meshmixer', customPath)
  },
  launchRealguide: async (customPath) => {
    return await ipcRenderer.invoke('launch-realguide', customPath)
  },
  saveMeshFile: async ({ defaultPath, data }) => {
    return await ipcRenderer.invoke('save-mesh-file', { defaultPath, data })
  },
  saveMeshFiles: async ({ title, files }) => {
    return await ipcRenderer.invoke('save-mesh-files', { title, files })
  },
  startCbctServer: async () => {
    return await ipcRenderer.invoke('start-cbct-server')
  },
  selectCbctSource: async ({ kind }) => {
    return await ipcRenderer.invoke('select-cbct-source', { kind })
  },
  selectFolder: async ({ title } = {}) => {
    return await ipcRenderer.invoke('select-folder', { title })
  }
})
