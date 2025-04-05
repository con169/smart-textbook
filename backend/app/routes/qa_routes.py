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
    try:
        data = request.get_json()
        if not data or 'question' not in data:
            return jsonify({'error': 'No question provided'}), 400

        question = data['question']
        page_number = data.get('page', 1)
        
        filename = os.path.join(current_app.config['UPLOAD_FOLDER'], 'current.pdf')
        if not os.path.exists(filename):
            return jsonify({'error': 'No PDF file uploaded'}), 404

        reader = PdfReader(filename)
        if page_number < 1 or page_number > len(reader.pages):
            return jsonify({'error': 'Invalid page number'}), 400

        # Extract text from the specified page
        page = reader.pages[page_number - 1]
        text = page.extract_text()

        # Get response from OpenAI
        response = get_openai_client().chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a helpful assistant that answers questions about the content of a book. Base your answers only on the provided text."},
                {"role": "user", "content": f"Here is the text from page {page_number}:\n\n{text}\n\nQuestion: {question}"}
            ],
            max_tokens=500
        )

        return jsonify({'answer': response.choices[0].message.content}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500

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

@bp.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if file and file.filename.endswith('.pdf'):
        filename = os.path.join(current_app.config['UPLOAD_FOLDER'], 'current.pdf')
        file.save(filename)
        return jsonify({'message': 'File uploaded successfully'}), 200
    
    return jsonify({'error': 'Invalid file type'}), 400

@bp.route('/get-toc', methods=['GET'])
def get_table_of_contents():
    try:
        filename = os.path.join(current_app.config['UPLOAD_FOLDER'], 'current.pdf')
        if not os.path.exists(filename):
            return jsonify({'error': 'No PDF file uploaded'}), 404

        reader = PdfReader(filename)
        
        def extract_bookmarks(bookmarks, level=0):
            items = []
            for bookmark in bookmarks:
                if isinstance(bookmark, dict):
                    item = {}
                    if '/Title' in bookmark:
                        item['title'] = bookmark['/Title']
                    if '/Page' in bookmark:
                        item['pageNumber'] = reader.get_destination_page_number(bookmark) + 1
                    item['level'] = level
                    
                    # Extract children/subsections
                    if '/First' in bookmark:
                        item['children'] = extract_bookmarks(bookmark['/First'], level + 1)
                    else:
                        item['children'] = []
                        
                    items.append(item)
                elif isinstance(bookmark, list):
                    items.extend(extract_bookmarks(bookmark, level))
            return items

        # Try to get TOC from metadata
        toc = []
        if hasattr(reader, 'outline') and reader.outline:
            toc = extract_bookmarks(reader.outline)
        
        # If no TOC in metadata, try to extract from content
        if not toc:
            # Use OpenAI to analyze the first page for potential TOC
            first_page = reader.pages[0]
            text = first_page.extract_text()
            
            response = get_openai_client().chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": "You are a helpful assistant that extracts hierarchical table of contents information from text. Return the information with proper indentation levels and page numbers."},
                    {"role": "user", "content": f"Extract the hierarchical table of contents from this text, if present. Use indentation to show hierarchy:\n\n{text}"}
                ],
                max_tokens=500
            )
            
            # Process the AI response to extract hierarchical TOC
            ai_response = response.choices[0].message.content
            lines = ai_response.split('\n')
            current_level = 0
            stack = [{'children': toc}]  # Root level
            
            for line in lines:
                if not line.strip():
                    continue
                    
                # Count leading spaces to determine level
                spaces = len(line) - len(line.lstrip())
                level = spaces // 2  # Assume 2 spaces per level
                
                # Extract title and page number
                parts = line.strip().split('.')
                if len(parts) >= 2 and parts[-1].strip().isdigit():
                    title = '.'.join(parts[:-1]).strip()
                    page_num = int(parts[-1].strip())
                    
                    # Create TOC item
                    item = {
                        'title': title,
                        'pageNumber': page_num,
                        'level': level,
                        'children': []
                    }
                    
                    # Adjust stack for current level
                    while len(stack) > level + 1:
                        stack.pop()
                    
                    # Add item to parent's children
                    stack[-1]['children'].append(item)
                    stack.append(item)
            
            # Extract final TOC from root
            toc = stack[0]['children']

        return jsonify({'toc': toc}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500 