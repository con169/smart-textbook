import React, { useState, useRef } from 'react';
import './App.css';
import PDFJSViewer, { PDFJSViewerRef } from './components/PDFJSViewer';
import ChatInterface from './components/ChatInterface';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';

interface TableOfContentsItem {
  title: string;
  page?: number;
  pageNumber?: number;
  level: number;
  children?: TableOfContentsItem[];
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  type?: 'command' | 'conversation';
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
  const [isUploading, setIsUploading] = useState(false);
  const pdfViewerRef = useRef<PDFJSViewerRef>(null);
  const [chatContext, setChatContext] = useState<Message[]>([]);

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
    console.log('Selected file:', selectedFile);
    
    if (selectedFile && selectedFile.type === 'application/pdf') {
      try {
        // Set loading state
        setIsUploading(true);

        // Reset states
        setFile(null);
        setMessages([]);
        setTableOfContents([]);
        setCurrentPage(1);

        // Create form data
        const formData = new FormData();
        formData.append('file', selectedFile);
        console.log('Uploading file...');

        // Upload the file
        const response = await fetch('http://localhost:8000/api/pdf/upload', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error('Failed to upload file');
        }

        const data = await response.json();
        console.log('Upload response:', data);

        // Set the file URL
        const fileUrl = 'http://localhost:8000/api/pdf/file/current.pdf';
        console.log('Setting file URL:', fileUrl);
        setFile(fileUrl);

        // Set TOC if available
        if (data.toc) {
          const validatedTOC = data.toc.map((item: any) => ({
            ...item,
            page: item.pageNumber || 1,
            level: item.level || 0,
            children: item.children || []
          }));
          console.log('Setting TOC:', validatedTOC);
          setTableOfContents(validatedTOC);
        }
        
        // Add welcome message
        setMessages([{
          role: 'assistant',
          content: `I've loaded your PDF. I can answer questions about what you're currently viewing. Navigate to a specific page and ask me questions about its content. Currently showing page ${currentPage}.`
        }]);

      } catch (error) {
        console.error('Error during file upload:', error);
        setFile(null);
        setMessages([{
          role: 'assistant',
          content: 'Sorry, I encountered an error loading the PDF. Please try again.'
        }]);
      } finally {
        setIsUploading(false);
      }
    }
  };

  // Helper to check if message is a command
  const isCommand = (message: string): boolean => {
    const commands = [
      'summarize',
      'read',
      'navigate',
      'zoom',
      'go to page'
    ];
    return commands.some(cmd => message.toLowerCase().startsWith(cmd));
  };

  const handleSendMessage = async (message: string) => {
    if (!message.trim() || chatIsLoading) return;

    // Add user message
    const userMessage: Message = { 
      role: 'user', 
      content: message,
      type: isCommand(message) ? 'command' : 'conversation'
    };
    setMessages(prev => [...prev, userMessage]);
    setChatContext(prev => [...prev, userMessage]);
    setChatIsLoading(true);

    try {
      if (isCommand(message)) {
        // Use existing function-based approach for commands
        const response = await fetch('http://localhost:8000/api/qa/ask', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ question: message, page: currentPage }),
        });

        if (!response.ok) throw new Error('Failed to get response');
        const data = await response.json();
        
        const assistantMessage: Message = {
          role: 'assistant',
          content: data.answer,
          type: 'command'
        };
        setMessages(prev => [...prev, assistantMessage]);

      } else {
        // Use OpenAI API directly for conversational queries
        const response = await fetch('http://localhost:8000/api/qa/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            messages: chatContext.slice(-10), // Keep last 10 messages for context
            currentPage,
            question: message 
          }),
        });

        if (!response.ok) throw new Error('Failed to get response');
        const data = await response.json();
        
        const assistantMessage: Message = {
          role: 'assistant',
          content: data.answer,
          type: 'conversation'
        };
        setMessages(prev => [...prev, assistantMessage]);
        setChatContext(prev => [...prev, assistantMessage]);
      }
    } catch (error) {
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request.',
        type: 'command'
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setChatIsLoading(false);
    }
  };

  // Add debug log for render
  console.log('Rendering App with file:', file);

  return (
    <div className="app">
      {isUploading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <div>Processing PDF...</div>
        </div>
      )}
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
          {tableOfContents.length > 0 && (
            <div className="toc-header">Table of Contents</div>
          )}
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
        {file ? (
          <PDFJSViewer
            ref={pdfViewerRef}
            file={file}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
          />
        ) : (
          <div className="upload-prompt">
            Please upload a PDF file to begin
          </div>
        )}
      </div>
      {file && (
        <ChatInterface
          messages={messages}
          onSendMessage={handleSendMessage}
          isLoading={chatIsLoading}
        />
      )}
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
    const pageNum = item.page || item.pageNumber;
    if (typeof pageNum === 'number' && !isNaN(pageNum)) {
      console.log('Calling onPageChange with page:', pageNum);
      onPageChange(pageNum);
    } else {
      console.error('Invalid page number in TOC item:', item);
    }
  };

  // Determine if this is a "Notes" or "References" section
  const isSubsection = item.title.toLowerCase().endsWith('notes.') || 
                      item.title.toLowerCase().endsWith('references.');
  const effectiveLevel = isSubsection ? (item.level || 0) + 1 : item.level || 0;

  return (
    <div className={`toc-item level-${effectiveLevel}`}>
      <div className="toc-item-header">
        {hasChildren && (
          <button
            className="expand-button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            aria-label={isExpanded ? 'Collapse section' : 'Expand section'}
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        )}
        <div
          className="toc-item-title"
          onClick={handleClick}
          title={`Go to page ${item.page || item.pageNumber}`}
        >
          <span className="title-text">{item.title}</span>
          <span className="page-number">{item.page || item.pageNumber}</span>
        </div>
      </div>
      {hasChildren && isExpanded && (
        <div className="toc-children">
          {item.children!.map((child, index) => (
            <TOCItem
              key={`${child.title}-${index}`}
              item={{
                ...child,
                level: effectiveLevel + 1
              }}
              onPageChange={onPageChange}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default App;
