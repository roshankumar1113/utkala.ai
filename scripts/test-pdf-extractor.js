const path = require('path');
const fs = require('fs-extra');
const PDFExtractor = require('../services/pdfExtractorService');

async function testExtractor() {
  const extractor = new PDFExtractor();
  const pdfDir = path.join(__dirname, '..', 'pdfs');

  await fs.ensureDir(pdfDir);

  console.log('--- 🧪 TESTING SINGLE PDF EXTRACTION (NON-EXISTENT ERROR HANDLING) ---');
  const missingResult = await extractor.extractFromPDF(path.join(pdfDir, 'odia-book.pdf'));
  console.log('Missing File Result:', JSON.stringify(missingResult, null, 2));

  console.log('\n--- 🧪 TESTING BATCH PDF EXTRACTION ---');
  const batchResults = await extractor.extractBatchPDFs(pdfDir);
  console.log(`Batch Results Count: ${batchResults.length}`);
}

testExtractor().catch(err => {
  console.error('Test Runner Error:', err);
});
