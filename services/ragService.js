/**
 * ragService.js
 * Simple in-memory keyword-based RAG context retrieval.
 * Reads from scraped_odia_data.json and vector_store_fallback.json.
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'scraped_odia_data.json');
const VECTOR_FALLBACK = path.join(__dirname, '..', 'data', 'vector_store_fallback.json');

const NO_MATCH_MSG =
  'No explicit matching local state schema documents found in the primary vector cluster repository.';

let cachedRecords = null;
let lastLoadedTime = 0;

/**
 * Load the local knowledge base (scraped data + vector fallback) with in-memory caching.
 * @returns {Array} - Combined array of knowledge records
 */
function loadKnowledgeBase() {
  const now = Date.now();
  // Cache for 60 seconds
  if (cachedRecords && (now - lastLoadedTime < 60000)) {
    return cachedRecords;
  }

  const records = [];

  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      records.push(...data);
    }
  } catch (err) {
    console.warn('[RAGService] Could not load scraped_odia_data.json:', err.message);
  }

  try {
    if (fs.existsSync(VECTOR_FALLBACK)) {
      const vData = JSON.parse(fs.readFileSync(VECTOR_FALLBACK, 'utf8'));
      // Vector store items have a "text" field, map to content
      const mapped = vData.map(item => ({
        title: item.metadata?.title || 'Vector Chunk',
        category: item.metadata?.source || 'Vector Store',
        content: item.text || '',
        source_url: item.metadata?.source_url || '',
        language: item.metadata?.language || 'odia',
      }));
      records.push(...mapped);
    }
  } catch (err) {
    console.warn('[RAGService] Could not load vector_store_fallback.json:', err.message);
  }

  cachedRecords = records;
  lastLoadedTime = now;
  return records;
}

/**
 * Simple keyword-based context retrieval.
 * Scores records by how many query words appear in title + content.
 * Returns the top 3 most relevant passages concatenated.
 *
 * @param {string} query - User query string
 * @returns {string} - Relevant context text or NO_MATCH_MSG
 */
function retrieveContext(query) {
  if (!query || typeof query !== 'string') return NO_MATCH_MSG;

  const records = loadKnowledgeBase();
  if (!records.length) return NO_MATCH_MSG;

  // Tokenise query (lowercase, split on spaces and Odia word separators)
  const queryWords = query
    .toLowerCase()
    .split(/[\s,।.\-!?]+/)
    .filter(w => w.length > 1);

  if (!queryWords.length) return NO_MATCH_MSG;

  // Score each record
  const scored = records.map(rec => {
    const haystack = `${rec.title || ''} ${rec.content || ''}`.toLowerCase();
    let score = 0;
    for (const word of queryWords) {
      if (haystack.includes(word)) score++;
    }
    return { rec, score };
  });

  // Filter to records with at least 1 match, take top 3
  const topMatches = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => s.rec);

  if (!topMatches.length) return NO_MATCH_MSG;

  // Concatenate context blocks
  const contextBlocks = topMatches.map(
    (rec, i) =>
      `[Context Block ${i + 1}]\nTitle: ${rec.title}\nCategory: ${rec.category}\n${rec.content}`
  );

  return contextBlocks.join('\n\n---\n\n');
}

module.exports = {
  retrieveContext,
};
