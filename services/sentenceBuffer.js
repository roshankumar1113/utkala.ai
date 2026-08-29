/**
 * sentenceBuffer.js
 * Sentence/phrase-aware buffering for streaming TTS.
 *
 * As Gemini streams text deltas, we accumulate them and emit complete
 * sentences (or long-enough phrases) as soon as a boundary is seen, so TTS can
 * start speaking sentence 1 while sentence 2 is still being generated.
 *
 * Odia uses the danda "।" as a full stop; we also honor ., !, ?, and newlines.
 */

const BOUNDARY_RE = /[।.!?\n]/;

class SentenceBuffer {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.minChars=12] - don't flush a boundary shorter than this
   * @param {number} [opts.maxChars=220] - force-flush if buffer exceeds this
   */
  constructor(opts = {}) {
    this.minChars = opts.minChars ?? 12;
    this.maxChars = opts.maxChars ?? 220;
    this.buffer = '';
  }

  /**
   * Push a text delta. Returns an array of completed chunks ready for TTS.
   * @param {string} delta
   * @returns {string[]}
   */
  push(delta) {
    if (!delta) return [];
    this.buffer += delta;
    const out = [];

    let guard = 0;
    while (guard++ < 1000) {
      const m = this.buffer.match(BOUNDARY_RE);
      if (!m) break;
      const idx = m.index;
      const candidate = this.buffer.slice(0, idx + 1).trim();

      if (candidate.replace(/[।.!?\s]/g, '').length >= this.minChars) {
        out.push(candidate);
        this.buffer = this.buffer.slice(idx + 1);
      } else if (this.buffer.length > this.maxChars) {
        // Sentence-less runaway; flush what we have up to the boundary.
        out.push(candidate);
        this.buffer = this.buffer.slice(idx + 1);
      } else {
        // Boundary too short (e.g. abbreviation); keep accumulating.
        break;
      }
    }

    // Force-flush an over-long buffer with no boundary at all.
    if (this.buffer.length > this.maxChars) {
      out.push(this.buffer.trim());
      this.buffer = '';
    }

    return out.filter(Boolean);
  }

  /** Flush any remaining buffered text (call at stream end). */
  flush() {
    const rest = this.buffer.trim();
    this.buffer = '';
    return rest ? [rest] : [];
  }
}

module.exports = { SentenceBuffer };
