/**
 * chatService.js
 * Universal Odia chat response generator using Gemini.
 */

require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

let ai;
try {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} catch (err) {
  console.error('[ChatService] GenAI init error:', err.message);
}

const SYSTEM_PROMPT = `
You are Utkal.ai — a warm, helpful AI assistant for Odia-speaking people in Odisha.
You help small shopkeepers, farmers, and citizens with:
- Business ledger and transaction queries
- Government schemes (Subhadra, KALIA, MSME, etc.)
- General knowledge questions in Odia

RULES:
1. Always reply in native Odia script (ଓଡ଼ିଆ).
2. Be concise, friendly, and practical.
3. If asked in English, still reply in Odia script but include a brief English summary at the end.
4. Never invent government scheme details — only share verified information.
`;

const FALLBACK_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
];

/**
 * Generate a universal Odia AI response for a user message.
 * @param {string} userMessage - The user's chat message
 * @returns {Promise<string>} - AI-generated Odia response text
 */
async function generateUniversalResponse(userMessage) {
  if (!ai) throw new Error('Google GenAI SDK not initialized. Check GEMINI_API_KEY.');

  let lastError;
  for (const model of FALLBACK_MODELS) {
    try {
      console.log(`[ChatService] Trying model: ${model}`);

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Chat request timed out')), 15000)
      );

      const apiCall = ai.models.generateContent({
        model,
        contents: userMessage,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.7,
        },
      });

      const response = await Promise.race([apiCall, timeoutPromise]);
      const text = response?.text?.trim();

      if (text) {
        console.log(`[ChatService] Response from ${model} (${text.length} chars)`);
        return text;
      }
    } catch (err) {
      lastError = err;
      console.warn(`[ChatService] Model ${model} failed: ${err.message}`);
    }
  }

  throw lastError || new Error('All Gemini models failed to respond.');
}

module.exports = {
  generateUniversalResponse,
};
