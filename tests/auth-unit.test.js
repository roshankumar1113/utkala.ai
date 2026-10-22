/**
 * Account and session checks. Uses a throwaway data folder.
 * Run: node tests/auth-unit.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utkal-auth-'));
process.env.AUTH_DATA_DIR = dir;
process.env.ADMIN_EMAIL = 'owner@utkal.test';
const auth = require('../services/authService');

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

console.log('\n== Auth accounts ==');

test('first signup is admin and can log in', () => {
  const created = auth.signup({ name: 'Owner', email: 'Owner@Utkal.test', password: 'secret-pass' });
  assert.strictEqual(created.ok, true);
  assert.strictEqual(created.user.role, 'admin');
  assert.strictEqual(created.user.email, 'owner@utkal.test');
  const session = auth.userFromToken(created.token);
  assert.strictEqual(session.id, created.user.id);
});

test('second person is a normal user', () => {
  const created = auth.signup({ name: 'Mina', email: 'mina@shop.test', password: 'another-pass' });
  assert.strictEqual(created.ok, true);
  assert.strictEqual(created.user.role, 'user');
});

test('configured admin email stays admin', () => {
  const created = auth.signup({ name: 'Desk', email: 'owner@utkal.test', password: 'secret-pass' });
  assert.strictEqual(created.code, 'EMAIL_USED');
  const extra = auth.signup({ name: 'Desk', email: 'desk@utkal.test', password: 'secret-pass' });
  assert.strictEqual(extra.user.role, 'user');
  process.env.ADMIN_EMAIL = 'desk@utkal.test';
  const promoted = auth.signup({ name: 'Desk Two', email: 'desk2@utkal.test', password: 'secret-pass' });
  assert.strictEqual(promoted.user.role, 'user');
  process.env.ADMIN_EMAIL = 'boss@utkal.test';
  const boss = auth.signup({ name: 'Boss', email: 'boss@utkal.test', password: 'secret-pass' });
  assert.strictEqual(boss.user.role, 'admin');
});

test('rejects short passwords and bad email', () => {
  assert.strictEqual(auth.signup({ name: 'A', email: 'a@b.c', password: 'short' }).code, 'WEAK_PASSWORD');
  assert.strictEqual(auth.signup({ name: 'A', email: 'not-an-email', password: 'long-enough' }).code, 'BAD_EMAIL');
  assert.strictEqual(auth.signup({ name: '   ', email: 'ok@shop.test', password: 'long-enough' }).code, 'NEED_NAME');
});

test('wrong password fails and logout kills the token', () => {
  const bad = auth.login({ email: 'mina@shop.test', password: 'wrong-password' });
  assert.strictEqual(bad.code, 'BAD_LOGIN');
  const good = auth.login({ email: 'mina@shop.test', password: 'another-pass' });
  assert.strictEqual(good.ok, true);
  auth.logout(good.token);
  assert.strictEqual(auth.userFromToken(good.token), null);
});

test('cookie header resolves the signed-in user', () => {
  const good = auth.login({ email: 'owner@utkal.test', password: 'secret-pass' });
  const header = `theme=amber; utkal_session=${encodeURIComponent(good.token)}`;
  assert.strictEqual(auth.userFromCookieHeader(header).role, 'admin');
  assert.strictEqual(auth.userFromCookieHeader('utkal_session=nope'), null);
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
