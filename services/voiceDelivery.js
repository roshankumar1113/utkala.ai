/**
 * Spoken delivery for Live Talk.
 * Bulbul v3 has no pitch, loudness, or SSML. Expressiveness is pace plus
 * temperature, and emotion has to be written as words the speaker can say
 * (a single "ha ha", a comma where a person would breathe).
 */

const PACE_MIN = 0.5;
const PACE_MAX = 2;
const TEMP_MIN = 0.01;
const TEMP_MAX = 1;

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function languageCode(language) {
  if (language === 'en' || language === 'en-IN') return 'en-IN';
  if (language === 'hi' || language === 'mix' || language === 'hi-IN') return 'hi-IN';
  return 'od-IN';
}

/**
 * Which language the live reply should use.
 * Odia mode and the English chip stay fixed. Auto follows the utterance.
 */
function detectSpokenLanguage(transcript, opts = {}) {
  const mode = opts.languageMode === 'auto' ? 'auto' : 'od-IN';
  const chip = opts.replyLanguage === 'en' ? 'en' : 'or';
  if (chip === 'en') return 'en';
  if (mode !== 'auto') return 'or';

  const text = String(transcript || '');
  if (/[\u0B00-\u0B7F]/.test(text)) return 'or';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';

  const hinglish = /\b(kya|kyun|kyu|hai|hoon|hun|nahi|nahin|acha|accha|yaar|bhai|theek|thik|karo|batao|bata|samajh|mujhe|tum|aap|haan|matlab|kaise|kaisa|kuch)\b/i;
  const english = /\b(the|what|how|please|tell|about|is|are|can|you|why|when|where)\b/i;
  if (hinglish.test(text) && english.test(text)) return 'mix';
  if (hinglish.test(text)) return 'hi';
  if (english.test(text) || /[a-z]/i.test(text)) return 'en';
  return 'or';
}

function prepareSpeechText(text) {
  let clean = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*#_`~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';

  clean = clean
    .replace(/\b(ha(?:ha)+)\b/gi, 'ha ha')
    .replace(/(?:ha\s+){2,}ha/gi, 'ha ha')
    .replace(/(?:ହା\s*){3,}/g, 'ହା ହା')
    .replace(/(?:हा\s*){3,}/g, 'हा हा')
    .replace(/[!]{2,}/g, '!')
    .replace(/[?]{2,}/g, '?')
    .replace(/\.{4,}/g, '...')
    .replace(/\s+([,।.!?])/g, '$1');

  return clean.slice(0, 500);
}

function forUtterance(text, userText = '', basePace = 1) {
  const spoken = prepareSpeechText(text);
  const blob = `${userText}\n${spoken}`.toLowerCase();
  let pace = Number(basePace) || 1;
  let temperature = 0.72;
  let emotion = 'warm';

  const laugh = /ha ha|ହା ହା|हा हा|hehe|lol/.test(blob)
    || /joke|funny|ହସ|मजाक|मज़ाक|hasibe|hasi/.test(blob);
  const empathy = /sorry|sad|dukh|ଦୁଃଖ|ଦୁଖ|अफसोस|चिंता|worry|lost|died|କଷ୍ଟ/.test(blob);
  const surprise = /ଆରେ|अरे|वाह|oh really|wait,|seriously|ସତେ|unbelievable/.test(blob);
  const happy = /great|wonderful|ଖୁସି|ବହୁତ ଭଲ|बधाई|congratulations|excited|yay|ବଢ଼ିଆ|मजा आ/.test(blob);

  if (empathy && !laugh) {
    pace = Math.min(pace, 0.92);
    temperature = 0.7;
    emotion = 'empathy';
  } else if (laugh) {
    pace = Math.max(pace, 1.04);
    temperature = 0.82;
    emotion = 'humor';
  } else if (surprise) {
    pace = Math.max(pace, 1.05);
    temperature = 0.8;
    emotion = 'surprise';
  } else if (happy) {
    pace = Math.max(pace, 1.06);
    temperature = 0.78;
    emotion = 'happy';
  }

  return {
    text: spoken,
    emotion,
    pace: clamp(pace, PACE_MIN, PACE_MAX),
    temperature: clamp(temperature, TEMP_MIN, TEMP_MAX),
  };
}

/**
 * Odia-mode STT sometimes spells English in Odia letters ("ଆର୍ ୟୁ ଦେୟାର୍").
 * Two or more of these fragments means the utterance should be heard again
 * with language detection, so English, Hindi, and Hinglish are not forced into Odia.
 */
function looksLikeForeignInOdia(text) {
  const value = String(text || '');
  if (!/[\u0B00-\u0B7F]/.test(value)) return false;
  const hits = value.match(/ଆର୍|ୟୁ|କେନ୍|ହାର୍|ହେଲ୍ପ|ପ୍ଲିଜ୍|ହାଲୋ|ୱାଟ୍|ହାଉ|ଥ୍ୟାଙ୍କ|ଓକେ|ହାଏ|ଦେୟାର୍|ଦେହା|ୱାଏ|ନାଟ୍|ପ୍ଲାନ୍|ବ୍ରୋ/g);
  return Boolean(hits && hits.length >= 2);
}

function looksLikeLedger(text) {
  const value = String(text || '');
  if (/[0-9\u0B66-\u0B6F\u0966-\u096F]/.test(value)) return true;
  return /ଟଙ୍କା|ଉଧାର|ବାକି|ବିକ୍ରି|କିଣ|₹|rupees?|rs\.?|rupay|टका|उधार|बिक्री|credit|sale|purchase/i.test(value);
}

function needsKnowledge(text) {
  return /ଯୋଜନା|scheme|subhadra|ସୁଭଦ୍ରା|ration|ରେସନ|certificate|ପ୍ରମାଣ|kalia|କାଳିଆ|pension|ପେନସନ|bsky|yojana|yojna|राशन|योजना|सुभद्रा|दस्तावेज|document/i.test(text || '');
}

module.exports = {
  clamp,
  languageCode,
  detectSpokenLanguage,
  prepareSpeechText,
  forUtterance,
  looksLikeForeignInOdia,
  looksLikeLedger,
  needsKnowledge,
};
