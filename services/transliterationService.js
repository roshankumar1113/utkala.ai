/**
 * transliterationService.js
 * Detects, converts, and clarifies Odia transliteration (Romanized Odia -> Native Odia Script) using Gemini.
 */

require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

let ai;
try {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} catch (err) {
  console.error('[TransliterationService] GenAI init error:', err.message);
}

const TRANSLITERATION_SYSTEM_PROMPT = `
You are a language accuracy assistant for Odia conversations.

### YOUR JOB: DETECT & CLARIFY ODIA TRANSLITERATION
When a user sends input in transliterated Odia (like "tame kenta achho" or "mu student chu"), you must:

1. RECOGNIZE IT'S TRANSLITERATED ODIA
   - Input like "tame", "mu", "achho", "chu", "korchho", "kemiti", "bhalu", "bhau" = transliterated Odia
   - NOT English, NOT random text

2. CONVERT TO NATIVE ODIA SCRIPT
   - "tame kenta achho?" → "ତମେ କେତେ ଆଛି?" / "ତମେ କେମିତି ଅଛ?"
   - "mu student chu" → "ମୁ ଛାତ୍ର ଛୁ"
   - "dhoka bandha" → "ଦୋକା ବନ୍ଦ"

3. CLARIFY BEFORE PROCEEDING
   - Show the conversion: "ଆପଣ ଏହା ଅର୍ଥ କହୁଛନ୍ତି, ଠିକ ଅଛି? [Native script]"
   - If ambiguous, ask: "ତମେ ଯାହା ଲେଖିଛ, ତାର ଅର୍ଥ ହେଉଛି... ଠିକ ଅଛି?"
   - Once confirmed, provide the converted native Odia text.

### OUTPUT JSON FORMAT
Always respond in strict JSON format:
{
  "isTransliterated": true | false,
  "isEnglish": true | false,
  "isGibberish": true | false,
  "needsClarification": true | false,
  "convertedScript": "Native Odia Script conversion here",
  "clarificationText": "Odia clarification message to user (e.g., 'ଆପଣ ଏହା ଅର୍ଥ କହୁଛନ୍ତି, ଠିକ ଅଛି? [ତମେ କେମିତି ଅଛ?]')"
}
`;

const FALLBACK_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
];



/**
 * Checks if a string contains Odia script characters (\u0B00-\u0B7F).
 * @param {string} text
 * @returns {boolean}
 */
function isNativeOdiaScript(text) {
  return /[\u0B00-\u0B7F]/.test(text);
}

/**
 * Checks if text is likely transliterated Odia or needs analysis.
 * @param {string} text
 * @returns {Promise<Object>}
 */
async function detectAndClarifyTransliteration(text) {
  if (!text || typeof text !== 'string' || text.trim() === '') {
    return {
      isTransliterated: false,
      needsClarification: false,
      convertedScript: text,
      clarificationText: '',
    };
  }

  // If text already has substantial Odia script, skip transliteration
  if (isNativeOdiaScript(text)) {
    return {
      isTransliterated: false,
      needsClarification: false,
      convertedScript: text,
      clarificationText: '',
    };
  }

  // If GenAI is not initialized, return original
  if (!ai) {
    return {
      isTransliterated: false,
      needsClarification: false,
      convertedScript: text,
      clarificationText: '',
    };
  }

  // Run through Gemini for transliteration detection & conversion
  for (const model of FALLBACK_MODELS) {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Transliteration timeout')), 6000)
      );

      const prompt = `Analyze this user message for Odia transliteration: "${text}"`;

      const apiCall = ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: TRANSLITERATION_SYSTEM_PROMPT,
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      });

      const response = await Promise.race([apiCall, timeoutPromise]);
      const rawText = response?.text?.trim();

      if (rawText) {
        const parsed = JSON.parse(rawText);
        return {
          isTransliterated: !!parsed.isTransliterated,
          isEnglish: !!parsed.isEnglish,
          isGibberish: !!parsed.isGibberish,
          needsClarification: !!parsed.needsClarification,
          convertedScript: parsed.convertedScript || text,
          clarificationText: parsed.clarificationText || (parsed.convertedScript ? `ଆପଣ ଏହା ଅର୍ଥ କହୁଛନ୍ତି, ଠିକ ଅଛି? [${parsed.convertedScript}]` : ''),
        };
      }
    } catch (err) {
      console.warn(`[TransliterationService] Model ${model} failed: ${err.message}`);
    }
  }

  // Fallback if all models fail
  return {
    isTransliterated: false,
    needsClarification: false,
    convertedScript: text,
    clarificationText: '',
  };
}

module.exports = {
  detectAndClarifyTransliteration,
  isNativeOdiaScript,
  TRANSLITERATION_SYSTEM_PROMPT,
};
