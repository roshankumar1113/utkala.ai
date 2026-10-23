/**
 * demo-tavily-search.js
 * Demonstrates real Tavily web search fetching, citation extraction,
 * and Gemini synthesis under the LIVE DATA RULES.
 */

require('dotenv').config();
const { fetchLiveContext, fetchWebSearch } = require('../services/liveDataService');
const { generateUniversalResponse } = require('../services/chatService');

async function runDemo(userQuery) {
  console.log('===============================================================');
  console.log(`🔍 USER QUERY: "${userQuery}"`);
  console.log('===============================================================\n');

  // 1. Direct Tavily Web Search
  console.log('📡 STEP 1: Calling Tavily AI Search API...');
  const webResult = await fetchWebSearch(userQuery);

  if (!webResult) {
    console.log('❌ No live web data found or TAVILY_API_KEY issue.');
    return;
  }

  console.log('✅ Tavily Results Retrieved Successfully!');
  console.log('\n--- [SOURCES IDENTIFIED] ---');
  console.log(webResult.sources.join(', '));

  console.log('\n--- [LIVE GROUNDING CONTEXT INJECTED FOR GEMINI] ---');
  console.log(webResult.contextText);

  // 2. Full Pipeline: Gemini Answering with Live Data Grounding
  console.log('\n===============================================================');
  console.log('🤖 STEP 2: Gemini generating response with LIVE DATA RULES...');
  console.log('===============================================================\n');

  const result = await generateUniversalResponse(userQuery, 'demo-session', {}, {
    replyLanguage: 'or', // Odia response
  });

  console.log('--- [FINAL USER-FACING RESPONSE (ODIA)] ---');
  console.log(result.response);

  console.log('\n--- [CITATION CHIPS DISPLAYED IN UI] ---');
  console.log(result.ragSources);

  // Also show English translation/version for demonstration
  console.log('\n===============================================================');
  console.log('🌐 STEP 3: Same query in English (Bilingual Support)...');
  console.log('===============================================================\n');

  const resultEn = await generateUniversalResponse(userQuery, 'demo-session-en', {}, {
    replyLanguage: 'en',
  });

  console.log('--- [FINAL USER-FACING RESPONSE (ENGLISH)] ---');
  console.log(resultEn.response);
  console.log('\n--- [CITATION CHIPS] ---');
  console.log(resultEn.ragSources);
}

const query = process.argv[2] || 'Subhadra Yojana latest update Odisha today';
runDemo(query).catch(err => {
  console.error('Error during Tavily demo:', err);
  process.exit(1);
});
