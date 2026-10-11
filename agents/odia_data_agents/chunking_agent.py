"""
chunking_agent.py — Agent 3: Odia-Aware Chunking Agent.
Preserves paragraph flow and splits long texts on Odia danda (।) and Latin (.!?) boundaries.
Generates deterministic IDs for idempotent ingestion.
"""

import re
import json
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone

from .config import AgentConfig

logger = logging.getLogger(__name__)


class ChunkingAgent:
    """
    Splits accepted documents into overlapping, Odia-aware chunks with
    deterministic IDs and rich provenance metadata.
    """

    def __init__(self, config: Optional[AgentConfig] = None):
        self.config = config or AgentConfig()
        self.chunks: List[Dict[str, Any]] = []

    def _split_into_sentences(self, text: str) -> List[str]:
        """Splits on Odia danda (।), double danda (॥), and standard punctuation."""
        # Matches non-punctuation sequence followed by terminators
        sentences = re.findall(r"[^.!?।॥\n]+[.!?।॥\n]+", text)
        cleaned = [s.strip() for s in sentences if s.strip()]
        return cleaned or [text.strip()]

    def _split_text(self, text: str) -> List[str]:
        """Paragraph-first, then sentence-based splitting respecting chunk_size and overlap."""
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]

        expanded_units: List[str] = []
        for p in paragraphs:
            if len(p) <= self.config.chunk_size:
                expanded_units.append(p)
            else:
                # Long paragraph: break down by Odia/Latin sentence boundaries
                sentences = self._split_into_sentences(p)
                expanded_units.extend(sentences)

        raw_chunks: List[str] = []
        current = ""

        for unit in expanded_units:
            if not current:
                current = unit
            elif len(current) + len(unit) + 2 <= self.config.chunk_size:
                current = f"{current}\n\n{unit}"
            else:
                if len(current) >= self.config.min_chunk_length:
                    raw_chunks.append(current)
                # Form overlap from tail of previous chunk
                overlap_text = (
                    current[-self.config.chunk_overlap:]
                    if len(current) > self.config.chunk_overlap
                    else ""
                )
                current = f"{overlap_text}\n\n{unit}".strip() if overlap_text else unit

        if current and len(current) >= self.config.min_chunk_length:
            raw_chunks.append(current)

        return raw_chunks

    def chunk_document(self, doc: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Splits a single document into chunk records with deterministic IDs."""
        text = doc.get("content", "")
        if not text:
            return []

        doc_id = doc.get("doc_id", "doc_unknown")
        raw_chunks = self._split_text(text)
        total_chunks = len(raw_chunks)

        doc_chunks = []
        for idx, chunk_text in enumerate(raw_chunks):
            chunk_id = f"{doc_id}_c{idx:03d}"
            record = {
                "chunk_id": chunk_id,
                "doc_id": doc_id,
                "text": chunk_text,
                "char_length": len(chunk_text),
                "metadata": {
                    "source": doc.get("category", "General"),
                    "title": doc.get("title", "Untitled Document"),
                    "source_url": doc.get("source_url", ""),
                    "domain": doc.get("domain", ""),
                    "category": doc.get("category", ""),
                    "language": doc.get("language", "odia"),
                    "chunkIndex": idx,
                    "totalChunks": total_chunks,
                    "license_status": doc.get("license_status", "review_required"),
                    "chunked_at": datetime.now(timezone.utc).isoformat(),
                },
            }
            doc_chunks.append(record)

        return doc_chunks

    def chunk_all(self, documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Processes all documents and outputs chunks.jsonl."""
        logger.info(f"✂️ [Agent 3: Chunking] Chunking {len(documents)} document(s)...")
        self.chunks = []
        for doc in documents:
            chunks = self.chunk_document(doc)
            self.chunks.extend(chunks)

        logger.info(f"✅ [Agent 3: Chunking] Generated {len(self.chunks)} chunk(s).")
        self._write_output()
        return self.chunks

    def _write_output(self):
        chunks_path = self.config.output_dir / "chunks.jsonl"
        with open(chunks_path, "w", encoding="utf-8") as f:
            for c in self.chunks:
                f.write(json.dumps(c, ensure_ascii=False) + "\n")
        logger.info(f"📁 Chunks saved to: {chunks_path}")
