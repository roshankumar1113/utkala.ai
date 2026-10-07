/**
 * Resolves Gemini / Sarvam keys and reports which ones are set.
 * Never prints secret values.
 */

function raw(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function present(name) {
  const value = raw(name);
  if (!value) return false;
  if (/your_|placeholder|changeme|example/i.test(value)) return false;
  return true;
}

function ttsKey() {
  return raw('SARVAM_TTS_API_KEY') || raw('SARVAM_API_KEY');
}

function sttKey() {
  return raw('SARVAM_STT_API_KEY') || raw('SARVAM_API_KEY');
}

function logKeyStatus() {
  const status = {
    GEMINI_API_KEY: present('GEMINI_API_KEY'),
    SARVAM_API_KEY: present('SARVAM_API_KEY'),
    SARVAM_TTS_API_KEY: present('SARVAM_TTS_API_KEY'),
    SARVAM_STT_API_KEY: present('SARVAM_STT_API_KEY'),
    ttsReady: Boolean(ttsKey()) && (present('SARVAM_TTS_API_KEY') || present('SARVAM_API_KEY')),
    sttReady: Boolean(sttKey()) && (present('SARVAM_STT_API_KEY') || present('SARVAM_API_KEY')),
  };
  console.log(`[Keys] configured (values hidden): ${JSON.stringify(status)}`);
  if (!status.GEMINI_API_KEY) console.warn('[Keys] GEMINI_API_KEY is missing or still a placeholder.');
  if (!status.ttsReady) console.warn('[Keys] No Sarvam TTS key. Set SARVAM_TTS_API_KEY or SARVAM_API_KEY.');
  if (!status.sttReady) console.warn('[Keys] No Sarvam STT key. Set SARVAM_STT_API_KEY or SARVAM_API_KEY.');
  return status;
}

module.exports = { present, ttsKey, sttKey, logKeyStatus };
