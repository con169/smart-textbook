import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
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

interface PageInfo {
  pageNumber: number;
  isLoaded: boolean;
}

export interface PDFJSViewerRef {
  scrollToPage: (pageNumber: number) => void;
}

const PDFJSViewer = forwardRef<PDFJSViewerRef, PDFJSViewerProps>(({ file, currentPage, onPageChange }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const pagesContainerRef = useRef<HTMLDivElement>(null);

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

  // Handle page changes
  useEffect(() => {
    if (!pdfDoc || !pagesContainerRef.current) return;

    const pageElement = pageRefs.current.get(currentPage);
    if (pageElement) {
      // Ensure the page is rendered
      if (!pageElement.hasChildNodes()) {
        renderPage(currentPage, pageElement);
      }
      
      // Only scroll the container itself, not the whole viewport
      if (pageElement.getAttribute('data-needs-scroll') === 'true') {
        const container = pagesContainerRef.current;
        const elementTop = pageElement.offsetTop - container.offsetTop;
        container.scrollTo({
          top: elementTop,
          behavior: 'smooth'
        });
        pageElement.removeAttribute('data-needs-scroll');
      }
    }
  }, [currentPage, pdfDoc]);

  // Setup intersection observer
  useEffect(() => {
    if (!pagesContainerRef.current || !pdfDoc) return;

    const options = {
      root: pagesContainerRef.current, // Observe intersections within the container
      rootMargin: '0px',
      threshold: 0.5
    };

    const callback: IntersectionObserverCallback = (entries) => {
      entries.forEach(entry => {
        const pageNum = parseInt(entry.target.getAttribute('data-page') || '0');
        if (entry.isIntersecting) {
          // Ensure the page is rendered
          const container = entry.target as HTMLDivElement;
          if (!container.hasChildNodes()) {
            renderPage(pageNum, container);
          }
        }
      });
    };

    observerRef.current = new IntersectionObserver(callback, options);

    pageRefs.current.forEach((element) => {
      observerRef.current?.observe(element);
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, [pdfDoc]);

  // Expose scrollToPage function to parent
  useImperativeHandle(ref, () => ({
    scrollToPage: (pageNumber: number) => {
      console.log('scrollToPage called with:', pageNumber);
      const targetPage = Math.max(1, Math.min(pageNumber, numPages));
      console.log('Target page after bounds check:', targetPage);
      
      const pageElement = pageRefs.current.get(targetPage);
      console.log('Found page element:', !!pageElement);
      
      if (pageElement) {
        // Mark this page as needing to scroll
        pageElement.setAttribute('data-needs-scroll', 'true');
        // Ensure the page is rendered
        if (!pageElement.hasChildNodes()) {
          console.log('Page not rendered, rendering now');
          renderPage(targetPage, pageElement);
        }
        // Update the page number
        onPageChange(targetPage);
      } else {
        console.log('Page element not found in refs');
      }
    }
  }));

  // Render page
  const renderPage = async (pageNum: number, container: HTMLDivElement) => {
    if (!pdfDoc) return;

    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      // Create canvas and text layer containers
      const canvas = document.createElement('canvas');
      const textLayerDiv = document.createElement('div');
      
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      textLayerDiv.className = 'pdfjs-text-layer';

      container.appendChild(canvas);
      container.appendChild(textLayerDiv);

      // Set canvas dimensions
      const context = canvas.getContext('2d')!;
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      // Render PDF page into canvas context
      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };

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
        container: textLayerDiv,
        viewport,
        textDivs: []
      });

    } catch (error) {
      console.error(`Error rendering page ${pageNum}:`, error);
    }
  };

  return (
    <div className="pdfjs-container" ref={containerRef}>
      <div className="pdfjs-controls">
        <button 
          onClick={() => {
            const prevPage = Math.max(1, currentPage - 1);
            const pageElement = pageRefs.current.get(prevPage);
            if (pageElement) {
              pageElement.setAttribute('data-needs-scroll', 'true');
              onPageChange(prevPage);
            }
          }}
          disabled={currentPage <= 1}
        >
          Previous
        </button>
        <span>Page {currentPage} of {numPages}</span>
        <button 
          onClick={() => {
            const nextPage = Math.min(numPages || 1, currentPage + 1);
            const pageElement = pageRefs.current.get(nextPage);
            if (pageElement) {
              pageElement.setAttribute('data-needs-scroll', 'true');
              onPageChange(nextPage);
            }
          }}
          disabled={currentPage >= (numPages || 1)}
        >
          Next
        </button>
      </div>
      <div className="pdfjs-pages" ref={pagesContainerRef}>
        {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNumber => (
          <div
            key={pageNumber}
            ref={element => {
              if (element) {
                pageRefs.current.set(pageNumber, element);
                observerRef.current?.observe(element);
              }
            }}
            data-page={pageNumber}
            className="pdfjs-page-container"
          />
        ))}
      </div>
    </div>
  );
});

export default PDFJSViewer; 