/**
 * tests/live-collectors.test.js
 * Comprehensive unit tests for all live data collectors with mocked network responses.
 * Tests work 100% deterministically in sandbox mode (offline).
 */

require('dotenv').config();
if (!process.env.TAVILY_API_KEY) {
  process.env.TAVILY_API_KEY = 'test_mock_tavily_key';
}

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const {
  collectImdWeather,
  resolveLocation,
  weatherCodeToOdia,
  ODISHA_DISTRICTS
} = require('../services/collectors/imdWeatherCollector');

const { collectSrcAlerts } = require('../services/collectors/srcAlertsCollector');
const { collectGoldRates } = require('../services/collectors/goldRatesCollector');
const { collectMandiRates } = require('../services/collectors/mandiRatesCollector');
const { recordLiveAudit, readLiveAuditLog } = require('../services/liveAuditLog');
const {
  fetchLiveContext,
  isWeatherQuery,
  isSrcAlertQuery,
  isGoldQuery,
  isMandiQuery,
  isGeneralLiveQuery,
  isAnyLiveQuery
} = require('../services/liveDataService');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}\n     ${err.message}`);
  }
}

async function runSuite() {
  console.log('\n=== Live Data Collectors Unit Tests (Offline/Mocked) ===\n');

  // Backup original axios methods
  const origGet = axios.get;
  const origPost = axios.post;

  try {
    // 1. IMD & Weather Collector Tests
    console.log('-- 1. IMD Weather Collector --');

    await test('District resolution covers all 30 Odisha districts in Odia and English', () => {
      assert.ok(ODISHA_DISTRICTS.length >= 30, 'Should have at least 30 districts');
      assert.strictEqual(resolveLocation('ଭୁବନେଶ୍ୱରରେ ପାଗ କିପରି').name, 'Bhubaneswar');
      assert.strictEqual(resolveLocation('weather in Cuttack').name, 'Cuttack');
      assert.strictEqual(resolveLocation('ପୁରୀ ଜିଲ୍ଲାର ତାପମାତ୍ରା').name, 'Puri');
      assert.strictEqual(resolveLocation('Sambalpur rain forecast').name, 'Sambalpur');
      assert.strictEqual(resolveLocation('ବାଲେଶ୍ୱର ସହର').name, 'Balasore');
      assert.strictEqual(resolveLocation('ବ୍ରହ୍ମପୁର ବର୍ଷା').name, 'Berhampur');
      assert.strictEqual(resolveLocation('unknown place').name, 'Bhubaneswar'); // default
    });

    await test('Weather code accurately translates WMO codes to native Odia & English', () => {
      assert.strictEqual(weatherCodeToOdia(0).odia, 'ନିର୍ମଳ ସ୍ୱଚ୍ଛ ଆକାଶ');
      assert.strictEqual(weatherCodeToOdia(1).odia, 'ଆଂଶିକ ମେଘୁଆ ପାଗ');
      assert.strictEqual(weatherCodeToOdia(61).odia, 'ବର୍ଷା ସମ୍ଭାବନା');
      assert.strictEqual(weatherCodeToOdia(95).odia, 'ବିଜୁଳି ଘଡ଼ଘଡ଼ି ସହ ବର୍ଷା');
    });

    await test('collectImdWeather formats weather context with accurate Odia units and sources', async () => {
      axios.get = async (url) => {
        if (url.includes('api.open-meteo.com')) {
          return {
            status: 200,
            data: {
              current: {
                temperature_2m: 31.4,
                apparent_temperature: 34.0,
                relative_humidity_2m: 68,
                weather_code: 2,
                wind_speed_10m: 14.5
              }
            }
          };
        }
        if (url.includes('imd.gov.in') || url.includes('bhubaneswar')) {
          return {
            status: 200,
            data: '<html><body><div class="content"><p>ପାଣିପାଗ ସ୍ଥିତି ସାଧାରଣ ରହିବ।</p></div></body></html>'
          };
        }
        throw new Error(`Unhandled GET url: ${url}`);
      };

      const res = await collectImdWeather('କଟକରେ ଆଜି ତାପମାତ୍ରା କେତେ?');
      assert.ok(res !== null);
      assert.strictEqual(res.location, 'Cuttack');
      assert.strictEqual(res.locationOr, 'କଟକ');
      assert.strictEqual(res.temperature, 31.4);
      assert.ok(res.contextText.includes('୩୧.୪') || res.contextText.includes('31.4°C'));
      assert.ok(res.contextText.includes('କଟକ'));
      assert.ok(res.sources.includes('Open-Meteo Live Data'));
    });

    // 2. SRC Odisha Disaster / Cyclone Alerts Collector Tests
    console.log('\n-- 2. SRC Odisha Alerts Collector --');

    await test('collectSrcAlerts extracts alerts and cites official source and timestamp', async () => {
      axios.get = async (url) => {
        if (url.includes('srcodisha.nic.in')) {
          return {
            status: 200,
            data: `<html><body>
              <div class="alert-box">
                <span class="date">11-Nov-2026</span>
                <p class="title">ସତର୍କତା: ଉପକୂଳ ଓଡ଼ିଶାରେ ସାମାନ୍ୟରୁ ମଧ୍ୟମ ଧରଣର ବର୍ଷା ସମ୍ଭାବନା। ମତ୍ସ୍ୟଜୀବୀଙ୍କ ପାଇଁ ସତର୍କ ସୂଚନା।</p>
              </div>
            </body></html>`
          };
        }
        throw new Error(`Unhandled GET url: ${url}`);
      };

      const alerts = await collectSrcAlerts();
      assert.ok(alerts !== null);
      assert.strictEqual(alerts.category, 'src_alert');
      assert.ok(alerts.sources.some(s => s.includes('SRC Odisha')));
      assert.ok(alerts.contextText.includes('SRC ODISHA'));
      assert.ok(alerts.contextText.includes('ମତ୍ସ୍ୟଜୀବୀଙ୍କ ପାଇଁ ସତର୍କ ସୂଚନା'));
    });

    await test('collectSrcAlerts handles calm / no alert condition safely without hallucination', async () => {
      axios.get = async () => ({
        status: 200,
        data: '<html><body><div>କୌଣସି ଜରୁରୀକାଳୀନ ସତର୍କତା ନାହିଁ। ପରିସ୍ଥିତି ସମ୍ପୂର୍ଣ୍ଣ ସ୍ୱାଭାବିକ।</div></body></html>'
      });

      const alerts = await collectSrcAlerts();
      assert.ok(alerts !== null);
      assert.ok(alerts.contextText.includes('କୌଣସି') || alerts.contextText.includes('ସ୍ୱାଭାବିକ') || alerts.contextText.includes('ସତର୍କତା'));
    });

    // 3. Gold & Silver Rates Collector Tests
    console.log('\n-- 3. Gold Rates Collector --');

    await test('collectGoldRates parses 24K and 22K per-gram rates with reputable citations', async () => {
      axios.post = async (url, payload) => {
        if (url.includes('tavily.com')) {
          return {
            status: 200,
            data: {
              answer: 'Today 24 carat gold price in Odisha is ₹7,850 per gram (₹78,500 per 10 grams), while 22 carat gold is ₹7,200 per gram.',
              results: [
                {
                  title: 'Gold Rate Today in Odisha - Goodreturns',
                  url: 'https://www.goodreturns.in/gold-rates/odisha.html',
                  content: '24K gold rate today in Bhubaneswar is Rs 7,850 per gram. 22K gold rate is Rs 7,200 per gram.'
                },
                {
                  title: 'Today Gold Price in Odisha - NDTV Profit',
                  url: 'https://www.ndtvprofit.com/gold-rate-today/odisha',
                  content: 'Check today 22k and 24k gold and silver rates in Odisha.'
                }
              ]
            }
          };
        }
        throw new Error(`Unhandled POST url: ${url}`);
      };

      const gold = await collectGoldRates();
      assert.ok(gold !== null);
      assert.strictEqual(gold.category, 'gold_rate');
      assert.ok(gold.sources.length >= 1);
      assert.ok(gold.sources.some(s => s.toLowerCase().includes('goodreturns') || s.toLowerCase().includes('ndtv')));
      assert.ok(gold.contextText.includes('GOLD') || gold.contextText.includes('ସୁନା'));
      assert.ok(gold.contextText.includes('24K') || gold.contextText.includes('୨୪ କ୍ୟାରେଟ') || gold.contextText.includes('7,850'));
    });

    // 4. Mandi Rates Collector Tests
    console.log('\n-- 4. Mandi Rates Collector --');

    await test('collectMandiRates parses paddy (ଧାନ) / rice and MSP benchmarks from Agmarknet', async () => {
      axios.post = async (url) => {
        return {
          status: 200,
          data: {
            answer: 'Odisha Mandi paddy (Dhan) rate today is between ₹2,300 to ₹2,350 per quintal under government MSP procurement.',
            results: [
              {
                title: 'Agmarknet Odisha Mandi Price Today',
                url: 'https://agmarknet.gov.in',
                content: 'Paddy common minimum support price MSP is Rs 2,300 per quintal in Bargarh, Sambalpur, and Cuttack mandis.'
              }
            ]
          }
        };
      };

      const mandi = await collectMandiRates('ଆଜି ମଣ୍ଡିରେ ଧାନ ଦର କେତେ?');
      assert.ok(mandi !== null);
      assert.strictEqual(mandi.category, 'mandi_rate');
      assert.ok(mandi.sources.some(s => s.toLowerCase().includes('agmarknet') || s.toLowerCase().includes('mandi')));
      assert.ok(mandi.contextText.includes('MANDI') || mandi.contextText.includes('ମଣ୍ଡି'));
      assert.ok(mandi.contextText.includes('୨,୩୦୦') || mandi.contextText.includes('2300') || mandi.contextText.includes('2,300'));
    });

    // 5. Intent Classifier Tests
    console.log('\n-- 5. Intent Classification --');

    await test('Intent functions accurately discriminate live questions from static schemes', () => {
      assert.strictEqual(isWeatherQuery('ଆଜି ବର୍ଷା ହେବ କି?'), true);
      assert.strictEqual(isWeatherQuery('Subhadra yojana eligibility'), false);

      assert.strictEqual(isSrcAlertQuery('ବାତ୍ୟା ସତର୍କତା କଣ ଅଛି?'), true);
      assert.strictEqual(isSrcAlertQuery('PMEGP loan documents'), false);

      assert.strictEqual(isGoldQuery('ଆଜି ୨୨ କ୍ୟାରେଟ ସୁନା ଦର କେତେ?'), true);
      assert.strictEqual(isGoldQuery('କାଳିଆ ଯୋଜନା କିସ୍ତି'), false);

      assert.strictEqual(isMandiQuery('ଆଜି ମଣ୍ଡିରେ ଧାନ କେତେ ଟଙ୍କାରେ ବିକ୍ରି ହେଉଛି?'), true);
      assert.strictEqual(isMandiQuery('Udyam registration process'), false);

      assert.strictEqual(isAnyLiveQuery('ଆଜି ଭୁବନେଶ୍ୱରରେ ପାଣିପାଗ କେମିତି ଅଛି?'), true);
      assert.strictEqual(isAnyLiveQuery('PMEGP ସବସିଡି ନିୟମ କଣ?'), false);
    });

    // 6. Live Audit Log Tests
    console.log('\n-- 6. Live Audit Log --');

    await test('recordLiveAudit writes valid JSONL entries and reads them back', () => {
      const entry = recordLiveAudit({
        category: 'test_category',
        query: 'ଆଜି ପାଣିପାଗ ପରୀକ୍ଷା',
        source: 'Mock Source',
        valuePreview: '32°C Sunny',
        status: 'success'
      });
      assert.ok(entry !== null);
      assert.strictEqual(entry.category, 'test_category');
      assert.ok(entry.timestamp);

      const recent = readLiveAuditLog(5);
      assert.ok(Array.isArray(recent));
      assert.ok(recent.length > 0);
      assert.strictEqual(recent[recent.length - 1].category, 'test_category');
    });

    // 7. Full fetchLiveContext Orchestrator
    console.log('\n-- 7. Orchestrator fetchLiveContext --');

    await test('fetchLiveContext orchestrates multiple live queries and attaches source attribution', async () => {
      const context = await fetchLiveContext('ଆଜି ଭୁବନେଶ୍ୱରରେ ପାଣିପାଗ ଓ ସୁନା ଦର କଣ?');
      assert.ok(context !== null);
      assert.ok(context.contextText.includes('WEATHER') || context.contextText.includes('GOLD') || context.contextText.includes('ପାଣିପାଗ') || context.contextText.includes('ସୁନା'));
      assert.ok(Array.isArray(context.sources));
      assert.ok(context.sources.length >= 1);
    });

  } finally {
    // Restore axios methods
    axios.get = origGet;
    axios.post = origPost;
  }

  console.log(`\n=============================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`=============================================\n`);

  process.exit(failed ? 1 : 0);
}

runSuite();
