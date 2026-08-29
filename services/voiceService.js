/**
 * voiceService.js
 * Handles Speech-to-Text (Sarvam AI Saarikav2.5 + Gemini Multimodal Fallback)
 * and Text-to-Speech (Sarvam AI Bulbul v2).
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const PUBLIC_OUTPUTS_DIR = path.join(__dirname, '..', 'public', 'outputs');

// Ensure output dir exists
if (!fs.existsSync(PUBLIC_OUTPUTS_DIR)) {
  fs.mkdirSync(PUBLIC_OUTPUTS_DIR, { recursive: true });
}

let ai;
try {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} catch (err) {
  console.error('[VoiceService] GenAI init error:', err.message);
}

/**
 * Detect actual audio mime type and extension from buffer magic bytes.
 * @param {Buffer} buffer
 * @param {string} [originalFilename='audio.wav']
 * @returns {{ mimeType: string, filename: string }}
 */
function detectAudioMimeAndExt(buffer, originalFilename = 'audio.wav') {
  if (buffer && buffer.length >= 4) {
    // WebM / EBML: 0x1A, 0x45, 0xDF, 0xA3
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
      return { mimeType: 'audio/webm', filename: 'audio.webm' };
    }
    // WAV / RIFF: 'RIFF'
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
      return { mimeType: 'audio/wav', filename: 'audio.wav' };
    }
    // Ogg: 'OggS'
    if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
      return { mimeType: 'audio/ogg', filename: 'audio.ogg' };
    }
    // MP3: 'ID3'
    if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
      return { mimeType: 'audio/mpeg', filename: 'audio.mp3' };
    }
    // MP4 / M4A
    if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
      return { mimeType: 'audio/mp4', filename: 'audio.mp4' };
    }
  }

  const ext = path.extname(originalFilename || 'audio.wav').toLowerCase() || '.wav';
  const mimeTypes = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.mp4': 'audio/mp4',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.webm': 'audio/webm',
    '.flac': 'audio/flac',
  };
  return { mimeType: mimeTypes[ext] || 'audio/webm', filename: `audio${ext}` };
}

/**
 * Fallback STT using Gemini Multimodal Audio understanding across any language.
 * @param {Buffer} audioBuffer
 * @param {string} mimeType
 * @returns {Promise<string>}
 */
async function transcribeWithGeminiFallback(audioBuffer, mimeType = 'audio/wav') {
  if (!ai) return '';
  const models = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
  for (const model of models) {
    try {
      console.log(`[VoiceService STT Fallback] Trying Gemini model: ${model}`);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini STT timeout')), 10000)
      );

      const apiCall = ai.models.generateContent({
        model,
        contents: [
          {
            inlineData: {
              mimeType: mimeType || 'audio/wav',
              data: audioBuffer.toString('base64'),
            },
          },
          {
            text: 'Listen carefully to this spoken audio. Transcribe the exact words spoken accurately in the speaker’s language (whether spoken in Odia, English, Hindi, Bengali, or any other language/dialect). Output ONLY the transcribed text without quotes or explanations.',
          },
        ],
      });

      const response = await Promise.race([apiCall, timeoutPromise]);
      const text = response?.text?.trim();
      if (text) {
        console.log(`[VoiceService STT Fallback] Gemini transcribed: "${text.substring(0, 60)}..."`);
        return text;
      }
    } catch (err) {
      console.warn(`[VoiceService STT Fallback] Model ${model} failed: ${err.message}`);
    }
  }
  return '';
}

/**
 * Transcribe an audio buffer in ANY language using MultiSTTService (Preprocessing + Sarvam + Gemini Multimodal Fallback).
 * @param {Buffer} audioBuffer - Raw audio file buffer
 * @param {string} filename - Original filename
 * @returns {Promise<string>} - Transcribed text
 */
async function transcribeAudio(audioBuffer, filename, options = {}) {
  console.log(`[VoiceService STT] Transcribing audio buffer of size ${audioBuffer?.length} bytes (name: ${filename})`);

  if (!audioBuffer || audioBuffer.length === 0) {
    const e = new Error('Audio buffer is empty.');
    e.errorCode = 'EMPTY_AUDIO';
    throw e;
  }

  const multiSTTService = require('./multiSTTService');
  const result = await multiSTTService.transcribeWithFallback(audioBuffer, options);

  if (result.success && result.transcript) {
    console.log(`[VoiceService STT] Final transcription (${result.engine}): "${result.transcript.substring(0, 80)}..."`);
    return result.transcript.trim();
  }

  const e = new Error(result.error || 'Failed to transcribe audio.');
  e.errorCode = result.errorCode || 'STT_FAILED';
  throw e;
}


/**
 * Generate Odia speech audio using Sarvam AI Bulbul TTS.
 * @param {string} text - Odia text to convert to speech
 * @param {string} [speaker='anushka'] - Speaker voice
 * @returns {Promise<string>} - Public URL path to the generated audio file
 */
async function generateSpeech(text, speaker = 'anushka') {
  console.log(`[VoiceService TTS] Generating speech for: "${text.substring(0, 60)}..."`);

  if (!SARVAM_API_KEY) {
    throw new Error('SARVAM_API_KEY is not configured in .env');
  }

  // Clean and prepare text for TTS
  const cleanText = text.replace(/[*#_`~]/g, '').trim().substring(0, 500);

  const response = await axios.post(
    'https://api.sarvam.ai/text-to-speech',
    {
      inputs: [cleanText],
      target_language_code: 'od-IN',
      speaker: speaker || 'anushka',
      pitch: 0,
      pace: 1.0,
      loudness: 1.5,
      speech_sample_rate: 22050,
      enable_preprocessing: true,
      model: 'bulbul:v2',
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': SARVAM_API_KEY,
      },
      timeout: 30000,
    }
  );

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

/**
 * Synthesize a single text chunk to base64 WAV (for realtime socket streaming).
 * Unlike generateSpeech(), this does NOT write a file — it returns the audio
 * inline so the client audio queue can play it immediately.
 * @param {string} text
 * @param {Object} [opts] - { speaker, pace, pitch }
 * @returns {Promise<{ audioBase64: string, contentType: string }>}
 */
async function synthesizeChunk(text, opts = {}) {
  if (!SARVAM_API_KEY) throw new Error('SARVAM_API_KEY is not configured in .env');
  const cleanText = String(text).replace(/[*#_`~]/g, '').trim().substring(0, 500);
  if (!cleanText) throw new Error('Empty TTS chunk');

  const response = await axios.post(
    'https://api.sarvam.ai/text-to-speech',
    {
      inputs: [cleanText],
      target_language_code: 'od-IN',
      speaker: opts.speaker || 'anushka',
      pitch: opts.pitch ?? 0,
      pace: opts.pace ?? 1.0,
      loudness: 1.5,
      speech_sample_rate: 22050,
      enable_preprocessing: true,
      model: 'bulbul:v2',
    },
    {
      headers: { 'Content-Type': 'application/json', 'api-subscription-key': SARVAM_API_KEY },
      timeout: 30000,
    }
  );

  const base64Audio = response.data?.audios?.[0];
  if (!base64Audio) throw new Error('Sarvam TTS returned no audio data.');
  return { audioBase64: base64Audio, contentType: 'audio/wav' };
}

module.exports = {
  transcribeAudio,
  generateSpeech,
  synthesizeChunk,
  detectAudioMimeAndExt,
};
