const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  startMeshServer1: async () => {
    return await ipcRenderer.invoke('start-mesh-server1')
  },
  saveInvertedLog: async ({ defaultPath, content }) => {
    return await ipcRenderer.invoke('save-inverted-log', { defaultPath, content })
  }
  ,
  openExternal: async ({ url }) => {
    return await ipcRenderer.invoke('open-external', { url })
  },
  launchMeshmixer: async (customPath) => {
    return await ipcRenderer.invoke('launch-meshmixer', customPath)
  },
  launchRealguide: async (customPath) => {
    return await ipcRenderer.invoke('launch-realguide', customPath)
  },
  saveMeshFile: async ({ defaultPath, data }) => {
    return await ipcRenderer.invoke('save-mesh-file', { defaultPath, data })
  }
})
