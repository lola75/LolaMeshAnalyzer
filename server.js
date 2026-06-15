import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { createServer } from 'http'
import { Server } from 'socket.io'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

// Crea HTTP server per Socket.io
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
})

// In-memory store per utenti e chat
const users = new Map() // userId -> {username, socketId, status, lastSeen}
const chatHistory = new Map() // conversationId -> [messages]

// Serve static files from dist
app.use(express.static(path.join(__dirname, 'dist')))

// API per ottenere utenti online
app.get('/api/users', (req, res) => {
  const onlineUsers = Array.from(users.values()).map(u => ({
    userId: u.userId,
    username: u.username,
    status: u.status,
    lastSeen: u.lastSeen
  }))
  res.json(onlineUsers)
})

// API per ottenere cronologia chat
app.get('/api/chat/:userId', (req, res) => {
  const { userId } = req.params
  const currentUserId = req.headers['x-user-id']
  const conversationId = [currentUserId, userId].sort().join('_')
  const messages = chatHistory.get(conversationId) || []
  res.json(messages)
})

// Socket.io events
io.on('connection', (socket) => {
  console.log('Nuovo utente connesso:', socket.id)

  // Registrazione utente
  socket.on('user:register', (data) => {
    const { userId, username } = data
    users.set(userId, {
      userId,
      username,
      socketId: socket.id,
      status: 'online',
      lastSeen: new Date()
    })
    socket.userId = userId
    
    // Notify everyone che un utente è online
    io.emit('users:updated', Array.from(users.values()).map(u => ({
      userId: u.userId,
      username: u.username,
      status: u.status
    })))
    
    console.log(`Utente registrato: ${username} (${userId})`)
  })

  // Messaggio privato
  socket.on('message:send', (data) => {
    const { recipientId, text, senderId, senderName } = data
    const message = {
      id: Date.now(),
      senderId,
      senderName,
      recipientId,
      text,
      timestamp: new Date().toISOString(),
      read: false
    }
    
    // Salva in cronologia
    const conversationId = [senderId, recipientId].sort().join('_')
    if (!chatHistory.has(conversationId)) {
      chatHistory.set(conversationId, [])
    }
    chatHistory.get(conversationId).push(message)
    
    // Invia al destinatario
    const recipient = users.get(recipientId)
    if (recipient) {
      io.to(recipient.socketId).emit('message:received', message)
    }
    
    // Conferma al mittente
    socket.emit('message:sent', message)
  })

  // Disconnessione utente
  socket.on('disconnect', () => {
    const userId = socket.userId
    if (userId && users.has(userId)) {
      users.delete(userId)
      io.emit('users:updated', Array.from(users.values()).map(u => ({
        userId: u.userId,
        username: u.username,
        status: u.status
      })))
      console.log(`Utente disconnesso: ${userId}`)
    }
  })
})

// Serve index.html for all routes (SPA)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

httpServer.listen(PORT, () => {
  console.log(`🚀 App online su http://localhost:${PORT}`)
  console.log(`📦 Servendo da: ${path.join(__dirname, 'dist')}`)
  console.log(`💬 Socket.io server attivo`)
})
