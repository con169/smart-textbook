from flask import Blueprint, request, jsonify, current_app
import os
import json
from openai import OpenAI, RateLimitError
import tiktoken
from datetime import datetime
from PyPDF2 import PdfReader

bp = Blueprint('qa', __name__, url_prefix='/api/qa')

def get_openai_client():
    """Create a new OpenAI client instance"""
    api_key = os.getenv('OPENAI_API_KEY')
    # Print masked version of API key for debugging
    if api_key:
        masked_key = f"{api_key[:8]}...{api_key[-4:]}"
        print(f"Using API key: {masked_key}")
    else:
        print("Warning: No API key found!")
    return OpenAI(api_key=api_key)

def count_tokens(text: str) -> int:
    """Count tokens in text using tiktoken"""
    encoding = tiktoken.encoding_for_model("gpt-3.5-turbo")
    return len(encoding.encode(text))

def chunk_text(text: str, max_tokens: int = 2000) -> list:
    """Split text into chunks that fit within token limits"""
    chunks = []
    current_chunk = ""
    current_tokens = 0
    
    # Split by paragraphs first
    paragraphs = text.split('\n')
    
    for paragraph in paragraphs:
        paragraph_tokens = count_tokens(paragraph)
        
        if current_tokens + paragraph_tokens > max_tokens:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = paragraph
            current_tokens = paragraph_tokens
        else:
            current_chunk += "\n" + paragraph
            current_tokens += paragraph_tokens
    
    if current_chunk:
        chunks.append(current_chunk.strip())
    
    return chunks

@bp.route('/ask', methods=['POST'])
def ask_question():
    data = request.json
    if not data or 'question' not in data:
        return jsonify({'error': 'Missing question'}), 400
    
    question = data['question']
    filename = data.get('filename')
    
    print(f"\n=== New Question Request ===")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print(f"Question: {question}")
    print(f"Filename: {filename}")
    
    try:
        # Get PDF content if filename is provided
        content = ""
        if filename:
            file_path = os.path.join(current_app.config['UPLOAD_FOLDER'], filename)
            if os.path.exists(file_path):
                try:
                    # Read PDF content using PyPDF2
                    reader = PdfReader(file_path)
                    content = ""
                    for page in reader.pages:
                        content += page.extract_text() + "\n"
                    print(f"Successfully extracted text from {filename}")
                except Exception as pdf_error:
                    print(f"Error extracting PDF text: {str(pdf_error)}")
                    return jsonify({'error': f'Error reading PDF: {str(pdf_error)}'}), 500
            else:
                print(f"Warning: File {filename} not found")
        
        # Create a new client for this request
        client = get_openai_client()
        
        # Prepare messages with content context if available
        messages = [
            {"role": "system", "content": "You are a helpful assistant. Answer questions based on the provided content."}
        ]
        
        if content:
            # Split content into chunks if it's too long
            chunks = chunk_text(content)
            context_message = f"Here is the content to answer questions from:\n\n{chunks[0]}"
            messages.append({"role": "user", "content": context_message})
            messages.append({"role": "assistant", "content": "I understand the content. What would you like to know?"})
        
        messages.append({"role": "user", "content": question})
        
        print("Making API call to OpenAI...")
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=messages,
            max_tokens=500  # Increased for more detailed responses
        )
        print("API call successful!")
        
        answer = response.choices[0].message.content
        print(f"Response received: {answer}")
        
        return jsonify({
            'answer': answer,
            'context_used': bool(content)
        }), 200
            
    except RateLimitError as e:
        print(f"Rate limit error: {str(e)}")
        return jsonify({
            'error': 'Rate limit exceeded. Please try again later.',
            'details': str(e)
        }), 429
    except Exception as e:
        print(f"Unexpected error: {str(e)}")
        return jsonify({'error': f'Error processing question: {str(e)}'}), 500

@bp.route('/history/<filename>', methods=['GET'])
def get_qa_history(filename):
    """Get Q&A history for a specific PDF"""
    history_path = os.path.join(current_app.config['UPLOAD_FOLDER'], f"{filename}_qa_history.json")
    
    if not os.path.exists(history_path):
        return jsonify({'history': []}), 200
        
    with open(history_path, 'r') as f:
        history = json.load(f)
        
    return jsonify({'history': history}), 200

@bp.route('/save_interaction', methods=['POST'])
def save_interaction():
    """Save a Q&A interaction to history"""
    data = request.json
    if not data or 'question' not in data or 'answer' not in data or 'filename' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
        
    filename = data['filename']
    history_path = os.path.join(current_app.config['UPLOAD_FOLDER'], f"{filename}_qa_history.json")
    
    # Load existing history or create new
    if os.path.exists(history_path):
        with open(history_path, 'r') as f:
            history = json.load(f)
    else:
        history = []
    
    # Add new interaction
    history.append({
        'question': data['question'],
        'answer': data['answer'],
        'timestamp': datetime.now().isoformat()
    })
    
    # Save updated history
    with open(history_path, 'w') as f:
        json.dump(history, f)
        
    return jsonify({'message': 'Interaction saved successfully'}), 200

@bp.route('/models', methods=['GET'])
def list_models():
    """List available OpenAI models"""
    try:
        # Create a new client for this request
        client = get_openai_client()
        models = client.models.list()
        available_models = [model.id for model in models.data]
        return jsonify({'models': available_models}), 200
    except Exception as e:
        return jsonify({'error': f'Error listing models: {str(e)}'}), 500 