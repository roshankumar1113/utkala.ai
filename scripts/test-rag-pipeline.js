const RAGPipeline = require('../services/ragPipelineService');

async function testPipeline() {
  console.log('--- 🧪 TESTING FULL RAG PIPELINE (STEPS 3 - 7) ---');

  const pipeline = new RAGPipeline();

  // 1. Run RAG Pipeline Training with local dataset
  const trainResult = await pipeline.run({
    pdfDirectory: './pdfs',
    websiteUrls: ['https://en.wikipedia.org/wiki/Odisha']
  });

  console.log('\n--- 📊 PIPELINE TRAIN RESULT ---');
  console.log(JSON.stringify(trainResult, null, 2));

  // 2. Perform Cosine Similarity Vector Search
  console.log('\n--- 🔍 TESTING VECTOR SIMILARITY SEARCH ---');
  const searchResult = await pipeline.query('ସୁଭଦ୍ରା ଯୋଜନା', 3);
  console.log(JSON.stringify(searchResult, null, 2));
}

testPipeline().catch(err => {
  console.error('Test Pipeline Error:', err);
});
