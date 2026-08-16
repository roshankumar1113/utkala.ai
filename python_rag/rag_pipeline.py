import os
import json
from typing import Dict, Any, List, Optional
from pdf_extractor import PDFExtractor
from web_scraper import WebScraper
from text_chunker import TextChunker
from embedding_generator import EmbeddingGenerator
from vector_store import VectorStore


class RAGPipeline:
    """
    RAGPipeline Class in Python.
    Orchestrates Extract -> Chunk -> Embed -> Store -> Query.
    """
    def __init__(self):
        self.pdf_extractor = PDFExtractor()
        self.web_scraper = WebScraper(timeout_seconds=12)
        self.text_chunker = TextChunker(chunk_size=500, overlap=100)
        self.embedding_generator = EmbeddingGenerator()
        self.vector_store = VectorStore()

    def run(self, config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        config = config or {}
        print("\n========================================")
        print("🚀 PYTHON RAG PIPELINE EXECUTOR STARTED")
        print("========================================")

        self.vector_store.connect()
        raw_documents = []

        # STEP 1: PDF Extraction
        pdf_dir = config.get("pdfDirectory") or os.path.join(os.path.dirname(__file__), "..", "pdfs")
        print(f'\n=== STEP 1: EXTRACTING PDFS FROM "{pdf_dir}" ===')
        if os.path.exists(pdf_dir):
            pdfs = self.pdf_extractor.extract_batch_pdfs(pdf_dir)
            for pdf in pdfs:
                if pdf.get("text"):
                    raw_documents.append({
                        "text": pdf["text"],
                        "filename": pdf["filename"],
                        "metadata": pdf.get("metadata", {})
                    })

        # STEP 2: Web Scraping
        urls = config.get("websiteUrls") or []
        if urls:
            print(f'\n=== STEP 2: SCRAPING {len(urls)} WEBSITES ===')
            pages = self.web_scraper.scrape_batch(urls)
            for page in pages:
                if page.get("content"):
                    raw_documents.append({
                        "text": page["content"],
                        "filename": page["title"],
                        "metadata": {
                            "source": "Website",
                            "title": page["title"],
                            "url": page["url"],
                            "language": "Odia"
                        }
                    })

        # STEP 3: Database & Local Records
        db_records = config.get("databaseRecords") or []
        local_data_file = os.path.join(os.path.dirname(__file__), "..", "data", "scraped_odia_data.json")
        if os.path.exists(local_data_file):
            with open(local_data_file, "r", encoding="utf-8") as f:
                local_records = json.load(f)
            db_records.extend(local_records)

        if db_records:
            print(f'\n=== STEP 3: LOADING {len(db_records)} DATABASE / LOCAL RECORDS ===')
            for rec in db_records:
                if rec.get("content"):
                    raw_documents.append({
                        "text": rec["content"],
                        "filename": rec.get("title", "Untitled Record"),
                        "metadata": {
                            "source": rec.get("category", "Database"),
                            "title": rec.get("title", "Untitled"),
                            "source_url": rec.get("source_url", ""),
                            "language": rec.get("language", "Odia")
                        }
                    })

        print(f"\nTotal Raw Documents Collected: {len(raw_documents)}")

        # STEP 4: Text Chunking
        print('\n=== STEP 4: CHUNKING DOCUMENTS (Size: 500, Overlap: 100) ===')
        all_chunks = []
        for doc in raw_documents:
            chunks = self.text_chunker.process_document(doc)
            all_chunks.extend(chunks)
        print(f"✅ Generated {len(all_chunks)} text chunks.")

        # STEP 5: Generating Embeddings
        print('\n=== STEP 5: GENERATING 384-DIM EMBEDDINGS (SentenceTransformer) ===')
        embedded_chunks = self.embedding_generator.generate_batch_embeddings(all_chunks)

        # STEP 6: Store in Vector Store
        print('\n=== STEP 6: STORING CHUNKS IN VECTOR DATABASE ===')
        stored_count = self.vector_store.store_chunks(embedded_chunks)

        # STEP 7: Final Stats
        stats = self.vector_store.getStats()

        print("\n========================================")
        print("🎉 PYTHON RAG PIPELINE EXECUTED SUCCESSFULLY!")
        print("========================================")
        print("Final Stats:", stats)

        return {
            "status": "success",
            "chunksProcessed": len(embedded_chunks),
            "storedCount": stored_count,
            "stats": stats
        }

    def query(self, user_query: str, top_k: int = 5) -> Dict[str, Any]:
        if not user_query or not isinstance(user_query, str):
            raise ValueError("User query must be a non-empty string.")

        self.vector_store.connect()
        print(f'🔍 [Python RAGPipeline] Querying vector DB for: "{user_query}"...')
        query_embedding = self.embedding_generator.generate_embedding(user_query)
        matches = self.vector_store.search_similar(query_embedding, limit=top_k)

        return {
            "status": "success",
            "query": user_query,
            "resultsCount": len(matches),
            "results": matches
        }
