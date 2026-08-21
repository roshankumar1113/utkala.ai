/**
 * sessionMemoryService.js
 * Manages user session state, conversation history, and profile extraction for Utkal AI.
 */

const crypto = require('crypto');

// In-memory session store: Map<sessionId, SessionObject>
const sessions = new Map();

// Session expiry time (24 hours)
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Creates or retrieves a session object.
 * @param {string} [sessionId] - Unique session identifier
 * @param {Object} [initialData] - Optional initial user context
 * @returns {Object} Session object
 */
function getOrCreateSession(sessionId, initialData = {}) {
  let id = sessionId;
  if (!id || typeof id !== 'string') {
    id = require('crypto').randomUUID ? require('crypto').randomUUID() : `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  let session = sessions.get(id);
  if (!session) {
    session = {
      sessionId: id,
      userId: initialData.userId || 'anonymous',
      userRole: initialData.userRole || initialData.user_role || null, // ଛାତ୍ର/ଚାକିରିଆ/କୃଷକ/ଗୃହିଣୀ/ବିଦ୍ୟାର୍ଥୀ/ବୟସ୍କ/ଅନ୍ୟ
      userAgeGroup: initialData.userAgeGroup || initialData.user_age_group || null, // child/teen/adult/elder
      languagePreference: initialData.languagePreference || initialData.language_preference || 'native_odia', // native_odia | transliterated
      messages: [], // [{ role: 'user'|'assistant', content: string, timestamp: string }]
      mentionedInterests: initialData.mentionedInterests || initialData.mentioned_interests || [],
      mentionedProblems: initialData.mentionedProblems || initialData.mentioned_problems || [],
      previousTopics: initialData.previousTopics || initialData.previous_topics || [],
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    sessions.set(id, session);
  } else {
    session.lastActiveAt = new Date().toISOString();
    // Merge any newly provided userContext attributes
    if (initialData.userRole || initialData.user_role) session.userRole = initialData.userRole || initialData.user_role;
    if (initialData.userAgeGroup || initialData.user_age_group) session.userAgeGroup = initialData.userAgeGroup || initialData.user_age_group;
  }

  return session;
}

/**
 * Extract heuristic user context clues from message text.
 * @param {string} text - Message text
 * @param {Object} session - Session object to mutate
 */
function extractContextClues(text, session) {
  if (!text) return;
  const lower = text.toLowerCase();

  // Role detection heuristics
  if (/ଛାତ୍ର|student|ପଢା|କ୍ଲାସ|class|ପରୀକ୍ଷା|exam|ମ୍ୟାଥ|math|ସାହିତ୍ୟ|literature|କଲେଜ|college|ସ୍କୁଲ|school/i.test(text)) {
    if (!session.userRole) session.userRole = 'ଛାତ୍ର';
    if (!session.userAgeGroup) session.userAgeGroup = 'teen';
  } else if (/ଚାଷୀ|କୃଷକ|farmer|ଖେତ|ଜମି|ଧାନ|ଫସଲ|କୀଟନାଶକ|ସାର|ବିହନ|ପୋକ/i.test(text)) {
    if (!session.userRole) session.userRole = 'କୃଷକ';
    if (!session.userAgeGroup) session.userAgeGroup = 'adult';
  } else if (/ଗୃହିଣୀ|homemaker|ରେସିପି|recipe|ରୋଷେଇ|ତରକାରୀ|ମସଲା|ଘରକରଣା/i.test(text)) {
    if (!session.userRole) session.userRole = 'ଗୃହିଣୀ';
    if (!session.userAgeGroup) session.userAgeGroup = 'adult';
  } else if (/ବୟସ୍କ|elder|ବୁଢ଼ା|ଠାକୁର|ପୂଜା|ବାତ|ଆଣ୍ଠୁ|ପେନସନ/i.test(text)) {
    if (!session.userRole) session.userRole = 'ବୟସ୍କ';
    if (!session.userAgeGroup) session.userAgeGroup = 'elder';
  } else if (/ଚାକିରି|job|office|କମ୍ପାନୀ|ଦରମା|salary/i.test(text)) {
    if (!session.userRole) session.userRole = 'ଚାକିରିଆ';
    if (!session.userAgeGroup) session.userAgeGroup = 'adult';
  }

  // Interest detection heuristics
  const interestKeywords = [
    { key: 'ଖେତି', regex: /ଚାଷ|ଖେତି|ଧାନ|ଫସଲ/i },
    { key: 'ପଢା', regex: /ପଢା|ସାହିତ୍ୟ|ଗଣିତ|ଇଂରାଜୀ|ବିଜ୍ଞାନ/i },
    { key: 'ସ୍ୱାସ୍ଥ୍ୟ', regex: /ସ୍ୱାସ୍ଥ୍ୟ|ରୋଗ|ଔଷଧ|ଡାକ୍ତର|ଦରଜ|କାଶ/i },
    { key: 'ରାଧୁନୀ', regex: /ରେସିପି|ରୋଷେଇ|ମସଲା/i },
    { key: 'ପରିବାର', regex: /ପରିବାର|ପିଲା|ଭାଇ|ବାପା|ମାଆ/i },
  ];
  for (const item of interestKeywords) {
    if (item.regex.test(text) && !session.mentionedInterests.includes(item.key)) {
      session.mentionedInterests.push(item.key);
    }
  }

  // Problem detection heuristics
  const problemKeywords = [
    { key: 'ରୋଗ', regex: /ରୋଗ|ଦରଜ|କାଶ|ଜ୍ୱର|ବିନ୍ଧା/i },
    { key: 'ପୋକ/ଶିଙ୍ଗାଡ଼ି', regex: /ପୋକ|ଶିଙ୍ଗାଡ଼ି|କୀଟ/i },
    { key: 'ପାଠ ସମସ୍ୟା', regex: /ବୁଝିପାରୁନି|ଅଙ୍କ ହେଉନି|ଭୟ ଲାଗୁଛି/i },
  ];
  for (const item of problemKeywords) {
    if (item.regex.test(text) && !session.mentionedProblems.includes(item.key)) {
      session.mentionedProblems.push(item.key);
    }
  }
}

/**
 * Record a message in session history and update metadata.
 * @param {string} sessionId
 * @param {'user'|'assistant'} role
 * @param {string} content
 */
function recordMessage(sessionId, role, content) {
  const session = getOrCreateSession(sessionId);
  
  if (role === 'user') {
    extractContextClues(content, session);
  }

  session.messages.push({
    role,
    content,
    timestamp: new Date().toISOString(),
  });

  // Keep last 30 messages in storage
  if (session.messages.length > 30) {
    session.messages = session.messages.slice(-30);
  }
  
  session.lastActiveAt = new Date().toISOString();
  return session;
}

/**
 * Get conversation history formatted for context injection (last 15 messages).
 * @param {string} sessionId
 * @returns {Array} List of { role, content }
 */
function getRecentHistory(sessionId, limit = 15) {
  const session = getOrCreateSession(sessionId);
  return session.messages.slice(-limit).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    text: m.content,
  }));
}

/**
 * Clean expired sessions periodically.
 */
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (now - new Date(s.lastActiveAt).getTime() > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}, 60 * 60 * 1000).unref();

module.exports = {
  getOrCreateSession,
  recordMessage,
  getRecentHistory,
  extractContextClues,
  sessions,
};
