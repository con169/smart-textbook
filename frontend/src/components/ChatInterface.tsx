import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import './ChatInterface.css';
import TypewriterMessage from './TypewriterMessage';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  isTyping?: boolean;
}

interface ChatInterfaceProps {
  messages: Message[];
  onSendMessage: (message: string) => void;
  isLoading: boolean;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, onSendMessage, isLoading }) => {
  const [input, setInput] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [typingMessageIndex, setTypingMessageIndex] = useState<number | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, typingMessageIndex]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsCollapsed(true);
    }
  };

  return (
    <div className={`chat-container ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="chat-header" onClick={() => setIsCollapsed(!isCollapsed)}>
        <span>AI Assistant</span>
        <div className="chat-controls">
          <button 
            className="collapse-button"
            onClick={(e) => {
              e.stopPropagation();
              setIsCollapsed(!isCollapsed);
            }}
            aria-label={isCollapsed ? 'Expand chat' : 'Collapse chat'}
          >
            {isCollapsed ? '▲' : '▼'}
          </button>
        </div>
      </div>
      <div className="chat-interface">
        <div className="chat-messages">
          {messages.map((message, index) => (
            <div key={index} className={`message ${message.role}`}>
              <div className="message-icon">
                {message.role === 'assistant' ? 'A' : 'U'}
              </div>
              <div className="message-content">
                <div className="message-text">
                  {message.role === 'assistant' && index === messages.length - 1 ? (
                    <TypewriterMessage 
                      content={message.content} 
                      onComplete={() => setTypingMessageIndex(null)}
                    />
                  ) : message.role === 'assistant' ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkMath, remarkGfm]}
                      rehypePlugins={[rehypeKatex]}
                    >
                      {message.content}
                    </ReactMarkdown>
                  ) : (
                    message.content
                  )}
                </div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="loading-indicator">
              <div className="loading-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <div className="chat-input">
          <form onSubmit={handleSubmit}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about the content on this page..."
              disabled={isLoading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
                handleKeyDown(e);
              }}
            />
            <button type="submit" disabled={!input.trim() || isLoading}>
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface; 