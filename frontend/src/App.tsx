import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import ChatInterface from './components/ChatInterface';
import PDFViewer from './components/PDFViewer';

interface TableOfContentsItem {
  title: string;
  pageNumber: number;
  level: number;
  children: TableOfContentsItem[];
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// Add TOC Item component for recursion
const TOCItem: React.FC<{
  item: TableOfContentsItem;
  onPageChange: (pageNumber: number) => void;
}> = ({ item, onPageChange }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className={`toc-item level-${item.level}`}>
      <div className="toc-item-header">
        {item.children.length > 0 && (
          <button 
            className={`expand-button ${isExpanded ? 'expanded' : ''}`}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        )}
        <div 
          className="toc-item-title"
          onClick={() => onPageChange(item.pageNumber)}
        >
          {item.title}
        </div>
      </div>
      {isExpanded && item.children.length > 0 && (
        <div className="toc-children">
          {item.children.map((child, index) => (
            <TOCItem
              key={index}
              item={child}
              onPageChange={onPageChange}
            />
          ))}
        </div>
      )}
    </div>
  );
};

function App() {
  const [file, setFile] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [tableOfContents, setTableOfContents] = useState<TableOfContentsItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatIsLoading, setChatIsLoading] = useState(false);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      const fileUrl = URL.createObjectURL(selectedFile);
      setFile(fileUrl);
      
      const formData = new FormData();
      formData.append('file', selectedFile);

      try {
        // Reset states
        setMessages([]);
        setTableOfContents([]);
        setCurrentPage(1);

        const response = await fetch('http://localhost:5000/api/qa/upload', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error('Failed to upload file');
        }

        // Get table of contents from the backend
        const tocResponse = await fetch('http://localhost:5000/api/qa/get-toc');
        if (tocResponse.ok) {
          const tocData = await tocResponse.json();
          setTableOfContents(tocData.toc || []);
          
          // Add welcome message
          setMessages([{
            role: 'assistant',
            content: `I've loaded your PDF. You can ask me questions about any page or chapter. Currently showing page ${currentPage}.`
          }]);
        }
      } catch (error) {
        console.error('Error:', error);
        setMessages([{
          role: 'assistant',
          content: 'Sorry, I encountered an error loading the PDF. Please try again.'
        }]);
      }
    }
  };

  const handleSendMessage = async (message: string) => {
    if (!message.trim() || chatIsLoading) return;

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: message }]);
    setChatIsLoading(true);

    try {
      const response = await fetch('http://localhost:5000/api/qa/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: message, page: currentPage }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();
      
      // Add assistant message
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer }]);
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request.'
      }]);
    } finally {
      setChatIsLoading(false);
    }
  };

  return (
    <div className="app">
      <div className="sidebar">
        <div className="file-upload">
          <input
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            className="file-input"
          />
        </div>
        <div className="table-of-contents">
          {tableOfContents.map((item, index) => (
            <TOCItem
              key={index}
              item={item}
              onPageChange={setCurrentPage}
            />
          ))}
        </div>
      </div>
      <div className="main-content">
        <PDFViewer
          file={file}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
        />
      </div>
      <div className="chat-panel">
        <ChatInterface
          messages={messages}
          onSendMessage={handleSendMessage}
          isLoading={chatIsLoading}
        />
      </div>
    </div>
  );
}

export default App;
