import React, { useContext, useState, useRef, useEffect } from 'react'
import { ChatContext } from '../contexts/ChatContext'

export default function ChatWindow() {
  const { 
    onlineUsers, 
    currentChat, 
    selectChat, 
    messages, 
    sendMessage,
    username,
    unreadCount,
    isConnected
  } = useContext(ChatContext)
  
  const [inputValue, setInputValue] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [showUsersList, setShowUsersList] = useState(true)
  const messagesEndRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, currentChat])

  const handleSendMessage = (e) => {
    e.preventDefault()
    if (!inputValue.trim() || !currentChat) return
    
    sendMessage(currentChat.userId, inputValue)
    setInputValue('')
  }

  const selectUser = (user) => {
    selectChat(user)
    setShowUsersList(false)
  }

  const currentMessages = currentChat ? messages[currentChat.userId] || [] : []

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 bg-blue-600 hover:bg-blue-700 text-white rounded-full p-4 shadow-lg transition-all hover:scale-110"
        title="Apri chat"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        {Object.values(unreadCount).reduce((a, b) => a + b, 0) > 0 && (
          <span className="absolute top-0 right-0 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {Object.values(unreadCount).reduce((a, b) => a + b, 0)}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 w-96 h-[600px] bg-white dark:bg-gray-900 rounded-lg shadow-2xl flex flex-col border border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="bg-blue-600 text-white p-4 rounded-t-lg flex items-center justify-between">
        <h2 className="font-bold text-lg">
          {currentChat ? currentChat.username : 'Chat'}
        </h2>
        <button
          onClick={() => {
            setIsOpen(false)
            setShowUsersList(true)
          }}
          className="hover:bg-blue-700 p-1 rounded transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Users list */}
        <div className={`w-full ${!showUsersList && currentChat ? 'hidden' : ''} overflow-y-auto border-r border-gray-200 dark:border-gray-700`}>
          {!isConnected && (
            <div className="p-4 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 text-sm">
              ⚠️ Connessione chat non disponibile
            </div>
          )}
          
          {onlineUsers.length === 0 ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">
              Nessun utente online
            </div>
          ) : (
            onlineUsers.map(user => (
              <button
                key={user.userId}
                onClick={() => selectUser(user)}
                className={`w-full p-3 text-left border-b border-gray-100 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-between ${
                  currentChat?.userId === user.userId ? 'bg-blue-100 dark:bg-blue-900' : ''
                }`}
              >
                <span>
                  <div className="font-semibold text-sm">{user.username}</div>
                  <div className="text-xs text-gray-500">{user.status}</div>
                </span>
                {unreadCount[user.userId] > 0 && (
                  <span className="bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {unreadCount[user.userId]}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {/* Chat view */}
        {currentChat && showUsersList === false && (
          <div className="flex-1 flex flex-col w-full">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {currentMessages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.senderId === username ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-xs px-3 py-2 rounded-lg text-sm ${
                      msg.senderId === username
                        ? 'bg-blue-600 text-white rounded-br-none'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-none'
                    }`}
                  >
                    <p>{msg.text}</p>
                    <div className="text-xs opacity-70 mt-1">
                      {new Date(msg.timestamp).toLocaleTimeString('it-IT', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSendMessage} className="p-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Scrivi un messaggio..."
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white text-sm"
              />
              <button
                type="submit"
                disabled={!inputValue.trim()}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
              >
                Invia
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
