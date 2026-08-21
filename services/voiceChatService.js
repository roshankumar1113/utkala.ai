const axios = require('axios');
const FormData = require('form-data');

class VoiceChatService {
  constructor() {
    this.sarvamApiKey = process.env.SARVAM_API_KEY;
    this.sarvamSTTUrl = 'https://api.sarvam.ai/speech-to-text';
    this.sarvamTTSUrl = 'https://api.sarvam.ai/text-to-speech';
  }

  /**
   * Speech-to-Text: Convert Odia audio → Odia text with preprocessing and multi-engine fallback
   * Input: Audio buffer (WAV format, 16kHz, mono)
   * Output: Transcribed Odia text
   */
  async transcribeOdiaAudio(audioBuffer) {
    const multiSTTService = require('./multiSTTService');
    return multiSTTService.transcribeWithFallback(audioBuffer);
  }


  /**
   * Text-to-Speech: Convert Odia text → Odia audio
   * Input: Odia text string
   * Output: Base64-encoded WAV audio
   */
  async synthesizeOdiaSpeech(text, options = {}) {
    try {
      const apiKey = this.sarvamApiKey || process.env.SARVAM_API_KEY;
      if (!apiKey) {
        console.warn('[TTS] No SARVAM_API_KEY found.');
        return {
          success: false,
          error: 'SARVAM_API_KEY is not configured in .env',
        };
      }

      const {
        speaker = 'meera', // Female Odia voice
        pace = 1.0, // 0.5 (slow) to 2.0 (fast)
        pitch = 1.0, // 0.5 to 2.0
      } = options;

      // Truncate text if too long (Sarvam limits)
      const maxLength = 500;
      const truncatedText = text.length > maxLength 
        ? text.substring(0, maxLength) + '।' 
        : text;

      const response = await axios.post(
        this.sarvamTTSUrl,
        {
          inputs: [truncatedText],
          target_language_code: 'od-IN',
          speaker: speaker,
          pace,
          pitch,
          model: 'bulbul:v1',
          enable_preprocessing: true,
        },
        {
          headers: {
            'api-subscription-key': apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      console.log('[TTS] Response received from Sarvam');

      if (response.data && response.data.audios && response.data.audios.length > 0) {
        const audioBase64 = response.data.audios[0];
        
        return {
          success: true,
          audio: audioBase64, // Base64-encoded WAV
          contentType: 'audio/wav',
          duration: response.data.duration || 0,
        };
      } else {
        return {
          success: false,
          error: response.data?.error || 'TTS audio generation failed',
        };
      }
    } catch (error) {
      console.error('[TTS Error]:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message,
      };
    }
  }

  /**
   * Fallback: If Sarvam fails, use Google Cloud (requires credentials)
   */
  async transcribeUsingGoogle(audioBuffer) {
    try {
      const speech = require('@google-cloud/speech');
      const client = new speech.SpeechClient({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      });

      const audio = {
        content: audioBuffer.toString('base64'),
      };

      const config = {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: 'or-IN', // Odia (India)
        enableAutomaticPunctuation: true,
      };

      const request = {
        audio,
        config,
      };

      const [response] = await client.recognize(request);
      const transcript = response.results
        .map((result) => result.alternatives[0].transcript)
        .join('\n');

      return {
        success: true,
        transcript,
      };
    } catch (error) {
      console.error('[Google STT Error]:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = new VoiceChatService();
