(function () {
  const KEY = 'utkal_khata';

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (_) {
      return [];
    }
  }

  function persist(items) {
    localStorage.setItem(KEY, JSON.stringify(items));
  }

  function uid() {
    return (crypto.randomUUID && crypto.randomUUID()) || `k_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function add(entry) {
    const items = load();
    const row = {
      id: uid(),
      party: String(entry.party || '').trim(),
      item: String(entry.item || '').trim(),
      action: entry.action || 'SALE',
      payment_type: entry.payment_type || 'CASH',
      amount: Number(entry.amount) || 0,
      source: entry.source || 'manual',
      createdAt: entry.createdAt || new Date().toISOString(),
    };
    items.unshift(row);
    persist(items);
    return row;
  }

  function update(id, patch) {
    const items = load().map((row) => (row.id === id ? { ...row, ...patch, id: row.id } : row));
    persist(items);
  }

  function remove(id) {
    persist(load().filter((row) => row.id !== id));
  }

  function inRange(row, range) {
    if (range === 'all') return true;
    const when = new Date(row.createdAt);
    const start = new Date();
    if (range === 'today') start.setHours(0, 0, 0, 0);
    else {
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
    }
    return when >= start;
  }

  function filtered(range) {
    return load().filter((row) => inRange(row, range));
  }

  function balances(rows) {
    const map = new Map();
    rows.forEach((row) => {
      const name = row.party || 'ସାଧାରଣ';
      if (!map.has(name)) map.set(name, { theyOwe: 0, weOwe: 0 });
      const b = map.get(name);
      const amt = Number(row.amount) || 0;
      if (row.action === 'SALE' && row.payment_type === 'CREDIT') b.theyOwe += amt;
      if (row.action === 'CREDIT_GIVEN') b.theyOwe += amt;
      if (row.action === 'RECEIVE_CASH') b.theyOwe -= amt;
      if (row.action === 'PURCHASE' && row.payment_type === 'CREDIT') b.weOwe += amt;
      if (row.action === 'PAY_CASH') b.weOwe -= amt;
    });
    return [...map.entries()];
  }

  function summarize(rows) {
    const sum = (pred) => rows.filter(pred).reduce((n, r) => n + (Number(r.amount) || 0), 0);
    return {
      sale: sum((r) => r.action === 'SALE'),
      purchase: sum((r) => r.action === 'PURCHASE'),
      received: sum((r) => r.action === 'RECEIVE_CASH'),
      paid: sum((r) => r.action === 'PAY_CASH'),
      udhaar: sum((r) => r.action === 'CREDIT_GIVEN' || (r.action === 'SALE' && r.payment_type === 'CREDIT')),
    };
  }

  function inr(n) {
    return `₹${Number(n || 0).toLocaleString('en-IN')}`;
  }

  const ACTION_LABEL = {
    SALE: 'ବିକ୍ରି',
    PURCHASE: 'କ୍ରୟ',
    RECEIVE_CASH: 'ନଗଦ ଆସିଲା',
    PAY_CASH: 'ନଗଦ ଦେଲି',
    CREDIT_GIVEN: 'ଉଧାର',
  };

  let range = 'today';
  let editing = null;

  function render() {
    const rows = filtered(range);
    const stats = summarize(rows);
    const summary = document.getElementById('khataSummary');
    if (summary) {
      summary.innerHTML = [
        ['ବିକ୍ରି', stats.sale],
        ['କ୍ରୟ', stats.purchase],
        ['ଉଧାର', stats.udhaar],
        ['ନଗଦ ଆସିଲା', stats.received],
        ['ନଗଦ ଗଲା', stats.paid],
      ].map(([label, value]) => `<div class="stat"><span>${label}</span><b>${inr(value)}</b></div>`).join('');
    }

    const parties = document.getElementById('partyList');
    if (parties) {
      const list = balances(rows).filter(([, b]) => b.theyOwe !== 0 || b.weOwe !== 0);
      parties.innerHTML = list.length
        ? list.map(([name, b]) => `<div class="party"><b>${escapeHtml(name)}</b><small>ଆମକୁ ଦେବେ ${inr(b.theyOwe)} · ଆମେ ଦେବୁ ${inr(b.weOwe)}</small></div>`).join('')
        : '<div class="empty">ଏହି ସମୟରେ ବାକି ନାହିଁ।</div>';
    }

    const listEl = document.getElementById('entryList');
    if (!listEl) return;
    if (!rows.length) {
      listEl.innerHTML = '<div class="empty">ମାଇକ୍ ଦବାନ୍ତୁ — “ରମେଶକୁ 500 ଉଧାର ଦେଲି”</div>';
      return;
    }
    listEl.innerHTML = rows.map((row) => `
      <article class="entry" data-id="${row.id}">
        <div>
          <b>${escapeHtml(row.party || 'ସାଧାରଣ')}</b> · ${escapeHtml(ACTION_LABEL[row.action] || row.action)} · ${inr(row.amount)}
          <small>${escapeHtml(row.item || '')} ${escapeHtml(row.payment_type || '')} · ${new Date(row.createdAt).toLocaleString('en-IN')}</small>
          ${editing === row.id ? editFields(row) : ''}
        </div>
        <div class="ops">
          <button type="button" data-act="edit">ବଦଳାନ୍ତୁ</button>
          <button type="button" data-act="del">ହଟାନ୍ତୁ</button>
        </div>
      </article>
    `).join('');
  }

  function editFields(row) {
    return `<form class="side-actions" data-edit="${row.id}">
      <input name="party" value="${escapeAttr(row.party)}" placeholder="ପାର୍ଟି">
      <input name="item" value="${escapeAttr(row.item)}" placeholder="ଜିନିଷ">
      <input name="amount" type="number" min="1" value="${Number(row.amount) || ''}">
      <button type="submit" class="primary">ସେଭ୍</button>
    </form>`;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(value) { return escapeHtml(value); }

  function init() {
    document.getElementById('khataFilters')?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-range]');
      if (!btn) return;
      range = btn.dataset.range;
      document.querySelectorAll('#khataFilters button').forEach((b) => b.classList.toggle('active', b === btn));
      render();
    });

    document.getElementById('khataForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target).entries());
      if (!data.party || !(Number(data.amount) > 0)) return;
      add({ ...data, source: 'manual' });
      e.target.reset();
      render();
    });

    document.getElementById('entryList')?.addEventListener('click', (e) => {
      const card = e.target.closest('.entry');
      if (!card) return;
      const id = card.dataset.id;
      if (e.target.dataset.act === 'del') {
        remove(id);
        if (editing === id) editing = null;
        render();
      }
      if (e.target.dataset.act === 'edit') {
        editing = editing === id ? null : id;
        render();
      }
    });

    document.getElementById('entryList')?.addEventListener('submit', (e) => {
      const form = e.target.closest('form[data-edit]');
      if (!form) return;
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      update(form.dataset.edit, {
        party: data.party,
        item: data.item,
        amount: Number(data.amount) || 0,
      });
      editing = null;
      render();
    });

    document.getElementById('askSummary')?.addEventListener('click', () => {
      const stats = summarize(filtered(range));
      const label = range === 'today' ? 'ଆଜି' : range === 'week' ? 'ଏହି ସପ୍ତାହ' : 'ସବୁ ରେକର୍ଡ';
      const text = `${label}ର ଦୋକାନ ହିସାବ ଏହି ସଂଖ୍ୟା ଉପରେ ଆଧାରିତ। ନୂଆ ରାଶି ଉଦ୍ଭାବନ କର ନାହିଁ। ବିକ୍ରି ${inr(stats.sale)}, କ୍ରୟ ${inr(stats.purchase)}, ଉଧାର ${inr(stats.udhaar)}, ନଗଦ ଆସିଲା ${inr(stats.received)}, ନଗଦ ଗଲା ${inr(stats.paid)}। ଏହାକୁ ସହଜ ଭାଷାରେ ବୁଝାଇ ଦିଅ।`;
      window.UtkalApp?.go('chat');
      window.UtkalChat?.send(text);
    });

    render();
  }

  window.UtkalKhata = { add, update, remove, render, summarize, filtered, init, inr };
})();
