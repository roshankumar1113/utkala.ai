function isLocalAddress(ip) {
  const clean = String(ip || '').replace(/^::ffff:/, '');
  return clean === '127.0.0.1' || clean === '::1' || clean === 'localhost';
}

function isAllowedAdminRequest({ ip, header, token }) {
  if (token && header && header === token && !/your_|placeholder/i.test(token)) return true;
  return isLocalAddress(ip);
}

module.exports = { isLocalAddress, isAllowedAdminRequest };
