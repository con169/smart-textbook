import React, { useState, useEffect } from 'react';
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

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [visiblePages, setVisiblePages] = useState<number[]>([1]);
  const [tableOfContents, setTableOfContents] = useState<TableOfContentsItem[]>([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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

  const handlePageChange = (pageNumber: number) => {
    setCurrentPage(pageNumber);
    
    // Calculate a window of pages to load around the target page
    const windowSize = 2; // Reduced window size for better performance
    const pagesToLoad = new Set<number>();
    
    // Add the target page and immediate neighbors
    pagesToLoad.add(pageNumber);
    pagesToLoad.add(pageNumber - 1);
    pagesToLoad.add(pageNumber + 1);
    
    // Add some pages before and after
    for (let i = Math.max(1, pageNumber - windowSize); i <= Math.min((numPages || 0), pageNumber + windowSize); i++) {
      pagesToLoad.add(i);
    }
    
    // Convert Set to Array and filter out invalid page numbers
    const pagesToRender = Array.from(pagesToLoad).filter(p => p > 0 && p <= (numPages || 0));
    setVisiblePages(pagesToRender);

    // Scroll to the target page with offset for header
    const targetElement = document.querySelector(`[data-page-number="${pageNumber}"]`);
    if (targetElement) {
      const offset = 80; // Adjust this value based on your header height
      const elementPosition = targetElement.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - offset;
      
      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    }
  };

  // Update the intersection observer to handle more pages
  useEffect(() => {
    if (!numPages) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const pageNumber = parseInt(entry.target.getAttribute('data-page-number') || '1');
          
          if (entry.isIntersecting) {
            // When a page becomes visible, update the current page
            setCurrentPage(pageNumber);
            
            // Add this page and its neighbors to visible pages
            setVisiblePages(prev => {
              const newPages = new Set(prev);
              // Add current page and immediate neighbors
              newPages.add(pageNumber);
              if (pageNumber > 1) newPages.add(pageNumber - 1);
              if (pageNumber < (numPages || 0)) newPages.add(pageNumber + 1);
              return Array.from(newPages).sort((a, b) => a - b);
            });
          }
        });
      },
      {
        root: null,
        rootMargin: '100px 0px',
        threshold: 0.1
      }
    );

    // Observe all page containers
    document.querySelectorAll('.page-container').forEach((pageContainer) => {
      observer.observe(pageContainer);
    });

    return () => observer.disconnect();
  }, [numPages]);

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
              onLoadSuccess={({ numPages }) => {
                setNumPages(numPages);
                // Initialize with first few pages
                setVisiblePages([1, 2, 3]);
              }}
              className="pdf-document"
              loading={
                <div className="page-loading">
                  Loading PDF
                </div>
              }
            >
              {Array.from(new Array(numPages), (_, index) => (
                <div 
                  key={`page-container-${index + 1}`}
                  className="page-container"
                  data-page-number={index + 1}
                >
                  {visiblePages.includes(index + 1) && (
                    <Page
                      key={`page_${index + 1}`}
                      pageNumber={index + 1}
                      className="pdf-page"
                      width={window.innerWidth * 0.5}
                      loading={
                        <div className="page-loading">
                          Loading page {index + 1}
                        </div>
                      }
                    />
                  )}
                </div>
              ))}
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
