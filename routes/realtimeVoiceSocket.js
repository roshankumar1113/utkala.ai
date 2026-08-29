/**
 * realtimeVoiceSocket.js
 * Realtime Odia voice session over Socket.IO (Utkal.ai Voice 2.0).
 *
 * Attaches to the existing io instance under the '/rt-voice' namespace so it
 * lives alongside — and does not disturb — the legacy voiceChatSocket handlers.
 *
 * Latency win: on end-of-speech we run STT once, then STREAM the Gemini answer
 * and pipe sentence-sized chunks to TTS so audio starts before the full answer
 * is generated. Barge-in (voice:interrupt) aborts generation and tells the
 * client to flush its audio queue immediately.
 *
 * NOTE: True realtime partial transcripts require a streaming STT provider
 * session (e.g. Sarvam saaras realtime). That is stubbed behind
 * SARVAM_REALTIME=1; by default we accumulate PCM chunks and transcribe on
 * voice:stop. This is documented as a known limitation.
 *
 * Event contract — CLIENT → SERVER:
 *   voice:start      { languageMode: 'od-IN' | 'auto' }
 *   voice:audio      { chunk: <base64 PCM16 mono 16k> }
 *   voice:stop       {}                 // end of utterance (manual or VAD)
 *   voice:cancel     {}                 // discard current utterance
 *   voice:interrupt  {}                 // barge-in: stop TTS + abort AI
 *
 * SERVER → CLIENT:
 *   voice:ready, voice:final_transcript, ai:thinking, ai:text_delta,
 *   ai:text_complete, tts:start, tts:audio, tts:end, voice:error, voice:stopped
 */

const chatService = require('../services/chatService');
const voiceService = require('../services/voiceService');
const ledgerParserService = require('../services/ledgerParserService');
const ledgerValidationService = require('../services/ledgerValidationService');
const { SentenceBuffer } = require('../services/sentenceBuffer');
const voiceMetrics = require('../services/voiceMetrics');

const SAMPLE_RATE = 16000;

/** Wrap raw PCM16 mono little-endian bytes in a WAV container. */
function pcmToWav(pcmBuffer, sampleRate = SAMPLE_RATE) {
  const header = Buffer.alloc(44);
  const dataLen = pcmBuffer.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcmBuffer]);
}

module.exports = (io) => {
  const ns = io.of('/rt-voice');

  ns.on('connection', (socket) => {
    const sessionId = `rt-${socket.id}-${Date.now()}`;
    console.log(`✅ [RT-Voice] connected: ${socket.id} (session ${sessionId})`);

    const state = {
      sessionId,
      languageMode: 'od-IN',
      chunks: [],
      abort: null,      // AbortController for in-flight AI generation
      speaking: false,
      turnSeq: 0,
    };

    socket.emit('voice:ready', { sessionId });

    socket.on('voice:start', (data = {}) => {
      state.languageMode = data.languageMode === 'auto' ? 'auto' : 'od-IN';
      state.chunks = [];
      console.log(`🎙️ [RT-Voice] utterance start (mode=${state.languageMode})`);
    });

    socket.on('voice:audio', (data = {}) => {
      const chunk = data.chunk;
      if (!chunk) return;
      try {
        state.chunks.push(Buffer.from(chunk, 'base64'));
      } catch (_) { /* ignore malformed chunk */ }
    });

    socket.on('voice:cancel', () => {
      state.chunks = [];
      socket.emit('voice:stopped', { reason: 'cancelled' });
    });

    // Barge-in: user spoke while Utkal was talking.
    socket.on('voice:interrupt', () => {
      console.log('🛑 [RT-Voice] interrupt (barge-in)');
      if (state.abort) state.abort.abort();
      state.speaking = false;
      socket.emit('voice:stopped', { reason: 'interrupted' });
    });

    socket.on('voice:stop', async () => {
      if (state.chunks.length === 0) {
        socket.emit('voice:error', { error_code: 'STT_EMPTY', message: 'ମୁଁ କିଛି ଶୁଣିପାରିଲି ନାହିଁ।' });
        return;
      }

      // Abort any prior generation still running (new turn supersedes it).
      if (state.abort) state.abort.abort();
      const abort = new AbortController();
      state.abort = abort;
      const turn = ++state.turnSeq;

      const pcm = Buffer.concat(state.chunks);
      state.chunks = [];
      const wav = pcmToWav(pcm, SAMPLE_RATE);

      const metrics = voiceMetrics.startTurn({
        sessionId: state.sessionId,
        language: state.languageMode,
        sttProvider: 'sarvam',
      });

      // --- STT ---
      let transcript;
      try {
        transcript = await voiceService.transcribeAudio(wav, 'utterance.wav', { languageMode: state.languageMode });
        metrics.mark('sttDone');
      } catch (err) {
        metrics.fail(err.errorCode || 'STT_FAILED');
        metrics.complete();
        socket.emit('voice:error', {
          error_code: err.errorCode || 'STT_FAILED',
          message: err.errorCode === 'PROVIDER_QUOTA'
            ? 'ସେବା ବ୍ୟସ୍ତ ଅଛି। ଦୟାକରି କିଛି ସମୟ ପରେ ଚେଷ୍ଟା କରନ୍ତୁ।'
            : 'ମୁଁ ଠିକ୍ ଭାବରେ ଶୁଣିପାରିଲି ନାହିଁ। ଦୟାକରି ପୁଣିଥରେ କୁହନ୍ତୁ।',
        });
        return;
      }

      if (abort.signal.aborted || turn !== state.turnSeq) return;
      socket.emit('voice:final_transcript', { text: transcript });

      // --- Ledger detection + safety (never auto-save, never guess) ---
      try {
        const tx = await ledgerParserService.analyzeTransaction(transcript);
        const isLedger = tx && tx.action !== 'UNKNOWN' && (tx.amount > 0 || tx.party !== 'N/A');
        if (isLedger) {
          const v = ledgerValidationService.validateTransaction(tx);
          const speak = v.valid ? null : v.clarification;
          socket.emit('ai:text_complete', {
            text: v.valid ? 'ଦୟାକରି ନିମ୍ନ କାରବାରକୁ ନିଶ୍ଚିତ କରନ୍ତୁ।' : v.clarification,
            ledger: {
              requiresConfirmation: v.valid,
              requiresClarification: !v.valid,
              transaction: v.normalized,
              missing: v.missing,
            },
          });
          if (!v.valid && speak) {
            await streamTts(speak);
          }
          metrics.set('ledger', true);
          metrics.complete();
          return;
        }
      } catch (e) {
        console.warn('[RT-Voice] ledger parse notice:', e.message);
      }

      // --- Conversational: stream AI + sentence-buffered TTS ---
      socket.emit('ai:thinking', {});
      const sBuf = new SentenceBuffer();
      let firstToken = false;
      let ttsStarted = false;

      const ttsQueue = [];
      let ttsRunning = false;
      async function pumpTts() {
        if (ttsRunning) return;
        ttsRunning = true;
        while (ttsQueue.length && !abort.signal.aborted && turn === state.turnSeq) {
          const text = ttsQueue.shift();
          try {
            const { audioBase64, contentType } = await voiceService.synthesizeChunk(text, { speaker: 'anushka' });
            if (abort.signal.aborted || turn !== state.turnSeq) break;
            if (!ttsStarted) { ttsStarted = true; socket.emit('tts:start', {}); metrics.mark('ttsFirstAudio'); }
            socket.emit('tts:audio', { audio: audioBase64, contentType });
          } catch (err) {
            // TTS is an optional enhancement — text already streamed. Don't fail the turn.
            socket.emit('voice:error', { error_code: 'TTS_FAILED', soft: true, message: '🔊 କଣ୍ଠସ୍ୱର ସାମୟିକ ଅନୁପଲବ୍ଧ। ଆପଣ ଉତ୍ତର ପଢ଼ିପାରିବେ।' });
          }
        }
        ttsRunning = false;
      }
      function streamTts(text) { ttsQueue.push(text); return pumpTts(); }

      try {
        state.speaking = true;
        const result = await chatService.generateUniversalResponseStream(transcript, {
          sessionId: state.sessionId,
          useRag: true,
          signal: abort.signal,
          onDelta: (delta) => {
            if (!firstToken) { firstToken = true; metrics.mark('aiFirstToken'); }
            socket.emit('ai:text_delta', { delta });
            for (const sentence of sBuf.push(delta)) ttsQueue.push(sentence);
            pumpTts();
          },
        });
        metrics.mark('aiDone');

        for (const rest of sBuf.flush()) ttsQueue.push(rest);
        await pumpTts();

        if (!result.aborted) {
          socket.emit('ai:text_complete', { text: result.response, ragSources: result.ragSources });
          socket.emit('tts:end', {});
          metrics.mark('ttsDone');
        } else {
          metrics.markInterrupted();
        }
        metrics.complete();
      } catch (err) {
        metrics.fail('AI_FAILED');
        metrics.complete();
        socket.emit('voice:error', { error_code: 'AI_FAILED', message: 'ଉତ୍ତର ପ୍ରସ୍ତୁତ କରିବାରେ ସମସ୍ୟା ହେଲା।' });
      } finally {
        state.speaking = false;
      }
    });

    socket.on('disconnect', () => {
      if (state.abort) state.abort.abort();
      console.log(`👋 [RT-Voice] disconnected: ${socket.id}`);
    });
  });

  return ns;
};
