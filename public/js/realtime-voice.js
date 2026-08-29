/**
 * realtime-voice.js — Utkal.ai Voice 2.0 client
 * Browser mic → AudioWorklet PCM16 (16kHz mono) → Socket.IO (/rt-voice) →
 * realtime STT → streaming AI text → streaming Odia TTS → ordered audio queue,
 * with energy-based VAD auto-stop and barge-in interruption.
 *
 * Requires socket.io client to be loaded first (window.io).
 * Usage:
 *   const rv = new RealtimeVoice({ serverUrl: '', languageMode: 'od-IN', on: {...} });
 *   await rv.startListening();  // tap mic
 *   rv.stopListening();         // manual stop
 */
class AudioQueue {
  constructor() {
    this.queue = [];
    this.playing = false;
    this.current = null;
    this.onEnd = null;
  }
  enqueue(base64Wav) {
    this.queue.push(base64Wav);
    if (!this.playing) this._next();
  }
  _next() {
    if (this.queue.length === 0) { this.playing = false; if (this.onEnd) this.onEnd(); return; }
    this.playing = true;
    const b64 = this.queue.shift();
    const audio = new Audio('data:audio/wav;base64,' + b64);
    this.current = audio;
    audio.onended = () => this._next();
    audio.onerror = () => this._next(); // skip corrupt chunk, keep going
    audio.play().catch(() => this._next());
  }
  clear() {
    this.queue = [];
    if (this.current) { try { this.current.pause(); } catch (_) {} this.current.src = ''; this.current = null; }
    this.playing = false;
  }
}

class RealtimeVoice {
  constructor(opts = {}) {
    this.serverUrl = opts.serverUrl || '';
    this.languageMode = opts.languageMode || 'od-IN';
    this.on = opts.on || {};
    this.socket = null;
    this.audioCtx = null;
    this.stream = null;
    this.workletNode = null;
    this.source = null;
    this.listening = false;
    this.assistantSpeaking = false;
    this.audioQueue = new AudioQueue();

    // VAD state
    this.speechDetected = false;
    this.silenceMs = 0;
    this.lastFrameTime = 0;
    this.VAD_THRESHOLD = 0.012;   // RMS energy floor for "speech"
    this.VAD_HANGOVER_MS = 900;   // silence duration to auto-end utterance
    this.BARGE_THRESHOLD = 0.03;  // higher bar to interrupt Utkal while speaking
  }

  _emit(evt, data) { if (this.on[evt]) this.on[evt](data); }

  async _connect() {
    if (this.socket && this.socket.connected) return;
    this.socket = window.io(this.serverUrl + '/rt-voice', {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 800,       // exponential backoff base
      reconnectionDelayMax: 8000,
    });

    const s = this.socket;
    s.on('voice:ready', (d) => this._emit('ready', d));
    s.on('voice:final_transcript', (d) => this._emit('finalTranscript', d));
    s.on('ai:thinking', () => this._emit('thinking'));
    s.on('ai:text_delta', (d) => this._emit('textDelta', d));
    s.on('ai:text_complete', (d) => this._emit('textComplete', d));
    s.on('tts:start', () => { this.assistantSpeaking = true; this._emit('speaking'); });
    s.on('tts:audio', (d) => { if (this.assistantSpeaking) this.audioQueue.enqueue(d.audio); });
    s.on('tts:end', () => { this.audioQueue.onEnd = () => { this.assistantSpeaking = false; this._emit('speakEnd'); }; });
    s.on('voice:stopped', (d) => {
      if (d.reason === 'interrupted') { this.audioQueue.clear(); this.assistantSpeaking = false; }
      this._emit('stopped', d);
    });
    s.on('voice:error', (d) => {
      if (!d.soft) { this.audioQueue.clear(); this.assistantSpeaking = false; }
      this._emit('error', d);
    });
    s.on('connect_error', (e) => this._emit('error', { error_code: 'SOCKET', message: e.message, soft: true }));

    await new Promise((res) => { s.on('connect', res); if (s.connected) res(); });
  }

  async startListening() {
    await this._connect();
    if (this.listening) return;

    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    await this.audioCtx.audioWorklet.addModule(this.serverUrl + '/pcm-worklet.js');

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.source = this.audioCtx.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.audioCtx, 'pcm-worklet');
    this.source.connect(this.workletNode);
    // Do NOT connect to destination (avoids echo/feedback).

    this.socket.emit('voice:start', { languageMode: this.languageMode });
    this.listening = true;
    this.speechDetected = false;
    this.silenceMs = 0;
    this._emit('listening');

    this.workletNode.port.onmessage = (e) => this._onFrame(e.data);
  }

  _onFrame(float32) {
    if (!this.listening) return;
    // RMS energy for VAD.
    let sum = 0;
    for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
    const rms = Math.sqrt(sum / float32.length);
    const frameMs = (float32.length / 16000) * 1000;

    // Barge-in: user speaks loudly while Utkal is talking.
    if (this.assistantSpeaking && rms > this.BARGE_THRESHOLD) {
      this._interrupt();
    }

    // Convert Float32 → PCM16 → base64 and stream.
    const pcm = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const b64 = this._toBase64(new Uint8Array(pcm.buffer));
    this.socket.emit('voice:audio', { chunk: b64 });

    // VAD end-of-speech.
    if (rms > this.VAD_THRESHOLD) {
      this.speechDetected = true;
      this.silenceMs = 0;
    } else if (this.speechDetected) {
      this.silenceMs += frameMs;
      if (this.silenceMs >= this.VAD_HANGOVER_MS) {
        this.stopListening(); // natural pause → end utterance
      }
    }
  }

  _toBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  _interrupt() {
    this.audioQueue.clear();
    this.assistantSpeaking = false;
    if (this.socket) this.socket.emit('voice:interrupt');
    this._emit('interrupted');
  }

  stopListening() {
    if (!this.listening) return;
    this.listening = false;
    this._teardownMic();
    if (this.speechDetected) {
      this.socket.emit('voice:stop');
      this._emit('thinking');
    } else {
      this.socket.emit('voice:cancel');
    }
    this.speechDetected = false;
  }

  cancel() {
    this.listening = false;
    this._teardownMic();
    if (this.socket) this.socket.emit('voice:cancel');
  }

  _teardownMic() {
    try { if (this.workletNode) this.workletNode.port.onmessage = null; } catch (_) {}
    try { if (this.source) this.source.disconnect(); } catch (_) {}
    try { if (this.workletNode) this.workletNode.disconnect(); } catch (_) {}
    try { if (this.stream) this.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { if (this.audioCtx && this.audioCtx.state !== 'closed') this.audioCtx.close(); } catch (_) {}
    this.workletNode = this.source = this.stream = this.audioCtx = null;
  }

  destroy() {
    this.cancel();
    this.audioQueue.clear();
    if (this.socket) { this.socket.disconnect(); this.socket = null; }
  }
}

if (typeof window !== 'undefined') { window.RealtimeVoice = RealtimeVoice; window.AudioQueue = AudioQueue; }
if (typeof module !== 'undefined' && module.exports) { module.exports = { RealtimeVoice, AudioQueue }; }
