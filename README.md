# Smart Textbook

An AI-powered web application that allows users to:
- Upload and process PDF textbooks
- Ask questions about specific chapters or topics
- Get AI-generated answers with text-to-speech capabilities using celebrity voices

## Features
- PDF text extraction and processing
- AI-powered Q&A system
- Text-to-speech with celebrity voice options
- Modern web interface

## Tech Stack
- Backend: Python (Flask)
- Frontend: React
- AI: OpenAI API
- Text-to-Speech: ElevenLabs API

## Setup Instructions
1. Clone the repository
2. Backend setup:
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```
3. Frontend setup:
   ```bash
   cd frontend
   npm install
   ```

## Environment Variables
Create a `.env` file in the backend directory with:
```
OPENAI_API_KEY=your_openai_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key
```

## License
MIT 