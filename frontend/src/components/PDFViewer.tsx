import React, { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import './PDFViewer.css';
import { useTheme } from '../contexts/ThemeContext';

// Set up the worker for PDF.js
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

interface Voice {
  voice_id: string;
  name: string;
}

interface PDFViewerProps {
  file: string | null;
  onPageChange: (pageNumber: number) => void;
  currentPage: number;
}

const PDFViewer: React.FC<PDFViewerProps> = ({ file, onPageChange, currentPage }) => {
  const { theme, toggleTheme } = useTheme();
  const [numPages, setNumPages] = useState<number | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [voiceError, setVoiceError] = useState<string>('');
  const [ttsError, setTtsError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [speed, setSpeed] = useState<number>(1.0);
  const [currentParagraph, setCurrentParagraph] = useState<number | null>(null);
  const [readyPages, setReadyPages] = useState<Set<number>>(new Set());

  // Effect to handle page changes from TOC
  useEffect(() => {
    const pageElement = document.querySelector(`.page-container[data-page="${currentPage}"]`);
    if (pageElement) {
      pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [currentPage]);

  // Effect to handle text highlighting
  useEffect(() => {
    // Remove previous highlights
    document.querySelectorAll('.highlighted-text').forEach(el => {
      el.classList.remove('highlighted-text');
    });

    // Add new highlight only if the current page is ready
    if (currentParagraph !== null && readyPages.has(currentPage)) {
      const textLayer = document.querySelector(`.page-container[data-page="${currentPage}"] .react-pdf__Page__textContent`);
      if (textLayer) {
        const textElements = Array.from(textLayer.querySelectorAll('span'));
        const lines: HTMLElement[][] = [];
        let currentLine: HTMLElement[] = [];
        let lastY = -1;

        // Group elements by vertical position
        textElements.forEach(el => {
          const rect = el.getBoundingClientRect();
          if (lastY === -1 || Math.abs(rect.top - lastY) < 5) {
            currentLine.push(el as HTMLElement);
          } else {
            if (currentLine.length > 0) {
              lines.push([...currentLine]);
            }
            currentLine = [el as HTMLElement];
          }
          lastY = rect.top;
        });

        if (currentLine.length > 0) {
          lines.push(currentLine);
        }

        // Highlight the current line
        if (lines[currentParagraph]) {
          lines[currentParagraph].forEach(el => {
            el.classList.add('highlighted-text');
          });

          // Scroll the first element into view
          lines[currentParagraph][0]?.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });
        }
      }
    }
  }, [currentParagraph, currentPage, readyPages]);

  useEffect(() => {
    // Fetch available voices when component mounts
    console.log('Starting to fetch voices from backend...');
    fetch('http://localhost:5000/api/tts/voices')
      .then(response => {
        console.log('Got response:', response.status);
        if (!response.ok) {
          throw new Error('Failed to fetch voices');
        }
        return response.json();
      })
      .then(data => {
        console.log('Received data:', data);
        if (data.voices && Array.isArray(data.voices)) {
          console.log(`Found ${data.voices.length} voices`);
          setVoices(data.voices);
          if (data.voices.length > 0) {
            setSelectedVoice(data.voices[0].voice_id);
          }
          setVoiceError('');
        } else if (data.error) {
          console.error('Error from voices API:', data.error);
          setVoiceError(data.error);
        }
      })
      .catch(error => {
        console.error('Error fetching voices:', error);
        setVoiceError('Failed to fetch voices. Please check if the API key is configured correctly.');
      });
  }, []);

  const handleDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const playPageAudio = async () => {
    try {
      setIsPlaying(true);
      setTtsError('');
      setIsLoading(true);
      setCurrentParagraph(null);
      
      if (!readyPages.has(currentPage)) {
        throw new Error('Text layer not ready. Please wait for the page to fully load.');
      }

      const textLayer = document.querySelector(`.page-container[data-page="${currentPage}"] .react-pdf__Page__textContent`);
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

      const response = await fetch('http://localhost:5000/api/tts/read-pdf', {
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

      // Get the audio blob from the response
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      if (audioElement) {
        audioElement.pause();
        URL.revokeObjectURL(audioElement.src);
      }

      const audio = new Audio(audioUrl);
      audio.playbackRate = speed;
      setAudioElement(audio);
      
      // Set up time update handler for highlighting
      let currentTime = 0;
      const avgCharsPerSecond = 15 / speed;
      
      audio.ontimeupdate = () => {
        if (!readyPages.has(currentPage)) return;
        
        const newTime = audio.currentTime;
        if (Math.floor(newTime) !== Math.floor(currentTime)) {
          currentTime = newTime;
          
          let totalChars = 0;
          let currentIndex = 0;
          
          for (let i = 0; i < nonEmptyLines.length; i++) {
            totalChars += nonEmptyLines[i].length;
            const timeForText = totalChars / (15 / speed); // 15 chars per second
            
            if (timeForText > currentTime) {
              currentIndex = i;
              break;
            }
          }
          
          setCurrentParagraph(currentIndex);
        }
      };

      audio.onended = () => {
        setIsPlaying(false);
        setCurrentParagraph(null);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        setIsPlaying(false);
        setCurrentParagraph(null);
        setTtsError('Failed to play audio');
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
    } catch (error) {
      console.error('Error playing audio:', error);
      setTtsError(error instanceof Error ? error.message : 'Failed to generate audio');
      setIsPlaying(false);
      setCurrentParagraph(null);
    } finally {
      setIsLoading(false);
    }
  };

  const stopAudio = () => {
    if (audioElement) {
      audioElement.pause();
      setIsPlaying(false);
      setCurrentParagraph(null);
    }
  };

  // Generate array of page numbers to render
  const pageNumbers = numPages ? Array.from(new Array(numPages), (_, index) => index + 1) : [];

  return (
    <div className="pdf-viewer">
      <div className="pdf-controls">
        <div className="navigation-controls">
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            Previous
          </button>
          <span>
            Page {currentPage} of {numPages}
          </span>
          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= (numPages || 0)}
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
        <button 
          className="theme-toggle" 
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          {theme === 'light' ? (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          )}
        </button>
      </div>

      <div className="pdf-container">
        {file ? (
          <Document
            file={file}
            onLoadSuccess={handleDocumentLoadSuccess}
            className="pdf-document"
          >
            {pageNumbers.map((pageNumber) => (
              <div 
                key={pageNumber} 
                className="page-container"
                data-page={pageNumber}
              >
                <div className="page-number">Page {pageNumber}</div>
                <Page
                  pageNumber={pageNumber}
                  className="pdf-page"
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                  onLoadSuccess={(page) => {
                    // Update current page based on scroll position
                    const observer = new IntersectionObserver(
                      (entries) => {
                        entries.forEach((entry) => {
                          if (entry.isIntersecting) {
                            const page = parseInt(entry.target.getAttribute('data-page') || '1');
                            if (page !== currentPage) {
                              onPageChange(page);
                            }
                          }
                        });
                      },
                      {
                        root: null,
                        threshold: 0.5
                      }
                    );

                    const element = document.querySelector(`[data-page="${pageNumber}"]`);
                    if (element) {
                      observer.observe(element);
                    }

                    // Wait for text layer to be ready
                    const waitForTextLayer = () => {
                      const textLayer = element?.querySelector('.react-pdf__Page__textContent');
                      if (textLayer) {
                        // Set opacity to 0 once we confirm text layer is positioned correctly
                        (textLayer as HTMLElement).style.opacity = '0';
                        setReadyPages(prev => new Set([...prev, pageNumber]));
                        return true;
                      }
                      return false;
                    };

                    if (!waitForTextLayer()) {
                      const interval = setInterval(() => {
                        if (waitForTextLayer()) {
                          clearInterval(interval);
                        }
                      }, 100);

                      setTimeout(() => clearInterval(interval), 5000);
                    }

                    return () => {
                      if (element) {
                        observer.unobserve(element);
                      }
                      setReadyPages(prev => {
                        const next = new Set(prev);
                        next.delete(pageNumber);
                        return next;
                      });
                    };
                  }}
                />
                {!readyPages.has(pageNumber) && (
                  <div className="text-layer-loading">
                    Loading text layer...
                  </div>
                )}
              </div>
            ))}
          </Document>
        ) : (
          <div className="pdf-placeholder">
            Please upload a PDF file
          </div>
        )}
      </div>
    </div>
  );
};

export default PDFViewer; 