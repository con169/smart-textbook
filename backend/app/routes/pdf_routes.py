from flask import Blueprint, request, jsonify, current_app
import os
from werkzeug.utils import secure_filename
import PyPDF2
import json
from datetime import datetime, timedelta
from PyPDF2 import PdfReader
import glob

bp = Blueprint('pdf', __name__, url_prefix='/api/pdf')

ALLOWED_EXTENSIONS = {'pdf'}
TEMP_FILE_MAX_AGE = timedelta(hours=1)  # Clean files older than 1 hour

def is_file_old(filepath):
    """Check if a file is older than TEMP_FILE_MAX_AGE"""
    if not os.path.exists(filepath):
        return False
    
    file_time = datetime.fromtimestamp(os.path.getmtime(filepath))
    return datetime.now() - file_time > TEMP_FILE_MAX_AGE

def cleanup_old_files(force=False):
    """Clean up old files from the uploads directory
    Args:
        force (bool): If True, remove all files regardless of age
    """
    upload_folder = current_app.config['UPLOAD_FOLDER']
    
    # Clean up old PDFs - only if force=True since these are main content
    if force:
        pdf_files = glob.glob(os.path.join(upload_folder, '*.pdf'))
        for pdf in pdf_files:
            try:
                os.remove(pdf)
            except Exception as e:
                print(f"Error removing PDF {pdf}: {e}")
        
        # Clean up metadata files
        metadata_files = glob.glob(os.path.join(upload_folder, '*_metadata.json'))
        content_files = glob.glob(os.path.join(upload_folder, '*_content.txt'))
        for file in metadata_files + content_files:
            try:
                os.remove(file)
            except Exception as e:
                print(f"Error removing metadata file {file}: {e}")
    
    # Always clean up old temporary audio files
    temp_files = glob.glob(os.path.join(upload_folder, 'temp_audio_*.mp3'))
    for temp in temp_files:
        if force or is_file_old(temp):
            try:
                os.remove(temp)
            except Exception as e:
                print(f"Error removing temp file {temp}: {e}")

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
        # Clean up ALL old files before uploading new one
        cleanup_old_files(force=True)
        
        # Use a simple naming pattern
        filename = 'current.pdf'
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
                    for bookmark in bookmarks:
                        if isinstance(bookmark, dict):
                            page_num = reader.get_destination_page_number(bookmark)
                            item = {
                                'title': bookmark.get('/Title', 'Untitled'),
                                'pageNumber': page_num + 1,
                                'level': level,
                                'children': []
                            }
                            
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

@bp.route('/cleanup', methods=['POST'])
def trigger_cleanup():
    """Endpoint to manually trigger cleanup of old files"""
    try:
        cleanup_old_files(force=True)  # Clean everything
        return jsonify({'message': 'Cleanup completed successfully'}), 200
    except Exception as e:
        print(f"Cleanup error: {str(e)}")  # Log the error
        return jsonify({'error': f'Cleanup failed: {str(e)}'}), 500 