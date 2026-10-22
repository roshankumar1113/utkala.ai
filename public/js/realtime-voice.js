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
  constructor(ctx = null) {
    this.queue = [];
    this.playing = false;
    this.current = null;
    this.currentSource = null;
    this.onEnd = null;
    this.ctx = ctx || null;
    this.token = 0;
    this.activeTurnId = null;
  }
  bind(ctx) { this.ctx = ctx; }
  setTurnId(turnId) {
    this.activeTurnId = turnId;
  }
  async enqueue(base64Wav, turnId, seq) {
    if (turnId !== undefined && this.activeTurnId !== null && turnId !== this.activeTurnId) {
      return;
    }
    const item = (typeof base64Wav === 'object' && base64Wav !== null)
      ? base64Wav
      : { base64Wav, turnId, seq };
    this.queue.push(item);
    if (!this.playing) {
      this.playing = true;
      await this._next();
    }
  }
  async _next() {
    const token = this.token;
    if (this.queue.length === 0) {
      this.playing = false;
      this.current = null;
      this.currentSource = null;
      if (this.onEnd) this.onEnd();
      return;
    }
    const item = this.queue.shift();
    const b64 = typeof item === 'string' ? item : (item && item.base64Wav ? item.base64Wav : item);
    const ctx = this.ctx;
    if (!ctx) { await this._next(); return; }
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      if (token !== this.token) return;
      let bytes;
      if (typeof atob === 'function') {
        const binary = atob(b64);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      } else if (typeof Buffer !== 'undefined') {
        bytes = new Uint8Array(Buffer.from(b64, 'base64'));
      }
      const audioBuf = await ctx.decodeAudioData(bytes.buffer.slice(0));
      if (token !== this.token) return;
      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(ctx.destination);
      this.current = src;
      this.currentSource = src;
      src.onended = () => { if (token === this.token) this._next(); };
      src.start();
    } catch (_) {
      if (token === this.token) this._next();
    }
  }
  clear() {
    this.token += 1;
    this.queue = [];
    if (this.current) { try { this.current.stop(); } catch (_) {} this.current = null; }
    if (this.currentSource) { try { this.currentSource.stop(); } catch (_) {} this.currentSource = null; }
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
    this.capturing = false;
    this.callOpen = false;
    this.assistantSpeaking = false;
    this.phase = 'idle';
    this.audioQueue = new AudioQueue();
    this.playCtx = null;
    this._playTurn = -1;

    // VAD state
    this.speechDetected = false;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.bargeMs = 0;
    this.lastFrameTime = 0;
    this.VAD_THRESHOLD = 0.012;
    this.MIN_SPEECH_MS = 280;
    this.VAD_HANGOVER_MS = 700;
    this.BARGE_THRESHOLD = 0.045;
    this.BARGE_MS = 320;
    this._levelSmooth = 0;
    this._levelAt = 0;
  }

  _emit(evt, data) { if (this.on[evt]) this.on[evt](data); }

  async _connect() {
    if (this.socket && this.socket.connected) return;
    this.socket = window.io(this.serverUrl + '/rt-voice', {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 800,
      reconnectionDelayMax: 8000,
    });

    const s = this.socket;
    s.on('voice:ready', (d) => this._emit('ready', d));
    s.on('voice:final_transcript', (d) => this._emit('finalTranscript', d));
    s.on('ai:thinking', () => this._emit('thinking'));
    s.on('ai:text_delta', (d) => this._emit('textDelta', d));
    s.on('ai:text_complete', (d) => this._emit('textComplete', d));
    s.on('tts:start', (d) => {
      if (this._holdAudio || this.capturing) return;
      if (d && this._dropThrough && d.turn <= this._dropThrough) return;
      this._playTurn = d && d.turn != null ? d.turn : this._playTurn;
      this._speakAt = Date.now();
      this.audioQueue.setTurnId(this._playTurn);
      this.assistantSpeaking = true;
      this.phase = 'speaking';
      this._emit('speaking');
    });
    s.on('tts:audio', (d) => {
      if (this._holdAudio) return;
      if (!d || d.turn !== this._playTurn) return;
      this.assistantSpeaking = true;
      this.phase = 'speaking';
      this.audioQueue.enqueue({ base64Wav: d.audio, turnId: d.turn });
    });
    s.on('tts:end', (d) => {
      const turn = d && d.turn;
      if (this._holdAudio || this.capturing) return;
      if (turn != null && this._dropThrough && turn <= this._dropThrough) return;
      if (turn != null && this._playTurn > 0 && turn !== this._playTurn) return;
      const finish = () => {
        if (this.capturing || !this.callOpen) return;
        this.assistantSpeaking = false;
        this.phase = 'idle';
        this._emit('speakEnd');
        this.armUtterance();
      };
      if (this.audioQueue.playing || this.audioQueue.queue.length) this.audioQueue.onEnd = finish;
      else finish();
    });
    s.on('voice:stopped', (d) => {
      if (d && d.reason === 'interrupted' && !this.capturing) {
        this.audioQueue.clear();
        this.assistantSpeaking = false;
        this.phase = 'idle';
      }
      this._emit('stopped', d);
    });
    s.on('voice:error', (d) => {
      if (!d.soft) {
        this.audioQueue.clear();
        this.assistantSpeaking = false;
        this.phase = 'idle';
      }
      this._emit('error', d);
      if (this.callOpen && d && !d.soft && d.error_code !== 'MIC_ENDED') {
        this.capturing = false;
        this.listening = false;
        this.armUtterance();
      }
    });
    s.on('connect_error', (e) => this._emit('error', { error_code: 'SOCKET', message: e.message, soft: true }));

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ଭଏସ୍ ସର୍ଭର ସହ ସଂଯୋଗ ହେଲା ନାହିଁ। ପେଜ୍ ରିଫ୍ରେସ୍ କରନ୍ତୁ।')), 8000);
      const done = () => { clearTimeout(timer); resolve(); };
      s.on('connect', done);
      if (s.connected) done();
    });
  }

  async startListening() {
    if (this.starting) return;
    if (this.callOpen && this.audioCtx) {
      this.armUtterance();
      return;
    }
    if (typeof window.io !== 'function') {
      throw new Error('ଭଏସ୍ ସକେଟ୍ ଲୋଡ୍ ହେଲା ନାହିଁ। ପେଜ୍ ରିଫ୍ରେସ୍ କରନ୍ତୁ।');
    }
    this.starting = true;
    try {
    // Resume playback in this click so later TTS is allowed to make sound.
    this._unlockPlayback();
    // Open the mic before any network wait. A click only counts as a user
    // gesture until the first await, and Windows may reject a 16 kHz context.
    this.audioCtx = window.MicWav.createAudioContext();
    this.inputRate = this.audioCtx.sampleRate || 16000;
    await this.audioCtx.resume();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });

    try {
      await this._connect();
      await this.audioCtx.audioWorklet.addModule(this.serverUrl + '/pcm-worklet.js');
    } catch (err) {
      this._teardownMic();
      throw err;
    }
    this.source = this.audioCtx.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.audioCtx, 'pcm-worklet');
    this.source.connect(this.workletNode);
    // A silent tap keeps the audio graph running. Chrome drops a worklet
    // that is not connected toward the destination, so the mic would stay mute.
    this.mute = this.audioCtx.createGain();
    this.mute.gain.value = 0;
    this.workletNode.connect(this.mute);
    this.mute.connect(this.audioCtx.destination);
    const track = this.stream.getAudioTracks()[0];
    if (track) {
      track.onended = () => {
        if (!this.callOpen) return;
        this.callOpen = false;
        this.capturing = false;
        this.listening = false;
        this._emit('error', { error_code: 'MIC_ENDED' });
      };
    }
    this.callOpen = true;
    this.workletNode.port.onmessage = (e) => this._onFrame(e.data);
    this.armUtterance();
    } finally {
      this.starting = false;
    }
  }

  armUtterance(opts = {}) {
    if (!this.callOpen || !this.socket || !this.audioCtx || this.capturing) return;
    if (this._playTurn > 0) this._dropThrough = Math.max(this._dropThrough || 0, this._playTurn);
    this._playTurn = -1;
    this._holdAudio = Boolean(opts.hold);
    this.audioQueue.setTurnId(-1);
    this.audioQueue.clear();
    this.socket.emit('voice:start', {
      languageMode: this.languageMode,
      replyLanguage: this.replyLanguage === 'en' ? 'en' : 'or',
      speaker: this.speaker || 'priya',
    });
    this.capturing = true;
    this.listening = true;
    this.phase = 'listening';
    this.speechDetected = false;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.bargeMs = 0;
    this._emit('listening');
  }

  _onFrame(raw) {
    if (!this.callOpen) return;
    const float32 = raw instanceof Float32Array ? raw : new Float32Array(raw);
    const rate = this.inputRate || 16000;
    let sum = 0;
    for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
    const rms = Math.sqrt(sum / float32.length);
    const frameMs = (float32.length / rate) * 1000;
    if (this.capturing || this.assistantSpeaking) this._paintLevel(rms);

    if (!this.capturing && (this.assistantSpeaking || this.phase === 'thinking' || this.phase === 'speaking')) {
      const echoGuard = this.assistantSpeaking && (Date.now() - (this._speakAt || 0) < 450);
      if (!echoGuard && rms > this.BARGE_THRESHOLD) this.bargeMs += frameMs;
      else this.bargeMs = 0;
      if (this.bargeMs >= this.BARGE_MS) this._interrupt({ resume: true });
      return;
    }
    if (!this.capturing) return;

    const samples = window.MicWav.downsample(float32, rate, 16000);
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const b64 = this._toBase64(new Uint8Array(pcm.buffer));
    this.socket.emit('voice:audio', { chunk: b64 });

    if (rms > this.VAD_THRESHOLD) {
      this.speechDetected = true;
      this.speechMs += frameMs;
      this.silenceMs = 0;
    } else if (this.speechDetected) {
      this.silenceMs += frameMs;
      if (this.speechMs >= this.MIN_SPEECH_MS && this.silenceMs >= this.VAD_HANGOVER_MS) {
        this.releaseUtterance();
      }
    }
  }

  _paintLevel(rms) {
    const target = Math.max(0, Math.min(1, rms / 0.055));
    this._levelSmooth += (target - this._levelSmooth) * 0.5;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (this._levelAt && now - this._levelAt < 48) return;
    this._levelAt = now;
    this._emit('level', {
      level: this._levelSmooth,
      speaking: rms > this.VAD_THRESHOLD,
    });
  }

  _toBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  _unlockPlayback() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!this.playCtx || this.playCtx.state === 'closed') {
      this.playCtx = new AC();
      this.audioQueue.bind(this.playCtx);
    }
    const resume = this.playCtx.resume();
    try {
      const buf = this.playCtx.createBuffer(1, 1, this.playCtx.sampleRate);
      const src = this.playCtx.createBufferSource();
      src.buffer = buf;
      src.connect(this.playCtx.destination);
      src.start();
    } catch (_) {}
    return resume;
  }

  _interrupt(opts = {}) {
    if (this._playTurn > 0) this._dropThrough = this._playTurn;
    this._playTurn = -1;
    this._holdAudio = true;
    this.audioQueue.setTurnId(-1);
    this.audioQueue.clear();
    this.assistantSpeaking = false;
    this.bargeMs = 0;
    if (this.socket) this.socket.emit('voice:interrupt');
    if (!opts.hangup) this._emit('interrupted');
    if (opts.resume && this.callOpen) {
      this.capturing = false;
      this.listening = false;
      this.armUtterance({ hold: true });
    }
  }

  releaseUtterance() {
    if (!this.capturing) return;
    const heard = this.speechDetected && this.speechMs >= this.MIN_SPEECH_MS;
    this.capturing = false;
    this.listening = false;
    this.speechDetected = false;
    this._emit('level', { level: 0, speaking: false });
    if (heard) {
      this._holdAudio = false;
      this.phase = 'thinking';
      this.socket.emit('voice:stop');
      this._emit('thinking');
    } else if (this.callOpen) {
      this.socket.emit('voice:cancel');
      this.armUtterance();
    }
  }

  stopListening() {
    this.callOpen = false;
    this.capturing = false;
    this.listening = false;
    this._interrupt({ hangup: true });
    this._emit('level', { level: 0, speaking: false });
    this._teardownMic();
    this.phase = 'idle';
    if (this.socket) this.socket.emit('voice:cancel');
    this._emit('stopped', { reason: 'hangup' });
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
    try { if (this.mute) this.mute.disconnect(); } catch (_) {}
    try { if (this.stream) this.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { if (this.audioCtx && this.audioCtx.state !== 'closed') this.audioCtx.close(); } catch (_) {}
    this.workletNode = this.source = this.stream = this.audioCtx = this.mute = null;
  }

  destroy() {
    this.cancel();
    this.audioQueue.clear();
    if (this.socket) { this.socket.disconnect(); this.socket = null; }
  }
}

if (typeof window !== 'undefined') { window.RealtimeVoice = RealtimeVoice; window.AudioQueue = AudioQueue; }
if (typeof module !== 'undefined' && module.exports) { module.exports = { RealtimeVoice, AudioQueue }; }
