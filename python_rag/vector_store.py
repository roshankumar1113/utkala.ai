import os
import json
import math
from typing import Dict, Any, List, Optional

FALLBACK_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "vector_store_fallback.json")


def cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot_product = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot_product / (norm_a * norm_b)


class VectorStore:
    """
    VectorStore Class in Python for RAG Systems.
    Stores vector embeddings in PostgreSQL (pgvector) or local JSON fallback.
    """
    def __init__(self, connection_string: Optional[str] = None):
        self.connection_string = connection_string or os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/utkala_db")
        self.use_postgres = False
        self.conn = None

    def connect(self):
        try:
            import psycopg2
            from pgvector.psycopg2 import register_vector
            self.conn = psycopg2.connect(self.connection_string)
            register_vector(self.conn)
            self.use_postgres = True
            print("✅ [Python VectorStore] Connected to PostgreSQL Database.")
            self.setup_vector_table()
        except Exception as err:
            self.use_postgres = False
            print(f"⚠️ [Python VectorStore] PostgreSQL unavailable ({err}). Using local JSON fallback.")

    def setup_vector_table(self):
        if not self.use_postgres or not self.conn:
            return

        try:
            with self.conn.cursor() as cur:
                print('⚡ [Python VectorStore] Ensuring "vector" extension & "rag_chunks" table exist...')
                cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS rag_chunks (
                        id SERIAL PRIMARY KEY,
                        chunk_id VARCHAR(255) UNIQUE NOT NULL,
                        text TEXT NOT NULL,
                        embedding vector(384),
                        source VARCHAR(255),
                        title TEXT,
                        chunk_index INTEGER,
                        metadata JSONB,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                cur.execute("""
                    CREATE INDEX IF NOT EXISTS rag_chunks_embedding_ivfflat_idx 
                    ON rag_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
                """)
                self.conn.commit()
                print("✅ [Python VectorStore] Schema & IVFFLAT vector index verified.")
        except Exception as err:
            print(f"⚠️ [Python VectorStore] Setup table error: {err}")

    def store_chunks(self, embedded_chunks: List[Dict[str, Any]]) -> int:
        if not embedded_chunks:
            return 0

        if self.use_postgres and self.conn:
            try:
                with self.conn.cursor() as cur:
                    inserted = 0
                    for chunk in embedded_chunks:
                        cur.execute("""
                            INSERT INTO rag_chunks (chunk_id, text, embedding, source, title, chunk_index, metadata)
                            VALUES (%s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT (chunk_id) DO UPDATE SET
                                text = EXCLUDED.text,
                                embedding = EXCLUDED.embedding,
                                metadata = EXCLUDED.metadata;
                        """, (
                            chunk["id"],
                            chunk["text"],
                            chunk["embedding"],
                            chunk.get("metadata", {}).get("source", "Unknown"),
                            chunk.get("metadata", {}).get("title", "Untitled"),
                            chunk.get("metadata", {}).get("chunkIndex", 0),
                            json.dumps(chunk.get("metadata", {}))
                        ))
                        inserted += 1
                    self.conn.commit()
                    print(f"✅ [Python VectorStore] Stored {inserted} chunks in PostgreSQL pgvector.")
                    return inserted
            except Exception as err:
                print(f"⚠️ [Python VectorStore] PostgreSQL insert error ({err}). Using fallback.")

        # Fallback Local JSON Store
        os.makedirs(os.path.dirname(FALLBACK_FILE), exist_ok=True)
        store = []
        if os.path.exists(FALLBACK_FILE):
            with open(FALLBACK_FILE, "r", encoding="utf-8") as f:
                store = json.load(f)

        for chunk in embedded_chunks:
            existing_idx = next((i for i, item in enumerate(store) if item.get("id") == chunk["id"]), -1)
            if existing_idx >= 0:
                store[existing_idx] = chunk
            else:
                store.append(chunk)

        with open(FALLBACK_FILE, "w", encoding="utf-8") as f:
            json.dump(store, f, ensure_ascii=False, indent=2)

        print(f"✅ [Python VectorStore] Stored {len(embedded_chunks)} chunks in Local Vector Store file: {FALLBACK_FILE}")
        return len(embedded_chunks)

    def search_similar(self, query_embedding: List[float], limit: int = 5) -> List[Dict[str, Any]]:
        if not query_embedding:
            return []

        if self.use_postgres and self.conn:
            try:
                with self.conn.cursor() as cur:
                    cur.execute("""
                        SELECT chunk_id, text, source, title, chunk_index, metadata,
                               (embedding <=> %s::vector) AS distance
                        FROM rag_chunks
                        ORDER BY distance ASC
                        LIMIT %s;
                    """, (query_embedding, limit))
                    rows = cur.fetchall()
                    results = []
                    for r in rows:
                        results.append({
                            "id": r[0],
                            "text": r[1],
                            "similarity": 1.0 - float(r[6]),
                            "metadata": {
                                "source": r[2],
                                "title": r[3],
                                "chunkIndex": r[4],
                                **(r[5] if isinstance(r[5], dict) else json.loads(r[5] or '{}'))
                            }
                        })
                    return results
            except Exception as err:
                print(f"⚠️ [Python VectorStore] PostgreSQL search error ({err}). Using fallback.")

        # Local Fallback Cosine Search
        if not os.path.exists(FALLBACK_FILE):
            return []

        with open(FALLBACK_FILE, "r", encoding="utf-8") as f:
            store = json.load(f)

        scored = []
        for item in store:
            sim = cosine_similarity(query_embedding, item.get("embedding", []))
            scored.append({
                "id": item.get("id"),
                "text": item.get("text"),
                "similarity": sim,
                "metadata": item.get("metadata", {})
            })

        scored.sort(key=lambda x: x["similarity"], reverse=True)
        return scored[:limit]

    def get_stats(self) -> Dict[str, Any]:
        if self.use_postgres and self.conn:
            try:
                with self.conn.cursor() as cur:
                    cur.execute("SELECT COUNT(*) AS total_chunks, COUNT(DISTINCT source) AS sources FROM rag_chunks;")
                    r = cur.fetchone()
                    return {
                        "total_chunks": r[0],
                        "sources": r[1],
                        "storage": "PostgreSQL + pgvector"
                    }
            except Exception:
                pass

        if os.path.exists(FALLBACK_FILE):
            with open(FALLBACK_FILE, "r", encoding="utf-8") as f:
                store = json.load(f)
            sources = set(item.get("metadata", {}).get("source", "Unknown") for item in store)
            return {
                "total_chunks": len(store),
                "sources": len(sources),
                "storage": "Local Vector File"
            }

        return {"total_chunks": 0, "sources": 0, "storage": "Empty"}

    def disconnect(self):
        if self.conn:
            try:
                self.conn.close()
            except Exception:
                pass
