(function () {
  function chatStore() {
    const id = window.UtkalAuth && window.UtkalAuth.userId();
    return id ? `utkal_chat_sessions:${id}` : 'utkal_chat_sessions';
  }
  function activeChatKey() {
    const id = window.UtkalAuth && window.UtkalAuth.userId();
    return id ? `utkal_active_chat:${id}` : 'utkal_active_chat';
  }
  let sessions = [];
  let activeId = null;
  let imageFile = null;
  let dictating = false;
  let dictateSession = null;

  function showDictateBar(mode) {
    const bar = document.getElementById('dictateBar');
    document.getElementById('composer').classList.add('dictating');
    bar.hidden = false;
    bar.classList.toggle('asking', mode === 'ask');
    const wait = document.getElementById('dictateWait');
    if (wait) wait.textContent = t('allowMic');
    const tip = document.getElementById('dictateTipText');
    if (tip) tip.textContent = t('cancelDictate');
    document.getElementById('dictateCancel').title = t('cancelDictate');
    document.getElementById('dictateStopBtn').title = t('stopDictate');
  }

  function hideDictateBar() {
    document.getElementById('composer').classList.remove('dictating');
    const bar = document.getElementById('dictateBar');
    bar.hidden = true;
    bar.classList.remove('asking');
  }

  function paintDictateWave(rms) {
    const level = Math.max(0.12, Math.min(1, rms / 0.06));
    const wave = document.getElementById('dictateWave');
    wave.style.setProperty('--level', level.toFixed(3));
    wave.querySelectorAll('i').forEach((dot, index) => {
      const wobble = 0.45 + 0.55 * Math.abs(Math.sin(index * 0.55 + level * 6));
      dot.style.transform = `scale(${(0.65 + level * wobble).toFixed(2)})`;
    });
  }

  function onDictateKey(event) {
    if (event.key === 'Escape' && dictateSession) {
      event.preventDefault();
      dictateSession.finish('cancel');
    }
  }

  async function toggleDictation() {
    if (dictating && dictateSession) {
      dictateSession.finish('stop');
      return;
    }
    showDictateBar('ask');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (error) {
      hideDictateBar();
      throw error;
    }
    showDictateBar('live');
    let ctx;
    let source;
    let proc;
    let mute;
    const chunks = [];
    try {
      ctx = window.MicWav.createAudioContext();
      await ctx.resume();
      source = ctx.createMediaStreamSource(stream);
      proc = ctx.createScriptProcessor(4096, 1, 1);
      mute = ctx.createGain();
      mute.gain.value = 0;
      proc.onaudioprocess = (event) => {
        const channel = event.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(channel));
        let sum = 0;
        for (let i = 0; i < channel.length; i++) sum += channel[i] * channel[i];
        paintDictateWave(Math.sqrt(sum / channel.length));
      };
      source.connect(proc);
      proc.connect(mute);
      mute.connect(ctx.destination);
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      hideDictateBar();
      throw error;
    }
    dictating = true;
    document.addEventListener('keydown', onDictateKey);

    const session = {
      async finish(mode) {
        if (!dictating && dictateSession !== session) return;
        dictating = false;
        dictateSession = null;
        document.removeEventListener('keydown', onDictateKey);
        hideDictateBar();
        try { proc.disconnect(); source.disconnect(); mute.disconnect(); } catch (_) {}
        stream.getTracks().forEach((track) => track.stop());
        const rate = ctx.sampleRate || 16000;
        try { await ctx.close(); } catch (_) {}
        if (mode === 'cancel') return;
        const samples = window.MicWav.concatFloat(chunks);
        if (samples.length < rate * 0.3) {
          window.UtkalApp?.toast(t('shortSpeech'));
          return;
        }
        const blob = window.MicWav.encodeWav(samples, rate);
        const form = new FormData();
        form.append('file', blob, 'dictate.wav');
        try {
          const res = await fetch('/api/transcribe', { method: 'POST', body: form });
          const data = await res.json();
          if (!data.success || !data.transcription) {
            window.UtkalApp?.toast(data.message || t('sttFail'));
            return;
          }
          const input = document.getElementById('chatInput');
          const next = `${input.value} ${data.transcription}`.trim();
          input.value = mode === 'send' ? '' : next;
          input.focus();
          if (mode === 'send') send(next);
        } catch (_) {
          window.UtkalApp?.toast(t('netError'));
        }
      },
    };
    dictateSession = session;
  }
  let sending = false;

  function loadSessions() {
    try {
      const raw = JSON.parse(localStorage.getItem(chatStore()) || '[]');
      sessions = Array.isArray(raw) ? raw : [];
    } catch (_) {
      sessions = [];
    }
    if (!sessions.length) sessions = [blankSession()];
    activeId = localStorage.getItem(activeChatKey()) || sessions[0].id;
    if (!sessions.some((s) => s.id === activeId)) activeId = sessions[0].id;
  }

  function persist() {
    localStorage.setItem(chatStore(), JSON.stringify(sessions));
    localStorage.setItem(activeChatKey(), activeId);
  }

  function uid() {
    return (crypto.randomUUID && crypto.randomUUID()) || `c_${Date.now()}`;
  }

  function t(key) {
    return window.UtkalI18n ? window.UtkalI18n.t(key) : key;
  }

  function isFreshTitle(title) {
    return title === 'ନୂଆ ବାର୍ତ୍ତା' || title === 'New chat';
  }

  function blankSession() {
    return { id: uid(), title: 'ନୂଆ ବାର୍ତ୍ତା', messages: [], updatedAt: new Date().toISOString() };
  }

  function current() {
    return sessions.find((s) => s.id === activeId) || sessions[0];
  }

  function replyLanguage() {
    return localStorage.getItem('utkal_reply_lang') === 'en' ? 'en' : 'or';
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /**
   * Client-side mirror of the server's cleanSources().
   * Cleans source chips before rendering so old saved chats are also sanitised.
   *
   * Rules (must stay in sync with services/chatService.js cleanSources):
   *  1. Normalise each entry to a plain string.
   *  2. Drop internal documents (master instruction / system prompt titles).
   *  3. Drop bare-domain chips (e.g. "youtube.com", "instagram.com").
   *  4. Deduplicate case-insensitively.
   *  5. Cap at 3.
   */
  const INTERNAL_RE = /master\s*instruction|system\s*prompt|internal\s*(doc|document|instruction)|instruction\s*#\s*\d+/i;
  const BARE_DOMAIN_RE = /^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?(\.[a-z]{2,})+\/?$/i;

  function clientCleanSources(list) {
    if (!Array.isArray(list) || list.length === 0) return [];
    const seen = new Set();
    const out = [];
    for (const item of list) {
      let title = typeof item === 'string' ? item.trim()
        : item && typeof item === 'object' ? String(item.title || item.name || item.url || '').trim()
        : '';
      if (!title) continue;
      if (INTERNAL_RE.test(title)) continue;
      if (BARE_DOMAIN_RE.test(title)) continue;
      const key = title.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(title);
      if (out.length === 3) break;
    }
    return out;
  }

  function renderMarkdown(text) {
    let html = escapeHtml(text);
    html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`);
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/(^|\n)(?:[-*] .+(?:\n|$))+?/g, (block) => {
      const items = block.trim().split('\n').map((line) => `<li>${line.replace(/^[-*] /, '')}</li>`).join('');
      return `<ul>${items}</ul>`;
    });
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  function welcomeHtml() {
    const presets = window.UtkalI18n ? window.UtkalI18n.presets() : [];
    return `<div class="welcome">
      <h2>${escapeHtml(t('welcomeTitle'))}</h2>
      <p>${escapeHtml(t('welcomeBody'))}</p>
      ${presets.map((group) => `
        <div class="group-title">${escapeHtml(group.title)}</div>
        <div class="presets">
          ${group.cards.map((card) => `<button type="button" class="preset" data-prompt="${escapeHtml(card.prompt)}"><b>${escapeHtml(card.name)}</b><small>${escapeHtml(card.prompt)}</small></button>`).join('')}
        </div>`).join('')}
    </div>`;
  }

  function render() {
    const box = document.getElementById('messages');
    const session = current();
    if (!session.messages.length) {
      box.innerHTML = welcomeHtml();
      renderSessions();
      return;
    }
    box.innerHTML = session.messages.map((msg) => {
      if (msg.role === 'user') {
        const hint = msg.transliteration && msg.transliteration.isTransliterated && msg.transliteration.convertedScript
          ? `<div class="hint">${escapeHtml(t('understood'))}: ${escapeHtml(msg.transliteration.convertedScript)}</div>`
          : '';
        return `<div class="bubble user">${escapeHtml(msg.text)}</div>${hint}`;
      }
      const note = msg.knowledgeNote ? `<div class="note">${escapeHtml(msg.knowledgeNote)}</div>` : '';
      return `<div class="bubble assistant">${msg.pending ? escapeHtml(msg.text) : renderMarkdown(msg.text)}</div>${note}`;
    }).join('');
    box.scrollTop = box.scrollHeight;
    renderSessions();
  }

  function renderSessions() {
    const list = document.getElementById('sessionList');
    if (!list) return;
    list.innerHTML = sessions.map((s) => `
      <div class="session-row">
        <button type="button" class="session-item ${s.id === activeId ? 'active' : ''}" data-id="${s.id}">
          ${escapeHtml(isFreshTitle(s.title) ? t('newChat') : s.title)}
          <small>${new Date(s.updatedAt).toLocaleString('en-IN')}</small>
        </button>
        <button type="button" class="session-del" data-del="${s.id}" aria-label="${escapeHtml(t('delete'))}" title="${escapeHtml(t('delete'))}">×</button>
      </div>`).join('');
    paintFold();
  }

  function paintFold() {
    const panel = document.getElementById('sessionsPanel');
    const btn = document.getElementById('sessionsFold');
    if (!panel || !btn) return;
    const collapsed = localStorage.getItem('utkal_sessions_collapsed') === '1';
    panel.classList.toggle('collapsed', collapsed);
    const key = collapsed ? 'showChats' : 'hideChats';
    btn.textContent = collapsed ? '›' : '‹';
    btn.setAttribute('aria-label', t(key));
    btn.title = t(key);
  }

  function deleteSession(id) {
    if (sending && id === activeId) return;
    sessions = sessions.filter((s) => s.id !== id);
    if (!sessions.length) sessions = [blankSession()];
    if (!sessions.some((s) => s.id === activeId)) activeId = sessions[0].id;
    persist();
    render();
  }

  async function readSSE(response, handlers) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        let event = 'message';
        const dataLines = [];
        for (const line of part.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        let data;
        try { data = JSON.parse(dataLines.join('\n')); } catch (_) { continue; }
        if (handlers[event]) handlers[event](data);
      }
    }
  }

  async function fileToImage(file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const match = String(dataUrl).match(/^data:(.+);base64,(.+)$/);
    if (!match) return null;
    return { mimeType: match[1], base64: match[2] };
  }

  async function send(text) {
    const session = current();
    const message = String(text || '').trim();
    if ((!message && !imageFile) || sending) return;
    sending = true;
    document.getElementById('sendBtn').disabled = true;
    const history = session.messages.filter((m) => !m.pending).map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', text: m.text }));
    session.messages.push({ role: 'user', text: message || t('imageExplain') });
    const pending = { role: 'assistant', text: '', pending: true, sources: [], knowledgeNote: null };
    session.messages.push(pending);
    if (isFreshTitle(session.title) && message) session.title = message.slice(0, 42);
    session.updatedAt = new Date().toISOString();
    persist();
    render();

    const image = imageFile ? await fileToImage(imageFile) : null;
    clearImage();
    const body = {
      message,
      history,
      sessionId: session.id,
      replyLanguage: replyLanguage(),
      useRag: true,
      image,
    };

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        window.UtkalAuth?.expire();
        return;
      }
      if (!response.ok || !response.body) throw new Error('stream');
      await readSSE(response, {
        delta(data) {
          pending.text += data.delta || '';
          render();
        },
        done(data) {
          pending.pending = false;
          pending.text = data.response || pending.text;
          pending.sources = clientCleanSources(data.ragSources || []);
          pending.knowledgeNote = data.knowledgeNote || null;
          const userMsg = session.messages[session.messages.length - 2];
          if (userMsg && data.transliteration) userMsg.transliteration = data.transliteration;
        },
        error(data) {
          throw new Error(data.message || 'error');
        },
      });
      if (pending.pending && !pending.text) throw new Error('empty');
      pending.pending = false;
    } catch (err) {
      try {
        const fallback = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (fallback.status === 401) {
          window.UtkalAuth?.expire();
          return;
        }
        const data = await fallback.json();
        if (!fallback.ok || !data.success) throw new Error(data.message || t('answerFail'));
        pending.pending = false;
        pending.text = data.response || data.message;
        pending.sources = clientCleanSources(data.ragSources || []);
        pending.knowledgeNote = data.knowledgeNote || null;
        const userMsg = session.messages[session.messages.length - 2];
        if (userMsg && data.transliteration) userMsg.transliteration = data.transliteration;
      } catch (fallbackErr) {
        pending.pending = false;
        pending.text = fallbackErr.message && fallbackErr.message !== 'stream' && fallbackErr.message !== 'empty'
          ? fallbackErr.message
          : (err.message && err.message !== 'stream' ? err.message : t('answerFail'));
      }
    }
    session.updatedAt = new Date().toISOString();
    persist();
    render();
    sending = false;
    document.getElementById('sendBtn').disabled = false;
  }

  function clearImage() {
    imageFile = null;
    const box = document.getElementById('imagePreview');
    if (box) box.hidden = true;
    const input = document.getElementById('imageInput');
    if (input) input.value = '';
  }

  function init() {
    loadSessions();
    render();
    document.getElementById('composer').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('chatInput');
      const text = input.value;
      input.value = '';
      send(text);
    });
    document.getElementById('chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('composer').requestSubmit();
      }
    });
    document.getElementById('messages').addEventListener('click', (e) => {
      const preset = e.target.closest('[data-prompt]');
      if (preset) send(preset.dataset.prompt);
    });
    document.getElementById('newChatBtn').addEventListener('click', () => {
      const session = blankSession();
      sessions.unshift(session);
      activeId = session.id;
      persist();
      render();
    });
    document.getElementById('sessionsFold').addEventListener('click', () => {
      const narrow = window.matchMedia('(max-width: 860px)').matches;
      if (narrow) {
        document.getElementById('sessionsPanel').classList.remove('open');
        return;
      }
      const collapsed = localStorage.getItem('utkal_sessions_collapsed') === '1';
      localStorage.setItem('utkal_sessions_collapsed', collapsed ? '0' : '1');
      paintFold();
    });
    document.getElementById('sessionList').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        deleteSession(del.dataset.del);
        return;
      }
      const item = e.target.closest('[data-id]');
      if (!item) return;
      activeId = item.dataset.id;
      persist();
      render();
      document.getElementById('sessionsPanel').classList.remove('open');
    });
    document.getElementById('attachBtn').addEventListener('click', () => document.getElementById('imageInput').click());
    document.getElementById('imageInput').addEventListener('change', () => {
      imageFile = document.getElementById('imageInput').files[0] || null;
      const box = document.getElementById('imagePreview');
      if (!imageFile) { box.hidden = true; return; }
      box.hidden = false;
      document.getElementById('previewName').textContent = imageFile.name;
      document.getElementById('previewImg').src = URL.createObjectURL(imageFile);
    });
    document.getElementById('previewClear').addEventListener('click', clearImage);
    document.getElementById('dictateBtn').addEventListener('click', () => {
      toggleDictation().catch((error) => window.UtkalApp?.toast(window.MicWav.micMessage(error)));
    });
    document.getElementById('dictateCancel').addEventListener('click', () => {
      if (dictateSession) dictateSession.finish('cancel');
    });
    document.getElementById('dictateStopBtn').addEventListener('click', () => {
      if (dictateSession) dictateSession.finish('stop');
    });
    document.getElementById('dictateSendBtn').addEventListener('click', () => {
      if (dictateSession) dictateSession.finish('send');
    });
    document.getElementById('pdfBtn').addEventListener('click', () => document.getElementById('pdfInput').click());
    document.getElementById('pdfInput').addEventListener('change', async () => {
      const file = document.getElementById('pdfInput').files[0];
      if (!file) return;
      const form = new FormData();
      form.append('pdf', file);
      try {
        const res = await fetch('/api/upload-pdf', { method: 'POST', body: form });
        const data = await res.json();
        window.UtkalApp?.toast(data.message || (res.ok ? t('docAdded') : t('docFail')));
      } catch (_) {
        window.UtkalApp?.toast(t('docUploadFail'));
      }
      document.getElementById('pdfInput').value = '';
    });
    document.getElementById('retrainBtn').addEventListener('click', async () => {
      window.UtkalApp?.toast(t('training'));
      try {
        const res = await fetch('/api/rag/train', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        window.UtkalApp?.toast(data.message || (res.ok ? t('trained') : t('trainFail')));
      } catch (_) {
        window.UtkalApp?.toast(t('trainFail'));
      }
    });
    document.addEventListener('utkal:lang', () => render());
  }

  window.UtkalChat = { init, send, render };
})();
