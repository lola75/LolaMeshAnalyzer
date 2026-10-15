const SERVER_SELECTION_KEY = 'meshLibServerId'

export const MESH_LIB_SERVERS = [
  { id: 'server1', name: 'Server 1', url: 'http://127.0.0.1:8000' },
  { id: 'server2', name: 'Server 2', url: 'http://127.0.0.1:8001' },
]

export const getServerById = (id) => MESH_LIB_SERVERS.find((server) => server.id === id) || MESH_LIB_SERVERS[0]

export const getSavedServerId = () => {
  try {
    return window.localStorage.getItem(SERVER_SELECTION_KEY) || MESH_LIB_SERVERS[0].id
  } catch {
    return MESH_LIB_SERVERS[0].id
  }
}

export const saveServerId = (id) => {
  try {
    window.localStorage.setItem(SERVER_SELECTION_KEY, id)
  } catch {
    // ignore storage errors
  }
}

export const serverHealthUrl = (serverUrl) => `${serverUrl.replace(/\/$/, '')}/health`

export const apiUrl = (serverUrl, endpoint) => `${serverUrl.replace(/\/$/, '')}${endpoint}`

export const checkServerHealth = async (serverUrl) => {
  try {
    const response = await fetch(serverHealthUrl(serverUrl), {
      method: 'GET',
      cache: 'no-store',
    })
    return response.ok
  } catch (error) {
    return false
  }
}
