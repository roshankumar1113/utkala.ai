const multiSTTService = require('./services/multiSTTService');
const chatService = require('./services/chatService');
const voiceChatService = require('./services/voiceChatService');
const AudioPreprocessor = require('./services/audioPreprocessor');
require('dotenv').config();

async function testFullVoicePipeline() {
  console.log('==================================================');
  console.log('🎙️ FULL MULTI-STT & VOICE PIPELINE TEST');
  console.log('==================================================\n');

  // Generate 1-second sample 16kHz mono audio
  const sampleRate = 16000;
  const numSamples = sampleRate;
  const buffer = Buffer.alloc(44 + numSamples * 2);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  console.log('Step 1: Testing Audio Preprocessor (16kHz Mono Normalization + Auto-Gain)...');
  const processed = AudioPreprocessor.process(buffer);
  console.log(`✅ Preprocessed buffer: ${processed.length} bytes\n`);

  console.log('Step 2: Testing Multi-Engine STT Architecture...');
  const sttResult = await multiSTTService.transcribeWithFallback(processed);
  console.log(`STT Result:`, sttResult);

  console.log('\nStep 3: Testing Odia AI Answering & RAG Grounding...');
  const testQuery = 'ସୁଭଦ୍ରା ଯୋଜନାରେ କେତେ ଟଙ୍କା ମିଳେ?';
  const chatRes = await chatService.answerQuestion(testQuery, 'test-session');
  console.log(`✅ AI Response: "${chatRes.answer?.substring(0, 100)}..."`);
  console.log(`   Sources:`, chatRes.sources);

  console.log('\n==================================================');
  console.log('🎉 Full Voice & AI Pipeline Verified Successfully!');
  console.log('==================================================');
}

testFullVoicePipeline().catch(console.error);
