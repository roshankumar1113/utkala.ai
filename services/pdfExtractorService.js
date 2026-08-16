const fs = require('fs-extra');
const path = require('path');
const pdfParse = require('pdf-parse');

/**
 * PDFExtractor Class for RAG Systems
 * Extracts structured text, metadata, and page statistics from single or batch PDF files.
 */
class PDFExtractor {
  constructor(options = {}) {
    this.maxCharacterLength = options.maxCharacterLength || 500000; // Truncate very large PDFs
    this.defaultLanguage = options.defaultLanguage || 'Odia';
  }

  /**
   * Extract text, metadata, and page count from a single PDF file
   * @param {string} pdfPath - Path to the PDF file
   * @returns {Promise<Object>} - Structured PDF data payload
   */
  async extractFromPDF(pdfPath) {
    const filename = path.basename(pdfPath);
    console.log(`📄 [PDFExtractor] Extracting: "${filename}"...`);

    // 1. File existence error handling
    if (!await fs.pathExists(pdfPath)) {
      const errorMsg = `File not found at path: "${pdfPath}"`;
      console.error(`❌ [PDFExtractor] ${errorMsg}`);
      return {
        success: false,
        filename,
        error: errorMsg
      };
    }

    try {
      // 2. Read PDF buffer
      const dataBuffer = await fs.readFile(pdfPath);

      // 3. Parse PDF with pdf-parse
      const data = await pdfParse(dataBuffer);

      let extractedText = data.text ? data.text.trim() : '';
      let isTruncated = false;

      // 4. Handle very large PDFs (Truncate safeguard)
      if (extractedText.length > this.maxCharacterLength) {
        extractedText = extractedText.substring(0, this.maxCharacterLength) + '\n\n[TRUNCATED: Exceeded maximum character limit]';
        isTruncated = true;
        console.warn(`⚠️ [PDFExtractor] "${filename}" text exceeded limit. Truncated to ${this.maxCharacterLength} characters.`);
      }

      // 5. Structure metadata
      const info = data.info || {};
      const metadata = {
        title: info.Title && info.Title.trim() !== '' ? info.Title.trim() : path.parse(pdfPath).name,
        author: info.Author && info.Author.trim() !== '' ? info.Author.trim() : 'Sarala Dasa',
        date: info.CreationDate || new Date().toISOString(),
        source: 'PDF',
        language: this.defaultLanguage
      };

      console.log(`✅ [PDFExtractor] Successfully extracted "${filename}" (${data.numpages} pages, ${extractedText.length} chars)`);

      return {
        success: true,
        filename,
        pages: data.numpages,
        text: extractedText,
        metadata,
        isTruncated
      };

    } catch (error) {
      // 6. Invalid/Corrupt PDF error handling (Skip gracefully)
      console.error(`❌ [PDFExtractor] Failed to parse PDF "${filename}": ${error.message}`);
      return {
        success: false,
        filename,
        error: `Invalid or unparseable PDF: ${error.message}`
      };
    }
  }

  /**
   * Extract text and metadata from all PDFs in a directory
   * @param {string} pdfDirectory - Directory containing PDF files
   * @returns {Promise<Array<Object>>} - Array of structured PDF data payloads
   */
  async extractBatchPDFs(pdfDirectory) {
    console.log(`📂 [PDFExtractor] Starting batch extraction for directory: "${pdfDirectory}"...`);

    if (!await fs.pathExists(pdfDirectory)) {
      console.error(`❌ [PDFExtractor] Directory not found: "${pdfDirectory}"`);
      return [];
    }

    const files = await fs.readdir(pdfDirectory);
    const pdfFiles = files.filter(file => file.toLowerCase().endsWith('.pdf'));

    if (pdfFiles.length === 0) {
      console.warn(`⚠️ [PDFExtractor] No PDF files found in directory "${pdfDirectory}".`);
      return [];
    }

    console.log(`🔍 [PDFExtractor] Found ${pdfFiles.length} PDF files to process.`);

    const results = [];
    for (let i = 0; i < pdfFiles.length; i++) {
      const pdfFile = pdfFiles[i];
      const fullPath = path.join(pdfDirectory, pdfFile);
      console.log(`[Batch Progress ${i + 1}/${pdfFiles.length}] Processing: ${pdfFile}`);
      
      const result = await this.extractFromPDF(fullPath);
      if (result.success) {
        results.push(result);
      } else {
        console.warn(`⚠️ [PDFExtractor] Skipping file "${pdfFile}" due to error.`);
      }
    }

    console.log(`🎉 [PDFExtractor] Batch extraction complete. Processed ${results.length}/${pdfFiles.length} PDFs successfully.`);
    return results;
  }
}

module.exports = PDFExtractor;
