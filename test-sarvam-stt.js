const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
require('dotenv').config();

async function testSarvamSTT() {
  const sarvamApiKey = process.env.SARVAM_API_KEY;

  console.log('==================================================');
  console.log('🎙️ Testing Sarvam STT & Voice Connectivity');
  console.log('==================================================\n');

  if (!sarvamApiKey || sarvamApiKey === 'your_sarvam_api_key_here') {
    console.warn('⚠️ SARVAM_API_KEY not configured or set to placeholder.');
    console.log('ℹ️ The system will automatically use Gemini Multimodal Audio fallback for STT.');
    return;
  }

  console.log('Test 1: Sending Odia audio buffer to Sarvam API...');
  
  // Create a minimal 1-second 16kHz mono PCM WAV for validation
  const sampleRate = 16000;
  const numSamples = sampleRate; // 1 second
  const buffer = Buffer.alloc(44 + numSamples * 2);

  // Write WAV Header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // 1 channel
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  try {
    const formData = new FormData();
    formData.append('file', buffer, { filename: 'test-audio.wav', contentType: 'audio/wav' });
    formData.append('model', 'saarika:v2.5');
    formData.append('language_code', 'od-IN');

    const startTime = Date.now();
    const response = await axios.post('https://api.sarvam.ai/speech-to-text', formData, {
      headers: {
        'api-subscription-key': sarvamApiKey,
        ...formData.getHeaders(),
      },
      timeout: 20000,
    });

    const latency = Date.now() - startTime;
    console.log(`✅ Sarvam API responded in ${latency}ms`);
    console.log('Response:', response.data);
  } catch (error) {
    console.error('❌ Sarvam API response notice:', error.response?.data || error.message);
  }
}

testSarvamSTT();
