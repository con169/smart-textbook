from flask import Blueprint, request, jsonify, current_app
import os
import json
from openai import OpenAI
import tiktoken
from datetime import datetime

bp = Blueprint('qa', __name__, url_prefix='/api/qa')

# Initialize OpenAI client
client = OpenAI(
    api_key=os.getenv('OPENAI_API_KEY'),
    # Remove any custom configuration that might cause issues
)

def count_tokens(text: str) -> int:
    """Count tokens in text using tiktoken"""
    encoding = tiktoken.encoding_for_model("gpt-4")
    return len(encoding.encode(text))

def chunk_text(text: str, max_tokens: int = 6000) -> list:
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
    if not data or 'question' not in data or 'filename' not in data:
        return jsonify({'error': 'Missing question or filename'}), 400
    
    question = data['question']
    filename = data['filename']
    
    # Get the content file path
    content_path = os.path.join(current_app.config['UPLOAD_FOLDER'], f"{filename}_content.txt")
    if not os.path.exists(content_path):
        return jsonify({'error': 'PDF content not found'}), 404
    
    try:
        # Read the content
        with open(content_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Split content into chunks if it's too long
        chunks = chunk_text(content)
        
        # Initialize response storage
        relevant_content = []
        
        # For each chunk, ask OpenAI to determine relevance to the question
        for chunk in chunks:
            relevance_messages = [
                {"role": "system", "content": "You are a helpful assistant that determines if text content is relevant to answering a question. Respond with only 'yes' or 'no'."},
                {"role": "user", "content": f"Question: {question}\n\nIs the following content relevant to answering this question?\n\nContent: {chunk}"}
            ]
            
            relevance_response = client.chat.completions.create(
                model="gpt-4",
                messages=relevance_messages,
                temperature=0,
                max_tokens=10
            )
            
            if 'yes' in relevance_response.choices[0].message.content.lower():
                relevant_content.append(chunk)
        
        # If we found relevant content, use it to answer the question
        if relevant_content:
            context = "\n\n".join(relevant_content)
            
            messages = [
                {"role": "system", "content": """You are a helpful teaching assistant that answers questions about textbook content.
                Provide clear, accurate answers based on the content provided. If the answer cannot be fully determined from the content,
                acknowledge this and provide the best possible answer based on what is available. Use markdown formatting for better readability."""},
                {"role": "user", "content": f"Using the following textbook content, please answer this question: {question}\n\nContent: {context}"}
            ]
            
            response = client.chat.completions.create(
                model="gpt-4",
                messages=messages,
                temperature=0.7,
                max_tokens=1000
            )
            
            return jsonify({
                'answer': response.choices[0].message.content,
                'context_used': True
            }), 200
        else:
            # If no relevant content found, provide a fallback response
            messages = [
                {"role": "system", "content": "You are a helpful teaching assistant. The user has asked a question about content that isn't available in the provided text. Explain this politely and suggest how they might rephrase their question."},
                {"role": "user", "content": f"The user asked: {question}"}
            ]
            
            response = client.chat.completions.create(
                model="gpt-4",
                messages=messages,
                temperature=0.7,
                max_tokens=200
            )
            
            return jsonify({
                'answer': response.choices[0].message.content,
                'context_used': False
            }), 200
            
    except Exception as e:
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