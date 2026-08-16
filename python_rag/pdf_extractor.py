"""
pdf_extractor.py
Extract text and metadata from single PDFs or entire directories.
"""

import os
import logging
from pathlib import Path
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

try:
    from pypdf import PdfReader
except ImportError:
    try:
        from PyPDF2 import PdfReader
    except ImportError:
        PdfReader = None
        logger.warning("pypdf not installed — PDF extraction unavailable.")


class PDFExtractor:
    """Extract structured text and metadata from PDF files."""

    def __init__(self, max_chars: int = 500_000, default_language: str = "Odia"):
        self.max_chars = max_chars
        self.default_language = default_language

    # ── single file ───────────────────────────────────────────────────────────
    def extract_from_pdf(self, file_path: str) -> Dict[str, Any]:
        path = Path(file_path)
        filename = path.name
        logger.info(f'📄 Extracting: "{filename}"')

        if not path.exists():
            logger.error(f'File not found: "{file_path}"')
            return {"success": False, "filename": filename, "error": f"File not found: {file_path}"}

        if PdfReader is None:
            logger.error("pypdf not installed")
            return {"success": False, "filename": filename, "error": "pypdf not installed"}

        try:
            reader = PdfReader(str(path))
            num_pages = len(reader.pages)

            page_texts = []
            for i, page in enumerate(reader.pages):
                try:
                    page_texts.append(page.extract_text() or "")
                except Exception as exc:
                    logger.warning(f"  Page {i} extraction failed: {exc}")

            text = "\n\n".join(page_texts).strip()

            # Truncate if needed
            truncated = False
            if len(text) > self.max_chars:
                text = text[: self.max_chars] + "\n\n[TRUNCATED]"
                truncated = True
                logger.warning(f'"{filename}" truncated to {self.max_chars} chars.')

            # Metadata from PDF info dict
            info = reader.metadata or {}
            title = (info.get("/Title") or path.stem).strip()
            author = (info.get("/Author") or "Unknown").strip()

            logger.info(f'✅ "{filename}" — {num_pages} pages, {len(text)} chars')
            return {
                "success": True,
                "filename": filename,
                "pages": num_pages,
                "text": text,
                "isTruncated": truncated,
                "metadata": {
                    "title": title,
                    "author": author,
                    "source": "PDF",
                    "language": self.default_language,
                    "path": str(path),
                    "pages": num_pages,
                },
            }

        except Exception as exc:
            logger.error(f'❌ Failed to parse "{filename}": {exc}')
            return {"success": False, "filename": filename, "error": str(exc)}

    # ── batch ──────────────────────────────────────────────────────────────────
    def extract_batch_pdfs(self, pdf_directory: str) -> List[Dict[str, Any]]:
        directory = Path(pdf_directory)
        logger.info(f'📂 Batch extracting from "{directory}"')

        if not directory.exists():
            logger.error(f'Directory not found: "{directory}"')
            return []

        pdf_files = sorted(directory.glob("*.pdf"))
        if not pdf_files:
            logger.info("No PDF files found.")
            return []

        logger.info(f"Found {len(pdf_files)} PDF(s).")
        results = []
        for i, pdf_path in enumerate(pdf_files):
            logger.info(f"[{i + 1}/{len(pdf_files)}] {pdf_path.name}")
            result = self.extract_from_pdf(str(pdf_path))
            if result.get("success"):
                results.append(result)

        logger.info(f"✅ Batch done: {len(results)}/{len(pdf_files)} extracted.")
        return results
