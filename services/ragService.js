/**
 * ragService.js
 * High-accuracy bilingual keyword & entity matching RAG context retrieval.
 * Supports Odia & English domain questions (Subhadra, PMEGP, CGTMSE, PMFME, Udyam, KALIA).
 * 
 * Rules:
 *  - Filters English & Odia stop words so they never inflate scores.
 *  - Bilingual synonym/alias expansion (e.g. "subhadra" -> "ସୁଭଦ୍ରା", "pmegp" -> "ପିଏମଇଜିପି").
 *  - Deduplicates sources by normalized title.
 *  - Filters internal instruction documents and bare domains.
 *  - Suppresses generic encyclopedic sources (e.g. Wikipedia) when specific scheme/business schemes exist.
 *  - Relevance threshold: MIN_RELEVANCE = 0.25.
 *  - Rule: zero sources beats one irrelevant source.
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'scraped_odia_data.json');
const VECTOR_FALLBACK = path.join(__dirname, '..', 'data', 'vector_store_fallback.json');

const NO_MATCH_MSG =
  'No explicit matching local state schema documents found in the primary vector cluster repository.';

let cachedRecords = null;
let lastLoadedTime = 0;

// English & Odia stop words that carry zero domain relevance
const STOP_WORDS = new Set([
  'what', 'is', 'are', 'and', 'the', 'of', 'in', 'to', 'for', 'on', 'with', 'at', 'by',
  'from', 'about', 'how', 'do', 'does', 'can', 'will', 'would', 'a', 'an', 'this', 'that',
  'it', 'its', 'needed', 'required', 'documents', 'apply', 'get', 'tell', 'me', 'please',
  'under', 'which', 'who', 'where', 'when',
  'କଣ', 'କିପରି', 'ଏବଂ', 'ଓ', 'ର', 'ରେ', 'ପାଇଁ', 'କରିବେ', 'କିଏ', 'ଆବଶ୍ୟକ', 'ଜଣାନ୍ତୁ', 'ଦିଅନ୍ତୁ', 'ମିଳିବ', 'କେତେ'
]);

// Bilingual domain synonym mappings for high-precision scheme lookup
const BILINGUAL_ALIASES = {
  subhadra: ['ସୁଭଦ୍ରା', 'subhadra', 'ଯୋଜନା'],
  'ସୁଭଦ୍ରା': ['subhadra', 'ସୁଭଦ୍ରା', 'ଯୋଜନା'],
  pmegp: ['pmegp', 'ପିଏମଇଜିପି', 'ରୋଜଗାର', 'ସୃଜନ', 'ଋଣ', 'subsidy'],
  'ପିଏମଇଜିପି': ['pmegp', 'ରୋଜଗାର', 'ଋଣ'],
  cgtmse: ['cgtmse', 'କ୍ରେଡିଟ୍', 'ଗ୍ୟାରେଣ୍ଟି', 'collateral', 'credit guarantee'],
  'କ୍ରେଡିଟ୍': ['cgtmse', 'କ୍ରେଡିଟ୍', 'ଗ୍ୟାରେଣ୍ଟି'],
  pmfme: ['pmfme', 'ଖାଦ୍ୟ', 'ପ୍ରକ୍ରିୟାକରଣ', 'food processing', 'odop'],
  'ଖାଦ୍ୟ': ['pmfme', 'ଖାଦ୍ୟ', 'ପ୍ରକ୍ରିୟାକରଣ'],
  udyam: ['udyam', 'ଉଦ୍ୟମ', 'ପଞ୍ଜୀକରଣ', 'msme', 'registration'],
  'ଉଦ୍ୟମ': ['udyam', 'ଉଦ୍ୟମ', 'ପଞ୍ଜୀକରଣ', 'msme'],
  kalia: ['kalia', 'କାଳିଆ', 'farmers', 'ଚାଷୀ'],
  'କାଳିଆ': ['kalia', 'କାଳିଆ', 'ଚାଷୀ'],
  msme: ['msme', 'କ୍ଷୁଦ୍ର', 'ମଧ୍ୟମ', 'ଉଦ୍ୟୋଗ', 'business'],
  'କ୍ଷୁଦ୍ର': ['msme', 'କ୍ଷୁଦ୍ର', 'ଉଦ୍ୟୋଗ'],
};

const INTERNAL_TITLE_RE = /master\s*instruction|system\s*prompt|internal\s*(doc|document|instruction)|instruction\s*#\s*\d+/i;
const BARE_DOMAIN_RE = /^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?(\.[a-z]{2,})+\/?$/i;

function loadKnowledgeBase() {
  const now = Date.now();
  if (cachedRecords && (now - lastLoadedTime < 30000)) {
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

const MIN_RELEVANCE = 0.25;

function retrieveContext(query) {
  if (!query || typeof query !== 'string') return NO_MATCH_MSG;

  const records = loadKnowledgeBase();
  if (!records.length) return NO_MATCH_MSG;

  // Extract raw terms
  const rawWords = query
    .toLowerCase()
    .split(/[\s,।.\-!?]+/)
    .filter(w => w.length > 1);

  if (!rawWords.length) return NO_MATCH_MSG;

  // Filter out stop words
  const contentWords = rawWords.filter(w => !STOP_WORDS.has(w));
  const activeWords = contentWords.length > 0 ? contentWords : rawWords;

  // Check if query is asking for a scheme or business topic
  const isSchemeQuery = activeWords.some(w =>
    /pmegp|cgtmse|pmfme|udyam|subhadra|kalia|msme|scheme|yojana|subsidy|loan|registration|ଉଦ୍ୟମ|ସୁଭଦ୍ରା|କାଳିଆ|ଋଣ|ସବସିଡି|ଯୋଜନା/i.test(w)
  );

  // Expand with bilingual aliases
  const expandedTokens = new Set(activeWords);
  for (const w of activeWords) {
    if (BILINGUAL_ALIASES[w]) {
      BILINGUAL_ALIASES[w].forEach(a => expandedTokens.add(a.toLowerCase()));
    }
  }
  const tokenList = Array.from(expandedTokens);

  // Score records
  const scored = [];
  const seenTitles = new Set();

  for (const rec of records) {
    const rawTitle = String(rec.title || '').trim();
    if (!rawTitle || INTERNAL_TITLE_RE.test(rawTitle) || BARE_DOMAIN_RE.test(rawTitle)) {
      continue;
    }

    // Never return blogspot ROC spam
    if (rawTitle.includes('ROC at CUTTACK')) continue;

    // For scheme queries, suppress generic Wikipedia pages
    if (isSchemeQuery && /wikipedia/i.test(rawTitle)) continue;

    const titleText = rawTitle.toLowerCase();
    const bodyText = String(rec.content || '').toLowerCase();

    let score = 0;
    let titleHits = 0;

    for (const token of tokenList) {
      if (titleText.includes(token)) {
        score += 4; // Title hit is primary signal
        titleHits++;
      } else if (bodyText.includes(token)) {
        score += 1;
      }
    }

    // Normalized against original active query terms * 4
    const maxPossible = Math.max(activeWords.length * 4, 4);
    const normScore = score / maxPossible;

    if (normScore >= MIN_RELEVANCE && (titleHits > 0 || normScore >= 0.5)) {
      // Deduplicate by normalized title
      const titleKey = rawTitle.toLowerCase().replace(/\s+/g, ' ');
      if (!seenTitles.has(titleKey)) {
        seenTitles.add(titleKey);
        scored.push({ rec, score, normScore, titleHits });
      }
    }
  }

  // Sort by title hits first, then normScore
  scored.sort((a, b) => b.titleHits - a.titleHits || b.normScore - a.normScore);
  const topMatches = scored.slice(0, 3).map(s => s.rec);

  if (!topMatches.length) return NO_MATCH_MSG;

  const contextBlocks = topMatches.map(
    (rec, i) =>
      `[Context Block ${i + 1}]\nTitle: ${rec.title}\nCategory: ${rec.category}\n${rec.content}`
  );

  return contextBlocks.join('\n\n---\n\n');
}

module.exports = {
  retrieveContext,
};
