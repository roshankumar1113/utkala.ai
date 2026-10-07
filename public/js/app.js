(function () {
  const screens = ['chat', 'voice', 'khata'];

  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3600);
  }

  function go(name) {
    if (!screens.includes(name)) name = 'chat';
    document.querySelectorAll('.screen').forEach((el) => {
      el.classList.toggle('active', el.id === `screen${name[0].toUpperCase()}${name.slice(1)}`);
    });
    document.querySelectorAll('[data-screen]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.screen === name);
    });
    history.replaceState(null, '', `#${name}`);
    if (name === 'khata') window.UtkalKhata?.render();
  }

  function applyFont(size) {
    const next = Math.min(22, Math.max(14, size));
    document.documentElement.style.setProperty('--body', `${next}px`);
    localStorage.setItem('utkal_ai_font_size', String(next));
  }

  function setLang(lang) {
    const en = lang === 'en';
    localStorage.setItem('utkal_reply_lang', en ? 'en' : 'or');
    document.getElementById('langEn').classList.toggle('active', en);
    document.getElementById('langOr').classList.toggle('active', !en);
    if (window.UtkalVoice) {
      /* next utterance picks this up */
    }
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('utkal_ai_theme', theme);
    document.querySelectorAll('#themeMenu [data-theme]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });
  }

  async function checkHealth() {
    const dot = document.getElementById('connDot');
    const text = document.getElementById('connText');
    try {
      const res = await fetch('/health');
      if (!res.ok) throw new Error('down');
      dot.classList.add('on');
      text.textContent = 'ସଂଯୁକ୍ତ';
    } catch (_) {
      dot.classList.remove('on');
      text.textContent = 'ସଂଯୋଗ ନାହିଁ';
    }
  }

  function init() {
    const savedFont = parseFloat(localStorage.getItem('utkal_ai_font_size') || '16');
    applyFont(Number.isFinite(savedFont) ? savedFont : 16);
    setTheme(localStorage.getItem('utkal_ai_theme') || 'amber');
    setLang(localStorage.getItem('utkal_reply_lang') || 'or');

    document.querySelectorAll('[data-screen]').forEach((btn) => {
      btn.addEventListener('click', () => go(btn.dataset.screen));
    });
    document.getElementById('fontUp').addEventListener('click', () => {
      const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--body')) || 16;
      applyFont(current + 1);
    });
    document.getElementById('fontDown').addEventListener('click', () => {
      const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--body')) || 16;
      applyFont(current - 1);
    });
    document.getElementById('langOr').addEventListener('click', () => setLang('or'));
    document.getElementById('langEn').addEventListener('click', () => setLang('en'));
    document.getElementById('themeBtn').addEventListener('click', () => {
      document.getElementById('themeMenu').classList.toggle('open');
    });
    document.querySelectorAll('#themeMenu [data-theme]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setTheme(btn.dataset.theme);
        document.getElementById('themeMenu').classList.remove('open');
      });
    });
    document.getElementById('sessionsToggle').addEventListener('click', () => {
      document.getElementById('sessionsPanel').classList.toggle('open');
    });
    document.getElementById('callBtn').addEventListener('click', async () => {
      go('voice');
      try { await window.UtkalVoice.startCall(); }
      catch (_) { toast(window.MicWav.micMessage(_)); }
    });

    window.UtkalKhata.init();
    window.UtkalChat.init();
    window.UtkalVoice.init();

    const hash = (location.hash || '#chat').slice(1);
    go(screens.includes(hash) ? hash : 'chat');
    checkHealth();
  }

  window.UtkalApp = { go, toast };
  init();
})();
