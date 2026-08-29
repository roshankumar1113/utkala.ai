/**
 * pcm-worklet.js — AudioWorkletProcessor
 * Captures mono Float32 audio frames and forwards fixed-size buffers
 * (~200ms) to the main thread. Runs on the audio render thread, so it is far
 * more reliable than ScriptProcessorNode for low-latency streaming.
 *
 * The AudioContext is created at 16 kHz by the client, so no resampling is
 * needed here — frames are already at the STT target rate.
 */
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    // ~200ms at 16kHz = 3200 samples.
    this.target = 3200;
    this.buf = new Float32Array(this.target);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) {
      this.buf[this.filled++] = ch[i];
      if (this.filled >= this.target) {
        // Transfer a copy to the main thread.
        const out = this.buf.slice(0, this.filled);
        this.port.postMessage(out, [out.buffer]);
        this.buf = new Float32Array(this.target);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-worklet', PcmWorklet);
