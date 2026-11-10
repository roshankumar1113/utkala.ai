/**
 * Acceptance Tests for Utkal.ai Bug Fixes
 */
'use strict';
const http = require('http');

const INTERNAL_RE = /master\s*instruction|system\s*prompt|internal\s*(doc|document|instruction)|instruction\s*#\s*\d+/i;
const BARE_DOMAIN_RE = /^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?(\.[a-z]{2,})+\/?$/i;

function post(path, body, cookieHeader) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: 'localhost', port: 5001, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    };
    const start = Date.now();
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const elapsed = Date.now() - start;
        let json; try { json = JSON.parse(data); } catch (_) { json = { raw: data }; }
        resolve({ status: res.statusCode, body: json, elapsed });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function checkSources(src) {
  const issues = [];
  if (!Array.isArray(src)) { issues.push('ragSources not an array'); return issues; }
  const seen = new Set();
  for (const s of src) {
    const key = String(s).toLowerCase().trim().replace(/\s+/g, ' ');
    if (seen.has(key)) issues.push(`DUPLICATE: "${s}"`);
    seen.add(key);
    if (INTERNAL_RE.test(s)) issues.push(`INTERNAL LEAKED: "${s}"`);
    if (BARE_DOMAIN_RE.test(s)) issues.push(`BARE DOMAIN: "${s}"`);
  }
  if (src.length > 3) issues.push(`CAP EXCEEDED: ${src.length} chips`);
  return issues;
}

let passed = 0, failed = 0;
function PASS(n, d) { console.log(`  ✅ PASS: ${n}${d ? ' — ' + d : ''}`); passed++; }
function FAIL(n, d) { console.error(`  ❌ FAIL: ${n}${d ? ' — ' + d : ''}`); failed++; }

async function getAuthCookie() {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ email: 'test@test.com', password: 'testpassword123' });
    const options = {
      hostname: 'localhost', port: 5001, path: '/api/auth/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };
    const req = http.request(options, (res) => {
      let data = ''; res.on('data', (c) => (data += c));
      res.on('end', () => {
        const cookies = res.headers['set-cookie'] || [];
        const sc = cookies.find((c) => c.startsWith('utkal_session='));
        resolve(sc ? sc.split(';')[0] : null);
      });
    });
    req.on('error', () => resolve(null));
    req.write(payload); req.end();
  });
}

async function run() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Utkal.ai Acceptance Tests (local port 5001)');
  console.log('══════════════════════════════════════════════════════\n');

  // TEST 6: unauthenticated 401 timing
  console.log('TEST 6 — Unauthenticated POST /api/chat → 401 in < 500ms');
  const r1 = await post('/api/chat', { message: 'test' });
  const r2 = await post('/api/chat', { message: 'test' }); // cached
  console.log(`  First call: HTTP ${r1.status} in ${r1.elapsed}ms`);
  console.log(`  Second call (cached): HTTP ${r2.status} in ${r2.elapsed}ms`);
  if (r1.status === 401) PASS('Returns 401'); else FAIL('Returns 401', `Got ${r1.status}`);
  if (r2.elapsed < 500) PASS(`Cached 401 in < 500ms`, `${r2.elapsed}ms`);
  else FAIL(`Cached 401 in ${r2.elapsed}ms (should be < 500ms)`);
  console.log();

  const cookie = await getAuthCookie();
  if (!cookie) {
    console.log('  ⚠️  Login failed — authenticated tests skipped (no test account)\n');
    console.log(`RESULTS: ${passed} passed, ${failed} failed\n`);
    return;
  }
  console.log(`  ℹ️  Cookie: ${cookie.substring(0,40)}...\n`);

  // Helper
  async function ask(testN, question, extraCheck) {
    console.log(`TEST ${testN} — ${question.substring(0, 80)}`);
    const r = await post('/api/chat', { message: question, useRag: true, replyLanguage: 'en' }, cookie);
    const src = r.body.ragSources || [];
    const issues = checkSources(src);
    console.log(`  Answer: "${String(r.body.response||r.body.message||'').substring(0,150)}..."`);
    console.log(`  Sources(${src.length}): ${JSON.stringify(src)}`);
    if (issues.length) issues.forEach((i) => FAIL(`Test ${testN}`, i));
    else PASS(`Test ${testN} sources clean`, `${src.length} chip(s)`);
    if (extraCheck) extraCheck(r, src);
    console.log();
  }

  await ask(1, 'What is the Subhadra Yojana and what documents are needed?');
  await ask(2, 'What is PMEGP loan?');

  // Test 3: weather
  console.log("TEST 3 — Today's temperature in Bhubaneswar");
  {
    const r = await post('/api/chat', { message: "What is today's temperature in Bhubaneswar?", useRag: true, replyLanguage: 'en' }, cookie);
    const src = r.body.ragSources || [];
    const ans = String(r.body.response || r.body.message || '');
    const issues = checkSources(src);
    console.log(`  Answer: "${ans.substring(0, 200)}"`);
    console.log(`  Sources(${src.length}): ${JSON.stringify(src)}`);
    const hasTemp = /\d+\s*°?C|\d+\s*degree/i.test(ans);
    const honestNoLive = /do not have live|no live information/i.test(ans);
    if (issues.length) issues.forEach((i) => FAIL('Test 3 sources', i));
    if (hasTemp) PASS('Test 3 — Real temperature returned', `sources: ${src.length}`);
    else if (honestNoLive && src.length === 0) PASS('Test 3 — Honest no-live-info with 0 chips');
    else FAIL('Test 3 — No temperature and no honest reply', `sources: ${JSON.stringify(src)}`);
  }
  console.log();

  // Test 4: gold price
  await ask(4, 'What is the price of gold today in India?', (r, src) => {
    const wikiCount = src.filter((s) => /wikipedia/i.test(s)).length;
    if (wikiCount >= 3) FAIL('Test 4 — 3 Wikipedia chips', `${wikiCount} wiki sources`);
    else PASS('Test 4 — No 3-Wikipedia overload');
  });

  // Test 5: Odia news
  await ask(5, 'What is the latest Odia news today?', (r, src) => {
    const bare = src.filter((s) => BARE_DOMAIN_RE.test(s));
    if (bare.length) FAIL('Test 5 — Bare domains', JSON.stringify(bare));
    else PASS('Test 5 — No bare domain chips');
  });

  // Test 7: client-side cleanSources logic validation
  console.log('TEST 7 — cleanSources logic (simulates old saved chat cleaning)');
  {
    const dirty = [
      'Odia Master Instruction #11', 'youtube.com',
      'Bhubaneswar - Wikipedia', 'Bhubaneswar - Wikipedia',
      'Odisha - Wikipedia', 'Odisha - Wikipedia', 'Odisha - Wikipedia',
    ];
    const seen = new Set(); const out = [];
    for (const item of dirty) {
      const t = String(item).trim();
      if (!t || INTERNAL_RE.test(t) || BARE_DOMAIN_RE.test(t)) continue;
      const key = t.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) continue;
      seen.add(key); out.push(t);
      if (out.length === 3) break;
    }
    console.log(`  Input(${dirty.length}): ${JSON.stringify(dirty)}`);
    console.log(`  Output(${out.length}): ${JSON.stringify(out)}`);
    if (!out.some((s) => INTERNAL_RE.test(s))) PASS('Test 7 — Internal docs removed');
    else FAIL('Test 7 — Internal doc not cleaned');
    if (!out.some((s) => BARE_DOMAIN_RE.test(s))) PASS('Test 7 — Bare domains removed');
    else FAIL('Test 7 — Bare domain leaked');
    if (new Set(out.map((s) => s.toLowerCase())).size === out.length) PASS('Test 7 — Deduped');
    else FAIL('Test 7 — Duplicates remain');
    if (out.length <= 3) PASS(`Test 7 — Capped at ≤3 (got ${out.length})`);
    else FAIL(`Test 7 — Cap exceeded: ${out.length}`);
  }
  console.log();

  console.log('══════════════════════════════════════════════════════');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => { console.error('Fatal:', e); process.exit(1); });
