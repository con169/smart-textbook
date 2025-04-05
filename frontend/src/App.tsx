import React, { useState, useEffect, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import './App.css';
import ChatInterface from './components/ChatInterface';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

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

// Add this function at the top level
const getPageRange = (currentPage: number, totalPages: number | null, window: number = 5) => {
  const start = Math.max(1, currentPage - window);
  const end = Math.min(totalPages || currentPage + window, currentPage + window);
  return { start, end };
};

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [visiblePages, setVisiblePages] = useState<number[]>([1]);
  const [tableOfContents, setTableOfContents] = useState<TableOfContentsItem[]>([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const pdfContainerRef = React.useRef<HTMLDivElement>(null);
  const [loadedPages, setLoadedPages] = useState<Set<number>>(new Set([1]));
  const [renderedPages, setRenderedPages] = useState<Set<number>>(new Set());
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollTimeout = useRef<number | undefined>(undefined);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatIsLoading, setChatIsLoading] = useState(false);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      
      const formData = new FormData();
      formData.append('file', selectedFile);

      try {
        // Reset states
        setMessages([]);
        setTableOfContents([]);
        setCurrentPage(1);
        setLoadedPages(new Set([1]));
        setRenderedPages(new Set());

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

  const handleAskQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || isLoading) return;

    setIsLoading(true);
    try {
      const response = await fetch('http://localhost:5000/api/qa/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question, page: currentPage }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();
      setAnswer(data.answer);
    } catch (error) {
      setAnswer('Sorry, I encountered an error processing your request.');
    } finally {
      setIsLoading(false);
    }
  };

  // Track both loaded and rendered states
  const loadPage = (pageNumber: number) => {
    if (!numPages || pageNumber < 1 || pageNumber > numPages) {
      return;
    }

    setLoadedPages(prev => {
      const newLoaded = new Set(prev);
      newLoaded.add(pageNumber);
      return newLoaded;
    });
  };

  // Handle successful page render
  const handlePageRenderSuccess = (pageNumber: number) => {
    setRenderedPages(prev => {
      const newRendered = new Set(prev);
      newRendered.add(pageNumber);
      return newRendered;
    });
  };

  // Load pages more aggressively during scroll
  const handleScroll = () => {
    if (!pdfContainerRef.current || !numPages) return;

    const mainContent = pdfContainerRef.current.closest('.main-content');
    if (!mainContent) return;

    const containerRect = mainContent.getBoundingClientRect();
    const containerHeight = containerRect.height;
    const containerTop = containerRect.top;

    // Find which page is most visible
    const pageContainers = Array.from(pdfContainerRef.current.querySelectorAll('.page-container'));
    
    let mostVisiblePage = 1;
    let maxVisibility = 0;

    pageContainers.forEach((container, index) => {
      const rect = container.getBoundingClientRect();
      const pageNumber = index + 1;
      
      // Calculate how much of the page is visible in the container
      const visibleTop = Math.max(containerTop, rect.top);
      const visibleBottom = Math.min(containerTop + containerHeight, rect.bottom);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);
      
      if (visibleHeight > maxVisibility) {
        maxVisibility = visibleHeight;
        mostVisiblePage = pageNumber;
      }

      // Load pages within 4 container heights
      if (rect.top <= containerTop + containerHeight * 4 && 
          rect.bottom >= containerTop - containerHeight * 4) {
        loadPage(pageNumber);
      }
    });

    // Only update if we found a visible page and it's different
    if (maxVisibility > 0 && mostVisiblePage !== currentPage) {
      setCurrentPage(mostVisiblePage);
    }
  };

  // Optimized scroll listener with requestAnimationFrame
  useEffect(() => {
    if (!pdfContainerRef.current) return;

    const mainContent = pdfContainerRef.current.closest('.main-content');
    if (!mainContent) return;

    const scrollListener = () => {
      requestAnimationFrame(handleScroll);
    };

    mainContent.addEventListener('scroll', scrollListener, { passive: true });
    
    // Initial detection after a short delay to ensure PDF is rendered
    setTimeout(handleScroll, 100);

    return () => mainContent.removeEventListener('scroll', scrollListener);
  }, [numPages]); // Keep numPages dependency only

  // Load more pages when jumping
  const handlePageChange = (pageNumber: number) => {
    if (!numPages || pageNumber < 1 || pageNumber > numPages) return;

    setCurrentPage(pageNumber);
    
    // Load more pages around the target (7 pages in each direction)
    for (let i = Math.max(1, pageNumber - 7); i <= Math.min(numPages, pageNumber + 7); i++) {
      loadPage(i);
    }

    const targetPage = pageRefs.current[pageNumber - 1];
    if (targetPage) {
      targetPage.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const onLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    // Load more pages initially (first 15 pages)
    const initialPages = new Set<number>();
    for (let i = 1; i <= Math.min(numPages, 15); i++) {
      initialPages.add(i);
    }
    setLoadedPages(initialPages);
    setVisiblePages([1]);
  };

  const handleSendMessage = async (message: string) => {
    setChatIsLoading(true);
    try {
      // Add user message to chat
      setMessages(prev => [...prev, { role: 'user', content: message }]);

      const response = await fetch('http://localhost:5000/api/qa/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          question: message,
          page: currentPage  // Changed to match the backend's expectation
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();
      
      // Add assistant message to chat
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer }]);
    } catch (error) {
      // Add error message to chat
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
      {!file ? (
        <div className="upload-overlay">
          <input
            type="file"
            onChange={handleFileChange}
            accept=".pdf"
            id="file-upload"
            className="file-input"
          />
          <label htmlFor="file-upload" className="upload-button">
            Upload PDF Book
          </label>
        </div>
      ) : (
        <>
          <div className="sidebar">
            <h2>Table of Contents</h2>
            {tableOfContents.map((item, index) => (
              <TOCItem
                key={index}
                item={item}
                onPageChange={handlePageChange}
              />
            ))}
          </div>
          <div className="main-content">
            <div className="pdf-container" ref={pdfContainerRef}>
              <Document
                file={file}
                onLoadSuccess={onLoadSuccess}
                className="pdf-document"
                loading={
                  <div className="page-loading">
                    Loading PDF
                  </div>
                }
              >
                {Array.from(new Array(numPages), (_, index) => {
                  const pageNumber = index + 1;
                  return (
                    <div 
                      key={`page-container-${pageNumber}`}
                      className="page-container"
                      data-page-number={pageNumber}
                      ref={(el: HTMLDivElement | null) => {
                        pageRefs.current[index] = el;
                      }}
                    >
                      {loadedPages.has(pageNumber) && (
                        <Page
                          key={`page_${pageNumber}`}
                          pageNumber={pageNumber}
                          className="pdf-page"
                          width={Math.min(800, window.innerWidth * 0.45)} // Limit max width
                          renderTextLayer={true}
                          renderAnnotationLayer={true}
                          loading={
                            <div className="page-loading">
                              Loading page {pageNumber}...
                            </div>
                          }
                          onRenderSuccess={() => handlePageRenderSuccess(pageNumber)}
                          error={
                            <div className="page-error">
                              Error loading page {pageNumber}. Retrying...
                            </div>
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </Document>
            </div>
          </div>
          <div className="chat-panel">
            <ChatInterface
              onSendMessage={handleSendMessage}
              messages={messages}
              isLoading={chatIsLoading}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default App;
