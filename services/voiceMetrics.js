/**
 * voiceMetrics.js
 * Structured, secret-free logging for voice turns so real latency can be
 * measured (the spec asks for TTFT / time-to-first-transcript / etc).
 *
 * Emits single-line JSON to stdout under a stable event name. Never logs API
 * keys, audio bytes, or full user content.
 */

function now() {
  return Date.now();
}

/**
 * Create a per-turn timer/collector.
 * @param {Object} ctx - { sessionId, userId, language, sttProvider, model }
 */
function startTurn(ctx = {}) {
  const t0 = now();
  const marks = {};
  const data = {
    sessionId: ctx.sessionId || null,
    userId: ctx.userId || null,
    language: ctx.language || null,
    sttProvider: ctx.sttProvider || null,
    model: ctx.model || null,
    interrupted: false,
    errorCode: null,
  };

  return {
    mark(name) {
      marks[name] = now() - t0;
    },
    set(key, value) {
      data[key] = value;
    },
    markInterrupted() {
      data.interrupted = true;
    },
    fail(errorCode) {
      data.errorCode = errorCode;
    },
    /** Emit the structured completion event. */
    complete(extra = {}) {
      const event = {
        event: 'voice_turn_complete',
        ...data,
        ...extra,
        timeToFirstTranscriptMs: marks.firstTranscript ?? null,
        sttLatencyMs: marks.sttDone ?? null,
        aiFirstTokenMs: marks.aiFirstToken ?? null,
        aiLatencyMs: marks.aiDone ?? null,
        ttsFirstAudioMs: marks.ttsFirstAudio ?? null,
        ttsLatencyMs: marks.ttsDone ?? null,
        totalLatencyMs: now() - t0,
      };
      // Single-line JSON for log ingestion.
      console.log(JSON.stringify(event));
      return event;
    },
  };
}

module.exports = { startTurn };
