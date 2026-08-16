const { Pool } = require('pg');
const fs = require('fs-extra');
const path = require('path');

const FALLBACK_FILE = path.join(__dirname, '..', 'data', 'vector_store_fallback.json');

/**
 * Cosine similarity helper for fallback in-memory search
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * VectorStore Class for RAG Systems
 * Integrates PostgreSQL + pgvector extension with automatic fallback to local vector store.
 */
class VectorStore {
  constructor(options = {}) {
    this.connectionString = options.connectionString || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/utkala_db';
    this.pool = new Pool({
      connectionString: this.connectionString,
      connectionTimeoutMillis: 3000
    });
    this.usePostgres = false;
  }

  /**
   * Connects to PostgreSQL and verifies pgvector availability
   */
  async connect() {
    try {
      const client = await this.pool.connect();
      client.release();
      this.usePostgres = true;
      console.log('✅ [VectorStore] Connected to PostgreSQL Database.');
      await this.setupVectorTable();
    } catch (err) {
      this.usePostgres = false;
      console.warn(`⚠️ [VectorStore] PostgreSQL connection failed (${err.message}). Using local JSON Vector Store fallback.`);
    }
  }

  /**
   * Sets up pgvector extension, table schema, and similarity index
   */
  async setupVectorTable() {
    if (!this.usePostgres) return;

    try {
      const client = await this.pool.connect();
      try {
        console.log('⚡ [VectorStore] Ensuring "vector" extension and "rag_chunks" table exist...');
        await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
        await client.query(`
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
        `);
        // Create IVFFLAT index for fast cosine distance (<=>) queries
        await client.query(`
          CREATE INDEX IF NOT EXISTS rag_chunks_embedding_ivfflat_idx 
          ON rag_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
        `).catch(() => {
          // If IVFFLAT requires table data before index creation, fallback silently
        });
        console.log('✅ [VectorStore] Schema and vector index setup verified.');
      } finally {
        client.release();
      }
    } catch (err) {
      console.warn('⚠️ [VectorStore] Table setup error:', err.message);
    }
  }

  /**
   * Stores embedded chunks in PostgreSQL or fallback JSON store
   * @param {Array<Object>} embeddedChunks 
   */
  async storeChunks(embeddedChunks) {
    if (!Array.isArray(embeddedChunks) || embeddedChunks.length === 0) return 0;

    if (this.usePostgres) {
      try {
        const client = await this.pool.connect();
        let inserted = 0;
        try {
          for (const chunk of embeddedChunks) {
            const vectorString = JSON.stringify(chunk.embedding);
            await client.query(`
              INSERT INTO rag_chunks (chunk_id, text, embedding, source, title, chunk_index, metadata)
              VALUES ($1, $2, $3::vector, $4, $5, $6, $7)
              ON CONFLICT (chunk_id) DO UPDATE SET
                text = EXCLUDED.text,
                embedding = EXCLUDED.embedding,
                metadata = EXCLUDED.metadata;
            `, [
              chunk.id,
              chunk.text,
              vectorString,
              chunk.metadata?.source || 'Unknown',
              chunk.metadata?.title || 'Untitled',
              chunk.metadata?.chunkIndex || 0,
              JSON.stringify(chunk.metadata || {})
            ]);
            inserted++;
          }
          console.log(`✅ [VectorStore] Stored ${inserted} chunks in PostgreSQL pgvector.`);
          return inserted;
        } finally {
          client.release();
        }
      } catch (err) {
        console.warn(`⚠️ [VectorStore] PostgreSQL insert error (${err.message}). Falling back to local store.`);
      }
    }

    // Fallback Local JSON Vector Store
    await fs.ensureDir(path.dirname(FALLBACK_FILE));
    let store = [];
    if (await fs.pathExists(FALLBACK_FILE)) {
      store = await fs.readJson(FALLBACK_FILE);
    }

    for (const chunk of embeddedChunks) {
      const idx = store.findIndex(item => item.id === chunk.id);
      if (idx >= 0) {
        store[idx] = chunk;
      } else {
        store.push(chunk);
      }
    }

    await fs.writeJson(FALLBACK_FILE, store, { spaces: 2 });
    console.log(`✅ [VectorStore] Stored ${embeddedChunks.length} chunks in Local Vector Store file: ${FALLBACK_FILE}`);
    return embeddedChunks.length;
  }

  /**
   * Performs Cosine Similarity Search for a query embedding
   * @param {Array<number>} queryEmbedding - 384-dim vector array
   * @param {number} limit - Number of top matching chunks
   * @returns {Promise<Array<Object>>} - Array of top matching chunks
   */
  async searchSimilar(queryEmbedding, limit = 5) {
    if (!queryEmbedding) return [];

    if (this.usePostgres) {
      try {
        const client = await this.pool.connect();
        try {
          const vectorString = JSON.stringify(queryEmbedding);
          const res = await client.query(`
            SELECT chunk_id, text, source, title, chunk_index, metadata,
                   (embedding <=> $1::vector) AS distance
            FROM rag_chunks
            ORDER BY distance ASC
            LIMIT $2;
          `, [vectorString, limit]);

          return res.rows.map(r => ({
            id: r.chunk_id,
            text: r.text,
            similarity: 1 - r.distance,
            metadata: {
              source: r.source,
              title: r.title,
              chunkIndex: r.chunk_index,
              ...(r.metadata || {})
            }
          }));
        } finally {
          client.release();
        }
      } catch (err) {
        console.warn(`⚠️ [VectorStore] PostgreSQL search error (${err.message}). Falling back to local store search.`);
      }
    }

    // Local Fallback Vector Search
    if (!await fs.pathExists(FALLBACK_FILE)) return [];
    const store = await fs.readJson(FALLBACK_FILE);

    const scored = store.map(item => ({
      id: item.id,
      text: item.text,
      similarity: cosineSimilarity(queryEmbedding, item.embedding),
      metadata: item.metadata
    }));

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  }

  /**
   * Retrieves dataset and vector store statistics
   */
  async getStats() {
    if (this.usePostgres) {
      try {
        const client = await this.pool.connect();
        try {
          const res = await client.query('SELECT COUNT(*) AS total_chunks, COUNT(DISTINCT source) AS sources FROM rag_chunks;');
          return {
            total_chunks: parseInt(res.rows[0].total_chunks, 10),
            sources: parseInt(res.rows[0].sources, 10),
            storage: 'PostgreSQL + pgvector'
          };
        } finally {
          client.release();
        }
      } catch (err) {
        // Fallthrough to local stats
      }
    }

    if (await fs.pathExists(FALLBACK_FILE)) {
      const store = await fs.readJson(FALLBACK_FILE);
      const sources = new Set(store.map(s => s.metadata?.source || 'Unknown'));
      return {
        total_chunks: store.length,
        sources: sources.size,
        storage: 'Local Vector File'
      };
    }

    return { total_chunks: 0, sources: 0, storage: 'Empty' };
  }

  async disconnect() {
    try {
      await this.pool.end();
    } catch (e) {
      // Ignore disconnect errors
    }
  }
}

module.exports = VectorStore;
