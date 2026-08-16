/**
 * TextChunker Class for RAG Systems
 * Splits documents into overlapping text chunks, preserving metadata and respecting paragraph boundaries.
 */
class TextChunker {
  constructor(options = {}) {
    this.chunkSize = options.chunkSize || 500;
    this.overlap = options.overlap || 100;
  }

  /**
   * Splits text by sentences as a fallback tokenizer
   * Supports standard punctuation (. ! ?) and Odia sentence boundary (।)
   * @param {string} text 
   * @returns {Array<string>}
   */
  chunkBySentences(text) {
    if (!text) return [];
    const sentences = text.match(/[^.!?।\n]+[.!?।\n]+/g) || [text];
    return sentences.map(s => s.trim()).filter(s => s.length > 0);
  }

  /**
   * Processes a document into structured chunks with overlap and metadata
   * @param {Object} document - Input document { text, filename, metadata }
   * @returns {Array<Object>} - Array of chunk objects
   */
  processDocument(document) {
    if (!document || !document.text || typeof document.text !== 'string') {
      return [];
    }

    const fullText = document.text.trim();
    if (fullText.length === 0) return [];

    // 1. Split text into paragraphs
    let paragraphs = fullText.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
    if (paragraphs.length === 1 && paragraphs[0].length > this.chunkSize) {
      paragraphs = this.chunkBySentences(paragraphs[0]);
    }

    const rawChunks = [];
    let currentChunk = '';

    for (const para of paragraphs) {
      if ((currentChunk + ' ' + para).length <= this.chunkSize) {
        currentChunk = currentChunk ? currentChunk + '\n\n' + para : para;
      } else {
        if (currentChunk.length >= 50) {
          rawChunks.push(currentChunk);
        }
        
        // Add overlap from the end of currentChunk if possible
        const overlapText = currentChunk.length > this.overlap 
          ? currentChunk.substring(currentChunk.length - this.overlap) 
          : '';

        currentChunk = overlapText ? overlapText + '\n\n' + para : para;
      }
    }

    if (currentChunk.length >= 50) {
      rawChunks.push(currentChunk);
    }

    const timestamp = Date.now();
    const totalChunks = rawChunks.length;
    const docTitle = document.metadata?.title || document.filename || 'Untitled Document';
    const docSource = document.metadata?.source || (document.filename ? 'PDF' : 'Text');
    const docLanguage = document.metadata?.language || 'Odia';

    // 2. Format final chunks with metadata
    return rawChunks.map((chunkText, index) => ({
      id: `chunk_${timestamp}_${index}`,
      text: chunkText,
      metadata: {
        source: docSource,
        title: docTitle,
        chunkIndex: index,
        totalChunks,
        language: docLanguage,
        ...(document.metadata || {})
      }
    }));
  }
}

module.exports = TextChunker;
