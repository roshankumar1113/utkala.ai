/**
 * scripts/test-retrieval-suite.js
 * Comprehensive 10-Question Retrieval Test Suite (5 Odia, 5 English)
 * covering PMEGP, CGTMSE, PMFME, Subhadra, and Udyam schemes.
 */

const rag = require('../services/ragService');

const testSet = [
  {
    id: 1,
    lang: 'English',
    topic: 'Subhadra Yojana',
    query: 'What is Subhadra Yojana and what documents are needed?',
    expectedScheme: 'Subhadra'
  },
  {
    id: 2,
    lang: 'Odia',
    topic: 'Subhadra Yojana',
    query: 'ସୁଭଦ୍ରା ଯୋଜନାରେ କିପରି ଆବେଦନ କରିବେ ଏବଂ କେତେ ଟଙ୍କା ମିଳିବ?',
    expectedScheme: 'ସୁଭଦ୍ରା'
  },
  {
    id: 3,
    lang: 'English',
    topic: 'PMEGP Scheme',
    query: 'What is PMEGP loan subsidy and how to apply?',
    expectedScheme: 'PMEGP'
  },
  {
    id: 4,
    lang: 'Odia',
    topic: 'PMEGP Scheme',
    query: 'ପ୍ରଧାନମନ୍ତ୍ରୀ ରୋଜଗାର ସୃଜନ ଯୋଜନା (PMEGP) ଋଣ ସବସିଡି କଣ?',
    expectedScheme: 'PMEGP'
  },
  {
    id: 5,
    lang: 'English',
    topic: 'CGTMSE Scheme',
    query: 'How to get collateral free loan under CGTMSE scheme?',
    expectedScheme: 'CGTMSE'
  },
  {
    id: 6,
    lang: 'Odia',
    topic: 'CGTMSE Scheme',
    query: 'କ୍ଷୁଦ୍ର ବ୍ୟବସାୟୀଙ୍କ ପାଇଁ CGTMSE କ୍ରେଡିଟ୍ ଗ୍ୟାରେଣ୍ଟି ଯୋଜନା କଣ?',
    expectedScheme: 'CGTMSE'
  },
  {
    id: 7,
    lang: 'English',
    topic: 'PMFME Scheme',
    query: 'What is PMFME food processing subsidy scheme in Odisha?',
    expectedScheme: 'PMFME'
  },
  {
    id: 8,
    lang: 'Odia',
    topic: 'PMFME Scheme',
    query: 'ଖାଦ୍ୟ ପ୍ରକ୍ରିୟାକରଣ ପାଇଁ PMFME ଯୋଜନାରେ କେତେ ସବସିଡି ମିଳେ?',
    expectedScheme: 'PMFME'
  },
  {
    id: 9,
    lang: 'English',
    topic: 'Udyam Registration',
    query: 'How to do Udyam registration for MSME business in Odisha?',
    expectedScheme: 'Udyam'
  },
  {
    id: 10,
    lang: 'Odia',
    topic: 'Udyam Registration',
    query: 'MSME ଉଦ୍ୟୋଗ ପାଇଁ ଉଦ୍ୟମ ପଞ୍ଜୀକରଣ କିପରି କରିବା?',
    expectedScheme: 'ଉଦ୍ୟମ'
  }
];

console.log('========================================================================');
console.log('UTKAL.AI RAG RETRIEVAL ACCURACY TEST SUITE (10 REPRESENTATIVE QUESTIONS)');
console.log('========================================================================\n');

let hits = 0;
const results = [];

for (const t of testSet) {
  const context = rag.retrieveContext(t.query);
  const isNoMatch = context.includes('No explicit matching');
  
  // Extract top sources from context
  const rawSources = (context.match(/Title:\s*(.+)/g) || []).map(m => m.replace(/Title:\s*/, '').trim());
  const sources = [...new Set(rawSources)];
  
  // Check if expected scheme appears in top retrieved documents
  const hit = !isNoMatch && sources.some(s => 
    s.toLowerCase().includes(t.expectedScheme.toLowerCase())
  );
  
  // Check for irrelevant sources leaked
  const hasSpam = sources.some(s => s.includes('ROC at CUTTACK') || s.includes('Wikipedia') && !t.topic.includes('Wiki'));
  
  if (hit && !hasSpam) {
    hits++;
    results.push({ ...t, status: 'PASS', sources });
    console.log(`✅ [PASS] Q${t.id} (${t.lang} | ${t.topic})`);
    console.log(`   Query: "${t.query}"`);
    console.log(`   Retrieved: ${sources.join(' | ')}\n`);
  } else {
    results.push({ ...t, status: 'FAIL', sources });
    console.log(`❌ [FAIL] Q${t.id} (${t.lang} | ${t.topic})`);
    console.log(`   Query: "${t.query}"`);
    console.log(`   Expected: ${t.expectedScheme}`);
    console.log(`   Retrieved: ${sources.join(' | ') || 'NO MATCH'}\n`);
  }
}

const rate = (hits / testSet.length) * 100;
console.log('========================================================================');
console.log(`RESULTS: ${hits} / ${testSet.length} PASSED (${rate.toFixed(1)}% Hit Rate)`);
console.log('========================================================================\n');

process.exit(hits === testSet.length ? 0 : 1);

