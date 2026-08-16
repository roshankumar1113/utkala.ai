let pipeline;

/**
 * EmbeddingGenerator Class for RAG Systems
 * Uses local @xenova/transformers with Xenova/all-MiniLM-L6-v2 to generate 384-dim vector embeddings.
 */
class EmbeddingGenerator {
  constructor(options = {}) {
    this.modelName = options.modelName || 'Xenova/all-MiniLM-L6-v2';
    this.pipe = null;
    this.maxCharLength = options.maxCharLength || 512;
  }

  /**
   * Lazily loads the local Transformer embedding model
   */
  async loadModel() {
    if (!this.pipe) {
      if (!pipeline) {
        const transformers = await import('@xenova/transformers');
        pipeline = transformers.pipeline;
      }
      console.log(`🤖 [EmbeddingGenerator] Loading local model "${this.modelName}"...`);
      this.pipe = await pipeline('feature-extraction', this.modelName);
      console.log(`✅ [EmbeddingGenerator] Model "${this.modelName}" loaded successfully!`);
    }
    return this.pipe;
  }

  /**
   * Generates a 384-dim normalized vector embedding for a single text input
   * @param {string} text - Input text
   * @returns {Promise<Array<number>>} - 384-dimensional Float array
   */
  async generateEmbedding(text) {
    await this.loadModel();

    if (!text || typeof text !== 'string') {
      throw new Error('Input text must be a non-empty string.');
    }

    // Truncate to 512 chars (Model context length limit safeguard)
    const truncatedText = text.substring(0, this.maxCharLength);

    // Extract features (mean pooling + normalization)
    const output = await this.pipe(truncatedText, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  /**
   * Batch generates embeddings for an array of chunk objects
   * @param {Array<Object>} chunks - Array of chunk objects with .text property
   * @returns {Promise<Array<Object>>} - Array of chunk objects with .embedding attached
   */
  async generateBatchEmbeddings(chunks) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return [];
    }

    await this.loadModel();
    console.log(`🚀 [EmbeddingGenerator] Generating embeddings for ${chunks.length} chunks...`);

    const embeddedChunks = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await this.generateEmbedding(chunk.text);

      embeddedChunks.push({
        ...chunk,
        embedding
      });

      if ((i + 1) % 10 === 0 || i === chunks.length - 1) {
        console.log(`📊 [Embedding Progress] Processed ${i + 1}/${chunks.length} chunks.`);
      }
    }

    console.log(`🎉 [EmbeddingGenerator] Successfully embedded ${embeddedChunks.length} chunks.`);
    return embeddedChunks;
  }
}

module.exports = EmbeddingGenerator;
