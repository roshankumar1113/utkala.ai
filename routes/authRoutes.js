const express = require('express');
const authService = require('../services/authService');
const authHttp = require('../services/authHttp');

const router = express.Router();

function sendResult(res, req, result) {
  if (!result.ok) return res.status(result.status).json({ success: false, code: result.code });
  authHttp.setSessionCookie(res, result.token, req);
  return res.status(200).json({ success: true, user: result.user });
}

router.post('/signup', (req, res) => {
  if (authHttp.tooMany(authHttp.clientIp(req))) {
    return res.status(429).json({ success: false, code: 'RATE_LIMIT' });
  }
  const result = authService.signup(req.body || {});
  return sendResult(res, req, result);
});

router.post('/login', (req, res) => {
  if (authHttp.tooMany(authHttp.clientIp(req))) {
    return res.status(429).json({ success: false, code: 'RATE_LIMIT' });
  }
  const result = authService.login(req.body || {});
  return sendResult(res, req, result);
});

router.post('/logout', (req, res) => {
  authService.logout(authHttp.tokenFromRequest(req));
  authHttp.clearSessionCookie(res, req);
  return res.status(200).json({ success: true });
});

router.get('/me', (req, res) => {
  const user = authService.userFromToken(authHttp.tokenFromRequest(req));
  if (!user) return res.status(401).json({ success: false, code: 'UNAUTHORIZED' });
  return res.status(200).json({ success: true, user });
});

module.exports = router;
