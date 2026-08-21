const { WaveFile } = require('wavefile');

class AudioPreprocessor {
  /**
   * Ensure audio is 16kHz mono 16-bit PCM WAV format
   * (Strict requirement for Sarvam and most high-accuracy STT models)
   * @param {Buffer} audioBuffer
   * @returns {Buffer}
   */
  static normalizeAudio(audioBuffer) {
    if (!audioBuffer || audioBuffer.length === 0) return audioBuffer;

    try {
      const wav = new WaveFile();
      wav.fromBuffer(audioBuffer);

      // Force 16kHz sample rate
      if (wav.fmt.sampleRate !== 16000) {
        console.log(`[AudioPreprocessor] Resampling from ${wav.fmt.sampleRate}Hz to 16000Hz`);
        wav.toSampleRate(16000);
      }

      // Convert to Mono (1 channel)
      if (wav.fmt.numChannels !== 1) {
        console.log(`[AudioPreprocessor] Converting ${wav.fmt.numChannels} channels to mono`);
        wav.toMono();
      }

      // Ensure 16-bit bit depth
      if (wav.bitDepth !== '16') {
        console.log(`[AudioPreprocessor] Converting bit depth from ${wav.bitDepth} to 16-bit`);
        wav.toBitDepth('16');
      }

      return Buffer.from(wav.toBuffer());
    } catch (error) {
      console.warn('[AudioPreprocessor] Normalization fallback (using original buffer):', error.message);
      return audioBuffer;
    }
  }

  /**
   * Amplify quiet audio (Auto-Gain Control)
   * @param {Buffer} audioBuffer
   * @param {number} targetLevel - Target peak level (0.0 to 1.0)
   * @returns {Buffer}
   */
  static amplifyAudio(audioBuffer, targetLevel = 0.85) {
    if (!audioBuffer || audioBuffer.length === 0) return audioBuffer;

    try {
      const wav = new WaveFile();
      wav.fromBuffer(audioBuffer);

      const samples = wav.getSamples(false, Float32Array);
      if (!samples || samples.length === 0) return audioBuffer;

      // Find maximum amplitude
      let maxAmp = 0;
      for (let i = 0; i < samples.length; i++) {
        const absVal = Math.abs(samples[i]);
        if (absVal > maxAmp) maxAmp = absVal;
      }

      // Apply gain if audio is quiet
      if (maxAmp > 0.001 && maxAmp < targetLevel) {
        const gainFactor = targetLevel / maxAmp;
        console.log(`[AudioPreprocessor] Applying auto-gain factor: ${gainFactor.toFixed(2)}x (peak: ${maxAmp.toFixed(3)})`);

        for (let i = 0; i < samples.length; i++) {
          samples[i] = Math.max(-1.0, Math.min(1.0, samples[i] * gainFactor));
        }

        wav.setSamples(samples);
        return Buffer.from(wav.toBuffer());
      }

      return audioBuffer;
    } catch (error) {
      console.warn('[AudioPreprocessor] Amplify fallback:', error.message);
      return audioBuffer;
    }
  }

  /**
   * Full preprocessing pipeline: Normalize (16kHz mono) + Amplify
   * @param {Buffer} audioBuffer
   * @returns {Buffer}
   */
  static process(audioBuffer) {
    if (!audioBuffer) return audioBuffer;
    const normalized = AudioPreprocessor.normalizeAudio(audioBuffer);
    const amplified = AudioPreprocessor.amplifyAudio(normalized);
    return amplified;
  }
}

module.exports = AudioPreprocessor;
