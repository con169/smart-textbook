import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import './PDFJSViewer.css';
import { useTheme } from '../contexts/ThemeContext';

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

interface Voice {
  voice_id: string;
  name: string;
}

export interface PDFJSViewerRef {
  scrollToPage: (pageNumber: number) => void;
}

const PDFJSViewer = forwardRef<PDFJSViewerRef, PDFJSViewerProps>(({ file, currentPage, onPageChange }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(3.0);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const pagesContainerRef = useRef<HTMLDivElement>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [voiceError, setVoiceError] = useState<string>('');
  const [ttsError, setTtsError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [speed, setSpeed] = useState<number>(1.0);

  // Load PDF document
  useEffect(() => {
    if (!file) return;

    // Clean up existing PDF and rendered pages
    if (pdfDoc) {
      pdfDoc.destroy();
      setPdfDoc(null);
      setNumPages(0);
      // Clear all rendered pages
      pageRefs.current.forEach((container) => {
        container.innerHTML = '';
      });
    }

    const loadingTask = pdfjsLib.getDocument(file);
    loadingTask.promise.then((doc) => {
      setPdfDoc(doc);
      setNumPages(doc.numPages);
      // Reset current page when loading new document
      onPageChange(1);
    }).catch((error) => {
      console.error('Error loading PDF:', error);
    });

    return () => {
      loadingTask.destroy();
      // Clean up when component unmounts or file changes
      if (pdfDoc) {
        pdfDoc.destroy();
      }
      // Clear all rendered pages
      pageRefs.current.forEach((container) => {
        container.innerHTML = '';
      });
    };
  }, [file, onPageChange]);

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
      root: pagesContainerRef.current,
      rootMargin: '-10% 0px',  // Ignore edges of viewport
      threshold: [0, 0.25, 0.5, 0.75, 1]  // Track multiple intersection points
    };

    let maxIntersection = {
      ratio: 0,
      pageNum: currentPage
    };

    const callback: IntersectionObserverCallback = (entries) => {
      entries.forEach(entry => {
        const pageNum = parseInt(entry.target.getAttribute('data-page') || '0');
        
        // Track the page with highest intersection ratio
        if (entry.intersectionRatio > maxIntersection.ratio) {
          maxIntersection = {
            ratio: entry.intersectionRatio,
            pageNum: pageNum
          };
        }

        // Ensure the page is rendered if it's becoming visible
        if (entry.isIntersecting) {
          const container = entry.target as HTMLDivElement;
          if (!container.hasChildNodes()) {
            renderPage(pageNum, container);
          }
        }
      });

      // Update page number if we have a clear winner and it's different
      if (maxIntersection.ratio > 0.25 && maxIntersection.pageNum !== currentPage) {
        onPageChange(maxIntersection.pageNum);
      }

      // Reset for next observation
      maxIntersection = { ratio: 0, pageNum: currentPage };
    };

    observerRef.current = new IntersectionObserver(callback, options);

    pageRefs.current.forEach((element) => {
      observerRef.current?.observe(element);
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, [pdfDoc, currentPage, onPageChange]);

  // Expose scrollToPage function to parent
  useImperativeHandle(ref, () => {
    const scrollToPageImpl = async (pageNumber: number) => {
      if (isLoading) {
        console.log('Already loading, ignoring scroll request');
        return;
      }

      console.log('scrollToPage called with:', pageNumber);
      const targetPage = Math.max(1, Math.min(pageNumber, numPages));
      console.log('Target page after bounds check:', targetPage);
      
      const pageElement = pageRefs.current.get(targetPage);
      console.log('Found page element:', !!pageElement);
      
      if (pageElement && pdfDoc) {
        setIsLoading(true);
        try {
          // Calculate the current visible page from container scroll position
          const container = pagesContainerRef.current;
          if (!container) throw new Error('Container not found');
          
          const currentScrollTop = container.scrollTop;
          const pageHeight = container.firstElementChild?.clientHeight || 0;
          const currentVisiblePage = Math.floor(currentScrollTop / pageHeight) + 1;
          
          // For long jumps, we'll do it in chunks
          const CHUNK_SIZE = 50; // Number of pages to jump at once
          const distance = Math.abs(targetPage - currentVisiblePage);
          
          if (distance > CHUNK_SIZE) {
            // Calculate intermediate target
            const direction = targetPage > currentVisiblePage ? 1 : -1;
            const intermediateTarget = currentVisiblePage + (direction * CHUNK_SIZE);
            
            // Pre-render the intermediate target page
            const intermediatePage = pageRefs.current.get(intermediateTarget);
            if (intermediatePage && !intermediatePage.hasChildNodes()) {
              await renderPage(intermediateTarget, intermediatePage);
            }
            
            // Scroll to intermediate position
            const intermediateElement = pageRefs.current.get(intermediateTarget);
            if (intermediateElement) {
              const elementTop = intermediateElement.offsetTop;
              const containerTop = container.offsetTop;
              const scrollPosition = elementTop - containerTop;
              
              container.scrollTo({
                top: scrollPosition,
                behavior: 'auto'
              });
              
              // Update page number to intermediate position
              onPageChange(intermediateTarget);
              
              // Schedule next chunk after a short delay
              setTimeout(() => {
                setIsLoading(false);
                scrollToPageImpl(targetPage);
              }, 100);
              return;
            }
          }
          
          // For short jumps or final approach, render target and neighbors
          if (!pageElement.hasChildNodes()) {
            console.log('Rendering target page');
            await renderPage(targetPage, pageElement);
          }

          // Calculate final scroll position
          const elementTop = pageElement.offsetTop;
          const containerTop = container.offsetTop;
          const scrollPosition = elementTop - containerTop;

          console.log('Scrolling to final position:', scrollPosition);

          // Scroll to final position
          container.scrollTo({
            top: scrollPosition,
            behavior: 'auto'
          });

          // Update the page number
          onPageChange(targetPage);
          
          // Pre-render neighbors after reaching target
          const neighbors = [-1, 1];
          for (const offset of neighbors) {
            const neighborPage = targetPage + offset;
            if (neighborPage >= 1 && neighborPage <= numPages) {
              const element = pageRefs.current.get(neighborPage);
              if (element && !element.hasChildNodes()) {
                renderPage(neighborPage, element).catch(console.error);
              }
            }
          }
        } catch (error) {
          console.error('Error scrolling to page:', error);
        } finally {
          setTimeout(() => {
            setIsLoading(false);
          }, 100);
        }
      } else {
        console.log('Page element not found in refs');
        setIsLoading(false);
      }
    };

    return {
      scrollToPage: scrollToPageImpl
    };
  });

  // Render page
  const renderPage = async (pageNum: number, container: HTMLDivElement): Promise<void> => {
    if (!pdfDoc) return;

    try {
      console.log(`Rendering page ${pageNum}`);
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      // Create canvas and text layer containers
      const canvas = document.createElement('canvas');
      const textLayerDiv = document.createElement('div');
      
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      textLayerDiv.className = 'pdfjs-text-layer';

      // Set dimensions and position for text layer
      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;

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

      // Render text layer with the same viewport as the page
      await renderTextLayer({
        textContent,
        container: textLayerDiv,
        viewport,
        textDivs: []
      });

      console.log(`Page ${pageNum} rendered successfully`);
    } catch (error) {
      console.error(`Error rendering page ${pageNum}:`, error);
      throw error;
    }
  };

  // Fetch voices when component mounts
  useEffect(() => {
    fetch('http://localhost:8000/api/tts/voices')
      .then(response => {
        if (!response.ok) throw new Error('Failed to fetch voices');
        return response.json();
      })
      .then(data => {
        if (data.voices && Array.isArray(data.voices)) {
          setVoices(data.voices);
          if (data.voices.length > 0) {
            setSelectedVoice(data.voices[0].voice_id);
          }
        }
      })
      .catch(error => {
        setVoiceError('Failed to fetch voices. Please check if the API key is configured correctly.');
      });
  }, []);

  const playPageAudio = async () => {
    try {
      setIsPlaying(true);
      setTtsError('');
      setIsLoading(true);
      
      const pageElement = pageRefs.current.get(currentPage);
      if (!pageElement) {
        throw new Error('Page element not found');
      }

      const textLayer = pageElement.querySelector('.pdfjs-text-layer');
      if (!textLayer) {
        throw new Error('Text layer not found');
      }

      // Get text content organized by lines
      const textElements = Array.from(textLayer.querySelectorAll('span'));
      const lines: string[] = [];
      let currentLine: HTMLElement[] = [];
      let lastY = -1;

      textElements.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (lastY === -1 || Math.abs(rect.top - lastY) < 5) {
          currentLine.push(el as HTMLElement);
        } else {
          if (currentLine.length > 0) {
            lines.push(currentLine.map(el => el.textContent || '').join(' ').trim());
          }
          currentLine = [el as HTMLElement];
        }
        lastY = rect.top;
      });

      if (currentLine.length > 0) {
        lines.push(currentLine.map(el => el.textContent || '').join(' ').trim());
      }

      const nonEmptyLines = lines.filter(line => line.trim().length > 0);

      const response = await fetch('http://localhost:8000/api/tts/read-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          page: currentPage,
          voice_id: selectedVoice,
          speed: speed,
          lines: nonEmptyLines
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate audio');
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      if (audioElement) {
        audioElement.pause();
        URL.revokeObjectURL(audioElement.src);
      }

      const audio = new Audio(audioUrl);
      audio.playbackRate = speed;
      setAudioElement(audio);

      audio.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        setIsPlaying(false);
        setTtsError('Failed to play audio');
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
    } catch (error) {
      console.error('Error playing audio:', error);
      setTtsError(error instanceof Error ? error.message : 'Failed to generate audio');
      setIsPlaying(false);
    } finally {
      setIsLoading(false);
    }
  };

  const stopAudio = () => {
    if (audioElement) {
      audioElement.pause();
      setIsPlaying(false);
    }
  };

  // Zoom control functions
  const zoomIn = () => {
    setScale(prevScale => {
      const newScale = prevScale + 0.5;
      return Math.min(newScale, 5.0);
    });
    // Clear and re-render all pages
    pageRefs.current.forEach((container) => {
      container.innerHTML = '';
    });
    if (pdfDoc) {
      pdfDoc.getPage(1).then(page => {
        const viewport = page.getViewport({ scale: scale + 0.5 });
        pageRefs.current.forEach(container => {
          container.style.width = `${viewport.width}px`;
        });
      });
    }
  };

  const zoomOut = () => {
    setScale(prevScale => {
      const newScale = prevScale - 0.5;
      return Math.max(newScale, 1.5);
    });
    // Clear and re-render all pages
    pageRefs.current.forEach((container) => {
      container.innerHTML = '';
    });
    if (pdfDoc) {
      pdfDoc.getPage(1).then(page => {
        const viewport = page.getViewport({ scale: scale - 0.5 });
        pageRefs.current.forEach(container => {
          container.style.width = `${viewport.width}px`;
        });
      });
    }
  };

  // Update the display percentage calculation
  const displayPercentage = Math.round((scale / 3.0) * 100);

  return (
    <div className="pdfjs-container" ref={containerRef}>
      <div className="pdfjs-controls">
        <div className="navigation-controls">
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
        
        <div className="tts-controls">
          {voiceError ? (
            <span className="error-message">{voiceError}</span>
          ) : (
            <>
              <select
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                disabled={isPlaying || voices.length === 0}
                className="voice-selector"
              >
                {voices.length === 0 ? (
                  <option value="">Loading voices...</option>
                ) : (
                  voices.map((voice) => (
                    <option key={voice.voice_id} value={voice.voice_id}>
                      {voice.name}
                    </option>
                  ))
                )}
              </select>
              
              <div className="speed-control">
                <label htmlFor="speed">Speed: {speed}x</label>
                <input
                  type="range"
                  id="speed"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={speed}
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                  disabled={isPlaying}
                  className="speed-slider"
                />
              </div>
              
              <button
                onClick={isPlaying ? stopAudio : playPageAudio}
                disabled={!selectedVoice || voices.length === 0 || isLoading}
                className={`play-button ${isPlaying ? 'playing' : ''} ${isLoading ? 'loading' : ''}`}
              >
                {isLoading ? 'Processing...' : isPlaying ? 'Stop' : 'Read Page'}
              </button>
            </>
          )}
          {ttsError && <span className="error-message">{ttsError}</span>}
        </div>
        <div className="zoom-controls">
          <button onClick={zoomOut} disabled={scale <= 1.5}>-</button>
          <span>{displayPercentage}%</span>
          <button onClick={zoomIn} disabled={scale >= 5.0}>+</button>
        </div>
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