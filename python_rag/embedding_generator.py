"""
embedding_generator.py
Multi-backend embedding generator with intelligent fallback chain:
  1. Gemini text-embedding-004  (768-dim, free, cloud)
  2. sentence-transformers       (384-dim, local, requires torch)
  3. Pure-Python n-gram          (128-dim, zero dependencies)
"""

import os
import math
import logging
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

# ── backend availability flags ──────────────────────────────────────────────
try:
    import google.generativeai as genai
    _GEMINI_AVAILABLE = True
except ImportError:
    genai = None
    _GEMINI_AVAILABLE = False

try:
    from sentence_transformers import SentenceTransformer
    _ST_AVAILABLE = True
except ImportError:
    SentenceTransformer = None
    _ST_AVAILABLE = False


# ── pure-python fallback ─────────────────────────────────────────────────────
def _ngram_embed(text: str, dim: int = 128) -> List[float]:
    """Character bi-gram frequency vector, L2-normalised."""
    vec = [0.0] * dim
    t = text.lower()
    for i in range(len(t) - 1):
        code = ((ord(t[i]) * 31) + ord(t[i + 1])) % dim
        vec[code] += 1.0
    mag = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / mag for v in vec]


# ── main class ───────────────────────────────────────────────────────────────
class EmbeddingGenerator:
    """
    Multi-backend embedding generator with intelligent fallback.

    model_type priority (auto-selected if not forced):
        "gemini"               → Gemini text-embedding-004  (768-dim)
        "sentence-transformers"→ all-MiniLM-L6-v2           (384-dim)
        "ngram"                → pure-Python n-gram          (128-dim)
    """

    DIMS = {"gemini": 768, "sentence-transformers": 384, "ngram": 128}

    def __init__(self, model_type: str = "gemini", max_char_length: int = 2048):
        self.max_char_length = max_char_length
        self._st_model = None

        # ── resolve which backend we can actually use ────────────────────────
        api_key = os.getenv("GEMINI_API_KEY", "")
        if model_type == "gemini" and _GEMINI_AVAILABLE and api_key:
            genai.configure(api_key=api_key)
            self.model_type = "gemini"
            logger.info("✅ EmbeddingGenerator: Gemini text-embedding-004 (768-dim)")
        elif _ST_AVAILABLE:
            self.model_type = "sentence-transformers"
            logger.info("✅ EmbeddingGenerator: sentence-transformers all-MiniLM-L6-v2 (384-dim)")
        else:
            self.model_type = "ngram"
            logger.warning(
                "⚠️  EmbeddingGenerator: using pure-Python n-gram fallback (128-dim). "
                "Set GEMINI_API_KEY to enable cloud embeddings."
            )

    # ── public API ───────────────────────────────────────────────────────────
    def generate_embedding(self, text: str) -> List[float]:
        if not text or not isinstance(text, str):
            raise ValueError("Input must be a non-empty string")
        text = text[: self.max_char_length]
        try:
            if self.model_type == "gemini":
                return self._gemini_embed(text)
            elif self.model_type == "sentence-transformers":
                return self._st_embed(text)
            else:
                return _ngram_embed(text)
        except Exception as exc:
            logger.warning(f"Embedding backend error ({exc}), falling back to n-gram")
            return _ngram_embed(text)

    def generate_batch_embeddings(
        self, chunks: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        if not chunks:
            return []
        logger.info(
            f"🚀 Embedding {len(chunks)} chunks via [{self.model_type}]..."
        )
        embedded = []
        for i, chunk in enumerate(chunks):
            try:
                c = dict(chunk)
                c["embedding"] = self.generate_embedding(c.get("text", ""))
                embedded.append(c)
                if (i + 1) % 20 == 0:
                    logger.info(f"   ↳ {i + 1}/{len(chunks)} done")
            except Exception as exc:
                logger.warning(f"   Skipping chunk {i}: {exc}")
        logger.info(f"✅ Embedded {len(embedded)}/{len(chunks)} chunks.")
        return embedded

    @property
    def dimension(self) -> int:
        return self.DIMS[self.model_type]

    # ── private backends ─────────────────────────────────────────────────────
    def _gemini_embed(self, text: str) -> List[float]:
        """Gemini Embedding API — text-embedding-004, 768-dim."""
        import requests as _req

        api_key = os.getenv("GEMINI_API_KEY", "")
        url = (
            "https://generativelanguage.googleapis.com/v1beta/"
            "models/text-embedding-004:embedContent"
        )
        payload = {
            "model": "models/text-embedding-004",
            "content": {"parts": [{"text": text}]},
            "taskType": "RETRIEVAL_DOCUMENT",
        }
        resp = _req.post(url, json=payload, params={"key": api_key}, timeout=15)
        if resp.status_code != 200:
            raise RuntimeError(f"Gemini embed API {resp.status_code}: {resp.text[:200]}")
        values = resp.json()["embedding"]["values"]
        return values

    def _st_embed(self, text: str) -> List[float]:
        """sentence-transformers all-MiniLM-L6-v2, 384-dim."""
        if self._st_model is None:
            logger.info("🤖 Loading sentence-transformers model...")
            self._st_model = SentenceTransformer("all-MiniLM-L6-v2")
        vec = self._st_model.encode(text, normalize_embeddings=True)
        return vec.tolist()
