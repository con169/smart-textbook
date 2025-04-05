from app import app

if __name__ == '__main__':
    print("\n=== Starting Flask Server on port 5000 ===\n")
    app.run(host='0.0.0.0', port=5000, debug=True) 