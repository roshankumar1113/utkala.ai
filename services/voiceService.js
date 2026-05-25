const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Base URL for Sarvam AI API
const SARVAM_BASE_URL = 'https://api.sarvam.ai';

/**
 * Transcribe Odia spoken audio to raw Odia text.
 * Uses Sarvam AI Speech-to-Text Saaras v3 model.
 * 
 * @param {Buffer} fileBuffer - Audio file buffer.
 * @param {string} originalName - Original filename to preserve file extension/format.
 * @returns {Promise<string>} - Transcribed Odia text.
 */
async function transcribeAudio(fileBuffer, originalName) {
  try {
    const sarvamApiKey = process.env.SARVAM_API_KEY;
    if (!sarvamApiKey || sarvamApiKey === 'your_sarvam_api_key_here') {
      throw new Error('Sarvam AI API Key is not configured in .env');
    }

    // Convert Buffer to a Blob/File representation for FormData
    const formData = new FormData();
    // BCP-47 Code for Odia is or-IN
    const mimeType = originalName.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';
    const fileBlob = new Blob([fileBuffer], { type: mimeType });
    
    formData.append('file', fileBlob, originalName || 'audio.wav');
    formData.append('model', 'saaras:v3');
    formData.append('language_code', 'or-IN');

    console.log(`[Voice STT] Initiating transcription for file: ${originalName || 'audio.wav'}, size: ${fileBuffer.length} bytes`);

    const response = await axios.post(`${SARVAM_BASE_URL}/speech-to-text`, formData, {
      headers: {
        'api-subscription-key': sarvamApiKey
        // Content-Type is automatically set with boundary for FormData in Axios
      }
    });

    if (response.data && response.data.transcript) {
      console.log(`[Voice STT] Transcription success: "${response.data.transcript}"`);
      return response.data.transcript;
    } else {
      console.warn('[Voice STT] Response did not contain a transcript field:', response.data);
      throw new Error('Transcription failed. Invalid response structure from Sarvam AI.');
    }
  } catch (error) {
    console.error('[Voice STT] Error occurred during transcription:', error.response?.data || error.message);
    throw new Error(`Voice STT Error: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Convert transaction confirmation text into Odia speech.
 * Uses Sarvam AI Text-to-Speech Bulbul v3 model and outputs a saved MP3 file.
 * 
 * @param {string} text - Plain text (Odia or code-mixed) to generate speech for.
 * @returns {Promise<string>} - Public relative URL path of the saved MP3 file.
 */
async function generateSpeech(text) {
  try {
    const sarvamApiKey = process.env.SARVAM_API_KEY;
    if (!sarvamApiKey || sarvamApiKey === 'your_sarvam_api_key_here') {
      throw new Error('Sarvam AI API Key is not configured in .env');
    }

    console.log(`[Voice TTS] Generating Odia speech for text: "${text}"`);

    const payload = {
      text: text,
      target_language_code: 'or-IN',
      model: 'bulbul:v3',
      speaker: 'shubh', // Default premium speaker for bulbul:v3
      speech_sample_rate: 22050,
      output_audio_codec: 'mp3',
      pace: 1.0
    };

    const response = await axios.post(`${SARVAM_BASE_URL}/text-to-speech`, payload, {
      headers: {
        'api-subscription-key': sarvamApiKey,
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.audios && response.data.audios.length > 0) {
      const base64Audio = response.data.audios[0];
      const audioBuffer = Buffer.from(base64Audio, 'base64');
      
      // Define outputs directory path
      const outputDir = path.join(__dirname, '..', 'public', 'outputs');
      await fs.mkdir(outputDir, { recursive: true });
      
      // Generate a unique filename
      const filename = `confirmation-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.mp3`;
      const filePath = path.join(outputDir, filename);
      
      // Write the MP3 audio file
      await fs.writeFile(filePath, audioBuffer);
      console.log(`[Voice TTS] Successfully saved voice confirmation file to ${filePath}`);
      
      // Return public relative path
      return `/outputs/${filename}`;
    } else {
      console.warn('[Voice TTS] Response did not contain audios array:', response.data);
      throw new Error('Speech generation failed. Invalid response structure from Sarvam AI.');
    }
  } catch (error) {
    console.error('[Voice TTS] Error occurred during speech generation:', error.response?.data || error.message);
    throw new Error(`Voice TTS Error: ${error.response?.data?.message || error.message}`);
  }
}

module.exports = {
  transcribeAudio,
  generateSpeech
};
