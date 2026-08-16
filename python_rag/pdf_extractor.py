import os
from typing import Dict, Any, List
try:
    from pypdf import PdfReader
except ImportError:
    try:
        from PyPDF2 import PdfReader
    except ImportError:
        PdfReader = None


class PDFExtractor:
    """
    PDFExtractor Class in Python for RAG Systems.
    Extracts structured text, metadata, and page count from single or batch PDF files.
    """
    def __init__(self, max_character_length: int = 500000, default_language: str = "Odia"):
        self.max_character_length = max_character_length
        self.default_language = default_language

    def extract_from_pdf(self, pdf_path: str) -> Dict[str, Any]:
        filename = os.path.basename(pdf_path)
        print(f'📄 [Python PDFExtractor] Extracting: "{filename}"...')

        if not os.path.exists(pdf_path):
            error_msg = f'File not found at path: "{pdf_path}"'
            print(f'❌ [Python PDFExtractor] {error_msg}')
            return {
                "success": False,
                "filename": filename,
                "error": error_msg
            }

        try:
            if PdfReader is None:
                # Basic text fallback if pypdf is not installed
                with open(pdf_path, 'r', encoding='utf-8', errors='ignore') as f:
                    extracted_text = f.read()
                numpages = 1
                title = os.path.splitext(filename)[0]
                author = "Unknown"
            else:
                reader = PdfReader(pdf_path)
                numpages = len(reader.pages)
                page_texts = [page.extract_text() or '' for page in reader.pages]
                extracted_text = "\n\n".join(page_texts).strip()

                meta = reader.metadata or {}
                title = meta.get('/Title', os.path.splitext(filename)[0]) or os.path.splitext(filename)[0]
                author = meta.get('/Author', 'Sarala Dasa') or 'Sarala Dasa'

            is_truncated = False
            if len(extracted_text) > self.max_character_length:
                extracted_text = (
                    extracted_text[:self.max_character_length] +
                    "\n\n[TRUNCATED: Exceeded maximum character limit]"
                )
                is_truncated = True
                print(f'⚠️ [Python PDFExtractor] "{filename}" text exceeded limit. Truncated to {self.max_character_length} chars.')

            metadata = {
                "title": str(title).strip(),
                "author": str(author).strip(),
                "source": "PDF",
                "language": self.default_language
            }

            print(f'✅ [Python PDFExtractor] Successfully extracted "{filename}" ({numpages} pages, {len(extracted_text)} chars)')

            return {
                "success": True,
                "filename": filename,
                "pages": numpages,
                "text": extracted_text,
                "metadata": metadata,
                "isTruncated": is_truncated
            }

        except Exception as error:
            print(f'❌ [Python PDFExtractor] Failed to parse PDF "{filename}": {error}')
            return {
                "success": False,
                "filename": filename,
                "error": f"Invalid or unparseable PDF: {error}"
            }

    def extract_batch_pdfs(self, pdf_directory: str) -> List[Dict[str, Any]]:
        print(f'📂 [Python PDFExtractor] Starting batch extraction for directory: "{pdf_directory}"...')

        if not os.path.exists(pdf_directory):
            print(f'❌ [Python PDFExtractor] Directory not found: "{pdf_directory}"')
            return []

        pdf_files = [f for f in os.listdir(pdf_directory) if f.lower().endswith('.pdf')]

        if not pdf_files:
            print(f'⚠️ [Python PDFExtractor] No PDF files found in directory "{pdf_directory}".')
            return []

        print(f'🔍 [Python PDFExtractor] Found {len(pdf_files)} PDF files to process.')

        results = []
        for i, pdf_file in enumerate(pdf_files):
            full_path = os.path.join(pdf_directory, pdf_file)
            print(f'[Batch Progress {i + 1}/{len(pdf_files)}] Processing: {pdf_file}')
            result = self.extract_from_pdf(full_path)
            if result.get("success"):
                results.append(result)

        print(f'🎉 [Python PDFExtractor] Batch extraction complete. Processed {len(results)}/{len(pdf_files)} PDFs.')
        return results
