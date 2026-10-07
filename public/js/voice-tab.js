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

  function $(id) { return document.getElementById(id); }

  function setStatus(text, state) {
    $('voiceStatus').textContent = text;
    $('voiceMic').classList.toggle('listening', state === 'listening');
    $('voiceMic').classList.toggle('speaking', state === 'speaking');
    $('voiceStop').hidden = state !== 'listening' && state !== 'speaking';
  }

  function resetTurn() {
    answer = '';
    pendingTx = null;
    editing = false;
    $('voiceTranscript').hidden = true;
    $('voiceTranscript').textContent = '';
    $('voiceAnswer').hidden = true;
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
      ['ପାର୍ଟି', tx.party],
      ['ଜିନିଷ', tx.item],
      ['ରାଶି', tx.amount ? `₹${Number(tx.amount).toLocaleString('en-IN')}` : ''],
      ['ପ୍ରକାର', tx.action],
      ['ପେମେଣ୍ଟ', tx.payment_type],
    ].filter(([, v]) => v).map(([k, v]) => `<div class="row"><span>${k}</span><b>${escapeHtml(v)}</b></div>`).join('');
    $('editParty').value = tx.party || '';
    $('editItem').value = tx.item || '';
    $('editAmount').value = tx.amount || '';
    if (tx.action) $('editAction').value = tx.action;
    if (tx.payment_type && tx.payment_type !== 'UNKNOWN') $('editPay').value = tx.payment_type;
  }

  function showLedger(payload) {
    pendingTx = payload.ledger.transaction;
    $('ledgerTitle').textContent = payload.ledger.requiresConfirmation ? 'ଆପଣ କହିଛନ୍ତି' : 'ଆଉ ଟିକେ ସୂଚନା ଦରକାର';
    fillLedger(pendingTx);
    $('ledgerCard').hidden = false;
    $('ledgerSave').hidden = !payload.ledger.requiresConfirmation;
    if (!payload.ledger.requiresConfirmation && payload.text) {
      $('voiceAnswer').hidden = false;
      $('voiceAnswer').textContent = payload.text;
    }
    setStatus('ନିଶ୍ଚିତ କରନ୍ତୁ କିମ୍ବା ବଦଳାନ୍ତୁ', 'idle');
  }

  function ensureVoice() {
    if (rv) return rv;
    rv = new RealtimeVoice({
      serverUrl: '',
      languageMode,
      replyLanguage: localStorage.getItem('utkal_reply_lang') === 'en' ? 'en' : 'or',
      on: {
        listening: () => setStatus('ଶୁଣୁଛି…', 'listening'),
        thinking: () => setStatus('ଭାବୁଛି…', 'thinking'),
        finalTranscript: (d) => {
          $('voiceTranscript').hidden = false;
          $('voiceTranscript').textContent = d.text;
        },
        textDelta: (d) => {
          answer += d.delta || '';
          $('voiceAnswer').hidden = false;
          $('voiceAnswer').textContent = answer;
        },
        textComplete: (d) => {
          if (d.ledger) return showLedger(d);
          $('voiceAnswer').hidden = false;
          $('voiceAnswer').textContent = d.text || answer;
          showSources(d.ragSources, d.knowledgeNote);
        },
        speaking: () => setStatus('କହୁଛି…', 'speaking'),
        speakEnd: () => setStatus('କହିବା ପାଇଁ ମାଇକ୍ ଦବାନ୍ତୁ', 'idle'),
        interrupted: () => setStatus('ବନ୍ଦ ହେଲା', 'idle'),
        stopped: (d) => { if (d.reason === 'interrupted') setStatus('କହିବା ପାଇଁ ମାଇକ୍ ଦବାନ୍ତୁ', 'idle'); },
        error: (d) => {
          window.UtkalApp?.toast(d.message || 'ଭଏସ୍ ସମସ୍ୟା।');
          if (!d.soft) setStatus('ପୁଣିଥରେ ଚେଷ୍ଟା କରନ୍ତୁ', 'idle');
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
    voice.replyLanguage = localStorage.getItem('utkal_reply_lang') === 'en' ? 'en' : 'or';
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
      window.UtkalApp?.toast('ପାର୍ଟି ଓ ରାଶି ଲେଖନ୍ତୁ।');
      return;
    }
    window.UtkalKhata.add({ ...tx, source: 'voice' });
    window.UtkalKhata.render();
    $('ledgerCard').hidden = true;
    window.UtkalApp?.toast('ଖାତାରେ ରେକର୍ଡ ହେଲା।');
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
      window.UtkalApp?.toast('ପରବର୍ତ୍ତୀ କଥାରେ ଏହି ସ୍ୱର ଲାଗିବ।');
      return;
    }
    unlockPreview();
    if (button) button.disabled = true;
    setStatus('ଏହି ସ୍ୱର ଶୁଣନ୍ତୁ…', 'idle');
    try {
      const res = await fetch('/api/voice/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speaker }),
      });
      const data = await res.json();
      if (!data.success || !data.audio) {
        window.UtkalApp?.toast(data.message || 'ଏହି ସ୍ୱର ଏବେ ମିଳିଲା ନାହିଁ।');
        setStatus('କହିବା ପାଇଁ ମାଇକ୍ ଦବାନ୍ତୁ', 'idle');
        return;
      }
      await playSample(data.audio);
      setStatus('କହିବା ପାଇଁ ମାଇକ୍ ଦବାନ୍ତୁ', 'idle');
    } catch (_) {
      window.UtkalApp?.toast('ଏହି ସ୍ୱର ଏବେ ମିଳିଲା ନାହିଁ।');
      setStatus('କହିବା ପାଇଁ ମାଇକ୍ ଦବାନ୍ତୁ', 'idle');
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
      if (voice.phase === 'thinking') {
        window.UtkalApp?.toast('ଭାବୁଛି… ଟିକେ ଅପେକ୍ଷା କରନ୍ତୁ। ଉତ୍ତର ଆସିଲେ କହିବ।');
        return;
      }
      if (voice.assistantSpeaking || voice.phase === 'speaking') { voice._interrupt(); return; }
      if (voice.listening) { voice.stopListening(); return; }
      try { await startCall(); }
      catch (e) { window.UtkalApp?.toast(window.MicWav.micMessage(e)); setStatus('ପୁଣିଥରେ ଚେଷ୍ଟା କରନ୍ତୁ', 'idle'); }
    });
    $('voiceStop').addEventListener('click', () => {
      if (!rv) return;
      if (rv.assistantSpeaking) rv._interrupt();
      else rv.stopListening();
    });
    $('ledgerSave').addEventListener('click', saveLedger);
    $('ledgerEditBtn').addEventListener('click', () => {
      editing = true;
      $('ledgerEdit').hidden = false;
      $('ledgerSave').hidden = false;
    });
  }

  function setMode(mode) {
    languageMode = mode;
    $('modeOdia').classList.toggle('active', mode === 'od-IN');
    $('modeAuto').classList.toggle('active', mode === 'auto');
    if (rv) rv.languageMode = mode;
  }

  window.UtkalVoice = { init, startCall };
})();
