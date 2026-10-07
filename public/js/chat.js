(function () {
  const STORE = 'utkal_chat_sessions';
  let sessions = [];
  let activeId = null;
  let imageFile = null;
  let dictating = false;
  let dictateStop = null;

  async function toggleDictation() {
    if (dictating && dictateStop) {
      dictateStop();
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = window.MicWav.createAudioContext();
    await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    const chunks = [];
    proc.onaudioprocess = (event) => {
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    source.connect(proc);
    proc.connect(mute);
    mute.connect(ctx.destination);
    dictating = true;
    document.getElementById('dictateBtn').textContent = '■';

    dictateStop = async () => {
      dictating = false;
      dictateStop = null;
      document.getElementById('dictateBtn').textContent = '🎙️';
      try { proc.disconnect(); source.disconnect(); mute.disconnect(); } catch (_) {}
      stream.getTracks().forEach((track) => track.stop());
      const rate = ctx.sampleRate || 16000;
      try { await ctx.close(); } catch (_) {}
      const samples = window.MicWav.concatFloat(chunks);
      if (samples.length < rate * 0.3) {
        window.UtkalApp?.toast('ବହୁତ କମ୍ ସମୟ କହିଲେ। ଆଉଥରେ କହନ୍ତୁ।');
        return;
      }
      const blob = window.MicWav.encodeWav(samples, rate);
      const form = new FormData();
      form.append('file', blob, 'dictate.wav');
      try {
        const res = await fetch('/api/transcribe', { method: 'POST', body: form });
        const data = await res.json();
        if (!data.success || !data.transcription) {
          window.UtkalApp?.toast(data.message || 'ସ୍ୱର ବୁଝାପଡ଼ିଲା ନାହିଁ।');
          return;
        }
        const input = document.getElementById('chatInput');
        input.value = `${input.value} ${data.transcription}`.trim();
        input.focus();
      } catch (_) {
        window.UtkalApp?.toast('ଇଣ୍ଟରନେଟ୍ ସମସ୍ୟା। ପୁଣିଥରେ ଚେଷ୍ଟା କରନ୍ତୁ।');
      }
    };
  }
  let sending = false;

  function loadSessions() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) || '[]');
      sessions = Array.isArray(raw) ? raw : [];
    } catch (_) {
      sessions = [];
    }
    if (!sessions.length) sessions = [blankSession()];
    activeId = localStorage.getItem('utkal_active_chat') || sessions[0].id;
    if (!sessions.some((s) => s.id === activeId)) activeId = sessions[0].id;
  }

  function persist() {
    localStorage.setItem(STORE, JSON.stringify(sessions));
    localStorage.setItem('utkal_active_chat', activeId);
  }

  function uid() {
    return (crypto.randomUUID && crypto.randomUUID()) || `c_${Date.now()}`;
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
    const presets = [
      ['ସରକାରୀ ଯୋଜନା', [
        ['ସୁଭଦ୍ରା ଯୋଜନା', 'ସୁଭଦ୍ରା ଯୋଜନା ପାଇଁ କେଉଁ କାଗଜପତ୍ର ଲାଗେ?'],
        ['ରେସନ କାର୍ଡ', 'ନୂଆ ରେସନ କାର୍ଡ ପାଇଁ କଣ କଣ ଲାଗେ?'],
        ['ପ୍ରମାଣପତ୍ର', 'ଜାତି ଓ ଆୟ ପ୍ରମାଣପତ୍ର ପାଇଁ ମୋ ସେବା କେନ୍ଦ୍ରରେ କଣ ଦରକାର?'],
      ]],
      ['ଦୋକାନ ହିସାବ', [
        ['ଉଧାର ଟିପ୍ସ', 'ଦୋକାନର ଉଧାର ଖାତା କେମିତି ସଜାଡ଼ିବି?'],
        ['ବିକ୍ରି ବଢ଼ାଅ', 'ଭୁବନେଶ୍ୱରର ଗ୍ରୋସରି ଦୋକାନର ବିକ୍ରି ବଢ଼ାଇବାକୁ ୩ଟି ଉପାୟ କୁହ।'],
      ]],
      ['ଖେତ ଓ ପଢ଼ା', [
        ['ଧାନ ଚାଷ', 'ଏବେ ଧାନ ଖେତରେ କେଉଁ ସାର ଦେବା ଠିକ୍?'],
        ['ଓଡ଼ିଆ ବର୍ଣ୍ଣ', 'ଛୋଟ ପିଲାଙ୍କୁ ଓଡ଼ିଆ ଅ ଆ କେମିତି ଶିଖାଇବି?'],
      ]],
    ];
    return `<div class="welcome">
      <h2>ନମସ୍କାର</h2>
      <p>ଯେକୌଣସି ଭାଷାରେ ପଚାରନ୍ତୁ। ଉତ୍ତର ଓଡ଼ିଆରେ ଆସିବ, English ଚିପ୍ ଚାଲୁ ଥିଲେ ଇଂରାଜୀରେ।</p>
      ${presets.map(([title, cards]) => `
        <div class="group-title">${title}</div>
        <div class="presets">
          ${cards.map(([name, prompt]) => `<button type="button" class="preset" data-prompt="${escapeHtml(prompt)}"><b>${name}</b><small>${escapeHtml(prompt)}</small></button>`).join('')}
        </div>`).join('')}
    </div>`;
  }

  function render() {
    const box = document.getElementById('messages');
    const session = current();
    if (!session.messages.length) {
      box.innerHTML = welcomeHtml();
      return;
    }
    box.innerHTML = session.messages.map((msg) => {
      if (msg.role === 'user') {
        const hint = msg.transliteration && msg.transliteration.isTransliterated && msg.transliteration.convertedScript
          ? `<div class="hint">ବୁଝିଲି: ${escapeHtml(msg.transliteration.convertedScript)}</div>`
          : '';
        return `<div class="bubble user">${escapeHtml(msg.text)}</div>${hint}`;
      }
      const sources = (msg.sources || []).map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('');
      const note = msg.knowledgeNote ? `<div class="note">${escapeHtml(msg.knowledgeNote)}</div>` : '';
      return `<div class="bubble assistant">${msg.pending ? escapeHtml(msg.text) : renderMarkdown(msg.text)}</div>${sources ? `<div class="sources">${sources}</div>` : ''}${note}`;
    }).join('');
    box.scrollTop = box.scrollHeight;
    renderSessions();
  }

  function renderSessions() {
    const list = document.getElementById('sessionList');
    if (!list) return;
    list.innerHTML = sessions.map((s) => `
      <button type="button" class="session-item ${s.id === activeId ? 'active' : ''}" data-id="${s.id}">
        ${escapeHtml(s.title)}
        <small>${new Date(s.updatedAt).toLocaleString('en-IN')}</small>
      </button>`).join('');
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
    session.messages.push({ role: 'user', text: message || 'ଏହି ଚିତ୍ର ଦେଖି ବୁଝାଇ ଦିଅ।' });
    const pending = { role: 'assistant', text: '', pending: true, sources: [], knowledgeNote: null };
    session.messages.push(pending);
    if (session.title === 'ନୂଆ ବାର୍ତ୍ତା' && message) session.title = message.slice(0, 42);
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
      if (!response.ok || !response.body) throw new Error('stream');
      await readSSE(response, {
        delta(data) {
          pending.text += data.delta || '';
          render();
        },
        done(data) {
          pending.pending = false;
          pending.text = data.response || pending.text;
          pending.sources = data.ragSources || [];
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
        const data = await fallback.json();
        if (!fallback.ok || !data.success) throw new Error(data.message || 'ଉତ୍ତର ଆସିଲା ନାହିଁ।');
        pending.pending = false;
        pending.text = data.response || data.message;
        pending.sources = data.ragSources || [];
        pending.knowledgeNote = data.knowledgeNote || null;
        const userMsg = session.messages[session.messages.length - 2];
        if (userMsg && data.transliteration) userMsg.transliteration = data.transliteration;
      } catch (fallbackErr) {
        pending.pending = false;
        pending.text = fallbackErr.message && fallbackErr.message !== 'stream' && fallbackErr.message !== 'empty'
          ? fallbackErr.message
          : (err.message && err.message !== 'stream' ? err.message : 'ଉତ୍ତର ଆସିଲା ନାହିଁ। ଇଣ୍ଟରନେଟ୍ କିମ୍ବା ଚାବି ଯାଞ୍ଚ କରନ୍ତୁ।');
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
    document.getElementById('sessionList').addEventListener('click', (e) => {
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
    document.getElementById('pdfBtn').addEventListener('click', () => document.getElementById('pdfInput').click());
    document.getElementById('pdfInput').addEventListener('change', async () => {
      const file = document.getElementById('pdfInput').files[0];
      if (!file) return;
      const form = new FormData();
      form.append('pdf', file);
      try {
        const res = await fetch('/api/upload-pdf', { method: 'POST', body: form });
        const data = await res.json();
        window.UtkalApp?.toast(data.message || (res.ok ? 'ଡକ୍ୟୁମେଣ୍ଟ ଯୋଡ଼ାଗଲା।' : 'ଡକ୍ୟୁମେଣ୍ଟ ଯୋଡ଼ାଯାଇପାରିଲା ନାହିଁ।'));
      } catch (_) {
        window.UtkalApp?.toast('ଡକ୍ୟୁମେଣ୍ଟ ଅପଲୋଡ୍ ହେଲା ନାହିଁ।');
      }
      document.getElementById('pdfInput').value = '';
    });
    document.getElementById('retrainBtn').addEventListener('click', async () => {
      window.UtkalApp?.toast('ଜ୍ଞାନ ସଜାଯାଉଛି…');
      try {
        const res = await fetch('/api/rag/train', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        window.UtkalApp?.toast(data.message || (res.ok ? 'ସଜାଗଲା।' : 'ସଜାଯାଇପାରିଲା ନାହିଁ।'));
      } catch (_) {
        window.UtkalApp?.toast('ଜ୍ଞାନ ସଜାଯାଇପାରିଲା ନାହିଁ।');
      }
    });
  }

  window.UtkalChat = { init, send, render };
})();
