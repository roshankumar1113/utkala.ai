(function () {
  const VOICE_KEY = 'utkal_voice_speaker';
  const SPEAKERS = ['priya', 'ishita', 'ritu', 'shubh', 'ratan'];
  let rv = null;
  let languageMode = 'od-IN';
  let speaker = SPEAKERS.includes(localStorage.getItem(VOICE_KEY)) ? localStorage.getItem(VOICE_KEY) : 'priya';
  let previewCtx = null;
  let previewSrc = null;
  let pendingTx = null;
  let editing = false;
  let answer = '';
  let statusKey = 'voiceIdle';
  let ledgerTitleKey = 'heard';
  const levelHist = [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2];

  function $(id) { return document.getElementById(id); }

  function t(key) {
    return window.UtkalI18n ? window.UtkalI18n.t(key) : key;
  }

  function replyLang() {
    return localStorage.getItem('utkal_reply_lang') === 'en' ? 'en' : 'or';
  }

  function setStatus(key, state) {
    statusKey = key;
    $('voiceStatus').textContent = t(key);
    $('voiceMic').classList.toggle('listening', state === 'listening');
    $('voiceMic').classList.toggle('speaking', state === 'speaking');
    $('micStage').classList.toggle('live', state === 'listening');
    $('micStage').classList.toggle('replying', state === 'speaking');
    const live = state === 'listening' || state === 'thinking' || state === 'speaking' || !!(rv && rv.callOpen);
    $('voiceStop').hidden = !live;
    if (state === 'listening') showHearing();
    if (state === 'thinking' && !$('voiceTranscript').textContent.trim()) {
      $('youLabel').textContent = t('thinking');
    }
    if (state !== 'listening') paintLevel(0, false);
  }

  function paintLevel(level, speaking) {
    const n = Math.max(0, Math.min(1, Number(level) || 0));
    levelHist.push(n);
    levelHist.shift();
    const stage = $('micStage');
    const eq = $('liveEq');
    if (stage) {
      stage.style.setProperty('--level', n.toFixed(3));
      stage.classList.toggle('hot', !!speaking && n > 0.08);
    }
    levelHist.forEach((value, index) => {
      const height = (0.22 + value * 0.78).toFixed(3);
      if (stage) stage.style.setProperty(`--b${index}`, height);
      if (eq) eq.style.setProperty(`--b${index}`, height);
    });
  }

  function showHearing() {
    $('youTurn').hidden = false;
    $('liveEq').hidden = false;
    if (!$('voiceTranscript').textContent.trim()) $('youLabel').textContent = t('listening');
  }

  function resetTurn() {
    answer = '';
    pendingTx = null;
    editing = false;
    $('youTurn').hidden = true;
    $('youLabel').textContent = '';
    $('liveEq').hidden = true;
    $('voiceTranscript').textContent = '';
    $('utkalTurn').hidden = true;
    $('voiceAnswer').textContent = '';
    $('voiceSources').hidden = true;
    $('voiceSources').innerHTML = '';
    $('voiceNote').hidden = true;
    $('voiceNote').textContent = '';
    $('ledgerCard').hidden = true;
    $('ledgerEdit').hidden = true;
  }

  function showSources(list, note) {
    const box = $('voiceSources');
    if (list && list.length) {
      box.hidden = false;
      box.innerHTML = list.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('');
    }
    if (note) {
      $('voiceNote').hidden = false;
      $('voiceNote').textContent = note;
    }
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fillLedger(tx) {
    $('ledgerRows').innerHTML = [
      [t('party'), tx.party],
      [t('item'), tx.item],
      [t('amount'), tx.amount ? `₹${Number(tx.amount).toLocaleString('en-IN')}` : ''],
      [t('actionType'), tx.action],
      [t('payment'), tx.payment_type],
    ].filter(([, v]) => v).map(([k, v]) => `<div class="row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join('');
    $('editParty').value = tx.party || '';
    $('editItem').value = tx.item || '';
    $('editAmount').value = tx.amount || '';
    if (tx.action) $('editAction').value = tx.action;
    if (tx.payment_type && tx.payment_type !== 'UNKNOWN') $('editPay').value = tx.payment_type;
  }

  function showLedger(payload) {
    pendingTx = payload.ledger.transaction;
    ledgerTitleKey = payload.ledger.requiresConfirmation ? 'heard' : 'needMore';
    $('ledgerTitle').textContent = t(ledgerTitleKey);
    fillLedger(pendingTx);
    $('ledgerCard').hidden = false;
    $('ledgerSave').hidden = !payload.ledger.requiresConfirmation;
    if (!payload.ledger.requiresConfirmation && payload.text) {
      $('utkalTurn').hidden = false;
      $('voiceAnswer').textContent = payload.text;
    }
    setStatus('confirmOrEdit', 'idle');
  }

  function ensureVoice() {
    if (rv) return rv;
    rv = new RealtimeVoice({
      serverUrl: '',
      languageMode,
      replyLanguage: replyLang(),
      on: {
        listening: () => setStatus('listening', 'listening'),
        thinking: () => setStatus('thinking', 'thinking'),
        level: (d) => paintLevel(d.level, d.speaking),
        finalTranscript: (d) => {
          $('youTurn').hidden = false;
          $('liveEq').hidden = true;
          $('youLabel').textContent = t('heard');
          $('voiceTranscript').textContent = d.text || '';
        },
        textDelta: (d) => {
          answer += d.delta || '';
          $('utkalTurn').hidden = false;
          $('voiceAnswer').textContent = answer;
        },
        textComplete: (d) => {
          if (d.ledger) return showLedger(d);
          $('utkalTurn').hidden = false;
          $('voiceAnswer').textContent = d.text || answer;
          showSources(d.ragSources, d.knowledgeNote);
        },
        speaking: () => setStatus('speaking', 'speaking'),
        speakEnd: () => {
          if (!(rv && rv.callOpen)) {
            setStatus('voiceIdle', 'idle');
            return;
          }
          if (!rv.capturing) rv.armUtterance();
        },
        interrupted: () => {},
        stopped: (d) => {
          if (d.reason === 'hangup') setStatus('voiceIdle', 'idle');
        },
        error: (d) => {
          const micGone = d.error_code === 'MIC_ENDED';
          window.UtkalApp?.toast(micGone ? t('micMissing') : (d.message || t('voiceProblem')));
          if (!d.soft || micGone) setStatus('tryAgain', 'idle');
        },
      },
    });
    return rv;
  }

  async function startCall() {
    resetTurn();
    const voice = ensureVoice();
    voice.languageMode = languageMode;
    voice.speaker = speaker;
    voice.replyLanguage = replyLang();
    stopPreview();
    await voice.startListening();
  }

  function saveLedger() {
    if (!pendingTx) return;
    const tx = editing ? {
      party: $('editParty').value.trim(),
      item: $('editItem').value.trim(),
      amount: Number($('editAmount').value),
      action: $('editAction').value,
      payment_type: $('editPay').value,
    } : pendingTx;
    if (!tx.party || !(Number(tx.amount) > 0)) {
      window.UtkalApp?.toast(t('partyAmount'));
      return;
    }
    window.UtkalKhata.add({ ...tx, source: 'voice' });
    window.UtkalKhata.render();
    $('ledgerCard').hidden = true;
    window.UtkalApp?.toast(t('recorded'));
    pendingTx = null;
  }

  function stopPreview() {
    if (previewSrc) { try { previewSrc.stop(); } catch (_) {} previewSrc = null; }
  }

  function unlockPreview() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!previewCtx || previewCtx.state === 'closed') previewCtx = new AC();
    previewCtx.resume();
    return previewCtx;
  }

  async function playSample(base64) {
    const ctx = previewCtx;
    if (!ctx) return;
    if (ctx.state === 'suspended') await ctx.resume();
    stopPreview();
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const audioBuf = await ctx.decodeAudioData(bytes.buffer.slice(0));
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(ctx.destination);
    previewSrc = src;
    src.onended = () => { if (previewSrc === src) previewSrc = null; };
    src.start();
  }

  function paintSpeaker() {
    document.querySelectorAll('.voice-pick').forEach((button) => {
      button.classList.toggle('active', button.dataset.speaker === speaker);
    });
  }

  async function chooseSpeaker(next, button) {
    if (!SPEAKERS.includes(next)) return;
    speaker = next;
    localStorage.setItem(VOICE_KEY, speaker);
    if (rv) rv.speaker = speaker;
    paintSpeaker();
    const busy = rv && (rv.listening || rv.phase === 'thinking' || rv.phase === 'speaking' || rv.assistantSpeaking);
    if (busy) {
      window.UtkalApp?.toast(t('nextVoice'));
      return;
    }
    unlockPreview();
    if (button) button.disabled = true;
    setStatus('listenVoice', 'idle');
    try {
      const res = await fetch('/api/voice/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speaker, language: replyLang() }),
      });
      const data = await res.json();
      if (!data.success || !data.audio) {
        window.UtkalApp?.toast(data.message || t('voiceUnavailable'));
        setStatus('voiceIdle', 'idle');
        return;
      }
      await playSample(data.audio);
      setStatus('voiceIdle', 'idle');
    } catch (_) {
      window.UtkalApp?.toast(t('voiceUnavailable'));
      setStatus('voiceIdle', 'idle');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function init() {
    paintSpeaker();
    document.querySelectorAll('.voice-pick').forEach((button) => {
      button.addEventListener('click', () => chooseSpeaker(button.dataset.speaker, button));
    });
    $('modeOdia').addEventListener('click', () => setMode('od-IN'));
    $('modeAuto').addEventListener('click', () => setMode('auto'));
    $('voiceMic').addEventListener('click', async () => {
      const voice = ensureVoice();
      if (voice.callOpen || voice.listening || voice.phase === 'thinking' || voice.phase === 'speaking' || voice.assistantSpeaking) {
        return;
      }
      try { await startCall(); }
      catch (e) { window.UtkalApp?.toast(window.MicWav.micMessage(e)); setStatus('tryAgain', 'idle'); }
    });
    $('voiceStop').addEventListener('click', () => {
      if (!rv) return;
      rv.stopListening();
    });
    $('ledgerSave').addEventListener('click', saveLedger);
    $('ledgerEditBtn').addEventListener('click', () => {
      editing = true;
      $('ledgerEdit').hidden = false;
      $('ledgerSave').hidden = false;
    });
    document.addEventListener('utkal:lang', () => {
      if ($('voiceStatus')) $('voiceStatus').textContent = t(statusKey);
      if ($('youTurn') && !$('youTurn').hidden && $('youLabel')) {
        $('youLabel').textContent = $('liveEq').hidden ? t('heard') : t('listening');
      }
      if (pendingTx && !$('ledgerCard').hidden) {
        $('ledgerTitle').textContent = t(ledgerTitleKey);
        fillLedger(pendingTx);
      }
    });
    setStatus('voiceIdle', 'idle');
  }

  function setReplyLanguage(lang) {
    if (rv) rv.replyLanguage = lang === 'en' ? 'en' : 'or';
  }

  function setMode(mode) {
    languageMode = mode;
    $('modeOdia').classList.toggle('active', mode === 'od-IN');
    $('modeAuto').classList.toggle('active', mode === 'auto');
    if (rv) rv.languageMode = mode;
  }

  window.UtkalVoice = { init, startCall, setReplyLanguage };
})();
