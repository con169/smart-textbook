import React, { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import './PDFViewer.css';

// Set up the worker for PDF.js
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

interface PDFViewerProps {
  file: File | null;
}

const PDFViewer: React.FC<PDFViewerProps> = ({ file }) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setPdfUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    }
  }, [file]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1); // Reset to first page when loading new document
  };

  const changePage = (offset: number) => {
    setPageNumber(prevPageNumber => {
      const newPage = prevPageNumber + offset;
      return newPage >= 1 && newPage <= (numPages || 1) ? newPage : prevPageNumber;
    });
  };

  const previousPage = () => changePage(-1);
  const nextPage = () => changePage(1);

  const zoomIn = () => setScale(prev => Math.min(prev + 0.1, 2.0));
  const zoomOut = () => setScale(prev => Math.max(prev - 0.1, 0.5));

  if (!file) {
    return <div className="pdf-placeholder">Upload a PDF to view it here</div>;
  }

  return (
    <div className="pdf-viewer">
      <div className="pdf-controls">
        <div className="pdf-navigation">
          <button onClick={previousPage} disabled={pageNumber <= 1}>
            Previous
          </button>
          <span>
            Page {pageNumber} of {numPages || '?'}
          </span>
          <button onClick={nextPage} disabled={pageNumber >= (numPages || 1)}>
            Next
          </button>
        </div>
        <div className="pdf-zoom">
          <button onClick={zoomOut}>-</button>
          <span>{Math.round(scale * 100)}%</span>
          <button onClick={zoomIn}>+</button>
        </div>
      </div>
      <div className="pdf-container">
        {pdfUrl && (
          <Document
            file={pdfUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            loading={<div className="pdf-loading">Loading PDF...</div>}
            error={<div className="pdf-error">Error loading PDF. Please try again.</div>}
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              loading={<div className="pdf-loading">Loading page...</div>}
            />
          </Document>
        )}
      </div>
    </div>
  );
};

export default PDFViewer; 