import { useState } from 'react'
import './App.css'
import ChatInterface from './components/ChatInterface'
import PDFViewer from './components/PDFViewer'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [uniqueFilename, setUniqueFilename] = useState<string>('')
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<{
    isUploading: boolean;
    success?: boolean;
    message?: string;
  }>({ isUploading: false });

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    console.log('File selected:', selectedFile)
    
    if (selectedFile && selectedFile.type === 'application/pdf') {
      console.log('Valid PDF file detected')
      setFile(selectedFile)
      setUploadStatus({ isUploading: true, message: 'Uploading PDF...' })
      
      // Create FormData and send to backend
      const formData = new FormData()
      formData.append('file', selectedFile)
      console.log('FormData created with file:', selectedFile.name)

      try {
        console.log('Sending request to backend...')
        const response = await fetch('http://localhost:5000/api/pdf/upload', {
          method: 'POST',
          body: formData,
        })

        console.log('Response received:', response.status)
        if (!response.ok) {
          throw new Error('Upload failed')
        }

        const data = await response.json()
        console.log('Upload successful:', data)
        setUniqueFilename(data.filename)
        setUploadStatus({ 
          isUploading: false, 
          success: true, 
          message: `${selectedFile.name} uploaded successfully! You can now ask questions about it.` 
        })
        
        // Add a welcome message
        setMessages([{ 
          role: 'assistant', 
          content: 'I\'ve processed your PDF. What would you like to know about it?' 
        }])
      } catch (error) {
        console.error('Error uploading file:', error)
        setUploadStatus({ 
          isUploading: false, 
          success: false, 
          message: 'Failed to upload file. Please try again.' 
        })
      }
    } else if (selectedFile) {
      console.log('Invalid file type:', selectedFile.type)
      setUploadStatus({ 
        isUploading: false, 
        success: false, 
        message: 'Please select a PDF file.' 
      })
    }
  }

  const handleSendMessage = async (question: string) => {
    if (!file || !uniqueFilename) {
      alert('Please upload a PDF first')
      return
    }

    setIsLoading(true)
    setMessages(prev => [...prev, { role: 'user', content: question }])

    try {
      const response = await fetch('http://localhost:5000/api/qa/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question,
          filename: uniqueFilename,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get answer')
      }

      const data = await response.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer }])
    } catch (error) {
      console.error('Error getting answer:', error)
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error processing your question.' }])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Smart Textbook</h1>
        <div className="file-upload">
          <input
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            id="file-input"
            style={{ display: 'none' }}
            disabled={uploadStatus.isUploading}
          />
          <label 
            htmlFor="file-input" 
            className={`upload-button ${uploadStatus.isUploading ? 'uploading' : ''}`}
          >
            {uploadStatus.isUploading ? 'Uploading...' : file ? 'Change PDF' : 'Upload PDF'}
          </label>
          {file && <span className="filename">{file.name}</span>}
        </div>
      </header>
      {uploadStatus.message && (
        <div className={`upload-status ${uploadStatus.success ? 'success' : 'error'}`}>
          {uploadStatus.message}
        </div>
      )}
      <main className="app-main">
        <div className="pdf-section">
          <PDFViewer file={file} />
        </div>
        <div className="chat-section">
          <ChatInterface
            onSendMessage={handleSendMessage}
            messages={messages}
            isLoading={isLoading}
          />
        </div>
      </main>
    </div>
  )
}

export default App
