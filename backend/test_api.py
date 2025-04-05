from openai import OpenAI
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize OpenAI client
client = OpenAI(
    api_key=os.getenv('OPENAI_API_KEY'),
)

try:
    # Try to list models
    models = client.models.list()
    print("API key is working! Available models:")
    for model in models.data:
        print(f"- {model.id}")
except Exception as e:
    print(f"Error: {str(e)}") 