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
 * Titles of records that must never appear as RAG sources.
 * Checked against the record title (case-insensitive).
 */
const INTERNAL_TITLE_RE = /master\s*instruction|system\s*prompt|internal\s*(doc|document|instruction)|instruction\s*#\s*\d+/i;

/**
 * Simple keyword-based context retrieval with relevance threshold.
 *
 * Scoring:
 *  - Each query word that appears in the record's title scores 2 (title matches are stronger signals).
 *  - Each query word that appears only in the body scores 1.
 *  - Normalised score = raw_score / queryWords.length  →  0.0 – 1.0+
 *
 * Relevance threshold: a record must have a normalised score ≥ MIN_RELEVANCE
 * (default 0.25, meaning at least 25 % of query words must match).
 * Generic city/state pages that barely touch the query are therefore excluded.
 *
 * Internal documents (master instructions, system prompts) are excluded entirely
 * so they can never surface as source chips.
 *
 * @param {string} query - User query string
 * @returns {string} - Relevant context text or NO_MATCH_MSG
 */

// Minimum fraction of query words that must match a record for it to be included.
// Raise this to make the retriever stricter; lower it to allow broader matches.
const MIN_RELEVANCE = 0.25;

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
  const scored = records
    .filter(rec => {
      // Exclude internal documents from being indexed as retrievable sources.
      const title = String(rec.title || '');
      return !INTERNAL_TITLE_RE.test(title);
    })
    .map(rec => {
      const titleText = String(rec.title || '').toLowerCase();
      const bodyText  = String(rec.content || '').toLowerCase();
      let score = 0;
      for (const word of queryWords) {
        if (titleText.includes(word)) {
          score += 2; // title hit is a stronger relevance signal
        } else if (bodyText.includes(word)) {
          score += 1;
        }
      }
      // Normalise: divide by max possible score (2 × every word hit in title)
      const normScore = score / (queryWords.length * 2);
      return { rec, score, normScore };
    });

  // Apply relevance threshold — weak / generic matches are excluded
  const topMatches = scored
    .filter(s => s.normScore >= MIN_RELEVANCE)
    .sort((a, b) => b.normScore - a.normScore)
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
