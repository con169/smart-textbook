import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import './ChatInterface.css';

interface Message {
  role: 'user' | 'assistant';
  content: string;
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input.trim());
      setInput('');
    }
  };

  return (
    <div className={`chat-container ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="chat-interface">
        <div 
          className="chat-header"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <span>AI Assistant</span>
          <div className="chat-controls">
            <button 
              className="collapse-button"
              onClick={(e) => {
                e.stopPropagation();
                setIsCollapsed(!isCollapsed);
              }}
              aria-label={isCollapsed ? "Expand chat" : "Collapse chat"}
            >
              {isCollapsed ? '▲' : '▼'}
            </button>
          </div>
        </div>
        
        {!isCollapsed && (
          <>
            <div className="messages">
              {messages.map((message, index) => (
                <div key={index} className={`message ${message.role}`}>
                  <div className="message-content">
                    <div className="message-icon">
                      {message.role === 'assistant' ? 'A' : 'U'}
                    </div>
                    <div className="message-text">
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        components={{
                          p: ({children}) => <p style={{margin: '0.5em 0'}}>{children}</p>,
                          ul: ({children}) => <ul style={{margin: '0.5em 0', paddingLeft: '1.5em'}}>{children}</ul>,
                          ol: ({children}) => <ol style={{margin: '0.5em 0', paddingLeft: '1.5em'}}>{children}</ol>,
                          li: ({children}) => <li style={{margin: '0.25em 0'}}>{children}</li>,
                          h1: ({children}) => <h1 style={{margin: '0.5em 0', fontSize: '1.5em'}}>{children}</h1>,
                          h2: ({children}) => <h2 style={{margin: '0.5em 0', fontSize: '1.3em'}}>{children}</h2>,
                          h3: ({children}) => <h3 style={{margin: '0.5em 0', fontSize: '1.1em'}}>{children}</h3>,
                          code: ({children}) => <code style={{backgroundColor: 'rgba(0,0,0,0.1)', padding: '0.2em 0.4em', borderRadius: '3px'}}>{children}</code>
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="message assistant">
                  <div className="message-content">
                    <div className="message-icon">A</div>
                    <div className="message-text loading">Thinking...</div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <form onSubmit={handleSubmit} className="input-form">
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
                }}
              />
              <div className="form-buttons">
                <button 
                  type="button" 
                  className="quick-collapse-button"
                  onClick={() => setIsCollapsed(true)}
                  aria-label="Collapse chat"
                >
                  ▼
                </button>
                <button type="submit" disabled={!input.trim() || isLoading}>
                  Send
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default ChatInterface; 