/* M Learning App — shared utilities
 * Everything that renders user/imported text goes through `html` (auto-escaping)
 * so imported HTML or scripts are always shown as plain text, never executed. */
(function () {
  'use strict';
  const ML = (window.ML = window.ML || {});

  class SafeHTML {
    constructor(s) { this.s = s; }
    toString() { return this.s; }
  }

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"'`]/g, (c) => ESC[c]); }

  function renderVal(v) {
    if (v == null || v === false) return '';
    if (v instanceof SafeHTML) return v.s;
    if (Array.isArray(v)) return v.map(renderVal).join('');
    return esc(v);
  }

  /** Tagged template: interpolated values are escaped unless already SafeHTML. */
  function html(strings, ...vals) {
    let out = '';
    strings.forEach((s, i) => { out += s; if (i < vals.length) out += renderVal(vals[i]); });
    return new SafeHTML(out);
  }
  /** Only for markup produced by this app's own code. Never pass user data. */
  const trusted = (s) => new SafeHTML(s);

  function uid(prefix) {
    const b = new Uint8Array(8);
    crypto.getRandomValues(b);
    return (prefix || 'id') + '_' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // ---------- toasts ----------
  function toast(msg, type) {
    let box = $('#toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'info');
    t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    t.textContent = msg;
    box.appendChild(t);
    while (box.children.length > 3) box.firstElementChild.remove(); // keep the stack short
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, type === 'error' ? 6000 : 3500);
  }

  // ---------- modal dialogs ----------
  /** Opens a modal. Resolves with the clicked action's value (or null on close).
   * actions: [{label, value, kind:'primary'|'danger'|'ghost', validate?:(root)=>bool}] */
  function modal({ title, body, actions, wide, onOpen }) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'modal' + (wide ? ' wide' : '');
      d.innerHTML = String(html`
        <div class="modal-card">
          <header class="modal-head"><h2>${title}</h2>
            <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></header>
          <div class="modal-body">${body}</div>
          <footer class="modal-foot">${(actions || [{ label: 'OK', value: true, kind: 'primary' }]).map((a, i) =>
            html`<button type="button" class="btn ${a.kind || 'ghost'}" data-idx="${i}">${a.label}</button>`)}</footer>
        </div>`);
      document.body.appendChild(d);
      let value = null;
      const close = () => { d.close(); };
      d.addEventListener('close', () => { d.remove(); resolve(value); });
      d.querySelector('[data-close]').onclick = close;
      d.querySelectorAll('[data-idx]').forEach((b) => {
        b.onclick = async () => {
          const a = actions[Number(b.dataset.idx)];
          try {
            if (a.validate && !(await a.validate(d))) return;
            value = typeof a.value === 'function' ? a.value(d) : a.value;
          } catch (e) { console.error(e); toast(e.message || String(e), 'error'); return; }
          close();
        };
      });
      // Enter in a single-line input triggers the primary action; forms inside the body never navigate.
      d.addEventListener('submit', (e) => e.preventDefault());
      d.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
          e.preventDefault();
          const primary = d.querySelector('.modal-foot .btn.primary, .modal-foot .btn.danger');
          if (primary) primary.click();
        }
      });
      d.showModal();
      if (onOpen) { try { onOpen(d); } catch (e) { console.error(e); } }
    });
  }

  async function confirmDialog(message, opts) {
    opts = opts || {};
    const r = await modal({
      title: opts.title || 'Please confirm',
      body: html`<p>${message}</p>`,
      actions: [
        { label: opts.cancelLabel || 'Cancel', value: false, kind: 'ghost' },
        { label: opts.okLabel || 'Confirm', value: true, kind: opts.danger ? 'danger' : 'primary' },
      ],
    });
    return r === true;
  }

  async function promptDialog(title, label, value, opts) {
    opts = opts || {};
    const r = await modal({
      title,
      body: html`<label class="field"><span>${label}</span>
        <input id="prompt-input" type="${opts.type || 'text'}" maxlength="${opts.maxLength || 80}" value="${value || ''}" required></label>
        <p class="field-error" id="prompt-err"></p>`,
      actions: [
        { label: 'Cancel', value: null },
        { label: opts.okLabel || 'Save', kind: 'primary',
          validate: (d) => {
            const v = d.querySelector('#prompt-input').value.trim();
            const err = opts.check ? opts.check(v) : (v ? '' : 'This field is required.');
            d.querySelector('#prompt-err').textContent = err || '';
            return !err;
          },
          value: (d) => d.querySelector('#prompt-input').value.trim() },
      ],
      onOpen: (d) => d.querySelector('#prompt-input').focus(),
    });
    return r;
  }

  // ---------- files ----------
  function download(filename, text, mime) {
    const blob = text instanceof Blob ? text : new Blob([text], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function readFileText(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error || new Error('Could not read file')); r.readAsText(file); });
  }
  function readFileBytes(file, n) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result)); r.onerror = () => rej(r.error || new Error('Could not read file')); r.readAsArrayBuffer(n ? file.slice(0, n) : file); });
  }

  // ---------- formatting ----------
  function fmtDate(ts, withTime) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + (withTime ? ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '');
  }
  function fmtDuration(sec) {
    if (sec == null) return '—';
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    if (m >= 60) return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
    return m + 'm ' + String(s).padStart(2, '0') + 's';
  }
  function timeAgo(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return Math.floor(s / 86400) + ' d ago';
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const r = new Uint32Array(1); crypto.getRandomValues(r);
      const j = r[0] % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.classList.add('busy'); btn.textContent = label || 'Working…'; }
    else { btn.disabled = false; btn.classList.remove('busy'); if (btn.dataset.label) btn.textContent = btn.dataset.label; }
  }

  const SUBJECTS = {
    Mathematics: { icon: '📐', tint: 'var(--tint-orange)', short: 'Maths' },
    English: { icon: '📖', tint: 'var(--tint-purple)', short: 'English' },
    'Basic Science': { icon: '🔬', tint: 'var(--tint-green)', short: 'Science' },
    'Computer Studies': { icon: '💻', tint: 'var(--tint-blue)', short: 'Computer' },
  };
  const subjectIcon = (s) => (SUBJECTS[s] ? SUBJECTS[s].icon : '📚');
  const LEVELS = ['Primary 4', 'Primary 5', 'Primary 6', 'JSS 1', 'JSS 2', 'JSS 3', 'SS 1', 'SS 2', 'SS 3'];
  const DIFFICULTIES = ['easy', 'medium', 'hard'];

  /** Safe "lite markup" for lesson bodies: "## heading", "- bullet", "> tip", blank-line paragraphs.
   * Text is escaped; only these structural tags are produced. */
  function renderLite(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const out = [];
    let list = null, para = [];
    const flushPara = () => { if (para.length) { out.push(html`<p>${para.join(' ')}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(html`<ul>${list.map((li) => html`<li>${li}</li>`)}</ul>`); list = null; } };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { flushPara(); flushList(); continue; }
      if (line.startsWith('## ')) { flushPara(); flushList(); out.push(html`<h3>${line.slice(3)}</h3>`); }
      else if (line.startsWith('- ')) { flushPara(); (list = list || []).push(line.slice(2)); }
      else if (line.startsWith('> ')) { flushPara(); flushList(); out.push(html`<div class="callout">💡 ${line.slice(2)}</div>`); }
      else { flushList(); para.push(line); }
    }
    flushPara(); flushList();
    return html`${out}`;
  }

  ML.u = { html, esc, trusted, SafeHTML, uid, $, $$, toast, modal, confirm: confirmDialog, prompt: promptDialog,
    download, readFileText, readFileBytes, fmtDate, fmtDuration, timeAgo, pct, shuffle, debounce, setBusy,
    SUBJECTS, subjectIcon, LEVELS, DIFFICULTIES, renderLite };
})();
