"""
text_chunker.py
Intelligent text chunking with paragraph-aware splitting,
Odia sentence boundary support (।), and overlap.
"""

import re
import uuid
import logging
from typing import Dict, Any, List

logger = logging.getLogger(__name__)


class TextChunker:
    """
    Splits documents into overlapping text chunks for RAG indexing.

    Two public entry-points:
      • chunk(text, metadata)         — plain text string
      • process_document(document)    — legacy dict {text, filename, metadata}
    """

    def __init__(self, chunk_size: int = 500, overlap: int = 100):
        self.chunk_size = chunk_size
        self.overlap = overlap

    # ── public API ───────────────────────────────────────────────────────────
    def chunk(self, text: str, metadata: Dict[str, Any] = None) -> List[Dict[str, Any]]:
        """Chunk a plain text string. metadata is merged into every chunk."""
        if not text or not isinstance(text, str):
            return []
        meta = metadata or {}
        raw = self._split(text.strip())
        return self._build_chunk_objects(raw, meta)

    def process_document(self, document: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Legacy interface: accepts {text, filename, metadata} dict."""
        text = document.get("text", "")
        if not text or not isinstance(text, str):
            return []

        filename = document.get("filename", "Untitled Document")
        meta = dict(document.get("metadata", {}))
        meta.setdefault("title", meta.get("title", filename))
        meta.setdefault(
            "source",
            "PDF" if filename.lower().endswith(".pdf") else "Text",
        )
        meta.setdefault("language", "Odia")

        return self.chunk(text, meta)

    # ── internal helpers ─────────────────────────────────────────────────────
    def _split(self, text: str) -> List[str]:
        """Split text into raw chunk strings respecting paragraphs and sentences."""
        # Try paragraph-level split first
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]

        # If one giant paragraph, split by Odia/Latin sentence boundaries
        if len(paragraphs) == 1 and len(paragraphs[0]) > self.chunk_size:
            paragraphs = self._sentence_split(paragraphs[0])

        raw_chunks: List[str] = []
        current = ""

        for para in paragraphs:
            if len(current) + len(para) + 2 <= self.chunk_size:
                current = f"{current}\n\n{para}" if current else para
            else:
                if len(current) >= 50:
                    raw_chunks.append(current)
                overlap_text = current[-self.overlap:] if len(current) > self.overlap else ""
                current = f"{overlap_text}\n\n{para}" if overlap_text else para

        if len(current) >= 50:
            raw_chunks.append(current)

        return raw_chunks

    @staticmethod
    def _sentence_split(text: str) -> List[str]:
        """Split on Odia (।) and Latin (. ! ?) sentence terminators."""
        sentences = re.findall(r"[^.!?।\n]+[.!?।\n]+", text)
        return [s.strip() for s in sentences if s.strip()] or [text]

    def _build_chunk_objects(
        self, raw_chunks: List[str], meta: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        total = len(raw_chunks)
        objects = []
        for i, text in enumerate(raw_chunks):
            chunk_meta = {**meta, "chunkIndex": i, "totalChunks": total}
            objects.append(
                {"id": str(uuid.uuid4()), "text": text, "metadata": chunk_meta}
            )
        logger.debug(f"TextChunker: produced {total} chunks")
        return objects
