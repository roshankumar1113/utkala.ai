/**
 * live-data.test.js
 * Unit tests for live data grounding (Open-Meteo weather, Tavily search, and prompt rules).
 * Run: node tests/live-data.test.js
 */

const assert = require('assert');
const {
  fetchLiveContext,
  LIVE_PROMPT_RULE,
  isWeatherQuery,
  isLiveSearchQuery,
  fetchWeather,
} = require('../services/liveDataService');
const { buildSystemInstruction } = require('../services/chatService');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return res
        .then(() => {
          passed++;
          console.log(`  ✅ ${name}`);
        })
        .catch((err) => {
          failed++;
          console.log(`  ❌ ${name}\n     ${err.message}`);
        });
    }
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}\n     ${err.message}`);
  }
}

async function run() {
  console.log('\n== Live Data Prompt Rules & Integration ==');

  test('LIVE_PROMPT_RULE contains all mandatory safety and grounding rules', () => {
    assert.ok(LIVE_PROMPT_RULE.includes('LIVE DATA RULES'));
    assert.ok(LIVE_PROMPT_RULE.includes('LIVE WEATHER'));
    assert.ok(LIVE_PROMPT_RULE.includes('LIVE WEB RESULTS'));
    assert.ok(LIVE_PROMPT_RULE.includes('answer ONLY from it'));
    assert.ok(LIVE_PROMPT_RULE.includes('sources differ'));
    assert.ok(LIVE_PROMPT_RULE.includes('I do not have live information'));
    assert.ok(LIVE_PROMPT_RULE.includes('potentially suitable'));
  });

  test('buildSystemInstruction appends LIVE_PROMPT_RULE to Odia, English, and Spoken modes', () => {
    const odiaPrompt = buildSystemInstruction('or');
    assert.ok(odiaPrompt.includes('LIVE DATA RULES'));

    const enPrompt = buildSystemInstruction('en');
    assert.ok(enPrompt.includes('LIVE DATA RULES'));

    const spokenPrompt = buildSystemInstruction('or', { spoken: true });
    assert.ok(spokenPrompt.includes('LIVE DATA RULES'));
  });

  test('isWeatherQuery detects English and Odia weather keywords', () => {
    assert.strictEqual(isWeatherQuery('bhubaneswar weather today'), true);
    assert.strictEqual(isWeatherQuery('ଆଜି କଟକରେ ପାଣିପାଗ କେମିତି ଅଛି?'), true);
    assert.strictEqual(isWeatherQuery('tomorrow temperature forecast'), true);
    assert.strictEqual(isWeatherQuery('how to make chhena poda'), false);
    assert.strictEqual(isWeatherQuery('ସୁଭଦ୍ରା ଯୋଜନାରେ କିପରି ଆବେଦନ କରିବେ'), false);
  });

  test('isLiveSearchQuery detects live/current queries', () => {
    assert.strictEqual(isLiveSearchQuery('today petrol price in odisha'), true);
    assert.strictEqual(isLiveSearchQuery('ଆଜି ସୁନା ଦର କେତେ?'), true);
    assert.strictEqual(isLiveSearchQuery('latest news update'), true);
    assert.strictEqual(isLiveSearchQuery('what is the history of Konark sun temple'), false);
  });

  await test('fetchWeather retrieves real Open-Meteo live data with zero API key', async () => {
    const data = await fetchWeather('What is the weather in Cuttack today?');
    assert.ok(data !== null);
    assert.ok(data.contextText.includes('[LIVE WEATHER - Open-Meteo live data]'));
    assert.ok(data.contextText.includes('Cuttack'));
    assert.ok(data.sources.includes('Open-Meteo live data'));
  });

  await test('fetchLiveContext handles non-live queries by returning null (saves latency)', async () => {
    const data = await fetchLiveContext('What are the symptoms of common cold?');
    assert.strictEqual(data, null);
  });

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed ? 1 : 0);
}

run();
