import React, { useState, useRef } from 'react';
import './App.css';
import PDFJSViewer, { PDFJSViewerRef } from './components/PDFJSViewer';
import ChatInterface from './components/ChatInterface';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';

interface TableOfContentsItem {
  title: string;
  page: number;
  level: number;
  children?: TableOfContentsItem[];
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// Create a separate component for the app content
const AppContent = () => {
  const { theme, toggleTheme } = useTheme();
  const [file, setFile] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [tableOfContents, setTableOfContents] = useState<TableOfContentsItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatIsLoading, setChatIsLoading] = useState(false);
  const pdfViewerRef = useRef<PDFJSViewerRef>(null);

  const handleTocClick = (page: number) => {
    console.log('Raw page number from TOC click:', page);
    if (typeof page !== 'number' || isNaN(page)) {
      console.error('Invalid page number from TOC:', page);
      return;
    }
    
    // PDF.js uses 1-based page numbers
    const targetPage = Math.max(1, page);
    console.log('TOC clicked, navigating to page:', targetPage);
    
    if (pdfViewerRef.current) {
      pdfViewerRef.current.scrollToPage(targetPage);
    }
  };

  // Get table of contents from the backend
  const fetchTOC = async () => {
    try {
      const tocResponse = await fetch('http://localhost:8000/api/qa/get-toc');
      if (tocResponse.ok) {
        const tocData = await tocResponse.json();
        console.log('Raw TOC data from backend:', tocData);
        
        // Validate and transform TOC data
        const validatedTOC = (tocData.toc || []).map((item: any) => {
          console.log('Processing TOC item:', item);
          return {
            ...item,
            page: item.pageNumber || 1, // Convert pageNumber to page
            pageNumber: undefined // Remove the old property
          };
        });
        console.log('Validated TOC:', validatedTOC);
        setTableOfContents(validatedTOC);
      }
    } catch (error) {
      console.error('Error fetching TOC:', error);
    }
  };

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

        const response = await fetch('http://localhost:8000/api/qa/upload', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error('Failed to upload file');
        }

        const data = await response.json();
        console.log('Upload response:', data);  // Debug log

        // Set TOC directly from upload response
        if (data.toc) {
          const validatedTOC = data.toc.map((item: any) => ({
            ...item,
            page: item.pageNumber || 1,
            pageNumber: undefined
          }));
          console.log('Setting TOC:', validatedTOC);  // Debug log
          setTableOfContents(validatedTOC);
        }
        
        // Add welcome message
        setMessages([{
          role: 'assistant',
          content: `I've loaded your PDF. I can answer questions about what you're currently viewing. Navigate to a specific page and ask me questions about its content. Currently showing page ${currentPage}.`
        }]);
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
      const response = await fetch('http://localhost:8000/api/qa/ask', {
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
        <button 
          onClick={toggleTheme}
          className="theme-toggle"
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
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
              onPageChange={handleTocClick}
            />
          ))}
        </div>
      </div>
      <div className="main-content">
        {file && (
          <PDFJSViewer
            ref={pdfViewerRef}
            file={file}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
          />
        )}
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
};

// Main App component just provides the theme
function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

interface TOCItemProps {
  item: TableOfContentsItem;
  onPageChange: (page: number) => void;
}

const TOCItem: React.FC<TOCItemProps> = ({ item, onPageChange }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = item.children && item.children.length > 0;

  const handleClick = () => {
    console.log('TOC item clicked:', item);
    const pageNum = item.page;
    if (typeof pageNum === 'number' && !isNaN(pageNum)) {
      console.log('Calling onPageChange with page:', pageNum);
      onPageChange(pageNum);
    } else {
      console.error('Invalid page number in TOC item:', item);
    }
  };

  return (
    <div className={`toc-item level-${item.level}`}>
      <div className="toc-item-header">
        {hasChildren && (
          <button
            className="expand-button"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        )}
        <span
          className="toc-item-title"
          onClick={handleClick}
          title={`Go to page ${item.page}`}
        >
          {item.title} (Page {item.page})
        </span>
      </div>
      {hasChildren && isExpanded && (
        <div className="toc-children">
          {item.children!.map((child, index) => (
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

export default App;
