/**
 * voice-unit.test.js
 * Dependency-free unit tests for Utkal.ai Voice 2.0 safety/logic modules.
 * Run: node tests/voice-unit.test.js
 *
 * These cover the parts that do NOT need external API credentials:
 * transcript hallucination gating, provider-error classification, ledger
 * validation, and streaming sentence buffering.
 */

const assert = require('assert');
const stt = require('../services/sttValidationService');
const providerErrors = require('../services/providerErrors');
const ledger = require('../services/ledgerValidationService');
const { SentenceBuffer } = require('../services/sentenceBuffer');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}\n     ${err.message}`);
  }
}

console.log('\n== STT transcript validation ==');
test('rejects Gemini audio-description hallucination', () => {
  const r = stt.validateTranscript('The sound of a door being shut is heard.', { languageMode: 'od-IN' });
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reason, 'AUDIO_DESCRIPTION');
});
test('rejects English narration in od-IN mode (not Odia script)', () => {
  const r = stt.validateTranscript('hello how are you', { languageMode: 'od-IN' });
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reason, 'NOT_ODIA_SCRIPT');
});
test('accepts genuine Odia sentence in od-IN mode', () => {
  const r = stt.validateTranscript('ସୁଭଦ୍ରା ଯୋଜନା ବିଷୟରେ କୁହନ୍ତୁ।', { languageMode: 'od-IN' });
  assert.strictEqual(r.valid, true);
});
test('accepts English in auto mode', () => {
  const r = stt.validateTranscript('tell me about the scheme', { languageMode: 'auto' });
  assert.strictEqual(r.valid, true);
});
test('rejects empty and too-short', () => {
  assert.strictEqual(stt.validateTranscript('', { languageMode: 'auto' }).valid, false);
  assert.strictEqual(stt.validateTranscript('a', { languageMode: 'auto' }).valid, false);
});
test('rejects "inaudible"/"silence" markers', () => {
  assert.strictEqual(stt.validateTranscript('[inaudible]', { languageMode: 'auto' }).valid, false);
  assert.strictEqual(stt.validateTranscript('silence', { languageMode: 'auto' }).valid, false);
});

console.log('\n== Provider error classification ==');
test('classifies 429 as RATE_LIMITED + quotaExhausted', () => {
  const c = providerErrors.classify({ response: { status: 429, data: { error: { message: 'RESOURCE_EXHAUSTED' } }, headers: { 'retry-after': '30' } } });
  assert.strictEqual(c.code, 'RATE_LIMITED');
  assert.strictEqual(c.quotaExhausted, true);
  assert.strictEqual(c.retryAfterMs, 30000);
});
test('classifies timeout', () => {
  assert.strictEqual(providerErrors.classify(new Error('Gemini STT timeout')).code, 'TIMEOUT');
});
test('classifies 401 auth (not retryable)', () => {
  const c = providerErrors.classify({ response: { status: 401 } });
  assert.strictEqual(c.code, 'AUTH');
  assert.strictEqual(c.retryable, false);
});
test('classifies network error', () => {
  assert.strictEqual(providerErrors.classify(new Error('ECONNREFUSED')).code, 'NETWORK');
});

console.log('\n== Ledger validation (financial safety) ==');
test('valid full transaction passes', () => {
  const r = ledger.validateTransaction({ action: 'SALE', party: 'ରମେଶ', amount: 12000, item: 'ଶାଢ଼ୀ', payment_type: 'CREDIT' });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.normalized.amount, 12000);
});
test('missing amount asks for amount, never guesses', () => {
  const r = ledger.validateTransaction({ action: 'SALE', party: 'ରମେଶ', amount: 0, item: 'ଶାଢ଼ୀ', payment_type: 'CREDIT' });
  assert.strictEqual(r.valid, false);
  assert.ok(r.missing.includes('amount'));
  assert.ok(r.clarification.includes('କେତେ'));
});
test('missing party asks for party', () => {
  const r = ledger.validateTransaction({ action: 'SALE', party: 'N/A', amount: 500, item: 'N/A', payment_type: 'CASH' });
  assert.strictEqual(r.valid, false);
  assert.ok(r.missing.includes('party'));
});
test('UNKNOWN action is ambiguous', () => {
  const r = ledger.validateTransaction({ action: 'UNKNOWN', party: 'N/A', amount: 0, item: 'N/A', payment_type: 'UNKNOWN' });
  assert.strictEqual(r.needsClarification, true);
});

console.log('\n== Admin guard ==');
const access = require('../services/accessGuard');
test('localhost may upload without a token', () => {
  assert.strictEqual(access.isAllowedAdminRequest({ ip: '127.0.0.1', header: '', token: '' }), true);
  assert.strictEqual(access.isAllowedAdminRequest({ ip: '::ffff:127.0.0.1', header: '', token: '' }), true);
});
test('a remote address is refused unless the admin token matches', () => {
  assert.strictEqual(access.isAllowedAdminRequest({ ip: '203.0.113.8', header: '', token: 'secret' }), false);
  assert.strictEqual(access.isAllowedAdminRequest({ ip: '203.0.113.8', header: 'secret', token: 'secret' }), true);
  assert.strictEqual(access.isAllowedAdminRequest({ ip: '203.0.113.8', header: 'your_admin_token_here', token: 'your_admin_token_here' }), false);
});

const speakers = require('../services/voiceSpeakers');
test('five voices cover male and female, unknown id falls back', () => {
  assert.strictEqual(speakers.VOICES.length, 5);
  assert.ok(speakers.VOICES.some((v) => v.gender === 'female'));
  assert.ok(speakers.VOICES.some((v) => v.gender === 'male'));
  assert.strictEqual(speakers.resolveVoice('nope').id, 'priya');
  assert.strictEqual(speakers.resolveVoice('SHUBH').id, 'shubh');
});

console.log('\n== Streaming sentence buffer ==');
test('emits complete Odia sentences on danda boundary', () => {
  const b = new SentenceBuffer();
  let out = b.push('ସୁଭଦ୍ରା ଯୋଜନା ଓଡ଼ିଶା ସରକାରଙ୍କ ଏକ ଯୋଜନା।');
  assert.strictEqual(out.length, 1);
  out = out.concat(b.push(' ଏହାର ଲାଭ ପାଇବା ପାଇଁ ଯୋଗ୍ୟତା ରହିଛି।'));
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(b.flush(), []);
});
test('buffers partial deltas until boundary', () => {
  const b = new SentenceBuffer();
  assert.deepStrictEqual(b.push('ସୁଭଦ୍ରା '), []);
  assert.deepStrictEqual(b.push('ଯୋଜନା '), []);
  const out = b.push('ବିଷୟରେ କୁହନ୍ତୁ।');
  assert.strictEqual(out.length, 1);
});
test('a short greeting does not stall the following sentence', () => {
  const b = new SentenceBuffer();
  const out = b.push('ନମସ୍କାର! ଆପଣ କେମିତି ଅଛନ୍ତି?');
  assert.strictEqual(out.length, 1);
  assert.ok(out[0].includes('କେମିତି'));
});
test('flush returns trailing text without boundary', () => {
  const b = new SentenceBuffer();
  b.push('ଏକ ଅସମ୍ପୂର୍ଣ୍ଣ ବାକ୍ୟ');
  assert.strictEqual(b.flush().length, 1);
});

console.log('\n== Live talk delivery ==');
const delivery = require('../services/voiceDelivery');
test('auto mode follows Hindi, English, and Hinglish', () => {
  const auto = { languageMode: 'auto', replyLanguage: 'or' };
  assert.strictEqual(delivery.detectSpokenLanguage('आज मौसम कैसा है?', auto), 'hi');
  assert.strictEqual(delivery.detectSpokenLanguage('What is the weather today?', auto), 'en');
  assert.strictEqual(delivery.detectSpokenLanguage('bhai what is the plan yaar', auto), 'mix');
  assert.strictEqual(delivery.detectSpokenLanguage('ଆଜି ପାଗ କେମିତି?', auto), 'or');
});
test('Odia mode and the English chip stay fixed', () => {
  assert.strictEqual(delivery.detectSpokenLanguage('what is this', { languageMode: 'od-IN', replyLanguage: 'or' }), 'or');
  assert.strictEqual(delivery.detectSpokenLanguage('आज कैसा है', { languageMode: 'auto', replyLanguage: 'en' }), 'en');
});
test('laughter is said once and humor speaks warmer and a bit quicker', () => {
  const line = delivery.forUtterance('ha ha ha ha that was funny', 'tell me a joke', 1);
  assert.strictEqual(line.text.includes('ha ha ha ha'), false);
  assert.ok(line.text.includes('ha ha'));
  assert.strictEqual(line.emotion, 'humor');
  assert.ok(line.temperature >= 0.78);
  assert.ok(line.pace > 1);
});
test('worry is slower than a cheerful reply', () => {
  const sad = delivery.forUtterance('I am sorry you are worried', 'I feel sad', 1);
  const glad = delivery.forUtterance('That is wonderful news', 'I got the job', 1);
  assert.strictEqual(sad.emotion, 'empathy');
  assert.strictEqual(glad.emotion, 'happy');
  assert.ok(sad.pace < glad.pace);
});
test('pace and temperature stay inside Bulbul v3 limits', () => {
  const line = delivery.forUtterance('hello there', '', 9);
  assert.ok(line.pace <= 2 && line.pace >= 0.5);
  assert.ok(line.temperature <= 1 && line.temperature >= 0.01);
  assert.strictEqual(delivery.languageCode('mix'), 'hi-IN');
  assert.strictEqual(delivery.languageCode('en'), 'en-IN');
  assert.strictEqual(delivery.languageCode('or'), 'od-IN');
});
test('only money talk waits for the ledger parser', () => {
  assert.strictEqual(delivery.looksLikeLedger('ରମେଶଙ୍କୁ 500 ଟଙ୍କା ଉଧାର ଦେଲି'), true);
  assert.strictEqual(delivery.looksLikeLedger('ଗୀତଟେ ଗା'), false);
  assert.strictEqual(delivery.looksLikeLedger('Romantic album'), false);
});
test('English spelled in Odia letters is sent back for another listen', () => {
  assert.strictEqual(delivery.looksLikeForeignInOdia('ଆର୍ ୟୁ ଦେୟାର୍ କେନ୍ ୟୁ ହାର୍ ମି?'), true);
  assert.strictEqual(delivery.looksLikeForeignInOdia('ଆଜି ପାଗ କେମିତି?'), false);
  assert.strictEqual(delivery.looksLikeForeignInOdia('can you hear me'), false);
});
test('a long spoken phrase can start at a comma', () => {
  const b = new SentenceBuffer({ conversational: true });
  const out = b.push('I wanted to tell you something important about the shop, and then ask how your day went');
  assert.ok(out.length >= 1);
  assert.ok(out[0].endsWith(','));
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
