const path = require('path');
const fs = require('fs-extra');
const PDFExtractor = require('./pdfExtractorService');
const WebScraper = require('./webScraperService');
const TextChunker = require('./textChunkerService');
const EmbeddingGenerator = require('./embeddingGeneratorService');
const VectorStore = require('./vectorStoreService');

/**
 * RAGPipeline Class
 * Orchestrates document extraction, chunking, embedding generation, vector storage, and query retrieval.
 */
class RAGPipeline {
  constructor() {
    this.pdfExtractor = new PDFExtractor();
    this.webScraper = new WebScraper({ timeoutMs: 12000 });
    this.textChunker = new TextChunker({ chunkSize: 500, overlap: 100 });
    this.embeddingGenerator = new EmbeddingGenerator();
    this.vectorStore = new VectorStore();
  }

  /**
   * Runs the full end-to-end RAG training pipeline
   * @param {Object} config - { pdfDirectory, websiteUrls, databaseRecords }
   * @returns {Promise<Object>} - Execution results and statistics
   */
  async run(config = {}) {
    console.log('\n========================================');
    console.log('🚀 RAG PIPELINE EXECUTOR STARTED');
    console.log('========================================');

    await this.vectorStore.connect();

    const rawDocuments = [];

    // STEP 1: PDF Extraction
    const pdfDir = config.pdfDirectory || path.join(__dirname, '..', 'pdfs');
    console.log(`\n=== STEP 1: EXTRACTING PDFS FROM "${pdfDir}" ===`);
    if (await fs.pathExists(pdfDir)) {
      const pdfs = await this.pdfExtractor.extractBatchPDFs(pdfDir);
      for (const pdf of pdfs) {
        if (pdf.text) {
          rawDocuments.push({
            text: pdf.text,
            filename: pdf.filename,
            metadata: pdf.metadata
          });
        }
      }
    }

    // STEP 2: Web Scraping
    const urls = config.websiteUrls || [];
    if (urls.length > 0) {
      console.log(`\n=== STEP 2: SCRAPING ${urls.length} WEBSITES ===`);
      const pages = await this.webScraper.scrapeBatch(urls);
      for (const page of pages) {
        if (page.content) {
          rawDocuments.push({
            text: page.content,
            filename: page.title,
            metadata: {
              source: 'Website',
              title: page.title,
              url: page.url,
              language: 'Odia'
            }
          });
        }
      }
    }

    // STEP 3: Database & Local Knowledge Base Records
    const dbRecords = config.databaseRecords || [];
    const localDataFile = path.join(__dirname, '..', 'data', 'scraped_odia_data.json');
    if (await fs.pathExists(localDataFile)) {
      const localRecords = await fs.readJson(localDataFile);
      dbRecords.push(...localRecords);
    }

    if (dbRecords.length > 0) {
      console.log(`\n=== STEP 3: LOADING ${dbRecords.length} DATABASE / LOCAL RECORDS ===`);
      for (const rec of dbRecords) {
        if (rec.content) {
          rawDocuments.push({
            text: rec.content,
            filename: rec.title,
            metadata: {
              source: rec.category || 'Database',
              title: rec.title,
              source_url: rec.source_url,
              language: rec.language || 'Odia'
            }
          });
        }
      }
    }

    console.log(`\nTotal Raw Documents Collected: ${rawDocuments.length}`);

    // STEP 4: Text Chunking
    console.log(`\n=== STEP 4: CHUNKING DOCUMENTS (Size: 500, Overlap: 100) ===`);
    const allChunks = [];
    for (const doc of rawDocuments) {
      const chunks = this.textChunker.processDocument(doc);
      allChunks.push(...chunks);
    }
    console.log(`✅ Generated ${allChunks.length} text chunks.`);

    // STEP 5: Generating Vector Embeddings
    console.log(`\n=== STEP 5: GENERATING 384-DIM EMBEDDINGS (Local Xenova Model) ===`);
    const embeddedChunks = await this.embeddingGenerator.generateBatchEmbeddings(allChunks);

    // STEP 6: Store in Vector Database
    console.log(`\n=== STEP 6: STORING CHUNKS IN VECTOR DATABASE ===`);
    const storedCount = await this.vectorStore.storeChunks(embeddedChunks);

    // STEP 7: Final Statistics
    const stats = await this.vectorStore.getStats();

    console.log('\n========================================');
    console.log('🎉 RAG PIPELINE EXECUTION COMPLETE!');
    console.log('========================================');
    console.log('Final Vector DB Stats:', stats);

    return {
      status: 'success',
      chunksProcessed: embeddedChunks.length,
      storedCount,
      stats
    };
  }

  /**
   * Queries the vector database for relevant context matching user search text
   * @param {string} userQuery - Natural language search query
   * @param {number} topK - Top K results to retrieve
   * @returns {Promise<Object>} - Search query results payload
   */
  async query(userQuery, topK = 5) {
    if (!userQuery || typeof userQuery !== 'string') {
      throw new Error('User query must be a non-empty string.');
    }

    await this.vectorStore.connect();

    console.log(`🔍 [RAGPipeline] Querying vector DB for: "${userQuery}"...`);
    const queryEmbedding = await this.embeddingGenerator.generateEmbedding(userQuery);
    const matches = await this.vectorStore.searchSimilar(queryEmbedding, topK);

    return {
      status: 'success',
      query: userQuery,
      resultsCount: matches.length,
      results: matches
    };
  }
}

module.exports = RAGPipeline;
