const axios = require('axios');

async function testAllEndpoints() {
  const BASE = 'http://localhost:5000';
  console.log('====================================================');
  console.log('🚀 TESTING ALL LIVE ENDPOINTS ON UTKAL.AI SERVER');
  console.log('====================================================\n');

  // 1. Health
  try {
    const res = await axios.get(`${BASE}/health`);
    console.log('✅ GET /health:', JSON.stringify(res.data));
  } catch (e) {
    console.log('❌ GET /health failed:', e.message);
  }

  // 2. Odia Dataset Stats
  try {
    const res = await axios.get(`${BASE}/api/odia-data/stats`);
    console.log('✅ GET /api/odia-data/stats:', JSON.stringify(res.data));
  } catch (e) {
    console.log('❌ GET /api/odia-data/stats failed:', e.message);
  }

  // 3. RAG Stats
  try {
    const res = await axios.get(`${BASE}/api/rag/stats`);
    console.log('✅ GET /api/rag/stats:', JSON.stringify(res.data));
  } catch (e) {
    console.log('❌ GET /api/rag/stats failed:', e.message);
  }

  // 4. RAG Search
  try {
    const res = await axios.post(`${BASE}/api/rag/search`, { query: 'କାଳିଆ ଯୋଜନା', topK: 2 });
    console.log('✅ POST /api/rag/search:', `Found ${res.data.resultsCount} results for "${res.data.query}"`);
  } catch (e) {
    console.log('❌ POST /api/rag/search failed:', e.message);
  }

  // 5. Transliteration check
  try {
    const res = await axios.post(`${BASE}/api/chat/check-transliteration`, { message: 'kemiti achha bhai' });
    console.log('✅ POST /api/chat/check-transliteration:', JSON.stringify(res.data));
  } catch (e) {
    console.log('❌ POST /api/chat/check-transliteration failed:', e.message);
  }

  // 6. Chat API
  try {
    const res = await axios.post(`${BASE}/api/chat`, {
      message: 'ନମସ୍କାର, ମୁଁ ଜଣେ ଚାଷୀ, ମୋ ପାଇଁ କଣ ସରକାରୀ ଯୋଜନା ଅଛି?',
      sessionId: 'test-session-123'
    });
    console.log('✅ POST /api/chat: Response generated successfully!');
    console.log('   Response snippet:', (res.data.response || res.data.message || '').substring(0, 120) + '...');
    console.log('   RAG context used:', res.data.ragContextUsed);
  } catch (e) {
    console.log('❌ POST /api/chat failed:', e.response?.data || e.message);
  }

  console.log('\n====================================================');
  console.log('🏁 All live endpoint tests completed.');
  console.log('====================================================');
}

testAllEndpoints();
