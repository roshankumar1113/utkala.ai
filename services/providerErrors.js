/**
 * providerErrors.js
 * Classifies errors from external AI providers (Gemini, Sarvam) into a stable
 * taxonomy so callers can decide whether to retry, fall back, or surface a
 * friendly message. Centralizes the 429 / quota handling the old pipeline
 * lacked (it just console.warn'd and retried aggressively).
 */

/**
 * @typedef {Object} ClassifiedError
 * @property {number|null} status       HTTP status if known
 * @property {string} code              Stable code: RATE_LIMITED, AUTH, FORBIDDEN,
 *                                       TIMEOUT, SERVER, NETWORK, UNKNOWN
 * @property {boolean} retryable        Safe to retry (possibly after delay)?
 * @property {boolean} quotaExhausted   True for 429 RESOURCE_EXHAUSTED
 * @property {number|null} retryAfterMs Suggested wait before retry, if provided
 * @property {string} message           Original-ish message (no secrets)
 * @property {string} userMessage       Friendly Odia-safe message for the client
 */

function parseRetryAfter(headers = {}) {
  const raw = headers['retry-after'] || headers['Retry-After'];
  if (!raw) return null;
  const asNum = Number(raw);
  if (!Number.isNaN(asNum)) return Math.max(0, asNum * 1000);
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

/**
 * Classify an arbitrary thrown error / axios error / SDK error.
 * @param {any} err
 * @returns {ClassifiedError}
 */
function classify(err) {
  const status =
    err?.response?.status ??
    err?.status ??
    (Number.isInteger(err?.code) ? err.code : null);

  const headers = err?.response?.headers || {};
  const rawMsg =
    err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.message ||
    'Unknown provider error';

  const msg = String(rawMsg);
  const isTimeout =
    /timeout|timed out|ETIMEDOUT|ECONNABORTED/i.test(msg) || status === 408;
  const isNetwork =
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|network/i.test(msg);
  const isQuota =
    status === 429 || /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(msg);

  let code = 'UNKNOWN';
  let retryable = false;
  let quotaExhausted = false;
  let userMessage =
    'ସେବା ସାମୟିକ ଭାବରେ ଅନୁପଲବ୍ଧ। ଦୟାକରି ପୁଣିଥରେ ଚେଷ୍ଟା କରନ୍ତୁ।';

  if (isQuota) {
    code = 'RATE_LIMITED';
    retryable = true; // retryable, but only after Retry-After / backoff
    quotaExhausted = true;
    userMessage =
      'ସେବା ବର୍ତ୍ତମାନ ବ୍ୟସ୍ତ ଅଛି (quota)। ଦୟାକରି କିଛି ସମୟ ପରେ ଚେଷ୍ଟା କରନ୍ତୁ।';
  } else if (status === 401) {
    code = 'AUTH';
    userMessage = 'ସେବା ପ୍ରାମାଣିକରଣ ବିଫଳ ହେଲା।';
  } else if (status === 403) {
    code = 'FORBIDDEN';
    userMessage = 'ଏହି ସେବା ପାଇଁ ଅନୁମତି ନାହିଁ।';
  } else if (isTimeout) {
    code = 'TIMEOUT';
    retryable = true;
    userMessage = 'ସେବା ଉତ୍ତର ଦେବାରେ ବିଳମ୍ବ ହେଲା। ଦୟାକରି ପୁଣିଥରେ ଚେଷ୍ଟା କରନ୍ତୁ।';
  } else if (isNetwork) {
    code = 'NETWORK';
    retryable = true;
    userMessage = 'ନେଟୱର୍କ ସମସ୍ୟା ହେଉଛି। ଦୟାକରି ପୁଣିଥରେ ଚେଷ୍ଟା କରନ୍ତୁ।';
  } else if (status && status >= 500) {
    code = 'SERVER';
    retryable = true;
  } else if (status && status >= 400) {
    code = 'CLIENT';
  }

  return {
    status: status || null,
    code,
    retryable,
    quotaExhausted,
    retryAfterMs: parseRetryAfter(headers),
    message: msg.slice(0, 300),
    userMessage,
  };
}

module.exports = { classify, parseRetryAfter };
