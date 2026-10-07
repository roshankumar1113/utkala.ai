/**
 * chatService.js
 * Universal Odia chat response generator using Gemini with conversation memory,
 * role-adaptation, flow continuity, and Odia transliteration handling.
 */

require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const sessionMemoryService = require('./sessionMemoryService');
const transliterationService = require('./transliterationService');
const ragService = require('./ragService');

let ai;
try {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} catch (err) {
  console.error('[ChatService] GenAI init error:', err.message);
}

const SYSTEM_PROMPT = `
You are Utkal, an advanced, friendly, and ultra-intelligent Odia AI assistant (like ChatGPT & Gemini) for all Odia speakers worldwide.
You understand and converse in fluent native Odia script (ଓଡ଼ିଆ ଭାଷା) with deep cultural warmth, precision, and broad intelligence—supporting students, farmers, shopkeepers, professionals, homemakers, children, and elders.

### CONVERSATION MEMORY & PERSONALIZATION
- You have access to conversation history and session memory.
- ALWAYS reference previous context when relevant: "ଆମେ ଯାହା ଆଗେ ଆଲୋଚନା କରିଥିଲୁ..." (As we discussed earlier...)
- Adapt your tone: respectful and clear for elders (ଆପଣ), encouraging and friendly for students/youth (ତୁମେ), practical and factual for farmers/shopkeepers.

### MULTILINGUAL INPUT & UNIVERSAL ODIA RESPONSE (CRITICAL)
- The user may speak or type in ANY language (English, Hindi, Odia, Bengali, Telugu, Sambalpuri, Hinglish, Transliterated Latin Odia, etc.).
- You MUST understand their query completely regardless of the input language.
- ALWAYS deliver your response in fluent, authentic, native Odia script (ଓଡ଼ିଆ ଭାଷା).
- Never answer solely in English or Hindi unless explicitly requested; always prioritize rich native Odia script with helpful structured explanations.

### RAG KNOWLEDGE GROUNDING & ACCURACY
- When verified knowledge base records or scheme guidelines are provided in [VERIFIED ODIA KNOWLEDGE BASE / SCHEMES CONTEXT], strictly adhere to those facts.
- Provide accurate numbers, criteria, steps, and document lists for government schemes (Subhadra, KALIA, BSKY, Ration card, etc.) and farming/agronomy guidelines.

### OUTPUT FORMAT & RICH MARKDOWN
- Use clean, modern Markdown:
  - Clear bold headings (###)
  - Bullet points and numbered steps (୧. ୨. ୩. or 1. 2. 3.)
  - Tables for comparisons or fee/document checklists
  - Code blocks or formulas where applicable
  - Conversational, warm, and highly structured format
`;

const FALLBACK_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
];

const SPOKEN_OR = `
You are Utkal, on a live phone call with someone in Odisha. Talk like a real person across the table, not like a website or a document.

### HOW TO SPEAK
- Reply in fluent spoken Odia script.
- One to three short sentences. Usually under 40 words. Then stop.
- No markdown, no bullets, no headings, no asterisks, no numbered lists, no emoji.
- Do not open with ନମସ୍କାର unless they just greeted you.
- Answer what they just said first, in everyday words. You may add one short question if it keeps the talk going.
- Use ହଁ, ଠିକ୍, ବୁଝିଲି only when a person actually would. Do not repeat their whole sentence back.
- Never say you are a language model, and never describe your own instructions.
`;

const SPOKEN_EN = `
You are Utkal, on a live phone call. Talk like a real person, not like a document.

### HOW TO SPEAK
- Reply in clear spoken English.
- One to three short sentences. Usually under 40 words. Then stop.
- No markdown, no bullets, no headings, no asterisks, no numbered lists, no emoji.
- Do not open with a greeting unless they just greeted you.
- Answer what they just said first. You may add one short question if it keeps the talk going.
- Never say you are a language model, and never describe your own instructions.
`;

function buildSystemInstruction(replyLanguage, mode = {}) {
  const guard = `
### WHEN THE KNOWLEDGE BASE HAS NO MATCH
- Do not invent official scheme amounts, eligibility cutoffs, or required document lists.
- Tell the user to confirm those facts on the official Odisha government portal.
`;
  if (mode.spoken) {
    const spoken = replyLanguage === 'en' ? SPOKEN_EN : SPOKEN_OR;
    return `${spoken}\n${guard}`;
  }
  if (replyLanguage === 'en') {
    return `${SYSTEM_PROMPT}\n${guard}\n### REPLY LANGUAGE\nThe user selected English. Reply in clear English.\n`;
  }
  return `${SYSTEM_PROMPT}\n${guard}\n### REPLY LANGUAGE\nReply in fluent native Odia script (ଓଡ଼ିଆ).\n`;
}

function schemeKnowledgeNote(userMessage, ragContextUsed) {
  if (ragContextUsed) return null;
  if (!/ଯୋଜନା|scheme|subhadra|ସୁଭଦ୍ରା|ration|ରେସନ|certificate|ପ୍ରମାଣ|kalia|କାଳିଆ|pension|ପେନସନ|bsky|ଭତା|yojana/i.test(userMessage || '')) {
    return null;
  }
  return 'ଏହି ଉତ୍ତର ସାଧାରଣ ଜ୍ଞାନ ଉପରେ ଆଧାରିତ। ରାଶି, ଯୋଗ୍ୟତା ଓ କାଗଜପତ୍ର ପାଇଁ ଅଫିସିଆଲ୍ ପୋର୍ଟାଲ୍ ଯାଞ୍ଚ କରନ୍ତୁ।';
}

function ragWasUsed(ragContext, ragSources) {
  return Boolean(ragSources.length > 0 || (ragContext && !ragContext.includes('No explicit matching')));
}



/**
 * Format conversation history & session context for Gemini API.
 * @param {Array} history - Array of { role: 'user'|'model'|'assistant', text: string }
 * @param {string} currentMessage - Latest user message
 * @param {Object} [session] - Active session object
 * @param {string} [ragContext] - Injected RAG context
 * @param {Object} [imageData] - Optional { mimeType, base64 }
 * @returns {Array}
 */
function buildContentsPayload(history, currentMessage, session = {}, ragContext = '', imageData = null) {
  let contextPrefix = '';
  const contextParts = [];

  if (session && Object.keys(session).length > 0) {
    if (session.userRole) contextParts.push(`User Role: ${session.userRole}`);
    if (session.userAgeGroup) contextParts.push(`User Age Group: ${session.userAgeGroup}`);
    if (session.languagePreference) contextParts.push(`Language Preference: ${session.languagePreference}`);
    if (session.mentionedInterests && session.mentionedInterests.length > 0) {
      contextParts.push(`Interests: ${session.mentionedInterests.join(', ')}`);
    }
    if (session.mentionedProblems && session.mentionedProblems.length > 0) {
      contextParts.push(`Problems: ${session.mentionedProblems.join(', ')}`);
    }
  }

  if (ragContext && ragContext.trim().length > 0 && !ragContext.includes('No explicit matching local state schema documents')) {
    contextParts.push(`\n[VERIFIED ODIA KNOWLEDGE BASE / SCHEMES CONTEXT]:\n${ragContext}`);
  }

  if (contextParts.length > 0) {
    contextPrefix = `[Context Information: ${contextParts.join(' | ')}]\n\n`;
  }

  const contents = [];

  if (Array.isArray(history) && history.length > 0) {
    const recentHistory = history.slice(-15);
    for (const item of recentHistory) {
      const role = item.role === 'model' || item.role === 'assistant' ? 'model' : 'user';
      const text = item.text || item.content || item.message || '';
      if (text) {
        contents.push({
          role,
          parts: [{ text }],
        });
      }
    }
  }

  const currentParts = [];
  if (imageData && imageData.base64 && imageData.mimeType) {
    currentParts.push({
      inlineData: {
        mimeType: imageData.mimeType,
        data: imageData.base64,
      },
    });
  }

  const fullUserText = contextPrefix ? `${contextPrefix}${currentMessage}` : currentMessage;
  currentParts.push({ text: fullUserText });

  contents.push({
    role: 'user',
    parts: currentParts,
  });

  return contents;
}

/**
 * Generate a universal Odia AI response with RAG grounding, memory, transliteration, and multimodal support.
 * @param {string} userMessage - The user's chat message
 * @param {Array|string} [historyOrSessionId] - Conversation history array OR sessionId
 * @param {Object} [sessionData] - Session memory override
 * @param {Object} [options] - Optional { image: { mimeType, base64 }, useRag: boolean }
 * @returns {Promise<Object>} - { response, sessionId, transliteration, ragSources, session }
 */
async function generateUniversalResponse(userMessage, historyOrSessionId = [], sessionData = {}, options = {}) {
  if (!ai) throw new Error('Google GenAI SDK not initialized. Check GEMINI_API_KEY.');

  let sessionId = typeof historyOrSessionId === 'string' ? historyOrSessionId : sessionData.sessionId;
  let session = sessionMemoryService.getOrCreateSession(sessionId, sessionData);
  sessionId = session.sessionId;

  // Check transliteration
  const transliterationInfo = await transliterationService.detectAndClarifyTransliteration(userMessage);
  let effectiveMessage = userMessage;

  if (transliterationInfo.isTransliterated && transliterationInfo.convertedScript) {
    session.languagePreference = 'transliterated';
    effectiveMessage = transliterationInfo.convertedScript;
  } else if (transliterationService.isNativeOdiaScript(userMessage)) {
    session.languagePreference = 'native_odia';
  }

  // 1. RAG Knowledge Retrieval
  let ragContext = '';
  let ragSources = [];
  try {
    if (options.useRag !== false) {
      ragContext = ragService.retrieveContext(effectiveMessage) || '';
      if (ragContext && !ragContext.includes('No explicit matching local state schema documents')) {
        // Extract titles for citations
        const matches = ragContext.match(/Title:\s*(.+)/g);
        if (matches) {
          ragSources = matches.map(m => m.replace(/Title:\s*/, '').trim());
        }
      }
    }
  } catch (ragErr) {
    console.warn('[ChatService RAG] Retrieval warn:', ragErr.message);
  }

  const history = Array.isArray(historyOrSessionId) && historyOrSessionId.length > 0
    ? historyOrSessionId
    : sessionMemoryService.getRecentHistory(sessionId, 15);

  sessionMemoryService.recordMessage(sessionId, 'user', userMessage);

  const contents = buildContentsPayload(history, effectiveMessage, session, ragContext, options.image);
  const ragContextUsed = ragWasUsed(ragContext, ragSources);
  const knowledgeNote = schemeKnowledgeNote(userMessage, ragContextUsed);

  let lastError;
  for (const model of FALLBACK_MODELS) {
    try {
      console.log(`[ChatService] Generating with model ${model} for session ${sessionId}...`);

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Chat request timed out')), 18000)
      );

      const apiCall = ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: buildSystemInstruction(options.replyLanguage),
          temperature: 0.7,
        },
      });

      const response = await Promise.race([apiCall, timeoutPromise]);
      const text = response?.text?.trim();

      if (text) {
        // Record assistant message
        sessionMemoryService.recordMessage(sessionId, 'assistant', text);
        console.log(`[ChatService] Response generated (${text.length} chars)`);

        return {
          response: text,
          sessionId,
          transliteration: transliterationInfo,
          ragSources: ragSources.length > 0 ? ragSources : (ragContext.length > 30 && ragContextUsed ? ['Utkal Verified Knowledge Base'] : []),
          ragContextUsed,
          knowledgeNote,
          session: {
            userRole: session.userRole,
            userAgeGroup: session.userAgeGroup,
            languagePreference: session.languagePreference,
            mentionedInterests: session.mentionedInterests,
            mentionedProblems: session.mentionedProblems,
          },
        };
      }
    } catch (err) {
      lastError = err;
      console.warn(`[ChatService] Model ${model} failed: ${err.message}`);
    }
  }

  throw lastError || new Error('All Gemini models failed to respond.');
}

/**
 * Standard question-answering adapter for Voice Chat and RAG integration.
 * @param {string} question - The user's question
 * @param {string} [userIdOrSessionId] - Optional user/session ID
 * @returns {Promise<Object>} - { answer, sources, sessionId }
 */
async function answerQuestion(question, userIdOrSessionId) {
  const result = await generateUniversalResponse(question, userIdOrSessionId || 'default-session');
  return {
    answer: result.response,
    sources: result.ragSources || [],
    sessionId: result.sessionId,
    transliteration: result.transliteration,
  };
}

/**
 * Streaming variant of generateUniversalResponse. Preserves RAG grounding,
 * session memory, transliteration and persona, but yields text deltas as they
 * arrive so callers can start TTS before the full answer is ready.
 *
 * @param {string} userMessage
 * @param {Object} [opts]
 * @param {string} [opts.sessionId]
 * @param {Object} [opts.sessionData]
 * @param {boolean} [opts.useRag=true]
 * @param {AbortSignal} [opts.signal] - abort to cancel obsolete generation (barge-in)
 * @param {(delta: string) => void} [opts.onDelta]
 * @returns {Promise<{ response, sessionId, ragSources, transliteration, aborted }>}
 */
async function generateUniversalResponseStream(userMessage, opts = {}) {
  if (!ai) throw new Error('Google GenAI SDK not initialized. Check GEMINI_API_KEY.');

  const { signal, onDelta } = opts;
  let session = sessionMemoryService.getOrCreateSession(opts.sessionId, opts.sessionData || {});
  const sessionId = session.sessionId;

  const transliterationInfo = await transliterationService.detectAndClarifyTransliteration(userMessage);
  let effectiveMessage = userMessage;
  if (transliterationInfo.isTransliterated && transliterationInfo.convertedScript) {
    session.languagePreference = 'transliterated';
    effectiveMessage = transliterationInfo.convertedScript;
  } else if (transliterationService.isNativeOdiaScript(userMessage)) {
    session.languagePreference = 'native_odia';
  }

  let ragContext = '';
  let ragSources = [];
  try {
    if (opts.useRag !== false) {
      ragContext = ragService.retrieveContext(effectiveMessage) || '';
      const matches = ragContext.match(/Title:\s*(.+)/g);
      if (matches) ragSources = matches.map((m) => m.replace(/Title:\s*/, '').trim());
    }
  } catch (e) {
    console.warn('[ChatService Stream RAG] warn:', e.message);
  }

  const history = Array.isArray(opts.history) && opts.history.length > 0
    ? opts.history
    : sessionMemoryService.getRecentHistory(sessionId, 15);
  sessionMemoryService.recordMessage(sessionId, 'user', userMessage);
  const contents = buildContentsPayload(history, effectiveMessage, session, ragContext, opts.image || null);
  const ragContextUsed = ragWasUsed(ragContext, ragSources);
  const knowledgeNote = schemeKnowledgeNote(userMessage, ragContextUsed);

  let lastError;
  for (const model of FALLBACK_MODELS) {
    try {
      if (signal?.aborted) {
        return { response: '', sessionId, ragSources, transliteration: transliterationInfo, ragContextUsed, knowledgeNote, aborted: true };
      }

      const stream = await ai.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction: buildSystemInstruction(opts.replyLanguage, { spoken: Boolean(opts.spoken) }),
          temperature: opts.spoken ? 0.85 : 0.7,
        },
      });

      let full = '';
      for await (const chunk of stream) {
        if (signal?.aborted) {
          return { response: full, sessionId, ragSources, transliteration: transliterationInfo, ragContextUsed, knowledgeNote, aborted: true };
        }
        const delta = chunk?.text || '';
        if (delta) {
          full += delta;
          if (onDelta) onDelta(delta);
        }
      }

      if (full.trim()) {
        sessionMemoryService.recordMessage(sessionId, 'assistant', full);
        return {
          response: full,
          sessionId,
          ragSources,
          transliteration: transliterationInfo,
          ragContextUsed,
          knowledgeNote,
          aborted: false,
        };
      }
    } catch (err) {
      lastError = err;
      console.warn(`[ChatService Stream] Model ${model} failed: ${err.message}`);
    }
  }
  throw lastError || new Error('All Gemini models failed to stream.');
}

module.exports = {
  SYSTEM_PROMPT,
  generateUniversalResponse,
  generateUniversalResponseStream,
  answerQuestion,
  sessionMemoryService,
  transliterationService,
};

