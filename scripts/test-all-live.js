const axios = require('axios');

async function testAllEndpoints() {
  const BASE = 'http://localhost:5000';
  console.log('====================================================');
  console.log('🚀 TESTING ALL LIVE ENDPOINTS ON UTKAL.AI SERVER');
  console.log('====================================================\n');

  // 1. Health (public)
  try {
    const res = await axios.get(`${BASE}/health`);
    console.log('✅ GET /health:', JSON.stringify(res.data));
  } catch (e) {
    console.log('❌ GET /health failed:', e.message);
  }

  // 2. Authenticate
  let cookieHeader = '';
  try {
    let authRes;
    try {
      authRes = await axios.post(`${BASE}/api/auth/login`, {
        email: 'tester@utkal.ai',
        password: 'securePassword123!'
      });
    } catch {
      authRes = await axios.post(`${BASE}/api/auth/signup`, {
        name: 'Tester',
        email: 'tester@utkal.ai',
        password: 'securePassword123!'
      });
    }
    const setCookie = authRes.headers['set-cookie'];
    if (setCookie) {
      cookieHeader = Array.isArray(setCookie) ? setCookie.map(c => c.split(';')[0]).join('; ') : setCookie.split(';')[0];
    }
    console.log('✅ Authentication successful:', authRes.data.user?.email || 'Logged in');
  } catch (e) {
    console.log('❌ Authentication failed:', e.response?.data || e.message);
  }

  const client = axios.create({
    baseURL: BASE,
    headers: cookieHeader ? { Cookie: cookieHeader } : {}
  });

  // 3. Odia Dataset Stats
  try {
    const res = await client.get('/api/odia-data/stats');
    console.log('✅ GET /api/odia-data/stats:', JSON.stringify(res.data));
  } catch (e) {
    console.log('❌ GET /api/odia-data/stats failed:', e.response?.data || e.message);
  }

  // 4. RAG Stats
  try {
    const res = await client.get('/api/rag/stats');
    console.log('✅ GET /api/rag/stats:', JSON.stringify(res.data));
  } catch (e) {
    console.log('❌ GET /api/rag/stats failed:', e.response?.data || e.message);
  }

  // 5. RAG Search
  try {
    const res = await client.post('/api/rag/search', { query: 'କାଳିଆ ଯୋଜନା', topK: 2 });
    console.log('✅ POST /api/rag/search:', `Found ${res.data.resultsCount} results for "${res.data.query}"`);
  } catch (e) {
    console.log('❌ POST /api/rag/search failed:', e.response?.data || e.message);
  }

  // 6. Transliteration check
  try {
    const res = await client.post('/api/chat/check-transliteration', { message: 'kemiti achha bhai' });
    console.log('✅ POST /api/chat/check-transliteration:', JSON.stringify(res.data));
  } catch (e) {
    console.log('❌ POST /api/chat/check-transliteration failed:', e.response?.data || e.message);
  }

  // 7. Chat API
  try {
    const res = await client.post('/api/chat', {
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

