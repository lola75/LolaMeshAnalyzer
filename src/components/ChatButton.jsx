import React, { useContext } from 'react'
import { ChatContext } from '../contexts/ChatContext'

export default function ChatButton() {
  const { isConnected } = useContext(ChatContext)

  return (
    <button
      id="chat-button"
      className="relative inline-flex items-center justify-center p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
      title={isConnected ? "Chat con gli utenti online" : "Connessione chat..."}
    >
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
      {isConnected && (
        <span className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full"></span>
      )}
    </button>
  )
}
