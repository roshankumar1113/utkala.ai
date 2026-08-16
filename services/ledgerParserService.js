/**
 * ledgerParserService.js
 * Parses Odia transaction text using Gemini and extracts structured JSON.
 */

require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

let ai;
try {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} catch (err) {
  console.error('[LedgerParser] GenAI init error:', err.message);
}

const SYSTEM_PROMPT = `
You are an expert Odia language business transaction parser for small shopkeepers and MSMEs in Odisha.
Your task: Extract structured transaction data from spoken/written Odia text.

OUTPUT RULES:
1. Always return ONLY valid JSON — no markdown, no explanation.
2. JSON must have exactly these keys: action, party, amount, item, payment_type
3. action values: SALE | PURCHASE | RECEIVE_CASH | PAY_CASH | CREDIT_GIVEN | UNKNOWN
4. payment_type values: CASH | CREDIT | ONLINE | UNKNOWN
5. amount must be a number (integer or float), 0 if unknown
6. party and item: short strings or "N/A" if not mentioned
7. Never invent details not present in the text.

EXAMPLES:
Input: "ରମେଶଙ୍କୁ ୧୨,୦୦୦ ଟଙ୍କାର ଶାଢ଼ୀ ବାକିରେ ବିକ୍ରି କଲି"
Output: {"action":"SALE","party":"ରମେଶ","amount":12000,"item":"ଶାଢ଼ୀ","payment_type":"CREDIT"}

Input: "ହରି ୫୦୦ ଟଙ୍କା ନଗଦ ଦେଲା"
Output: {"action":"RECEIVE_CASH","party":"ହରି","amount":500,"item":"N/A","payment_type":"CASH"}

Input: "ଶ୍ୟାମ ଭାଇଙ୍କ ଠାରୁ ୨୦୦୦ ଟଙ୍କାର ରାସନ ବାକିରେ ଆଣିଲି"
Output: {"action":"PURCHASE","party":"ଶ୍ୟାମ","amount":2000,"item":"ରାସନ","payment_type":"CREDIT"}

Input: "ରଞ୍ଜନ କୁ ୩୦୦ ଟଙ୍କା ଫୋନପେ ରେ ପଠେଇଲି"
Output: {"action":"PAY_CASH","party":"ରଞ୍ଜନ","amount":300,"item":"N/A","payment_type":"ONLINE"}
`;

// Working Gemini models — verified list only
const FALLBACK_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
];

/**
 * Analyse an Odia transaction text and return structured JSON.
 * @param {string} text - Odia spoken/written transaction text
 * @returns {Promise<Object>} - Structured transaction object
 */
async function analyzeTransaction(text) {
  if (!ai) throw new Error('Google GenAI SDK not initialized. Check GEMINI_API_KEY.');

  let lastError;
  for (const model of FALLBACK_MODELS) {
    try {
      console.log(`[LedgerParser] Trying model: ${model}`);

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini request timed out')), 10000)
      );

      const apiCall = ai.models.generateContent({
        model,
        contents: `Parse this Odia transaction text:\n"${text}"`,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.1,
        },
      });

      const response = await Promise.race([apiCall, timeoutPromise]);
      const raw = response?.text?.trim() || '';

      // Strip markdown code fences if present
      const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();

      const parsed = JSON.parse(jsonStr);
      console.log(`[LedgerParser] Parsed with ${model}:`, parsed);
      return parsed;
    } catch (err) {
      lastError = err;
      console.warn(`[LedgerParser] Model ${model} failed: ${err.message}`);
    }
  }

  // All models failed — return safe default
  console.error('[LedgerParser] All models failed. Returning UNKNOWN transaction.');
  return {
    action: 'UNKNOWN',
    party: 'N/A',
    amount: 0,
    item: 'N/A',
    payment_type: 'UNKNOWN',
  };
}

module.exports = {
  analyzeTransaction,
};
