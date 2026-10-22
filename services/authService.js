/**
 * File-backed accounts and session tokens.
 * Passwords are scrypt hashes. Session tokens are random and only their
 * SHA-256 is stored. The first account, or ADMIN_EMAIL, is the admin.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 32;

function dataDir() {
  return process.env.AUTH_DATA_DIR || path.join(__dirname, '..', 'data');
}

function usersFile() {
  return path.join(dataDir(), 'users.json');
}

function sessionsFile() {
  return path.join(dataDir(), 'sessions.json');
}

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function loadUsers() {
  const data = readJson(usersFile(), { users: [] });
  if (!Array.isArray(data.users)) data.users = [];
  return data;
}

function loadSessions() {
  const data = readJson(sessionsFile(), { sessions: [] });
  if (!Array.isArray(data.sessions)) data.sessions = [];
  const now = Date.now();
  data.sessions = data.sessions.filter((row) => row && row.expiresAt > now);
  return data;
}

function cleanName(value) {
  const name = String(value || '').replace(/[\u0000-\u001f]/g, '').trim();
  if (name.length < 1 || name.length > 60) return '';
  return name;
}

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return '';
  return email;
}

function isAdminEmail(email) {
  const configured = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  return Boolean(configured) && configured === email;
}

function hashPassword(password, salt = crypto.randomBytes(16)) {
  const hash = crypto.scryptSync(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

let dummyHash = null;
function dummyPasswordHash() {
  if (!dummyHash) dummyHash = hashPassword('not-a-real-password');
  return dummyHash;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[4], 'hex');
  const expected = Buffer.from(parts[5], 'hex');
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = crypto.scryptSync(password, salt, expected.length, SCRYPT);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role === 'admin' ? 'admin' : 'user',
  };
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const data = loadSessions();
  data.sessions.push({
    id: tokenHash(token),
    userId,
    expiresAt: Date.now() + SESSION_MS,
  });
  writeJson(sessionsFile(), data);
  return token;
}

function signup({ name, email, password }) {
  const clean = {
    name: cleanName(name),
    email: cleanEmail(email),
    password: String(password || ''),
  };
  if (!clean.name) return { ok: false, status: 400, code: 'NEED_NAME' };
  if (!clean.email) return { ok: false, status: 400, code: 'BAD_EMAIL' };
  if (clean.password.length < 8 || clean.password.length > 72) {
    return { ok: false, status: 400, code: 'WEAK_PASSWORD' };
  }
  const db = loadUsers();
  if (db.users.some((user) => user.email === clean.email)) {
    return { ok: false, status: 409, code: 'EMAIL_USED' };
  }
  const role = db.users.length === 0 || isAdminEmail(clean.email) ? 'admin' : 'user';
  const user = {
    id: crypto.randomUUID(),
    name: clean.name,
    email: clean.email,
    passwordHash: hashPassword(clean.password),
    role,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  writeJson(usersFile(), db);
  return { ok: true, token: createSession(user.id), user: publicUser(user) };
}

function login({ email, password }) {
  const clean = cleanEmail(email);
  const secret = String(password || '');
  const user = clean ? loadUsers().users.find((row) => row.email === clean) : null;
  const hash = user ? user.passwordHash : dummyPasswordHash();
  const matches = verifyPassword(secret, hash);
  if (!user || !matches) return { ok: false, status: 401, code: 'BAD_LOGIN' };
  return { ok: true, token: createSession(user.id), user: publicUser(user) };
}

function logout(token) {
  if (!token) return;
  const id = tokenHash(token);
  const data = loadSessions();
  data.sessions = data.sessions.filter((row) => row.id !== id);
  writeJson(sessionsFile(), data);
}

function userFromToken(token) {
  if (!token || typeof token !== 'string' || token.length < 32) return null;
  const id = tokenHash(token);
  const row = loadSessions().sessions.find((item) => item.id === id);
  if (!row) return null;
  const user = loadUsers().users.find((item) => item.id === row.userId);
  return user ? publicUser(user) : null;
}

function readCookie(header, name) {
  const parts = String(header || '').split(';');
  for (const part of parts) {
    const text = part.trim();
    const eq = text.indexOf('=');
    if (eq === -1) continue;
    if (text.slice(0, eq) !== name) continue;
    try {
      return decodeURIComponent(text.slice(eq + 1));
    } catch (_) {
      return '';
    }
  }
  return '';
}

function userFromCookieHeader(header) {
  return userFromToken(readCookie(header, 'utkal_session'));
}

module.exports = {
  signup,
  login,
  logout,
  userFromToken,
  userFromCookieHeader,
  readCookie,
  publicUser,
  SESSION_MS,
};
