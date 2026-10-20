// Funzioni comuni per parlare con il server CBCT (pagina CBCT ed Esplora DICOM)

export const readErrorDetail = async (response) => {
  try {
    const body = await response.json()
    return body?.detail || `Errore ${response.status}`
  } catch {
    return `Errore ${response.status}`
  }
}

export const newProgressId = () => (window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)

// POST con avanzamento dell'invio (fetch non lo fornisce). Restituisce una Response come fetch.
export const postFormWithProgress = (url, form, onProgress) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest()
  xhr.open('POST', url)
  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) onProgress(event.loaded / event.total)
  }
  xhr.onload = () => resolve(new Response(xhr.responseText, {
    status: xhr.status,
    headers: { 'Content-Type': xhr.getResponseHeader('Content-Type') || 'application/json' },
  }))
  xhr.onerror = () => reject(new TypeError('Failed to fetch'))
  xhr.send(form)
})
