import React, { useState, useEffect, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import './App.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface TableOfContentsItem {
  title: string;
  pageNumber: number;
  level: number;
  children: TableOfContentsItem[];
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
  const scrollTimeout = useRef<number>();

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      
      const formData = new FormData();
      formData.append('file', selectedFile);

      try {
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
          setTableOfContents(tocData.toc);
        }
      } catch (error) {
        console.error('Error:', error);
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
  const handleScroll = (event?: Event) => {
    if (!pdfContainerRef.current || !numPages) return;

    const container = pdfContainerRef.current.closest('.main-content');
    if (!container) return;

    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;
    
    // Get all page containers
    const pageContainers = Array.from(pdfContainerRef.current.querySelectorAll('.page-container'));
    
    // Find the current page based on scroll position
    let currentPageFound = false;
    pageContainers.forEach((container, index) => {
      const rect = container.getBoundingClientRect();
      const pageNumber = index + 1;
      
      // If this page is in view
      if (!currentPageFound && rect.top <= viewportHeight/2 && rect.bottom >= viewportHeight/2) {
        setCurrentPage(pageNumber);
        currentPageFound = true;
      }
      
      // Load pages within 4 viewport heights above and below
      if (rect.top <= viewportHeight * 4 && rect.bottom >= -viewportHeight * 4) {
        loadPage(pageNumber);
      }
    });
  };

  // Debounced scroll handler
  const debouncedScroll = () => {
    if (scrollTimeout.current) {
      window.clearTimeout(scrollTimeout.current);
    }
    scrollTimeout.current = window.setTimeout(handleScroll, 100);
  };

  // Scroll listener with both immediate and debounced updates
  useEffect(() => {
    if (!pdfContainerRef.current) return;

    const mainContent = pdfContainerRef.current.closest('.main-content');
    if (!mainContent) return;

    let ticking = false;
    const scrollListener = () => {
      // Immediate scroll handler for responsive UI
      if (!ticking) {
        requestAnimationFrame(() => {
          handleScroll();
          ticking = false;
        });
        ticking = true;
      }
      // Debounced handler for thorough loading
      debouncedScroll();
    };

    mainContent.addEventListener('scroll', scrollListener, { passive: true });
    // Initial load with a dummy scroll event
    handleScroll(new Event('scroll'));

    return () => {
      mainContent.removeEventListener('scroll', scrollListener);
      if (scrollTimeout.current) {
        window.clearTimeout(scrollTimeout.current);
      }
    };
  }, [numPages]);

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
            <h1>Table of Contents</h1>
            <nav className="toc-list">
              {tableOfContents.map((item, index) => (
                <TOCItem
                  key={index}
                  item={item}
                  onPageChange={handlePageChange}
                />
              ))}
            </nav>
          </div>
          
          <main className="main-content">
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
          </main>

          <div className="questions-panel">
            <h3 className="questions-header">Ask Questions</h3>
            <div className="current-page">Current Page: {currentPage}</div>
            <form onSubmit={handleAskQuestion}>
              <input
                type="text"
                className="question-input"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask about this page..."
                disabled={isLoading}
              />
              <button 
                type="submit" 
                className="ask-button"
                disabled={isLoading || !question.trim()}
              >
                {isLoading ? 'Thinking...' : 'Ask'}
              </button>
            </form>
            {answer && (
              <div className="answer-section">
                <div className="answer-label">Answer:</div>
                <div className="answer-content">{answer}</div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default App;
