(function () {
  let user = null;
  let mode = 'login';
  let pending = null;

  function t(key) {
    return window.UtkalI18n ? window.UtkalI18n.t(key) : key;
  }

  function userId() {
    return user ? user.id : '';
  }

  function claimLegacy(id) {
    if (!id || localStorage.getItem('utkal_legacy_owner')) return;
    const moves = [
      ['utkal_chat_sessions', `utkal_chat_sessions:${id}`],
      ['utkal_active_chat', `utkal_active_chat:${id}`],
      ['utkal_khata', `utkal_khata:${id}`],
    ];
    moves.forEach(([from, to]) => {
      const value = localStorage.getItem(from);
      if (value != null && localStorage.getItem(to) == null) localStorage.setItem(to, value);
    });
    localStorage.setItem('utkal_legacy_owner', id);
  }

  function paintAccount() {
    const name = document.getElementById('accountName');
    const logout = document.getElementById('logoutBtn');
    const admin = document.getElementById('adminTools');
    if (name) name.textContent = user ? user.name : '';
    if (logout) logout.hidden = !user;
    if (admin) admin.hidden = !(user && user.role === 'admin');
  }

  function showApp(next) {
    user = next;
    claimLegacy(next.id);
    document.body.classList.remove('auth-pending', 'needs-auth');
    paintAccount();
    if (pending) {
      const done = pending;
      pending = null;
      done(next);
    }
  }

  function showGate() {
    user = null;
    document.body.classList.remove('auth-pending');
    document.body.classList.add('needs-auth');
    paintAccount();
    setMode('login');
  }

  function setMode(next) {
    mode = next === 'signup' ? 'signup' : 'login';
    document.getElementById('authNameWrap').hidden = mode !== 'signup';
    document.getElementById('authTabLogin').classList.toggle('active', mode === 'login');
    document.getElementById('authTabSignup').classList.toggle('active', mode === 'signup');
    document.getElementById('authSubmit').textContent = t(mode === 'signup' ? 'signup' : 'login');
    document.getElementById('authPassword').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    setError('');
  }

  function setError(code) {
    const el = document.getElementById('authError');
    if (!code) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = t(code);
  }

  function setGateLang(lang) {
    const en = lang === 'en';
    localStorage.setItem('utkal_reply_lang', en ? 'en' : 'or');
    window.UtkalI18n.apply(en ? 'en' : 'or');
    document.getElementById('authLangEn').classList.toggle('active', en);
    document.getElementById('authLangOr').classList.toggle('active', !en);
    document.getElementById('authSubmit').textContent = t(mode === 'signup' ? 'signup' : 'login');
  }

  async function submit(event) {
    event.preventDefault();
    const button = document.getElementById('authSubmit');
    button.disabled = true;
    setError('');
    const body = {
      email: document.getElementById('authEmail').value,
      password: document.getElementById('authPassword').value,
    };
    if (mode === 'signup') body.name = document.getElementById('authName').value;
    try {
      const res = await fetch(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.user) {
        setError(data.code || 'BAD_LOGIN');
        return;
      }
      document.getElementById('authPassword').value = '';
      showApp(data.user);
    } catch (_) {
      setError('netError');
    } finally {
      button.disabled = false;
    }
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (_) { /* reload still drops the screen */ }
    location.reload();
  }

  function start() {
    document.getElementById('authForm').addEventListener('submit', submit);
    document.getElementById('authTabLogin').addEventListener('click', () => setMode('login'));
    document.getElementById('authTabSignup').addEventListener('click', () => setMode('signup'));
    document.getElementById('authLangOr').addEventListener('click', () => setGateLang('or'));
    document.getElementById('authLangEn').addEventListener('click', () => setGateLang('en'));
    document.getElementById('logoutBtn').addEventListener('click', logout);
    setGateLang(localStorage.getItem('utkal_reply_lang') === 'en' ? 'en' : 'or');

    const ready = new Promise((resolve) => { pending = resolve; });
    fetch('/api/auth/me')
      .then(async (res) => {
        if (!res.ok) {
          showGate();
          return;
        }
        const data = await res.json();
        if (!data.user) {
          showGate();
          return;
        }
        showApp(data.user);
      })
      .catch(() => showGate());
    return ready;
  }

  window.UtkalAuth = {
    start,
    userId,
    logout,
    expire() { location.reload(); },
    current() { return user; },
  };
})();
