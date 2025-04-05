import React, { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import './App.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface TableOfContentsItem {
  title: string;
  pageNumber: number;
}

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
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
                <div
                  key={index}
                  className="toc-item"
                  onClick={() => setCurrentPage(item.pageNumber)}
                >
                  {item.title}
                </div>
              ))}
            </nav>
          </div>
          
          <main className="main-content">
            <Document
              file={file}
              onLoadSuccess={({ numPages }) => setNumPages(numPages)}
              className="pdf-document"
            >
              {Array.from(new Array(numPages), (_, index) => (
                <Page
                  key={`page_${index + 1}`}
                  pageNumber={index + 1}
                  className="pdf-page"
                  width={window.innerWidth * 0.5}
                />
              ))}
            </Document>
          </main>

          <div className="questions-panel">
            <h3 className="questions-header">Ask Questions</h3>
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
