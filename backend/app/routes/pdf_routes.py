from flask import Blueprint, request, jsonify, current_app, abort, send_file
import os
from werkzeug.utils import secure_filename
from datetime import datetime, timedelta
from PyPDF2 import PdfReader
import glob
import hashlib
from pathlib import Path
import json

bp = Blueprint('pdf', __name__, url_prefix='/api/pdf')

ALLOWED_EXTENSIONS = {'pdf'}
TEMP_FILE_MAX_AGE = timedelta(hours=1)  # Clean files older than 1 hour
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB limit

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

def secure_check_file(file):
    """Perform security checks on uploaded file"""
    # Check file size
    file.seek(0, os.SEEK_END)
    size = file.tell()
    file.seek(0)
    if size > MAX_FILE_SIZE:
        return False, "File too large"

    # Check file extension
    if not file.filename.lower().endswith('.pdf'):
        return False, "Invalid file type - must be PDF"

    # Save to temporary file for validation
    temp_path = os.path.join(current_app.config['UPLOAD_FOLDER'], 'temp_check.pdf')
    try:
        file.save(temp_path)
        reader = PdfReader(temp_path)
        if not reader.pages or len(reader.pages) == 0:
            return False, "Invalid PDF structure"
        return True, None
    except Exception as e:
        return False, f"Invalid PDF file: {str(e)}"
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        file.seek(0)

@bp.route('/upload', methods=['POST'])
def upload_pdf():
    """Handle PDF file upload with security checks"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    # Security checks
    is_safe, error_message = secure_check_file(file)
    if not is_safe:
        return jsonify({'error': error_message}), 400

    # Clean up ALL old files before uploading new one
    cleanup_old_files(force=True)
    
    # Use a fixed filename
    filename = 'current.pdf'
    filepath = os.path.join(current_app.config['UPLOAD_FOLDER'], filename)
    
    try:
        # Save the file
        file.save(filepath)
        
        # Verify the saved file
        if not os.path.exists(filepath):
            return jsonify({'error': 'File save failed'}), 500
        
        # Update the current PDF path in app config
        current_app.config['CURRENT_PDF'] = filepath
        
        # Extract text content and save it
        reader = PdfReader(filepath)
        text_content = ""
        for page in reader.pages:
            text_content += page.extract_text() + "\n\n"
        
        # Save text content
        text_path = os.path.join(current_app.config['UPLOAD_FOLDER'], f"{filename}_content.txt")
        with open(text_path, 'w', encoding='utf-8') as f:
            f.write(text_content)
        
        # Extract TOC if available
        toc = []
        try:
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
                            
                            if '/Next' in bookmark:
                                next_items = extract_bookmarks([bookmark['/Next']], level)
                                items.extend(next_items)
                                
                        elif isinstance(bookmark, list):
                            items.extend(extract_bookmarks(bookmark, level))
                    
                    return items
                
                toc = extract_bookmarks(reader.outline)
        except Exception as e:
            print(f"Error extracting TOC: {str(e)}")
            # Continue even if TOC extraction fails
        
        # Calculate file hash for integrity
        file_hash = hashlib.sha256()
        with open(filepath, 'rb') as f:
            for chunk in iter(lambda: f.read(4096), b''):
                file_hash.update(chunk)
        
        # Save metadata
        metadata = {
            'filename': filename,
            'original_name': secure_filename(file.filename),
            'upload_date': datetime.now().isoformat(),
            'hash': file_hash.hexdigest(),
            'page_count': len(reader.pages),
            'has_toc': bool(toc)
        }
        
        metadata_path = os.path.join(current_app.config['UPLOAD_FOLDER'], f"{filename}_metadata.json")
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)
                
        return jsonify({
            'message': 'File uploaded successfully',
            'filename': filename,
            'hash': file_hash.hexdigest(),
            'toc': toc,
            'metadata': metadata
        }), 200
        
    except Exception as e:
        # Clean up on error
        if os.path.exists(filepath):
            os.remove(filepath)
        return jsonify({'error': f'Upload failed: {str(e)}'}), 500

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
    # If no specific filename is provided or it's "current", use the current PDF
    if filename in ['current', 'current.pdf']:
        if not current_app.config.get('CURRENT_PDF'):
            return jsonify({'error': 'No PDF currently loaded'}), 404
        filename = 'current.pdf'
    
    text_path = os.path.join(current_app.config['UPLOAD_FOLDER'], f"{filename}_content.txt")
    metadata_path = os.path.join(current_app.config['UPLOAD_FOLDER'], f"{filename}_metadata.json")
    
    if not os.path.exists(text_path) or not os.path.exists(metadata_path):
        return jsonify({'error': 'PDF content not found'}), 404
        
    try:
        with open(text_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)
            
        return jsonify({
            'content': content,
            'metadata': metadata
        }), 200
    except Exception as e:
        print(f"Error reading PDF content: {str(e)}")
        return jsonify({'error': 'Failed to read PDF content'}), 500

@bp.route('/cleanup', methods=['POST'])
def trigger_cleanup():
    """Endpoint to manually trigger cleanup of old files"""
    try:
        cleanup_old_files(force=True)  # Clean everything
        return jsonify({'message': 'Cleanup completed successfully'}), 200
    except Exception as e:
        print(f"Cleanup error: {str(e)}")  # Log the error
        return jsonify({'error': f'Cleanup failed: {str(e)}'}), 500

@bp.route('/file/<filename>', methods=['GET'])
def serve_pdf(filename):
    """Serve the PDF file directly"""
    if filename == 'current.pdf' and not current_app.config.get('CURRENT_PDF'):
        return jsonify({'error': 'No PDF currently loaded'}), 404
        
    filepath = os.path.join(current_app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'PDF file not found'}), 404
        
    try:
        return send_file(
            filepath,
            mimetype='application/pdf',
            as_attachment=False,
            download_name=filename
        )
    except Exception as e:
        print(f"Error serving PDF: {str(e)}")
        return jsonify({'error': 'Failed to serve PDF'}), 500 