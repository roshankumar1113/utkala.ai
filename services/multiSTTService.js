/**
 * multiSTTService.js
 * Multi-engine Speech-to-Text orchestrator for Odia speech.
 * Priority: Preprocessed Audio -> Sarvam AI (Odia-optimized) -> Gemini Multimodal Audio -> Google Cloud STT
 */

require('dotenv').config();
const axios = require('axios');
const FormData = require('form-data');
const { GoogleGenAI } = require('@google/genai');
const AudioPreprocessor = require('./audioPreprocessor');
const sttValidation = require('./sttValidationService');
const providerErrors = require('./providerErrors');

const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let ai;
try {
  if (GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
} catch (err) {
  console.error('[MultiSTT] GenAI init error:', err.message);
}

class MultiSTTService {
  /**
   * Primary: Transcribe using Sarvam AI (saarika:v2.5 / saarika:v2)
   * @param {Buffer} audioBuffer - 16kHz mono WAV
   * @returns {Promise<{ success: boolean, transcript: string, confidence: number }>}
   */
  async transcribeWithSarvam(audioBuffer, options = {}) {
    const apiKey = SARVAM_API_KEY || process.env.SARVAM_API_KEY;
    if (!apiKey) {
      return { success: false, error: 'SARVAM_API_KEY is not configured in .env' };
    }

    // MODE A (od-IN): force Odia, never rely on auto-detect.
    // MODE B (auto): let Sarvam detect (uses 'unknown').
    const languageMode = options.languageMode === 'auto' ? 'auto' : 'od-IN';
    const languageCode = languageMode === 'auto' ? 'unknown' : 'od-IN';

    try {
      const formData = new FormData();
      formData.append('file', audioBuffer, {
        filename: 'audio.wav',
        contentType: 'audio/wav',
      });
      formData.append('model', 'saarika:v2.5');
      formData.append('language_code', languageCode);

      const response = await axios.post('https://api.sarvam.ai/speech-to-text', formData, {
        headers: {
          'api-subscription-key': apiKey,
          ...formData.getHeaders(),
        },
        timeout: 30000,
      });

      const transcript = response.data?.transcript || response.data?.text || '';
      const confidence = response.data?.confidence || (transcript ? 0.88 : 0);

      if (transcript && transcript.trim().length > 0) {
        return {
          success: true,
          transcript: transcript.trim(),
          confidence,
          engine: 'Sarvam AI (Saarika)',
        };
      } else {
        return { success: false, error: 'Sarvam returned empty transcript' };
      }
    } catch (error) {
      const classified = providerErrors.classify(error);
      return { success: false, error: classified.message, classified };
    }
  }

  /**
   * Fallback 1: Transcribe using Gemini Multimodal Audio Understanding
   * @param {Buffer} audioBuffer - 16kHz mono WAV
   * @returns {Promise<{ success: boolean, transcript: string, confidence: number }>}
   */
  async transcribeWithGemini(audioBuffer) {
    if (!ai) {
      return { success: false, error: 'Google GenAI is not initialized' };
    }

    const models = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
    const base64Data = audioBuffer.toString('base64');

    for (const model of models) {
      try {
        console.log(`[MultiSTT] Trying Gemini Multimodal STT model: ${model}...`);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Gemini STT timeout')), 12000)
        );

        const apiCall = ai.models.generateContent({
          model,
          contents: [
            {
              inlineData: {
                mimeType: 'audio/wav',
                data: base64Data,
              },
            },
            {
              text: 'Listen carefully to this spoken audio. Transcribe the exact words spoken accurately in native Odia script (ଓଡ଼ିଆ ଭାଷା) if spoken in Odia, or the speaker\'s original language. Output ONLY the exact transcribed text without formatting, explanations, or quotes.',
            },
          ],
        });

        const response = await Promise.race([apiCall, timeoutPromise]);
        const text = response?.text?.trim();

        if (text && text.length > 0) {
          // Gemini is multimodal and can *describe* audio rather than
          // transcribe it. It is a last-resort fallback only, so we cap its
          // confidence BELOW Sarvam's success confidence (0.88) and rely on the
          // caller's hard validation gate to reject descriptions/hallucinations.
          return {
            success: true,
            transcript: text,
            confidence: 0.7,
            engine: `Gemini Multimodal (${model})`,
          };
        }
      } catch (err) {
        const classified = providerErrors.classify(err);
        console.warn(`[MultiSTT] Gemini ${model} notice: ${classified.code} ${classified.message}`);
        // Do not keep hammering a quota-exhausted account across models.
        if (classified.quotaExhausted) {
          return { success: false, error: 'Gemini quota exhausted', classified };
        }
      }
    }

    return { success: false, error: 'All Gemini multimodal models failed' };
  }

  /**
   * Fallback 2: Google Cloud Speech-to-Text (if credentials provided)
   * @param {Buffer} audioBuffer
   * @returns {Promise<{ success: boolean, transcript: string, confidence: number }>}
   */
  async transcribeWithGoogleCloud(audioBuffer) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      return { success: false, error: 'No GOOGLE_APPLICATION_CREDENTIALS set' };
    }

    try {
      const speech = require('@google-cloud/speech');
      const client = new speech.SpeechClient({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      });

      const audio = { content: audioBuffer.toString('base64') };
      const config = {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: 'or-IN', // Odia (India)
        enableAutomaticPunctuation: true,
      };

      const [response] = await client.recognize({ audio, config });
      const transcript = response.results
        .map((r) => r.alternatives[0]?.transcript)
        .filter(Boolean)
        .join('\n');

      if (transcript) {
        return {
          success: true,
          transcript,
          confidence: response.results[0]?.alternatives[0]?.confidence || 0.85,
          engine: 'Google Cloud STT',
        };
      }
      return { success: false, error: 'Google STT returned empty result' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Main multi-STT pipeline with automatic audio preprocessing, fallbacks, and confidence selection.
   * @param {Buffer} rawAudioBuffer
   * @returns {Promise<{ success: boolean, transcript: string, confidence: number, engine: string }>}
   */
  async transcribeWithFallback(rawAudioBuffer, options = {}) {
    if (!rawAudioBuffer || rawAudioBuffer.length === 0) {
      return { success: false, error: 'Audio buffer is empty', errorCode: 'EMPTY_AUDIO' };
    }

    const languageMode = options.languageMode === 'auto' ? 'auto' : 'od-IN';

    // Step 1: Preprocess Audio (Ensure 16kHz Mono + Auto-Gain Amplification)
    console.log(`[MultiSTT] Preprocessing audio buffer (${rawAudioBuffer.length} bytes)...`);
    const processedAudio = AudioPreprocessor.process(rawAudioBuffer);
    console.log(`[MultiSTT] Preprocessed audio ready (${processedAudio.length} bytes)`);

    const results = [];
    let quotaHit = false;

    // Validate + collect a candidate only if it passes the hallucination gate.
    const consider = (res) => {
      if (!res || !res.success || !res.transcript) return;
      const v = sttValidation.validateTranscript(res.transcript, { languageMode });
      if (!v.valid) {
        console.warn(`🚫 [MultiSTT] Rejected ${res.engine} transcript (${v.reason}): "${res.transcript.slice(0, 60)}"`);
        return;
      }
      results.push({ ...res, transcript: v.cleaned });
      console.log(`✅ [MultiSTT] Accepted ${res.engine}: "${v.cleaned}" (conf ${res.confidence})`);
    };

    // Step 2: Primary Sarvam AI STT
    console.log(`🔄 [MultiSTT] Engine 1: Sarvam AI (mode=${languageMode})...`);
    try {
      const sarvamRes = await this.transcribeWithSarvam(processedAudio, { languageMode });
      consider(sarvamRes);
      if (sarvamRes.classified?.quotaExhausted) quotaHit = true;
      if (!sarvamRes.success) console.warn(`⚠️ [MultiSTT] Sarvam failed: ${sarvamRes.error}`);
    } catch (err) {
      console.warn('⚠️ [MultiSTT] Sarvam error:', err.message);
    }

    // Step 3: Gemini Multimodal only if we still lack a confident accepted result.
    if (results.length === 0 || results[0].confidence < 0.75) {
      console.log('🔄 [MultiSTT] Engine 2: Gemini Multimodal (last-resort, gated)...');
      try {
        const geminiRes = await this.transcribeWithGemini(processedAudio);
        consider(geminiRes);
        if (geminiRes.classified?.quotaExhausted) quotaHit = true;
        if (!geminiRes.success) console.warn(`⚠️ [MultiSTT] Gemini failed: ${geminiRes.error}`);
      } catch (err) {
        console.warn('⚠️ [MultiSTT] Gemini error:', err.message);
      }
    }

    // Step 4: Google Cloud STT if available and still nothing valid.
    if (results.length === 0 && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.log('🔄 [MultiSTT] Engine 3: Google Cloud STT...');
      try {
        const googleRes = await this.transcribeWithGoogleCloud(processedAudio);
        consider(googleRes);
      } catch (err) {
        console.warn('⚠️ [MultiSTT] Google Cloud error:', err.message);
      }
    }

    // Step 5: Select best VALID result — or fail cleanly. We NEVER invent text.
    if (results.length === 0) {
      return {
        success: false,
        errorCode: quotaHit ? 'PROVIDER_QUOTA' : 'STT_FAILED',
        error: quotaHit
          ? 'STT providers are rate-limited (quota exhausted).'
          : 'No reliable speech could be recognized in the audio.',
      };
    }

    const best = results.reduce((a, b) => ((b.confidence || 0) > (a.confidence || 0) ? b : a));
    console.log(`🎯 [MultiSTT] Selected (${best.engine}): "${best.transcript}"`);

    return {
      success: true,
      transcript: best.transcript,
      confidence: best.confidence,
      engine: best.engine,
      languageMode,
    };
  }
}

module.exports = new MultiSTTService();
