import { useState } from 'react'
import './App.css'

function App() {
  const [isDragging, setIsDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<{success: boolean, message: string} | null>(null)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile?.type === 'application/pdf') {
      setFile(droppedFile)
      setUploadStatus(null) // Reset status when new file is selected
    } else {
      setUploadStatus({
        success: false,
        message: 'Please upload a PDF file'
      })
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile?.type === 'application/pdf') {
      setFile(selectedFile)
      setUploadStatus(null) // Reset status when new file is selected
    } else {
      setUploadStatus({
        success: false,
        message: 'Please upload a PDF file'
      })
    }
  }

  const handleUpload = async () => {
    if (!file) return

    setIsUploading(true)
    setUploadStatus(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('http://localhost:5000/api/pdf/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (response.ok) {
        setUploadStatus({
          success: true,
          message: `Successfully uploaded: ${data.filename}`
        })
        // Here you would typically navigate to the next step or update the UI
      } else {
        setUploadStatus({
          success: false,
          message: data.error || 'Failed to upload file'
        })
      }
    } catch (error) {
      setUploadStatus({
        success: false,
        message: 'Network error. Please try again.'
      })
      console.error('Upload error:', error)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 py-6 flex flex-col justify-center sm:py-12">
      <div className="relative py-3 sm:max-w-xl sm:mx-auto">
        <div className="relative px-4 py-10 bg-white shadow-lg sm:rounded-3xl sm:p-20">
          <div className="max-w-md mx-auto">
            <div className="divide-y divide-gray-200">
              <div className="py-8 text-base leading-6 space-y-4 text-gray-700 sm:text-lg sm:leading-7">
                <h1 className="text-3xl font-bold text-center mb-8 text-indigo-600">Smart Textbook</h1>
                
                {/* Upload Section */}
                <div 
                  className={`mt-4 p-8 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors
                    ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 hover:border-indigo-400'}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={handleFileInput}
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    <div className="space-y-4">
                      <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                        <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <div className="text-gray-600">
                        {file ? (
                          <p className="font-medium text-indigo-600">{file.name}</p>
                        ) : (
                          <>
                            <p className="font-medium">Drop your PDF here</p>
                            <p className="text-sm">or click to browse</p>
                          </>
                        )}
                      </div>
                    </div>
                  </label>
                </div>

                {/* Status Message */}
                {uploadStatus && (
                  <div className={`mt-4 p-3 rounded-md ${uploadStatus.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                    {uploadStatus.message}
                  </div>
                )}

                {/* Upload Button */}
                {file && (
                  <button 
                    onClick={handleUpload}
                    disabled={isUploading}
                    className={`w-full mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg transition-colors
                      ${isUploading ? 'opacity-70 cursor-not-allowed' : 'hover:bg-indigo-700'}`}
                  >
                    {isUploading ? 'Processing...' : 'Process Textbook'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
