/**
 * ragPipelineService.js
 * Node.js RAG pipeline orchestrator.
 * Extracts → chunks → embeds (via @xenova/transformers) → stores vectors.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const VectorStore = require('./vectorStoreService');

const DATA_FILE = path.join(__dirname, '..', 'data', 'scraped_odia_data.json');
const CHUNK_SIZE = 500;
const OVERLAP = 100;

/**
 * Split a long text into overlapping chunks.
 */
function chunkText(text, chunkSize = CHUNK_SIZE, overlap = OVERLAP) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end).trim());
    if (end === text.length) break;
    start += chunkSize - overlap;
  }
  return chunks.filter(c => c.length >= 30);
}

/**
 * Generate a simple embedding using character n-gram frequency.
 * This is a lightweight fallback that works without a model download.
 * For production, replace with @xenova/transformers or the Python RAG service.
 */
function generateSimpleEmbedding(text, dim = 128) {
  const vec = new Array(dim).fill(0);
  const t = text.toLowerCase();
  for (let i = 0; i < t.length - 1; i++) {
    const code = ((t.charCodeAt(i) * 31) + t.charCodeAt(i + 1)) % dim;
    vec[code] += 1;
  }
  // Normalize
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / mag);
}

class RAGPipeline {
  constructor() {
    this.vectorStore = new VectorStore();
  }

  async run(config = {}) {
    console.log('\n=== RAG Pipeline: Starting ===');
    await this.vectorStore.connect();

    let rawDocuments = [];

    // Load local scraped data
    if (fs.existsSync(DATA_FILE)) {
      const dataset = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      for (const rec of dataset) {
        if (rec.content) {
          rawDocuments.push({
            text: rec.content,
            title: rec.title || 'Untitled',
            source: rec.category || 'Local',
            language: rec.language || 'odia',
          });
        }
      }
    }

    // Load additional PDF-extracted content from data dir
    const extraDataFile = path.join(__dirname, '..', 'data', 'scraped_odia_data.json');
    // Already loaded above

    console.log(`[RAGPipeline] Loaded ${rawDocuments.length} documents`);

    // Chunk all documents
    const allChunks = [];
    const ts = Date.now();
    for (const [docIdx, doc] of rawDocuments.entries()) {
      const chunks = chunkText(doc.text);
      for (const [cIdx, chunkText_] of chunks.entries()) {
        allChunks.push({
          id: `chunk_${ts}_${docIdx}_${cIdx}`,
          text: chunkText_,
          embedding: generateSimpleEmbedding(chunkText_),
          metadata: {
            title: doc.title,
            source: doc.source,
            language: doc.language,
            chunkIndex: cIdx,
            totalChunks: chunks.length,
          },
        });
      }
    }

    console.log(`[RAGPipeline] Generated ${allChunks.length} chunks`);

    // Store in vector store
    const stored = await this.vectorStore.storeChunks(allChunks);
    const stats = await this.vectorStore.getStats();

    console.log('=== RAG Pipeline: Complete ===');
    return {
      status: 'success',
      chunksProcessed: allChunks.length,
      storedCount: stored,
      stats,
    };
  }

  async query(userQuery, topK = 5) {
    if (!userQuery || typeof userQuery !== 'string') {
      throw new Error('Query must be a non-empty string.');
    }
    await this.vectorStore.connect();

    const queryEmbedding = generateSimpleEmbedding(userQuery);
    const results = await this.vectorStore.searchSimilar(queryEmbedding, topK);

    return {
      status: 'success',
      query: userQuery,
      resultsCount: results.length,
      results,
    };
  }
}

module.exports = RAGPipeline;
