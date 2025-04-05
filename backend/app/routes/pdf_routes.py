from flask import Blueprint, request, jsonify, current_app
import os
from werkzeug.utils import secure_filename
import PyPDF2
import json
from datetime import datetime

bp = Blueprint('pdf', __name__, url_prefix='/api/pdf')

ALLOWED_EXTENSIONS = {'pdf'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@bp.route('/upload', methods=['POST'])
def upload_pdf():
    print("\n=== PDF Upload Request ===")
    print("Files in request:", request.files)
    
    if 'file' not in request.files:
        print("Error: No file part in request")
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    print("Received file:", file.filename)
    
    if file.filename == '':
        print("Error: No selected file")
        return jsonify({'error': 'No selected file'}), 400

    if not allowed_file(file.filename):
        print("Error: Invalid file type")
        return jsonify({'error': 'Invalid file type. Only PDF files are allowed'}), 400

    # Secure the filename
    filename = secure_filename(file.filename)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    unique_filename = f"{timestamp}_{filename}"
    print("Generated unique filename:", unique_filename)
    
    # Save the file
    file_path = os.path.join(current_app.config['UPLOAD_FOLDER'], unique_filename)
    print("Saving file to:", file_path)
    file.save(file_path)
    
    # Extract text and metadata
    try:
        with open(file_path, 'rb') as pdf_file:
            print("Reading PDF with PyPDF2...")
            pdf_reader = PyPDF2.PdfReader(pdf_file)
            
            # Extract text from each page
            text_content = []
            print(f"Extracting text from {len(pdf_reader.pages)} pages...")
            for page in pdf_reader.pages:
                text_content.append(page.extract_text())
            
            # Get metadata
            metadata = {
                'title': filename,
                'num_pages': len(pdf_reader.pages),
                'upload_date': timestamp,
                'file_path': file_path
            }
            print("Generated metadata:", metadata)
            
            # Save metadata and text content
            metadata_path = os.path.join(current_app.config['UPLOAD_FOLDER'], f"{unique_filename}_metadata.json")
            text_path = os.path.join(current_app.config['UPLOAD_FOLDER'], f"{unique_filename}_content.txt")
            
            print("Saving metadata to:", metadata_path)
            with open(metadata_path, 'w', encoding='utf-8') as f:
                json.dump(metadata, f)
            
            print("Saving text content to:", text_path)
            with open(text_path, 'w', encoding='utf-8') as f:
                f.write('\n---PAGE BREAK---\n'.join(text_content))
            
            print("Upload successful!")
            return jsonify({
                'message': 'File uploaded successfully',
                'filename': unique_filename,
                'metadata': metadata
            }), 200
            
    except Exception as e:
        print("Error processing PDF:", str(e))
        # Clean up files if there's an error
        if os.path.exists(file_path):
            os.remove(file_path)
        return jsonify({'error': f'Error processing PDF: {str(e)}'}), 500

@bp.route('/list', methods=['GET'])
def list_pdfs():
    upload_folder = current_app.config['UPLOAD_FOLDER']
    pdfs = []
    
    for filename in os.listdir(upload_folder):
        if filename.endswith('_metadata.json'):
            with open(os.path.join(upload_folder, filename), 'r') as f:
                metadata = json.load(f)
                pdfs.append(metadata)
    
    return jsonify({'pdfs': pdfs}), 200

@bp.route('/<filename>', methods=['GET'])
def get_pdf_content(filename):
    text_path = os.path.join(current_app.config['UPLOAD_FOLDER'], f"{filename}_content.txt")
    metadata_path = os.path.join(current_app.config['UPLOAD_FOLDER'], f"{filename}_metadata.json")
    
    if not os.path.exists(text_path) or not os.path.exists(metadata_path):
        return jsonify({'error': 'PDF not found'}), 404
        
    with open(text_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    with open(metadata_path, 'r') as f:
        metadata = json.load(f)
        
    return jsonify({
        'content': content,
        'metadata': metadata
    }), 200 