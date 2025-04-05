from flask import Blueprint, request, jsonify, current_app
import os
from werkzeug.utils import secure_filename
import PyPDF2
import json
from datetime import datetime
from PyPDF2 import PdfReader

bp = Blueprint('pdf', __name__, url_prefix='/api/pdf')

ALLOWED_EXTENSIONS = {'pdf'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@bp.route('/upload', methods=['POST'])
def upload_pdf():
    """Handle PDF file upload"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if file and file.filename.endswith('.pdf'):
        filename = secure_filename(file.filename)
        filepath = os.path.join(current_app.config['UPLOAD_FOLDER'], filename)
        
        # Save the file
        file.save(filepath)
        
        # Update the current PDF path in app config
        current_app.config['CURRENT_PDF'] = filepath
        
        # Extract TOC if available
        try:
            reader = PdfReader(filepath)
            toc = []
            
            if hasattr(reader, 'outline') and reader.outline:
                def extract_bookmarks(bookmarks, level=0):
                    items = []
                    for item in bookmarks:
                        if isinstance(item, dict):
                            page_num = reader.get_destination_page_number(item)
                            items.append({
                                'title': item.get('/Title', 'Untitled'),
                                'pageNumber': page_num + 1,
                                'level': level,
                                'children': []
                            })
                        elif isinstance(item, list):
                            items.extend(extract_bookmarks(item, level + 1))
                    return items
                
                toc = extract_bookmarks(reader.outline)
            
            return jsonify({
                'message': 'File uploaded successfully',
                'filename': filename,
                'toc': toc
            }), 200
            
        except Exception as e:
            print(f"Error extracting TOC: {str(e)}")
            return jsonify({
                'message': 'File uploaded successfully but failed to extract TOC',
                'filename': filename,
                'toc': []
            }), 200
    else:
        return jsonify({'error': 'Invalid file type. Please upload a PDF file.'}), 400

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