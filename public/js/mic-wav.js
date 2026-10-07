/**
 * Shared mic helpers. Windows often refuses a 16 kHz AudioContext, so callers
 * record at the device rate and downsample to 16 kHz WAV for Sarvam.
 */
(function () {
  function createAudioContext() {
    const AC = window.AudioContext || window.webkitAudioContext;
    try {
      return new AC({ sampleRate: 16000 });
    } catch (_) {
      return new AC();
    }
  }

  function downsample(input, inRate, outRate) {
    if (!input || !input.length) return new Float32Array(0);
    if (!inRate || inRate === outRate) return input;
    const ratio = inRate / outRate;
    const outLen = Math.max(1, Math.floor(input.length / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, input.length - 1);
      const frac = pos - i0;
      out[i] = input[i0] * (1 - frac) + input[i1] * frac;
    }
    return out;
  }

  function encodeWav(float32, sampleRate) {
    const pcm = downsample(float32, sampleRate, 16000);
    const buffer = new ArrayBuffer(44 + pcm.length * 2);
    const view = new DataView(buffer);
    const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    write(0, 'RIFF');
    view.setUint32(4, 36 + pcm.length * 2, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 16000 * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, pcm.length * 2, true);
    let offset = 44;
    for (let i = 0; i < pcm.length; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  function concatFloat(chunks) {
    const len = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Float32Array(len);
    let offset = 0;
    chunks.forEach((chunk) => { out.set(chunk, offset); offset += chunk.length; });
    return out;
  }

  function micMessage(error) {
    const name = error && error.name;
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'ମାଇକ୍ ଅନୁମତି ଦରକାର। ବ୍ରାଉଜରର ଲକ୍ ଆଇକନ୍ ରୁ ଅନୁମତି ଦିଅନ୍ତୁ।';
    if (name === 'NotFoundError') return 'ଏହି କମ୍ପ୍ୟୁଟରରେ ମାଇକ୍ ମିଳିଲା ନାହିଁ।';
    return (error && error.message) || 'ଭଏସ୍ ଆରମ୍ଭ ହେଲା ନାହିଁ।';
  }

  window.MicWav = { createAudioContext, downsample, encodeWav, concatFloat, micMessage };
})();
