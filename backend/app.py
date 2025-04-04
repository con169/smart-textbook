from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv()

def create_app():
    app = Flask(__name__)
    CORS(app)
    
    # Configure app
    app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev')
    app.config['UPLOAD_FOLDER'] = 'uploads'
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
    
    # Ensure upload directory exists
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    
    # Register blueprints
    from app.routes import pdf_routes, qa_routes  # Remove tts_routes for now
    app.register_blueprint(pdf_routes.bp)
    app.register_blueprint(qa_routes.bp)
    # Comment out tts_routes until we implement it
    # app.register_blueprint(tts_routes.bp)
    
    return app

if __name__ == '__main__':
    app = create_app()
    app.run(debug=True) 