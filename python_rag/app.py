import os
import shutil
from typing import Dict, Any, Optional, List
try:
    from fastapi import FastAPI, File, UploadFile, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel
except ImportError:
    FastAPI = None

from rag_pipeline import RAGPipeline
from vector_store import VectorStore
from pdf_extractor import PDFExtractor

app = FastAPI(
    title="Utkal.ai Python RAG API",
    version="1.0.0",
    description="Python FastAPI backend for Odia Language RAG System"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TrainRequest(BaseModel):
    pdfDirectory: Optional[str] = None
    websiteUrls: Optional[List[str]] = []
    databaseRecords: Optional[List[Dict[str, Any]]] = []


class SearchRequest(BaseModel):
    query: str
    topK: Optional[int] = 5


@app.get("/")
def read_root():
    return {
        "status": "active",
        "service": "Utkal.ai Python RAG Backend",
        "version": "1.0.0"
    }


@app.post("/api/rag/train")
def train_rag(req: TrainRequest):
    try:
        pipeline = RAGPipeline()
        config = req.model_dump()
        result = pipeline.run(config)
        return {
            "status": "success",
            "message": "Python RAG Pipeline training completed successfully.",
            "statistics": result["stats"],
            "chunksProcessed": result["chunksProcessed"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rag/search")
def search_rag(req: SearchRequest):
    try:
        if not req.query.strip():
            raise HTTPException(status_code=400, detail="Query string is required.")
        pipeline = RAGPipeline()
        result = pipeline.query(req.query, req.topK or 5)
        return {
            "status": "success",
            "query": result["query"],
            "resultsCount": result["resultsCount"],
            "results": result["results"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/rag/stats")
def get_rag_stats():
    try:
        vs = VectorStore()
        vs.connect()
        stats = vs.get_stats()
        return {
            "status": "success",
            "statistics": stats
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/upload-pdf")
async def upload_pdf(pdf: UploadFile = File(...)):
    try:
        pdf_dir = os.path.join(os.path.dirname(__file__), "..", "pdfs")
        os.makedirs(pdf_dir, exist_ok=True)
        file_path = os.path.join(pdf_dir, pdf.filename)

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(pdf.file, buffer)

        extractor = PDFExtractor()
        result = extractor.extract_from_pdf(file_path)

        if not result.get("success"):
            raise HTTPException(status_code=500, detail=result.get("error"))

        return {
            "success": True,
            "message": f'PDF "{result["filename"]}" uploaded and processed!',
            "data": {
                "filename": result["filename"],
                "pages": result["pages"],
                "characterCount": len(result.get("text", "")),
                "metadata": result.get("metadata")
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
