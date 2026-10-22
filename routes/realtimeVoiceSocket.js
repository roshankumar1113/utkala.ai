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
const { resolveVoice } = require('../services/voiceSpeakers');
const voiceDelivery = require('../services/voiceDelivery');
const { socketAuth } = require('../services/authHttp');

const SAMPLE_RATE = 16000;

function say(state, english, hindi, odia) {
  if (state.replyLanguage === 'en') return english;
  if (state.replyLanguage === 'hi' || state.replyLanguage === 'mix') return hindi;
  return odia;
}

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
  ns.use(socketAuth);

  ns.on('connection', (socket) => {
    const sessionId = `rt-${socket.id}-${Date.now()}`;
    console.log(`✅ [RT-Voice] connected: ${socket.id} (session ${sessionId})`);

    const state = {
      sessionId,
      languageMode: 'od-IN',
      replyLanguage: 'or',
      speaker: 'priya',
      pace: 1.02,
      chunks: [],
      abort: null,      // AbortController for in-flight AI generation
      speaking: false,
      turnSeq: 0,
    };

    socket.emit('voice:ready', { sessionId });

    socket.on('voice:start', (data = {}) => {
      state.languageMode = data.languageMode === 'auto' ? 'auto' : 'od-IN';
      if (data.replyLanguage === 'en') state.replyLanguage = 'en';
      else if (state.languageMode !== 'auto') state.replyLanguage = 'or';
      const voice = resolveVoice(data.speaker);
      state.speaker = voice.id;
      state.pace = voice.pace;
      state.chunks = [];
      console.log(`🎙️ [RT-Voice] utterance start (mode=${state.languageMode}, speaker=${state.speaker})`);
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
      state.turnSeq += 1;
      state.speaking = false;
      state.chunks = [];
      socket.emit('voice:stopped', { reason: 'interrupted' });
    });

    socket.on('voice:stop', async () => {
      if (state.chunks.length === 0) {
        socket.emit('voice:error', {
          error_code: 'STT_EMPTY',
          message: say(state, 'I could not hear anything.', 'मुझे कुछ सुनाई नहीं दिया।', 'ମୁଁ କିଛି ଶୁଣିପାରିଲି ନାହିଁ।'),
        });
        return;
      }

      // Abort any prior generation still running (new turn supersedes it).
      if (state.abort) state.abort.abort();
      const abort = new AbortController();
      state.abort = abort;
      state.heardAsAuto = false;
      const turn = ++state.turnSeq;
      let ttsStarted = false;
      const spoken = new Set();
      const slots = [];
      const jobs = [];
      let nextEmit = 0;
      let flushing = Promise.resolve();
      let inflight = 0;
      const waiters = [];
      const acquire = () => {
        if (inflight < 2) {
          inflight += 1;
          return Promise.resolve();
        }
        return new Promise((resolve) => waiters.push(resolve));
      };
      const release = () => {
        const next = waiters.shift();
        if (next) next();
        else inflight = Math.max(0, inflight - 1);
      };
      const flushReady = () => {
        flushing = flushing.then(() => {
          while (slots[nextEmit]) {
            const item = slots[nextEmit];
            nextEmit += 1;
            if (!item || item.skip) continue;
            if (abort.signal.aborted || turn !== state.turnSeq) return;
            if (!ttsStarted) {
              ttsStarted = true;
              socket.emit('tts:start', { turn });
              metrics.mark('ttsFirstAudio');
            }
            socket.emit('tts:audio', { audio: item.audioBase64, contentType: item.contentType, turn });
          }
        });
        return flushing;
      };
      function streamTts(text, transcript) {
        const delivery = voiceDelivery.forUtterance(text, transcript, state.pace);
        const chunk = delivery.text;
        if (!chunk || spoken.has(chunk)) return;
        spoken.add(chunk);
        const index = slots.length;
        slots.push(undefined);
        jobs.push((async () => {
          await acquire();
          let item = { skip: true };
          try {
            if (!abort.signal.aborted && turn === state.turnSeq) {
              const audio = await voiceService.synthesizeChunk(chunk, {
                speaker: state.speaker,
                pace: delivery.pace,
                temperature: delivery.temperature,
                language: state.replyLanguage,
              });
              if (!abort.signal.aborted && turn === state.turnSeq) item = audio;
            }
          } catch (err) {
            console.warn('[RT-Voice] TTS chunk failed:', err.message);
            socket.emit('voice:error', {
              error_code: 'TTS_FAILED',
              soft: true,
              message: say(
                state,
                'Voice is temporarily unavailable. You can still read the answer.',
                'आवाज़ अभी उपलब्ध नहीं है। जवाब आप पढ़ सकते हैं।',
                '🔊 କଣ୍ଠସ୍ୱର ସାମୟିକ ଅନୁପଲବ୍ଧ। ଆପଣ ଉତ୍ତର ପଢ଼ିପାରିବେ।'
              ),
            });
          } finally {
            slots[index] = item;
            release();
            await flushReady();
          }
        })());
      }

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
        const sttMode = state.replyLanguage === 'en' ? 'auto' : state.languageMode;
        transcript = await voiceService.transcribeAudio(wav, 'utterance.wav', { languageMode: sttMode });
        if (sttMode !== 'auto' && voiceDelivery.looksLikeForeignInOdia(transcript)) {
          try {
            const again = await voiceService.transcribeAudio(wav, 'utterance.wav', { languageMode: 'auto' });
            if (again && !/[\u0B00-\u0B7F]/.test(again)) {
              transcript = again;
              state.heardAsAuto = true;
            }
          } catch (retryErr) {
            console.warn('[RT-Voice] language retry skipped:', retryErr.message);
          }
        }
        metrics.mark('sttDone');
      } catch (err) {
        metrics.fail(err.errorCode || 'STT_FAILED');
        metrics.complete();
        socket.emit('voice:error', {
          error_code: err.errorCode || 'STT_FAILED',
          message: err.errorCode === 'PROVIDER_QUOTA'
            ? say(state, 'The service is busy. Please try again in a moment.', 'सेवा अभी व्यस्त है। थोड़ी देर बाद कोशिश करें।', 'ସେବା ବ୍ୟସ୍ତ ଅଛି। ଦୟାକରି କିଛି ସମୟ ପରେ ଚେଷ୍ଟା କରନ୍ତୁ।')
            : say(state, 'I did not catch that. Please say it again.', 'मैं ठीक से सुन नहीं पाया। फिर से बोलें।', 'ମୁଁ ଠିକ୍ ଭାବରେ ଶୁଣିପାରିଲି ନାହିଁ। ଦୟାକରି ପୁଣିଥରେ କୁହନ୍ତୁ।'),
        });
        return;
      }

      if (abort.signal.aborted || turn !== state.turnSeq) return;
      state.replyLanguage = voiceDelivery.detectSpokenLanguage(transcript, {
        languageMode: state.heardAsAuto ? 'auto' : state.languageMode,
        replyLanguage: state.replyLanguage,
      });
      state.heardAsAuto = false;
      socket.emit('voice:final_transcript', { text: transcript, replyLanguage: state.replyLanguage });

      // Ledger only when the words sound like money. A chat must not wait on that model.
      if (voiceDelivery.looksLikeLedger(transcript)) try {
        const tx = await ledgerParserService.analyzeTransaction(transcript);
        const isLedger = tx && tx.action !== 'UNKNOWN' && (tx.amount > 0 || tx.party !== 'N/A');
        if (isLedger) {
          const v = ledgerValidationService.validateTransaction(tx, { language: state.replyLanguage });
          const speak = v.valid ? null : v.clarification;
          socket.emit('ai:text_complete', {
            text: v.valid
              ? say(state, 'Please confirm this transaction.', 'कृपया इस लेन-देन की पुष्टि करें।', 'ଦୟାକରି ନିମ୍ନ କାରବାରକୁ ନିଶ୍ଚିତ କରନ୍ତୁ।')
              : v.clarification,
            ledger: {
              requiresConfirmation: v.valid,
              requiresClarification: !v.valid,
              transaction: v.normalized,
              missing: v.missing,
            },
          });
          if (!v.valid && speak) {
            streamTts(speak, transcript);
            await Promise.all(jobs);
            await flushing;
            if (!abort.signal.aborted && turn === state.turnSeq) socket.emit('tts:end', { turn });
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
      const sBuf = new SentenceBuffer({ minChars: 8, conversational: true });
      let firstToken = false;

      try {
        state.speaking = true;
        const result = await chatService.generateUniversalResponseStream(transcript, {
          sessionId: state.sessionId,
          useRag: voiceDelivery.needsKnowledge(transcript),
          replyLanguage: state.replyLanguage,
          spoken: true,
          signal: abort.signal,
          onDelta: (delta) => {
            if (!firstToken) { firstToken = true; metrics.mark('aiFirstToken'); }
            socket.emit('ai:text_delta', { delta });
            for (const sentence of sBuf.push(delta)) streamTts(sentence, transcript);
          },
        });
        metrics.mark('aiDone');

        for (const rest of sBuf.flush()) streamTts(rest, transcript);
        await Promise.all(jobs);
        await flushing;

        if (!result.aborted && turn === state.turnSeq) {
          socket.emit('ai:text_complete', {
            text: result.response,
            ragSources: result.ragSources,
            knowledgeNote: result.knowledgeNote || null,
          });
          socket.emit('tts:end', { turn });
          metrics.mark('ttsDone');
        } else {
          metrics.markInterrupted();
        }
        metrics.complete();
      } catch (err) {
        metrics.fail('AI_FAILED');
        metrics.complete();
        socket.emit('voice:error', {
          error_code: 'AI_FAILED',
          message: say(state, 'The answer could not be prepared.', 'जवाब तैयार नहीं हो पाया।', 'ଉତ୍ତର ପ୍ରସ୍ତୁତ କରିବାରେ ସମସ୍ୟା ହେଲା।'),
        });
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
