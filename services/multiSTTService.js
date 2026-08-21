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
  async transcribeWithSarvam(audioBuffer) {
    const apiKey = SARVAM_API_KEY || process.env.SARVAM_API_KEY;
    if (!apiKey) {
      return { success: false, error: 'SARVAM_API_KEY is not configured in .env' };
    }

    try {
      const formData = new FormData();
      formData.append('file', audioBuffer, {
        filename: 'audio.wav',
        contentType: 'audio/wav',
      });
      formData.append('model', 'saarika:v2.5');
      formData.append('language_code', 'od-IN');

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
      const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message;
      return { success: false, error: errorMsg };
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
          return {
            success: true,
            transcript: text,
            confidence: 0.94,
            engine: `Gemini Multimodal (${model})`,
          };
        }
      } catch (err) {
        console.warn(`[MultiSTT] Gemini ${model} notice: ${err.message}`);
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
  async transcribeWithFallback(rawAudioBuffer) {
    if (!rawAudioBuffer || rawAudioBuffer.length === 0) {
      return { success: false, error: 'Audio buffer is empty' };
    }

    // Step 1: Preprocess Audio (Ensure 16kHz Mono + Auto-Gain Amplification)
    console.log(`[MultiSTT] Preprocessing audio buffer (${rawAudioBuffer.length} bytes)...`);
    const processedAudio = AudioPreprocessor.process(rawAudioBuffer);
    console.log(`[MultiSTT] Preprocessed audio ready (${processedAudio.length} bytes)`);

    const results = [];

    // Step 2: Try Primary Sarvam AI STT
    console.log('🔄 [MultiSTT] Engine 1: Sarvam AI (Odia Saarikav2.5)...');
    try {
      const sarvamRes = await this.transcribeWithSarvam(processedAudio);
      if (sarvamRes.success && sarvamRes.transcript) {
        results.push(sarvamRes);
        console.log(`✅ [MultiSTT] Sarvam transcript: "${sarvamRes.transcript}" (confidence: ${sarvamRes.confidence})`);
      } else {
        console.warn(`⚠️ [MultiSTT] Sarvam failed or empty: ${sarvamRes.error}`);
      }
    } catch (err) {
      console.warn('⚠️ [MultiSTT] Sarvam error:', err.message);
    }

    // Step 3: Try Gemini Multimodal STT if Sarvam is absent or confidence is under 0.75
    if (results.length === 0 || results[0].confidence < 0.75) {
      console.log('🔄 [MultiSTT] Engine 2: Gemini Multimodal Audio Intelligence...');
      try {
        const geminiRes = await this.transcribeWithGemini(processedAudio);
        if (geminiRes.success && geminiRes.transcript) {
          results.push(geminiRes);
          console.log(`✅ [MultiSTT] Gemini transcript: "${geminiRes.transcript}" (confidence: ${geminiRes.confidence})`);
        } else {
          console.warn(`⚠️ [MultiSTT] Gemini failed: ${geminiRes.error}`);
        }
      } catch (err) {
        console.warn('⚠️ [MultiSTT] Gemini error:', err.message);
      }
    }

    // Step 4: Try Google Cloud STT if available and still no result
    if (results.length === 0 && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.log('🔄 [MultiSTT] Engine 3: Google Cloud STT...');
      try {
        const googleRes = await this.transcribeWithGoogleCloud(processedAudio);
        if (googleRes.success && googleRes.transcript) {
          results.push(googleRes);
          console.log(`✅ [MultiSTT] Google Cloud transcript: "${googleRes.transcript}"`);
        }
      } catch (err) {
        console.warn('⚠️ [MultiSTT] Google Cloud error:', err.message);
      }
    }

    // Step 5: Select best result
    if (results.length === 0) {
      return {
        success: false,
        error: 'All STT engines failed to recognize speech in the audio recording.',
      };
    }

    const best = results.reduce((a, b) => ((b.confidence || 0) > (a.confidence || 0) ? b : a));
    console.log(`🎯 [MultiSTT] Selected Best Result (${best.engine}): "${best.transcript}"`);

    return {
      success: true,
      transcript: best.transcript,
      confidence: best.confidence,
      engine: best.engine,
    };
  }
}

module.exports = new MultiSTTService();
