import React, { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import './PDFViewer.css';

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
  const [numPages, setNumPages] = useState<number | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [voiceError, setVoiceError] = useState<string>('');
  const [ttsError, setTtsError] = useState<string>('');

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
        
        const response = await fetch('http://localhost:5000/api/tts/read-pdf', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                page: currentPage,  // Send actual page number
                voice_id: selectedVoice,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to generate audio');
        }

        const blob = await response.blob();
        const audioUrl = URL.createObjectURL(blob);
        
        if (audioElement) {
            audioElement.pause();
            URL.revokeObjectURL(audioElement.src);
        }

        const audio = new Audio(audioUrl);
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
    }
  };

  const stopAudio = () => {
    if (audioElement) {
      audioElement.pause();
      setIsPlaying(false);
    }
  };

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
              
              <button
                onClick={isPlaying ? stopAudio : playPageAudio}
                disabled={!selectedVoice || voices.length === 0}
                className={`play-button ${isPlaying ? 'playing' : ''}`}
              >
                {isPlaying ? 'Stop' : 'Read Page'}
              </button>
            </>
          )}
          {ttsError && <span className="error-message">{ttsError}</span>}
        </div>
      </div>

      <div className="pdf-container">
        {file ? (
          <Document
            file={file}
            onLoadSuccess={handleDocumentLoadSuccess}
            className="pdf-document"
          >
            <Page
              pageNumber={currentPage}
              className="pdf-page"
              renderTextLayer={true}
              renderAnnotationLayer={true}
            />
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