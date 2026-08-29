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
test('flush returns trailing text without boundary', () => {
  const b = new SentenceBuffer();
  b.push('ଏକ ଅସମ୍ପୂର୍ଣ୍ଣ ବାକ୍ୟ');
  assert.strictEqual(b.flush().length, 1);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
