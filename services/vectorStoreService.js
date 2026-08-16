/**
 * vectorStoreService.js
 * Vector storage using PostgreSQL/pgvector when available,
 * falling back to a local JSON file store with cosine similarity.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const FALLBACK_FILE = path.join(__dirname, '..', 'data', 'vector_store_fallback.json');

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

class VectorStore {
  constructor() {
    this.usePostgres = false;
    this.pool = null;
  }

  async connect() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      console.log('[VectorStore] No DATABASE_URL set. Using local JSON fallback.');
      return;
    }

    try {
      const { Pool } = require('pg');
      this.pool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: 4000 });
      const client = await this.pool.connect();

      // Ensure rag_chunks table exists (without pgvector — using JSONB for embeddings)
      await client.query(`
        CREATE TABLE IF NOT EXISTS rag_chunks (
          id SERIAL PRIMARY KEY,
          chunk_id VARCHAR(255) UNIQUE NOT NULL,
          text TEXT NOT NULL,
          embedding JSONB,
          source VARCHAR(255),
          title TEXT,
          chunk_index INTEGER,
          metadata JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await client.query('COMMIT');
      client.release();

      this.usePostgres = true;
      console.log('[VectorStore] Connected to PostgreSQL.');
    } catch (err) {
      this.usePostgres = false;
      this.pool = null;
      console.warn(`[VectorStore] PostgreSQL unavailable (${err.message}). Using JSON fallback.`);
    }
  }

  async storeChunks(chunks) {
    if (!chunks || !chunks.length) return 0;

    if (this.usePostgres && this.pool) {
      try {
        const client = await this.pool.connect();
        let inserted = 0;
        for (const chunk of chunks) {
          await client.query(
            `INSERT INTO rag_chunks (chunk_id, text, embedding, source, title, chunk_index, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (chunk_id) DO UPDATE SET
               text = EXCLUDED.text,
               embedding = EXCLUDED.embedding,
               metadata = EXCLUDED.metadata`,
            [
              chunk.id,
              chunk.text,
              JSON.stringify(chunk.embedding),
              chunk.metadata?.source || 'Unknown',
              chunk.metadata?.title || 'Untitled',
              chunk.metadata?.chunkIndex || 0,
              JSON.stringify(chunk.metadata || {}),
            ]
          );
          inserted++;
        }
        client.release();
        console.log(`[VectorStore] Stored ${inserted} chunks in PostgreSQL.`);
        return inserted;
      } catch (err) {
        console.warn(`[VectorStore] PostgreSQL insert error (${err.message}). Using fallback.`);
      }
    }

    // JSON fallback
    const dir = path.dirname(FALLBACK_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let store = [];
    if (fs.existsSync(FALLBACK_FILE)) {
      try { store = JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf8')); } catch {}
    }

    for (const chunk of chunks) {
      const existingIdx = store.findIndex(s => s.id === chunk.id);
      if (existingIdx >= 0) {
        store[existingIdx] = chunk;
      } else {
        store.push(chunk);
      }
    }

    fs.writeFileSync(FALLBACK_FILE, JSON.stringify(store, null, 2), 'utf8');
    console.log(`[VectorStore] Stored ${chunks.length} chunks in JSON fallback.`);
    return chunks.length;
  }

  async searchSimilar(queryEmbedding, limit = 5) {
    if (!queryEmbedding) return [];

    if (this.usePostgres && this.pool) {
      try {
        const client = await this.pool.connect();
        const result = await client.query(
          `SELECT chunk_id, text, source, title, chunk_index, metadata, embedding
           FROM rag_chunks LIMIT 500`
        );
        client.release();

        const scored = result.rows.map(row => {
          const emb = typeof row.embedding === 'string'
            ? JSON.parse(row.embedding)
            : (row.embedding || []);
          return {
            id: row.chunk_id,
            text: row.text,
            similarity: cosineSimilarity(queryEmbedding, emb),
            metadata: typeof row.metadata === 'string'
              ? JSON.parse(row.metadata)
              : (row.metadata || {}),
          };
        });

        return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
      } catch (err) {
        console.warn(`[VectorStore] PostgreSQL search error (${err.message}). Using fallback.`);
      }
    }

    // JSON fallback
    if (!fs.existsSync(FALLBACK_FILE)) return [];

    let store = [];
    try { store = JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf8')); } catch { return []; }

    const scored = store.map(item => ({
      id: item.id,
      text: item.text,
      similarity: cosineSimilarity(queryEmbedding, item.embedding || []),
      metadata: item.metadata || {},
    }));

    return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  async getStats() {
    if (this.usePostgres && this.pool) {
      try {
        const client = await this.pool.connect();
        const result = await client.query(
          `SELECT COUNT(*) AS total_chunks, COUNT(DISTINCT source) AS sources FROM rag_chunks`
        );
        client.release();
        const row = result.rows[0];
        return {
          totalChunks: parseInt(row.total_chunks, 10),
          sources: parseInt(row.sources, 10),
          storage: 'PostgreSQL',
        };
      } catch {}
    }

    if (fs.existsSync(FALLBACK_FILE)) {
      try {
        const store = JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf8'));
        const sources = new Set(store.map(i => i.metadata?.source || 'Unknown'));
        return {
          totalChunks: store.length,
          sources: sources.size,
          storage: 'Local JSON',
        };
      } catch {}
    }

    return { totalChunks: 0, sources: 0, storage: 'Empty' };
  }
}

module.exports = VectorStore;
