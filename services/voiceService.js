/**
 * voiceService.js
 * Handles Speech-to-Text (Sarvam AI) and Text-to-Speech (Sarvam AI Bulbul).
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const PUBLIC_OUTPUTS_DIR = path.join(__dirname, '..', 'public', 'outputs');

// Ensure output dir exists
if (!fs.existsSync(PUBLIC_OUTPUTS_DIR)) {
  fs.mkdirSync(PUBLIC_OUTPUTS_DIR, { recursive: true });
}

/**
 * Transcribe an Odia audio buffer using Sarvam AI Speech-to-Text.
 * @param {Buffer} audioBuffer - Raw audio file buffer
 * @param {string} filename - Original filename (used to determine extension)
 * @returns {Promise<string>} - Transcribed text
 */
async function transcribeAudio(audioBuffer, filename) {
  console.log(`[VoiceService STT] Transcribing audio: ${filename}`);

  if (!SARVAM_API_KEY) {
    throw new Error('SARVAM_API_KEY is not configured in .env');
  }

  const ext = path.extname(filename || 'audio.wav').toLowerCase() || '.wav';
  const mimeTypes = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.mp4': 'audio/mp4',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.webm': 'audio/webm',
    '.flac': 'audio/flac',
  };
  const mimeType = mimeTypes[ext] || 'audio/wav';

  // Build multipart form-data manually using axios FormData pattern
  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', audioBuffer, { filename: `audio${ext}`, contentType: mimeType });
  form.append('model', 'saarika:v2');
  form.append('language_code', 'or-IN'); // Odia

  const response = await axios.post(
    'https://api.sarvam.ai/speech-to-text',
    form,
    {
      headers: {
        ...form.getHeaders(),
        'api-subscription-key': SARVAM_API_KEY,
      },
      timeout: 30000,
    }
  );

  const transcript = response.data?.transcript || response.data?.text || '';
  console.log(`[VoiceService STT] Transcription complete: "${transcript.substring(0, 80)}..."`);
  return transcript;
}

/**
 * Generate Odia speech audio using Sarvam AI Bulbul TTS.
 * @param {string} text - Odia text to convert to speech
 * @returns {Promise<string>} - Public URL path to the generated audio file
 */
async function generateSpeech(text) {
  console.log(`[VoiceService TTS] Generating speech for: "${text.substring(0, 60)}..."`);

  if (!SARVAM_API_KEY) {
    throw new Error('SARVAM_API_KEY is not configured in .env');
  }

  const response = await axios.post(
    'https://api.sarvam.ai/text-to-speech',
    {
      inputs: [text.substring(0, 500)], // Sarvam TTS max ~500 chars per request
      target_language_code: 'or-IN',
      speaker: 'meera',
      pitch: 0,
      pace: 1.0,
      loudness: 1.5,
      speech_sample_rate: 22050,
      enable_preprocessing: true,
      model: 'bulbul:v1',
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': SARVAM_API_KEY,
      },
      timeout: 30000,
    }
  );

  // Sarvam returns base64-encoded audio in audios array
  const base64Audio = response.data?.audios?.[0];
  if (!base64Audio) {
    throw new Error('Sarvam TTS returned no audio data.');
  }

  const audioBuffer = Buffer.from(base64Audio, 'base64');
  const filename = `tts_${Date.now()}.wav`;
  const filePath = path.join(PUBLIC_OUTPUTS_DIR, filename);

  fs.writeFileSync(filePath, audioBuffer);
  console.log(`[VoiceService TTS] Audio saved: ${filename}`);

  return `/outputs/${filename}`;
}

module.exports = {
  transcribeAudio,
  generateSpeech,
};
