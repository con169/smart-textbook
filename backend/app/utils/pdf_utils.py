import PyPDF2
from typing import Dict, List

def extract_pdf_structure(pdf_path: str) -> Dict:
    """
    Extract the structure of a PDF including chapters and sections if available
    """
    with open(pdf_path, 'rb') as file:
        pdf = PyPDF2.PdfReader(file)
        
        # Basic structure
        structure = {
            'num_pages': len(pdf.pages),
            'chapters': [],
            'outline': []
        }
        
        # Try to extract outline/bookmarks if available
        try:
            if pdf.outline:
                structure['outline'] = process_outline(pdf.outline)
        except:
            pass
            
        return structure

def process_outline(outline: List) -> List:
    """
    Process PDF outline/bookmarks into a structured format
    """
    processed = []
    for item in outline:
        if isinstance(item, list):
            processed.extend(process_outline(item))
        else:
            try:
                processed.append({
                    'title': item.title,
                    'page': item.page if hasattr(item, 'page') else None
                })
            except:
                continue
    return processed 