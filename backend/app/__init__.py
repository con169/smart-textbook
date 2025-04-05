from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)

# Configure app
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev')
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size
app.config['CURRENT_PDF'] = None  # Track the current PDF file path

# Ensure upload directory exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Register blueprints
from .routes import pdf_routes, qa_routes, tts_routes
app.register_blueprint(pdf_routes.bp)
app.register_blueprint(qa_routes.bp)
app.register_blueprint(tts_routes.bp)

if __name__ == '__main__':
    app.run(debug=True)
