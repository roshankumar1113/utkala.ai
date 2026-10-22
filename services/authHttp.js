const authService = require('./authService');

const COOKIE = 'utkal_session';
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || 'local');
}

function tooMany(ip) {
  const now = Date.now();
  const row = attempts.get(ip);
  if (!row || row.until <= now) {
    attempts.set(ip, { count: 1, until: now + WINDOW_MS });
    return false;
  }
  row.count += 1;
  return row.count > MAX_ATTEMPTS;
}

function cookieValue(token, req, maxAge) {
  const secure = Boolean(req.secure || req.headers['x-forwarded-proto'] === 'https');
  const parts = [
    `${COOKIE}=${encodeURIComponent(token || '')}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function setSessionCookie(res, token, req) {
  res.setHeader('Set-Cookie', cookieValue(token, req, Math.floor(authService.SESSION_MS / 1000)));
}

function clearSessionCookie(res, req) {
  res.setHeader('Set-Cookie', cookieValue('', req, 0));
}

function tokenFromRequest(req) {
  return authService.readCookie(req.headers.cookie, COOKIE);
}

function requireAuth(req, res, next) {
  const user = authService.userFromToken(tokenFromRequest(req));
  if (!user) {
    return res.status(401).json({ success: false, code: 'UNAUTHORIZED' });
  }
  req.user = user;
  return next();
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ success: false, code: 'FORBIDDEN' });
}

function socketAuth(socket, next) {
  const user = authService.userFromCookieHeader(socket.handshake.headers.cookie);
  if (!user) return next(new Error('UNAUTHORIZED'));
  socket.user = user;
  return next();
}

module.exports = {
  tooMany,
  clientIp,
  setSessionCookie,
  clearSessionCookie,
  tokenFromRequest,
  requireAuth,
  requireAdmin,
  socketAuth,
};
