import re
import time
from typing import Dict, Any, List


class TextChunker:
    """
    TextChunker Class in Python for RAG Systems.
    Splits long documents into chunks of ~500 chars with 100 char overlap,
    smart paragraph/sentence boundaries, and metadata preservation.
    """
    def __init__(self, chunk_size: int = 500, overlap: int = 100):
        self.chunk_size = chunk_size
        self.overlap = overlap

    def chunk_by_sentences(self, text: str) -> List[str]:
        if not text:
            return []
        sentences = re.findall(r'[^.!?।\n]+[.!?।\n]+', text)
        if not sentences:
            sentences = [text]
        return [s.strip() for s in sentences if s.strip()]

    def process_document(self, document: Dict[str, Any]) -> List[Dict[str, Any]]:
        text = document.get("text", "")
        if not text or not isinstance(text, str):
            return []

        full_text = text.strip()
        if not full_text:
            return []

        # Split by paragraph
        paragraphs = [p.strip() for p in re.split(r'\n\s*\n', full_text) if p.strip()]

        if len(paragraphs) == 1 and len(paragraphs[0]) > self.chunk_size:
            paragraphs = self.chunk_by_sentences(paragraphs[0])

        raw_chunks = []
        current_chunk = ""

        for para in paragraphs:
            if len(current_chunk + " " + para) <= self.chunk_size:
                current_chunk = f"{current_chunk}\n\n{para}" if current_chunk else para
            else:
                if len(current_chunk) >= 50:
                    raw_chunks.append(current_chunk)

                overlap_text = (
                    current_chunk[-self.overlap:]
                    if len(current_chunk) > self.overlap
                    else ""
                )
                current_chunk = f"{overlap_text}\n\n{para}" if overlap_text else para

        if len(current_chunk) >= 50:
            raw_chunks.append(current_chunk)

        timestamp = int(time.time() * 1000)
        total_chunks = len(raw_chunks)
        filename = document.get("filename", "Untitled Document")
        meta = document.get("metadata", {})
        title = meta.get("title", filename)
        source = meta.get("source", "PDF" if filename.lower().endswith(".pdf") else "Text")
        language = meta.get("language", "Odia")

        chunk_objects = []
        for index, chunk_text in enumerate(raw_chunks):
            chunk_meta = {
                "source": source,
                "title": title,
                "chunkIndex": index,
                "totalChunks": total_chunks,
                "language": language
            }
            chunk_meta.update(meta)

            chunk_objects.append({
                "id": f"chunk_{timestamp}_{index}",
                "text": chunk_text,
                "metadata": chunk_meta
            })

        return chunk_objects
