/**
 * sttValidationService.js
 * Guards against hallucinated / invalid STT output.
 *
 * The prior pipeline could accept a Gemini "audio description" (e.g.
 * "The sound of a door being shut is heard") as a valid user transcript and
 * feed it into the ledger parser / chat engine. For a financial + voice
 * product this is unacceptable. This module classifies a candidate transcript
 * and decides whether it is safe to treat as real user speech.
 */

// English phrases that indicate the model is *describing* audio rather than
// transcribing spoken words. Kept lowercase; matched case-insensitively.
const AUDIO_DESCRIPTION_MARKERS = [
  'the sound of',
  'a sound of',
  'sound of a',
  'is heard',
  'can be heard',
  'audio clip',
  'the audio',
  'this audio',
  'background noise',
  'no speech',
  'no discernible',
  'no audible',
  'inaudible',
  'unintelligible',
  'silence',
  'appears to be',
  'seems to be',
  'the speaker says nothing',
  'music playing',
  'i cannot transcribe',
  'i can\'t transcribe',
  'unable to transcribe',
  'no words',
  'no clear speech',
  '[',      // bracketed stage directions e.g. [door shuts]
];

// Unicode ranges
const ODIA_RE = /[଀-୿]/g;
const LATIN_RE = /[a-zA-Z]/g;

/**
 * Ratio of Odia-script characters among all "letter-like" characters.
 * @param {string} text
 * @returns {number} 0..1
 */
function odiaScriptRatio(text) {
  const odia = (text.match(ODIA_RE) || []).length;
  const latin = (text.match(LATIN_RE) || []).length;
  const denom = odia + latin;
  if (denom === 0) return 0;
  return odia / denom;
}

/**
 * Validate a candidate transcript.
 *
 * @param {string} transcript
 * @param {Object} [opts]
 * @param {string} [opts.engine] - name of engine that produced it
 * @param {'od-IN'|'auto'} [opts.languageMode='auto'] - selected voice mode
 * @param {boolean} [opts.strictOdia] - require Odia script (derived from languageMode when omitted)
 * @returns {{ valid: boolean, reason?: string, cleaned: string }}
 */
function validateTranscript(transcript, opts = {}) {
  const languageMode = opts.languageMode || 'auto';
  const strictOdia = opts.strictOdia !== undefined ? opts.strictOdia : languageMode === 'od-IN';

  const cleaned = (transcript || '').replace(/^["'\s]+|["'\s]+$/g, '').trim();

  if (!cleaned) {
    return { valid: false, reason: 'EMPTY', cleaned: '' };
  }

  // Too short to be a meaningful utterance (single stray char / punctuation).
  if (cleaned.replace(/[\s.,!?।]/g, '').length < 2) {
    return { valid: false, reason: 'TOO_SHORT', cleaned };
  }

  const lower = cleaned.toLowerCase();

  // Audio-description / hallucination markers. Only reject when the transcript
  // is *dominated* by these (short text) or clearly English narration, so we
  // don't nuke a legitimate Odia sentence that merely contains a bracket.
  for (const marker of AUDIO_DESCRIPTION_MARKERS) {
    if (lower.includes(marker)) {
      // If the text is mostly Odia script, a stray English marker is unlikely
      // to be a description — keep it. Otherwise reject.
      if (odiaScriptRatio(cleaned) < 0.5) {
        return { valid: false, reason: 'AUDIO_DESCRIPTION', cleaned };
      }
    }
  }

  // In dedicated Odia mode, the transcript must actually be Odia script.
  // This eliminates the "Sarvam detected pa-IN / returned Latin garbage" class
  // of failures from being treated as a valid Odia turn.
  if (strictOdia && odiaScriptRatio(cleaned) < 0.5) {
    return { valid: false, reason: 'NOT_ODIA_SCRIPT', cleaned };
  }

  return { valid: true, cleaned };
}

module.exports = {
  validateTranscript,
  odiaScriptRatio,
  AUDIO_DESCRIPTION_MARKERS,
};
