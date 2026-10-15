import React, { createContext, useState, useEffect, useCallback } from 'react'
import { io } from 'socket.io-client'

export const ChatContext = createContext()

export function ChatProvider({ children }) {
  const [socket, setSocket] = useState(null)
  const [userId, setUserId] = useState(null)
  const [username, setUsername] = useState('')
  const [onlineUsers, setOnlineUsers] = useState([])
  const [currentChat, setCurrentChat] = useState(null)
  const [messages, setMessages] = useState({})
  const [isConnected, setIsConnected] = useState(false)
  const [unreadCount, setUnreadCount] = useState({})

  // Inizializza Socket.io e recupera/genera userId
  useEffect(() => {
    const storedUserId = localStorage.getItem('meshAnalyzer_userId')
    const storedUsername = localStorage.getItem('meshAnalyzer_username') || 'Utente'
    
    let newUserId = storedUserId
    if (!newUserId) {
      newUserId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      localStorage.setItem('meshAnalyzer_userId', newUserId)
    }
    
    setUserId(newUserId)
    setUsername(storedUsername)

    const newSocket = io(window.location.origin, {
      transports: ['websocket', 'polling']
    })

    newSocket.on('connect', () => {
      console.log('Connesso al server chat')
      setIsConnected(true)
      newSocket.emit('user:register', {
        userId: newUserId,
        username: storedUsername
      })
    })

    newSocket.on('users:updated', (users) => {
      setOnlineUsers(users.filter(u => u.userId !== newUserId))
    })

    newSocket.on('message:received', (message) => {
      const senderId = message.senderId
      setMessages(prev => ({
        ...prev,
        [senderId]: [...(prev[senderId] || []), message]
      }))
      setUnreadCount(prev => ({
        ...prev,
        [senderId]: (prev[senderId] || 0) + 1
      }))
    })

    newSocket.on('disconnect', () => {
      console.log('Disconnesso dal server chat')
      setIsConnected(false)
    })

    setSocket(newSocket)

    return () => {
      newSocket.disconnect()
    }
  }, [])

  const sendMessage = useCallback((recipientId, text) => {
    if (!socket || !userId) return

    socket.emit('message:send', {
      senderId: userId,
      senderName: username,
      recipientId,
      text
    })

    setMessages(prev => ({
      ...prev,
      [recipientId]: [
        ...(prev[recipientId] || []),
        {
          id: Date.now(),
          senderId: userId,
          senderName: username,
          recipientId,
          text,
          timestamp: new Date().toISOString(),
          read: true
        }
      ]
    }))
  }, [socket, userId, username])

  const selectChat = useCallback((user) => {
    setCurrentChat(user)
    setUnreadCount(prev => ({
      ...prev,
      [user.userId]: 0
    }))
  }, [])

  const updateUsername = (newUsername) => {
    setUsername(newUsername)
    localStorage.setItem('meshAnalyzer_username', newUsername)
    socket?.emit('user:register', {
      userId,
      username: newUsername
    })
  }

  const value = {
    socket,
    userId,
    username,
    updateUsername,
    onlineUsers,
    currentChat,
    selectChat,
    messages,
    sendMessage,
    isConnected,
    unreadCount
  }

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  )
}
