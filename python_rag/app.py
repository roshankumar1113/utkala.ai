"""
app.py  —  Utkal.ai Python RAG API  v2.0
FastAPI server exposing RAG train / search / stats / PDF-upload endpoints.
All routes are synchronous (compatible with Python 3.15 + sync psycopg2).
"""

import sys
import os

_EXTRA_SITE = os.path.expanduser(r"~\AppData\Local\Programs\Python\Python315\Lib\site-packages")
if os.path.exists(_EXTRA_SITE) and _EXTRA_SITE not in sys.path:
    sys.path.insert(0, _EXTRA_SITE)

_DIR = os.path.dirname(os.path.abspath(__file__))
if _DIR not in sys.path:
    sys.path.insert(0, _DIR)

import logging
import shutil
import requests
from typing import Dict, Any, Optional, List
from dotenv import load_dotenv  # type: ignore

# Load .env from this directory before importing anything that reads env vars
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from fastapi import FastAPI, File, UploadFile, HTTPException  # type: ignore
from fastapi.middleware.cors import CORSMiddleware  # type: ignore
from pydantic import BaseModel  # type: ignore

from rag_pipeline import RAGPipeline
from vector_store import VectorStore
from pdf_extractor import PDFExtractor

# ── logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

# ── app ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Utkal.ai Python RAG API",
    version="2.1.0",
    description="Production-grade Odia RAG system — Gemini embeddings + PostgreSQL/pgvector",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Pydantic models ───────────────────────────────────────────────────────────
class TrainRequest(BaseModel):
    pdfDirectory: Optional[str] = None
    websiteUrls: Optional[List[str]] = []
    databaseRecords: Optional[List[Dict[str, Any]]] = []
    embeddingType: Optional[str] = "gemini"   # "gemini" | "ngram"


class SearchRequest(BaseModel):
    query: str
    topK: Optional[int] = 5
    embeddingType: Optional[str] = "gemini"


class UrlInput(BaseModel):
    url: str
    embeddingType: Optional[str] = "ngram"   # embed & index immediately
    autoTrain: Optional[bool] = True          # re-train after scraping


# ── endpoints ─────────────────────────────────────────────────────────────────

@app.get("/")
def read_root():
    """Health check + feature advertisement."""
    return {
        "status": "active",
        "service": "Utkal.ai Python RAG Backend",
        "version": "2.1.0",
        "embedding_backends": ["gemini (768-dim)", "ngram-fallback (128-dim)"],
        "vector_storage": ["PostgreSQL + pgvector", "Local JSON fallback"],
        "endpoints": [
            "POST /api/upload-url   — scrape any URL → chunk → embed → index",
            "POST /api/upload-pdf   — upload PDF → extract → chunk → embed → index",
            "POST /api/rag/train    — full pipeline re-train from all sources",
            "POST /api/rag/search   — semantic vector search",
            "GET  /api/rag/stats    — vector store statistics",
        ],
        "docs": "/docs",
    }


@app.get("/health")
def health():
    return {"status": "healthy", "service": "utkal-ai-python-rag"}


@app.post("/api/rag/train")
def train_rag(req: TrainRequest):
    """
    Ingest documents into the RAG knowledge base.

    Steps:
      1. Extract PDFs from `pdfDirectory`
      2. Scrape `websiteUrls`
      3. Load `databaseRecords` + local scraped_odia_data.json
      4. Chunk → Embed (Gemini 768-dim) → Store (PostgreSQL / JSON)
    """
    try:
        logger.info(f"POST /api/rag/train  embeddingType={req.embeddingType}")
        pipeline = RAGPipeline(embedding_type=req.embeddingType or "gemini")
        result = pipeline.run(req.dict())
        return {
            "status": "success",
            "message": "RAG pipeline training completed successfully.",
            "statistics": result["stats"],
            "chunksProcessed": result["chunksProcessed"],
            "embeddingBackend": pipeline.embedder.model_type,
            "embeddingDimensions": pipeline.embedder.dimension,
        }
    except Exception as exc:
        logger.error(f"Training error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/rag/search")
def search_rag(req: SearchRequest):
    """
    Semantic search over the RAG knowledge base.

    Generates a Gemini embedding for the query, then performs
    cosine similarity search against stored chunks.
    """
    try:
        if not req.query.strip():
            raise HTTPException(status_code=400, detail="Query cannot be empty.")
        logger.info(f'POST /api/rag/search  query="{req.query[:60]}"')
        pipeline = RAGPipeline(embedding_type=req.embeddingType or "gemini")
        result = pipeline.query(req.query, top_k=req.topK or 5)
        return {
            "status": "success",
            "query": result["query"],
            "resultsCount": result["resultsCount"],
            "results": result["results"],
            "embeddingBackend": pipeline.embedder.model_type,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Search error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/rag/stats")
def get_rag_stats():
    """Return vector store statistics (chunk count, source count, storage type)."""
    try:
        vs = VectorStore()
        vs.connect()
        stats = vs.get_stats()
        vs.disconnect()
        return {
            "status": "success",
            "statistics": stats,
            "embeddingInfo": {
                "primary": "Gemini text-embedding-004 (768-dim)",
                "fallback": "Pure-Python n-gram (128-dim)",
                "cost": "Free tier",
            },
        }
    except Exception as exc:
        logger.error(f"Stats error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/upload-pdf")
async def upload_pdf(pdf: UploadFile = File(...)):
    """
    Upload a PDF and extract its text.
    The extracted text is returned and can be fed into /api/rag/train.
    """
    try:
        pdf_dir = os.path.join(os.path.dirname(__file__), "..", "pdfs")
        os.makedirs(pdf_dir, exist_ok=True)

        safe_name = os.path.basename(pdf.filename or "upload.pdf")
        file_path = os.path.join(pdf_dir, safe_name)

        contents = await pdf.read()
        with open(file_path, "wb") as f:
            f.write(contents)

        logger.info(f"PDF saved: {safe_name} ({len(contents)} bytes)")

        extractor = PDFExtractor()
        result = extractor.extract_from_pdf(file_path)

        if not result.get("success"):
            raise HTTPException(status_code=500, detail=result.get("error"))

        return {
            "success": True,
            "message": f'PDF "{result["filename"]}" uploaded and extracted.',
            "data": {
                "filename": result["filename"],
                "pages": result["pages"],
                "characterCount": len(result.get("text", "")),
                "isTruncated": result.get("isTruncated", False),
                "metadata": result.get("metadata"),
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Upload error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/upload-url")
async def upload_url(data: UrlInput):
    """
    Scrape a URL, extract clean text, chunk + embed it, and add it to
    the RAG knowledge base — exactly like /api/upload-pdf but for web pages.

    Steps:
      1. Fetch the URL with requests
      2. Strip scripts/styles with BeautifulSoup
      3. Chunk the clean text
      4. Embed (ngram by default — instant; or 'gemini' for 768-dim)
      5. Store in vector store (JSON fallback or PostgreSQL)
      6. Optionally append to scraped_odia_data.json for persistence

    Returns a preview of the scraped content and ingestion stats.
    """
    import re
    import json
    import time
    from pathlib import Path

    try:
        url = data.url.strip()
        if not url.startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="URL must start with http:// or https://")

        logger.info(f"POST /api/upload-url  url={url}")

        # ── 1. Fetch ───────────────────────────────────────────────────────────
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36 UtkalAIRAG/2.0"
            ),
            "Accept-Language": "or,en-US,en;q=0.9",
        }
        try:
            resp = requests.get(url, headers=headers, timeout=20, allow_redirects=True)
            resp.raise_for_status()
        except requests.exceptions.Timeout:
            raise HTTPException(status_code=504, detail=f"URL timed out: {url}")
        except requests.exceptions.ConnectionError as exc:
            raise HTTPException(status_code=502, detail=f"Cannot reach URL: {exc}")
        except requests.exceptions.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"HTTP error: {exc}")

        # ── 2. Parse & clean with BeautifulSoup ────────────────────────────────
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(resp.text, "html.parser")

        # Remove noise tags
        for tag in soup(["script", "style", "noscript", "iframe",
                          "header", "footer", "nav", "form", "svg",
                          "button", "aside", "advertisement"]):
            tag.decompose()

        # Page title
        title_tag = soup.find("title")
        page_title = title_tag.get_text(strip=True) if title_tag else url

        # Collect meaningful text blocks
        blocks = []
        for el in soup.find_all(["h1", "h2", "h3", "h4", "p", "li", "blockquote", "td"]):
            text = el.get_text(separator=" ", strip=True)
            if len(text) > 25:          # skip tiny fragments
                blocks.append(text)

        # Fallback: full page text
        if not blocks:
            raw = re.sub(r"\s+", " ", soup.get_text(separator=" ")).strip()
            blocks = [raw] if raw else []

        if not blocks:
            raise HTTPException(status_code=422, detail="No readable text found on this page.")

        full_text = "\n\n".join(blocks)
        logger.info(f"Scraped {len(full_text)} chars from '{page_title}'")

        # ── 3. Chunk ───────────────────────────────────────────────────────────
        from text_chunker import TextChunker
        chunker = TextChunker(chunk_size=500, overlap=100)
        chunks = chunker.chunk(
            full_text,
            metadata={
                "source": "URL",
                "title": page_title,
                "url": url,
                "language": "odia",
                "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
        )
        logger.info(f"Produced {len(chunks)} chunks")

        # ── 4. Embed ───────────────────────────────────────────────────────────
        from embedding_generator import EmbeddingGenerator
        embedder = EmbeddingGenerator(model_type=data.embeddingType or "ngram")
        embedded_chunks = embedder.generate_batch_embeddings(chunks)

        # ── 5. Store in vector store ────────────────────────────────────────────
        from vector_store import VectorStore
        vs = VectorStore()
        vs.connect()
        stored = vs.store_chunks(embedded_chunks)
        stats  = vs.get_stats()
        vs.disconnect()

        # ── 6. Persist to scraped_odia_data.json (optional) ────────────────────
        data_file = Path(__file__).parent.parent / "data" / "scraped_odia_data.json"
        existing: list = []
        if data_file.exists():
            try:
                existing = json.loads(data_file.read_text(encoding="utf-8"))
            except Exception:
                existing = []

        new_record = {
            "title":      page_title,
            "category":   "Web Knowledge",
            "content":    full_text[:10000],   # cap at 10 KB per record
            "source_url": url,
            "language":   "odia",
        }
        # Only add if not already present
        if not any(r.get("source_url") == url for r in existing):
            existing.append(new_record)
            data_file.parent.mkdir(exist_ok=True)
            data_file.write_text(
                json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            logger.info(f"Persisted URL record to {data_file.name}")

        return {
            "success":        True,
            "message":        f'URL "{page_title}" scraped, chunked, and indexed successfully.',
            "url":            url,
            "pageTitle":      page_title,
            "contentPreview": full_text[:300] + ("..." if len(full_text) > 300 else ""),
            "stats": {
                "charactersScraped": len(full_text),
                "chunksCreated":     len(chunks),
                "chunksStored":      stored,
                "embeddingBackend":  embedder.model_type,
                "embeddingDim":      embedder.dimension,
                "vectorStore":       stats,
            },
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"URL upload error: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


# ── dev entry-point ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn  # type: ignore

    uvicorn.run(
        "app:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PYTHON_RAG_PORT", "8000")),
        reload=True,
    )
