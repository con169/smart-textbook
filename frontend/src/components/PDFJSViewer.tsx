import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import './PDFJSViewer.css';

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

interface PDFJSViewerProps {
  file: string | null;
  currentPage: number;
  onPageChange: (page: number) => void;
}

const PDFJSViewer: React.FC<PDFJSViewerProps> = ({ file, currentPage, onPageChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.5);

  // Load PDF document
  useEffect(() => {
    if (!file) return;

    const loadingTask = pdfjsLib.getDocument(file);
    loadingTask.promise.then((doc) => {
      setPdfDoc(doc);
      setNumPages(doc.numPages);
    }).catch((error) => {
      console.error('Error loading PDF:', error);
    });

    return () => {
      loadingTask.destroy();
    };
  }, [file]);

  // Render page when page number changes
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || !textLayerRef.current) return;

    const renderPage = async (pageNum: number) => {
      try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });

        // Set canvas dimensions
        const canvas = canvasRef.current!;
        const context = canvas.getContext('2d')!;
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        // Render PDF page into canvas context
        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        // Clear text layer
        const textLayer = textLayerRef.current!;
        textLayer.innerHTML = '';
        textLayer.style.height = `${viewport.height}px`;
        textLayer.style.width = `${viewport.width}px`;

        // Render page
        const renderTask = page.render(renderContext);
        await renderTask.promise;

        // Get text content
        const textContent = await page.getTextContent();
        
        // Create text layer with proper typing
        const renderTextLayer = pdfjsLib.renderTextLayer as unknown as (params: {
          textContent: any;
          container: HTMLElement;
          viewport: any;
          textDivs: HTMLElement[];
        }) => Promise<void>;

        // Render text layer
        await renderTextLayer({
          textContent,
          container: textLayer,
          viewport,
          textDivs: []
        });

      } catch (error) {
        console.error('Error rendering page:', error);
      }
    };

    renderPage(currentPage);
  }, [pdfDoc, currentPage, scale]);

  return (
    <div className="pdfjs-container" ref={containerRef}>
      <div className="pdfjs-page-container" style={{ position: 'relative' }}>
        <canvas ref={canvasRef} />
        <div 
          ref={textLayerRef}
          className="pdfjs-text-layer"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            overflow: 'hidden',
            lineHeight: 1.0,
            userSelect: 'text'
          }}
        />
      </div>
    </div>
  );
};

export default PDFJSViewer; 