from flask import Blueprint, request, jsonify, current_app, send_file
import os
import requests
from io import BytesIO
from PyPDF2 import PdfReader

bp = Blueprint('tts', __name__, url_prefix='/api/tts')

print("\n=== TTS Routes Loaded ===\n")

def get_elevenlabs_api_key():
    api_key = os.getenv('ELEVENLABS_API_KEY')
    print("\n=== Checking ElevenLabs API Key ===")
    print(f"API Key present: {'Yes' if api_key else 'No'}")
    print("===================================\n")
    return api_key

@bp.route('/voices', methods=['GET'])
def list_voices():
    """Get available voices from ElevenLabs"""
    print("\n=== Voice List Request Received ===")
    try:
        api_key = get_elevenlabs_api_key()
        if not api_key:
            print("ERROR: No API key found!")
            return jsonify({'error': 'ElevenLabs API key not configured'}), 500

        print("Making request to ElevenLabs API...")
        response = requests.get(
            'https://api.elevenlabs.io/v1/voices',
            headers={'xi-api-key': api_key}
        )

        print(f"Response status code: {response.status_code}")
        if response.ok:
            data = response.json()
            voices = data.get('voices', [])
            print(f"Successfully found {len(voices)} voices")
            for voice in voices:
                print(f"- {voice.get('name', 'Unknown')}")
            return jsonify(data), 200
        else:
            error_msg = f"API Error: {response.text}"
            print(error_msg)
            return jsonify({'error': error_msg}), response.status_code

    except Exception as e:
        error_msg = f"Server Error: {str(e)}"
        print(error_msg)
        return jsonify({'error': error_msg}), 500
    finally:
        print("=== Voice List Request Complete ===\n")

@bp.route('/read-pdf', methods=['POST'])
def read_pdf_page():
    """Convert PDF page text to speech using ElevenLabs"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data received'}), 400
        
        if 'page' not in data or 'voice_id' not in data:
            return jsonify({'error': 'Missing required fields: page and voice_id'}), 400

        api_key = get_elevenlabs_api_key()
        if not api_key:
            return jsonify({'error': 'ElevenLabs API key not configured'}), 500

        # Get the PDF path from the app config
        pdf_path = current_app.config.get('CURRENT_PDF')
        if not pdf_path or not os.path.exists(pdf_path):
            return jsonify({'error': 'No PDF file loaded'}), 400

        # Extract text from the specified page
        try:
            reader = PdfReader(pdf_path)
            page_num = int(data['page']) - 1  # Convert to 0-based index
            
            if page_num < 0 or page_num >= len(reader.pages):
                return jsonify({'error': f'Invalid page number. Valid range: 1 to {len(reader.pages)}'}), 400
            
            page = reader.pages[page_num]
            text = page.extract_text()
            
            if not text.strip():
                return jsonify({'error': 'No text found on this page'}), 400

        except Exception as e:
            return jsonify({'error': f'Failed to extract text from PDF: {str(e)}'}), 500

        # Get speed parameter (default to 1.0 if not provided)
        speed = float(data.get('speed', 1.0))
        
        # Adjust text based on speed
        if speed != 1.0:
            # Add SSML tags for speed adjustment
            text = f'<speak><prosody rate="{int((speed-1)*100)}%">{text}</prosody></speak>'

        # Request TTS from ElevenLabs
        response = requests.post(
            f'https://api.elevenlabs.io/v1/text-to-speech/{data["voice_id"]}',
            headers={
                'xi-api-key': api_key,
                'Content-Type': 'application/json'
            },
            json={
                'text': text,
                'model_id': 'eleven_monolingual_v1',
                'voice_settings': {
                    'stability': 0.5,
                    'similarity_boost': 0.75
                }
            }
        )

        if response.ok:
            # Store audio temporarily
            audio_data = BytesIO(response.content)
            audio_data.seek(0)
            
            # Generate a temporary filename
            temp_path = os.path.join(current_app.config['UPLOAD_FOLDER'], f'temp_audio_page_{page_num + 1}.mp3')
            
            # Save the audio file
            with open(temp_path, 'wb') as f:
                f.write(audio_data.read())
            
            # Return the audio file
            return send_file(
                temp_path,
                mimetype='audio/mpeg',
                as_attachment=True,
                download_name=f'page_{page_num + 1}.mp3'
            )
        else:
            return jsonify({'error': f"ElevenLabs API Error: {response.text}"}), response.status_code

    except Exception as e:
        return jsonify({'error': str(e)}), 500 