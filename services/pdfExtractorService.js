/**
 * pdfExtractorService.js
 * Extracts text and metadata from PDF files using pdf-parse.
 */

const fs = require('fs');
const path = require('path');

let pdfParse;
try {
  pdfParse = require('pdf-parse');
} catch (err) {
  console.warn('[PDFExtractor] pdf-parse not installed. PDF extraction unavailable.');
}

class PDFExtractor {
  constructor(maxCharLength = 500000, defaultLanguage = 'odia') {
    this.maxCharLength = maxCharLength;
    this.defaultLanguage = defaultLanguage;
  }

  /**
   * Extract text and metadata from a single PDF file.
   * @param {string} pdfPath - Absolute path to the PDF file
   * @returns {Promise<Object>} - Extraction result
   */
  async extractFromPDF(pdfPath) {
    const filename = path.basename(pdfPath);
    console.log(`[PDFExtractor] Extracting: "${filename}"`);

    if (!fs.existsSync(pdfPath)) {
      return { success: false, filename, error: `File not found: ${pdfPath}` };
    }

    if (!pdfParse) {
      return { success: false, filename, error: 'pdf-parse library not installed. Run: npm install pdf-parse' };
    }

    try {
      const dataBuffer = fs.readFileSync(pdfPath);
      const data = await pdfParse(dataBuffer);

      let text = (data.text || '').trim();
      let isTruncated = false;

      if (text.length > this.maxCharLength) {
        text = text.slice(0, this.maxCharLength) + '\n\n[TRUNCATED]';
        isTruncated = true;
      }

      const metadata = {
        title: (data.info?.Title || path.parse(filename).name).trim(),
        author: (data.info?.Author || 'Unknown').trim(),
        source: 'PDF',
        language: this.defaultLanguage,
      };

      console.log(`[PDFExtractor] Extracted "${filename}" (${data.numpages} pages, ${text.length} chars)`);

      return {
        success: true,
        filename,
        pages: data.numpages || 1,
        text,
        metadata,
        isTruncated,
      };
    } catch (err) {
      console.error(`[PDFExtractor] Failed to parse "${filename}": ${err.message}`);
      return { success: false, filename, error: `Invalid or unparseable PDF: ${err.message}` };
    }
  }

  /**
   * Extract text from all PDFs in a directory.
   * @param {string} pdfDirectory - Path to directory containing PDFs
   * @returns {Promise<Array>} - Array of extraction results
   */
  async extractBatchPDFs(pdfDirectory) {
    if (!fs.existsSync(pdfDirectory)) {
      console.warn(`[PDFExtractor] Directory not found: ${pdfDirectory}`);
      return [];
    }

    const files = fs.readdirSync(pdfDirectory).filter(f => f.toLowerCase().endsWith('.pdf'));

    if (!files.length) {
      console.log(`[PDFExtractor] No PDFs found in: ${pdfDirectory}`);
      return [];
    }

    console.log(`[PDFExtractor] Processing ${files.length} PDFs in: ${pdfDirectory}`);
    const results = [];

    for (const [i, file] of files.entries()) {
      console.log(`[PDFExtractor] [${i + 1}/${files.length}] ${file}`);
      const result = await this.extractFromPDF(path.join(pdfDirectory, file));
      if (result.success) results.push(result);
    }

    console.log(`[PDFExtractor] Batch complete: ${results.length}/${files.length} extracted.`);
    return results;
  }
}

module.exports = PDFExtractor;
