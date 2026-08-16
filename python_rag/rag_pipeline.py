"""
rag_pipeline.py
Complete RAG pipeline: Extract → Chunk → Embed → Store → Query.
Synchronous (no asyncio) to be compatible with Python 3.15 + FastAPI sync routes.
"""

import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

from embedding_generator import EmbeddingGenerator
from vector_store import VectorStore
from pdf_extractor import PDFExtractor
from text_chunker import TextChunker
from web_scraper import WebScraper

logger = logging.getLogger(__name__)

# Path to the pre-scraped local dataset
_LOCAL_DATA = Path(__file__).parent.parent / "data" / "scraped_odia_data.json"


class RAGPipeline:
    """
    Orchestrates the full RAG lifecycle:
      run()   → ingest documents into the vector store
      query() → retrieve relevant chunks for a user query
    """

    def __init__(self, embedding_type: str = "gemini"):
        self.embedder = EmbeddingGenerator(model_type=embedding_type)
        self.vector_store = VectorStore()
        self.pdf_extractor = PDFExtractor()
        self.chunker = TextChunker(chunk_size=500, overlap=100)
        self.web_scraper = WebScraper(timeout_seconds=12)

    # ── ingest ────────────────────────────────────────────────────────────────
    def run(self, config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        config = config or {}
        logger.info("=" * 50)
        logger.info("🚀 RAG PIPELINE — STARTING")
        logger.info("=" * 50)

        self.vector_store.connect()
        raw_docs: List[Dict[str, Any]] = []

        # ── STEP 1: PDFs ──────────────────────────────────────────────────────
        pdf_dir = config.get("pdfDirectory") or str(
            Path(__file__).parent.parent / "pdfs"
        )
        logger.info(f'📄 STEP 1: Extracting PDFs from "{pdf_dir}"')
        for pdf in self.pdf_extractor.extract_batch_pdfs(pdf_dir):
            if pdf.get("text"):
                raw_docs.append(
                    {
                        "text": pdf["text"],
                        "filename": pdf["filename"],
                        "metadata": pdf.get("metadata", {}),
                    }
                )

        # ── STEP 2: Web scraping ──────────────────────────────────────────────
        urls: List[str] = config.get("websiteUrls") or []
        if urls:
            logger.info(f"🌐 STEP 2: Scraping {len(urls)} URL(s)")
            for page in self.web_scraper.scrape_batch(urls):
                if page.get("content"):
                    raw_docs.append(
                        {
                            "text": page["content"],
                            "filename": page.get("title", "Web Page"),
                            "metadata": {
                                "source": "Website",
                                "title": page.get("title", ""),
                                "url": page.get("url", ""),
                                "language": "Odia",
                            },
                        }
                    )

        # ── STEP 3: Local JSON + explicit records ─────────────────────────────
        db_records: List[Dict] = list(config.get("databaseRecords") or [])
        if _LOCAL_DATA.exists():
            try:
                with open(_LOCAL_DATA, "r", encoding="utf-8") as f:
                    db_records.extend(json.load(f))
            except Exception as exc:
                logger.warning(f"Could not load local data file: {exc}")

        if db_records:
            logger.info(f"📊 STEP 3: Loading {len(db_records)} local/DB records")
            for rec in db_records:
                content = rec.get("content") or rec.get("text")
                if content:
                    raw_docs.append(
                        {
                            "text": content,
                            "filename": rec.get("title", "Untitled"),
                            "metadata": {
                                "source": rec.get("category", "Database"),
                                "title": rec.get("title", "Untitled"),
                                "source_url": rec.get("source_url", ""),
                                "language": rec.get("language", "Odia"),
                            },
                        }
                    )

        logger.info(f"Total documents collected: {len(raw_docs)}")

        # ── STEP 4: Chunk ─────────────────────────────────────────────────────
        logger.info("✂️  STEP 4: Chunking (size=500, overlap=100)")
        all_chunks: List[Dict] = []
        for doc in raw_docs:
            all_chunks.extend(self.chunker.process_document(doc))
        logger.info(f"Generated {len(all_chunks)} chunks")

        # ── STEP 5: Embed ─────────────────────────────────────────────────────
        logger.info(f"🧠 STEP 5: Embedding [{self.embedder.model_type}, {self.embedder.dimension}-dim]")
        embedded = self.embedder.generate_batch_embeddings(all_chunks)

        # ── STEP 6: Store ─────────────────────────────────────────────────────
        logger.info("💾 STEP 6: Storing in vector store")
        stored = self.vector_store.store_chunks(embedded)

        # ── STEP 7: Stats ─────────────────────────────────────────────────────
        stats = self.vector_store.get_stats()
        self.vector_store.disconnect()

        logger.info("=" * 50)
        logger.info("✅ RAG PIPELINE COMPLETE")
        logger.info(f"   chunks_processed={len(embedded)}, stored={stored}")
        logger.info(f"   stats={stats}")
        logger.info("=" * 50)

        return {
            "status": "success",
            "chunksProcessed": len(embedded),
            "storedCount": stored,
            "stats": stats,
        }

    # ── query ─────────────────────────────────────────────────────────────────
    def query(self, user_query: str, top_k: int = 5) -> Dict[str, Any]:
        if not user_query or not isinstance(user_query, str):
            raise ValueError("Query must be a non-empty string.")

        logger.info(f'🔍 RAG query: "{user_query[:80]}"')
        self.vector_store.connect()

        query_embedding = self.embedder.generate_embedding(user_query)
        results = self.vector_store.search_similar(query_embedding, limit=top_k)

        self.vector_store.disconnect()

        logger.info(f"Found {len(results)} results")
        return {
            "status": "success",
            "query": user_query,
            "resultsCount": len(results),
            "results": results,
        }
