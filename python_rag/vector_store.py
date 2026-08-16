"""
vector_store.py
PostgreSQL + pgvector primary store, local JSON fallback.
Uses synchronous psycopg2 (asyncpg has Python 3.15 incompatibilities).
"""

import os
import json
import math
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

FALLBACK_FILE = os.path.join(
    os.path.dirname(__file__), "..", "data", "vector_store_fallback.json"
)


# ── helpers ──────────────────────────────────────────────────────────────────
def _cosine(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    mag = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / mag if mag else 0.0


# ── main class ───────────────────────────────────────────────────────────────
class VectorStore:
    """
    Dual-mode vector store:
      • PostgreSQL + pgvector  when DATABASE_URL is set and reachable
      • Local JSON file        as automatic fallback
    """

    def __init__(self, connection_string: Optional[str] = None):
        self.connection_string = (
            connection_string
            or os.getenv("DATABASE_URL", "")
        )
        self._pg_ok = False
        self._conn = None

    # ── connection ────────────────────────────────────────────────────────────
    def connect(self):
        if not self.connection_string:
            logger.info("ℹ️  No DATABASE_URL — using local JSON fallback.")
            return

        # strip asyncpg scheme if someone copied it from the guide
        cs = self.connection_string.replace(
            "postgresql+asyncpg://", "postgresql://"
        )
        try:
            import psycopg2

            self._conn = psycopg2.connect(cs, connect_timeout=5)
            self._pg_ok = True
            logger.info("✅ VectorStore: connected to PostgreSQL.")
            self._ensure_schema()
        except Exception as exc:
            self._pg_ok = False
            self._conn = None
            logger.warning(f"⚠️  VectorStore: PostgreSQL unavailable ({exc}). Using JSON fallback.")

    def disconnect(self):
        if self._conn:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None
            self._pg_ok = False

    # ── schema setup ──────────────────────────────────────────────────────────
    def _ensure_schema(self):
        dim = int(os.getenv("EMBEDDING_DIM", "768"))
        with self._conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS rag_chunks (
                    id            SERIAL PRIMARY KEY,
                    chunk_id      VARCHAR(255) UNIQUE NOT NULL,
                    text          TEXT        NOT NULL,
                    embedding     vector({dim}),
                    source        VARCHAR(255),
                    title         TEXT,
                    chunk_index   INTEGER,
                    metadata      JSONB,
                    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            # IVFFlat index (created only when rows exist)
            cur.execute("""
                DO $$
                BEGIN
                    IF (SELECT COUNT(*) FROM rag_chunks) > 0
                       AND NOT EXISTS (
                           SELECT 1 FROM pg_indexes
                           WHERE tablename='rag_chunks'
                             AND indexname='rag_chunks_emb_idx'
                       )
                    THEN
                        CREATE INDEX rag_chunks_emb_idx
                            ON rag_chunks
                            USING ivfflat (embedding vector_cosine_ops)
                            WITH (lists = 100);
                    END IF;
                END
                $$;
            """)
            self._conn.commit()
            logger.info("✅ VectorStore schema ready.")

    # ── write ─────────────────────────────────────────────────────────────────
    def store_chunks(self, chunks: List[Dict[str, Any]]) -> int:
        if not chunks:
            return 0

        if self._pg_ok and self._conn:
            try:
                with self._conn.cursor() as cur:
                    for chunk in chunks:
                        emb = chunk.get("embedding")
                        cur.execute(
                            """
                            INSERT INTO rag_chunks
                                (chunk_id, text, embedding, source, title, chunk_index, metadata)
                            VALUES (%s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT (chunk_id) DO UPDATE SET
                                text      = EXCLUDED.text,
                                embedding = EXCLUDED.embedding,
                                metadata  = EXCLUDED.metadata
                            """,
                            (
                                chunk["id"],
                                chunk["text"],
                                emb,
                                chunk.get("metadata", {}).get("source", "Unknown"),
                                chunk.get("metadata", {}).get("title", "Untitled"),
                                chunk.get("metadata", {}).get("chunkIndex", 0),
                                json.dumps(chunk.get("metadata", {})),
                            ),
                        )
                    self._conn.commit()
                logger.info(f"✅ VectorStore: stored {len(chunks)} chunks in PostgreSQL.")
                return len(chunks)
            except Exception as exc:
                logger.warning(f"⚠️  PostgreSQL insert error ({exc}). Falling back to JSON.")

        # ── JSON fallback ──────────────────────────────────────────────────
        return self._json_store(chunks)

    def _json_store(self, chunks: List[Dict[str, Any]]) -> int:
        os.makedirs(os.path.dirname(FALLBACK_FILE), exist_ok=True)
        store: List[Dict] = []
        if os.path.exists(FALLBACK_FILE):
            try:
                with open(FALLBACK_FILE, "r", encoding="utf-8") as f:
                    store = json.load(f)
            except Exception:
                store = []

        idx_map = {item["id"]: i for i, item in enumerate(store)}
        for chunk in chunks:
            if chunk["id"] in idx_map:
                store[idx_map[chunk["id"]]] = chunk
            else:
                store.append(chunk)

        with open(FALLBACK_FILE, "w", encoding="utf-8") as f:
            json.dump(store, f, ensure_ascii=False, indent=2)

        logger.info(f"✅ VectorStore: stored {len(chunks)} chunks in JSON fallback.")
        return len(chunks)

    # ── read ──────────────────────────────────────────────────────────────────
    def search_similar(
        self, query_embedding: List[float], limit: int = 5
    ) -> List[Dict[str, Any]]:
        if not query_embedding:
            return []

        if self._pg_ok and self._conn:
            try:
                with self._conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT chunk_id, text, source, title, chunk_index, metadata,
                               (embedding <=> %s::vector) AS distance
                        FROM rag_chunks
                        ORDER BY distance ASC
                        LIMIT %s
                        """,
                        (query_embedding, limit),
                    )
                    rows = cur.fetchall()
                return [
                    {
                        "id": r[0],
                        "text": r[1],
                        "similarity": round(1.0 - float(r[6]), 4),
                        "metadata": {
                            "source": r[2],
                            "title": r[3],
                            "chunkIndex": r[4],
                            **(
                                r[5]
                                if isinstance(r[5], dict)
                                else json.loads(r[5] or "{}")
                            ),
                        },
                    }
                    for r in rows
                ]
            except Exception as exc:
                logger.warning(f"⚠️  PostgreSQL search error ({exc}). Using JSON fallback.")

        return self._json_search(query_embedding, limit)

    def _json_search(
        self, query_embedding: List[float], limit: int
    ) -> List[Dict[str, Any]]:
        if not os.path.exists(FALLBACK_FILE):
            return []
        try:
            with open(FALLBACK_FILE, "r", encoding="utf-8") as f:
                store = json.load(f)
        except Exception:
            return []

        scored = [
            {
                "id": item.get("id"),
                "text": item.get("text"),
                "similarity": round(_cosine(query_embedding, item.get("embedding", [])), 4),
                "metadata": item.get("metadata", {}),
            }
            for item in store
        ]
        scored.sort(key=lambda x: x["similarity"], reverse=True)
        return scored[:limit]

    # ── stats ─────────────────────────────────────────────────────────────────
    def get_stats(self) -> Dict[str, Any]:
        if self._pg_ok and self._conn:
            try:
                with self._conn.cursor() as cur:
                    cur.execute(
                        "SELECT COUNT(*) AS total, COUNT(DISTINCT source) AS srcs FROM rag_chunks"
                    )
                    r = cur.fetchone()
                    return {
                        "total_chunks": r[0],
                        "sources": r[1],
                        "storage": "PostgreSQL + pgvector",
                    }
            except Exception:
                pass

        if os.path.exists(FALLBACK_FILE):
            try:
                with open(FALLBACK_FILE, "r", encoding="utf-8") as f:
                    store = json.load(f)
                srcs = {item.get("metadata", {}).get("source", "Unknown") for item in store}
                return {
                    "total_chunks": len(store),
                    "sources": len(srcs),
                    "storage": "Local JSON",
                }
            except Exception:
                pass

        return {"total_chunks": 0, "sources": 0, "storage": "Empty"}
