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
        page = data.get('page', 1)
        
        # Get the PDF path from app config
        pdf_path = current_app.config.get('CURRENT_PDF')
        if not pdf_path or not os.path.exists(pdf_path):
            return jsonify({'error': 'Please upload a PDF file first'}), 404

        print(f"Using PDF file: {pdf_path}")
        print(f"Question: {question}")
        print(f"Page: {page}")

        reader = PdfReader(pdf_path)
        if page < 1 or page > len(reader.pages):
            return jsonify({'error': f'Invalid page number. The document has {len(reader.pages)} pages.'}), 400

        # If asking about a chapter, find chapter boundaries
        is_chapter_query = 'chapter' in question.lower()
        text = ""
        
        if is_chapter_query:
            # Find chapter boundaries from TOC
            chapter_start = 1
            chapter_end = page
            next_chapter_start = len(reader.pages)
            
            if hasattr(reader, 'outline') and reader.outline:
                for item in reader.outline:
                    if isinstance(item, dict):
                        item_page = reader.get_destination_page_number(item) + 1
                        if item_page <= page:
                            chapter_start = item_page
                        elif item_page > page:
                            next_chapter_start = item_page
                            break
                chapter_end = next_chapter_start - 1
            
            # Extract text from the entire chapter
            for page_num in range(chapter_start - 1, chapter_end):
                current_page = reader.pages[page_num]
                text += f"\n\n=== Page {page_num + 1} ===\n\n"
                text += current_page.extract_text()
                
            context = f"text from Chapter pages {chapter_start} to {chapter_end}"
        else:
            # For non-chapter queries, use current page and neighbors
            start_page = max(1, page - 1)
            end_page = min(len(reader.pages), page + 1)
            
            for page_num in range(start_page - 1, end_page):
                current_page = reader.pages[page_num]
                text += f"\n\n=== Page {page_num + 1} ===\n\n"
                text += current_page.extract_text()
                
            context = f"text from pages {start_page} to {end_page}"

        print(f"Extracted text length: {len(text)}")
        print(f"Context: {context}")

        # Split text into chunks if it's too long
        chunks = chunk_text(text)
        all_responses = []

        # Process each chunk with OpenAI
        for i, chunk in enumerate(chunks):
            print(f"Processing chunk {i + 1} of {len(chunks)}")
            response = get_openai_client().chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": "You are a helpful assistant that answers questions about the content of a book. Base your answers only on the provided text. If you cannot find relevant information in the text, say so clearly. If asked about a chapter, try to provide a comprehensive summary of the chapter's content."},
                    {"role": "user", "content": f"Here is the {context}:\n\n{chunk}\n\nQuestion: {question}"}
                ],
                max_tokens=500
            )
            all_responses.append(response.choices[0].message.content)
            print(f"Got response for chunk {i + 1}")

        # Combine responses if there were multiple chunks
        final_answer = "\n\n".join(all_responses)
        print("Final answer length:", len(final_answer))
        return jsonify({'answer': final_answer}), 200

    except Exception as e:
        print(f"Error in ask_question: {str(e)}")
        return jsonify({'error': 'Error processing request. Please make sure a PDF is uploaded and try again.'}), 500

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
        # Save with a unique filename
        filename = os.path.join(current_app.config['UPLOAD_FOLDER'], 'current.pdf')
        
        # Save the file
        file.save(filename)
        
        # Update the current PDF path in app config
        current_app.config['CURRENT_PDF'] = filename
        
        # Extract table of contents if available
        try:
            reader = PdfReader(filename)
            toc = []
            if hasattr(reader, 'outline') and reader.outline:
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
                            
                            # Handle nested bookmarks
                            if '/First' in bookmark:
                                # Get all children
                                current_child = bookmark['/First']
                                while current_child:
                                    child_items = extract_bookmarks([current_child], level + 1)
                                    if child_items:
                                        item['children'].extend(child_items)
                                    if '/Next' in current_child:
                                        current_child = current_child['/Next']
                                    else:
                                        break
                            
                            items.append(item)
                            
                            # Process next sibling if it exists
                            if '/Next' in bookmark:
                                next_items = extract_bookmarks([bookmark['/Next']], level)
                                items.extend(next_items)
                                
                        elif isinstance(bookmark, list):
                            items.extend(extract_bookmarks(bookmark, level))
                    return items
                
                toc = extract_bookmarks(reader.outline)
            
            return jsonify({
                'message': 'File uploaded successfully',
                'filename': os.path.basename(filename),
                'toc': toc
            }), 200
            
        except Exception as e:
            print(f"Error processing PDF: {str(e)}")
            return jsonify({'error': 'Error processing PDF file'}), 500
    else:
        return jsonify({'error': 'Invalid file type. Please upload a PDF file.'}), 400

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