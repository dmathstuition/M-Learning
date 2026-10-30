/* M Learning App — question bank management and the question import workflow.
 * Teachers manage the shared school bank; students get a private practice library. */
(function () {
  'use strict';
  const ML = (window.ML = window.ML || {});
  const V = (ML.views = ML.views || {});
  const { u, db, Q } = ML;
  const { html } = u;
  const L = Q.LETTERS;

  // ---------------- shared question editor (manual entry + fixing import rows) ----------------
  function editorBody(raw, user, banks) {
    raw = raw || {};
    const opts = raw.options || [];
    const type = raw.type && Q.TYPES[raw.type] ? raw.type : (opts.length ? 'mcq' : raw.type || 'mcq');
    return html`<form class="stack" id="qe" novalidate>
      <div class="form-grid">
        <label class="field"><span>Question type</span><select name="type">${Object.entries(Q.TYPES).map(([k, v]) => html`<option value="${k}" ${type === k ? 'selected' : ''}>${v}</option>`)}</select></label>
        <label class="field"><span>Marks</span><input name="marks" type="number" min="0.5" max="100" step="0.5" value="${raw.marks == null || raw.marks === '' ? 1 : raw.marks}"></label>
      </div>
      <label class="field"><span>Question text <span class="muted small">(for fill-in-the-blank, write ___ where the answer goes)</span></span><textarea name="text" maxlength="${Q.LIMITS.text}" style="min-height:90px">${raw.text || ''}</textarea></label>
      <div data-for="mcq"><div class="form-grid">${[0, 1, 2, 3, 4, 5].map((i) => html`<label class="field"><span>Option ${L[i]}${i < 2 ? ' *' : ' (optional)'}</span><input name="opt${i}" maxlength="${Q.LIMITS.option}" value="${opts[i] || ''}"></label>`)}</div>
        <label class="field"><span>Correct option</span><select name="mcqAnswer">${[0, 1, 2, 3, 4, 5].map((i) => html`<option ${String(raw.answer || '').toUpperCase() === L[i] ? 'selected' : ''}>${L[i]}</option>`)}</select></label></div>
      <div data-for="tf"><label class="field"><span>Correct answer</span><select name="tfAnswer"><option value="true" ${/^t/i.test(raw.answer || '') ? 'selected' : ''}>True</option><option value="false" ${/^f/i.test(raw.answer || '') ? 'selected' : ''}>False</option></select></label></div>
      <div data-for="text"><label class="field"><span>Accepted answers <span class="muted small">(separate alternatives with | — e.g. 5|five|x = 5)</span></span><input name="accepted" maxlength="1000" value="${['short', 'fill'].includes(raw.type) ? raw.answer || '' : ''}"></label>
        <label class="check" data-for="short"><input type="checkbox" name="manual" ${/^(1|true|yes|y)$/i.test(String(raw.manual || '')) ? u.trusted('checked') : ''}> Teacher marks this answer (answers that match an accepted answer are still marked automatically)</label></div>
      <label class="field"><span>Explanation (shown after answering)</span><textarea name="explanation" maxlength="${Q.LIMITS.explanation}" style="min-height:70px">${raw.explanation || ''}</textarea></label>
      <div class="form-grid">
        <label class="field"><span>Subject</span><select name="subject"><option value="">—</option>${Array.from(new Set(Object.keys(u.SUBJECTS).concat(raw.subject ? [raw.subject] : []))).map((s) => html`<option ${raw.subject === s ? 'selected' : ''}>${s}</option>`)}</select></label>
        <label class="field"><span>Class / level</span><select name="level"><option value="">All levels</option>${u.LEVELS.map((l) => html`<option ${raw.level === l ? 'selected' : ''}>${l}</option>`)}</select></label>
        <label class="field"><span>Topic</span><input name="topic" maxlength="80" value="${raw.topic || ''}"></label>
        <label class="field"><span>Difficulty</span><select name="difficulty">${u.DIFFICULTIES.map((d) => html`<option ${(raw.difficulty || 'medium') === d ? 'selected' : ''}>${d}</option>`)}</select></label>
        <label class="field"><span>Image reference (optional)</span><input name="image" maxlength="500" placeholder="https://… or diagram1.png" value="${raw.image || ''}"></label>
        ${banks ? html`<label class="field"><span>Question bank</span><input name="bank" maxlength="60" list="bank-list" value="${raw.bank || 'General'}"><datalist id="bank-list">${banks.map((b) => html`<option value="${b}">`)}</datalist></label>` : ''}
      </div>
      ${banks && user.role === 'teacher' ? html`<label class="check"><input type="checkbox" name="practice" ${raw.practice ? u.trusted('checked') : ''}> Students may use this question for topic practice (answers are revealed during practice)</label>` : ''}
      <div class="form-msg" id="qe-msg" role="alert"></div>
    </form>`;
  }
  function readEditor(d) {
    const f = u.$('#qe', d);
    const type = f.type.value;
    const raw = { type, text: f.text.value, explanation: f.explanation.value, subject: f.subject.value, level: f.level.value, topic: f.topic.value, difficulty: f.difficulty.value, marks: f.marks.value, image: f.image.value };
    if (type === 'mcq') { raw.options = [0, 1, 2, 3, 4, 5].map((i) => f['opt' + i].value).filter((x) => x.trim()); raw.answer = f.mcqAnswer.value; }
    else if (type === 'tf') raw.answer = f.tfAnswer.value;
    else { raw.answer = f.accepted.value; raw.manual = type === 'short' && f.manual.checked ? 'yes' : ''; }
    if (f.bank) raw.bank = f.bank.value.trim() || 'General';
    if (f.practice) raw.practice = f.practice.checked;
    return raw;
  }
  function syncEditor(d) {
    const t = u.$('#qe', d).type.value;
    u.$$('[data-for]', d).forEach((el) => { const k = el.dataset.for; el.hidden = !(k === t || (k === 'text' && (t === 'short' || t === 'fill'))); });
  }
  /** Opens the editor. Resolves to a raw question object (validated) or null. */
  async function editQuestion(raw, { title, user, banks, defaults }) {
    return u.modal({
      title, wide: true, body: editorBody(raw, user, banks),
      onOpen: (d) => { syncEditor(d); u.$('#qe', d).type.onchange = () => syncEditor(d); u.$('#qe', d).text.focus(); },
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Save question', kind: 'primary',
          validate: (d) => {
            const r = Q.validate(readEditor(d), defaults || {});
            const m = u.$('#qe-msg', d);
            if (r.errors.length) { m.className = 'form-msg show error'; m.textContent = r.errors.join(' '); return false; }
            return true;
          },
          value: (d) => readEditor(d) },
      ],
    });
  }
  ML.editQuestion = editQuestion;

  // =============================== QUESTION BANK ===============================
  V.bank = async (root, params, { user, setTitle }) => {
    const teacher = user.role === 'teacher';
    setTitle(teacher ? 'Question Bank' : 'My Question Library');
    let all = await ML.bank.visible(user);
    const selected = new Set();
    let limit = 100;
    const f = { q: '', subject: '', level: '', topic: '', difficulty: '', type: '', bank: '' };

    function filtered() {
      const q = f.q.toLowerCase();
      return all.filter((x) => (!q || x.text.toLowerCase().includes(q) || (x.topic || '').toLowerCase().includes(q) || (x.explanation || '').toLowerCase().includes(q))
        && (!f.subject || x.subject === f.subject) && (!f.level || x.level === f.level) && (!f.topic || x.topic === f.topic)
        && (!f.difficulty || x.difficulty === f.difficulty) && (!f.type || x.type === f.type) && (!f.bank || (x.bank || 'General') === f.bank))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }
    const sel = (id, label, values, cur) => html`<label class="field"><span>${label}</span><select data-f="${id}"><option value="">All</option>${values.map((v) => Array.isArray(v) ? html`<option value="${v[0]}" ${cur === v[0] ? 'selected' : ''}>${v[1]}</option>` : html`<option ${cur === v ? 'selected' : ''}>${v}</option>`)}</select></label>`;

    function draw() {
      const list = filtered();
      const subjects = Array.from(new Set(all.map((x) => x.subject))).sort();
      const levels = Array.from(new Set(all.map((x) => x.level))).sort((a, b) => u.LEVELS.indexOf(a) - u.LEVELS.indexOf(b));
      root.innerHTML = String(html`<div class="stack">
        ${teacher ? '' : html`<div class="local-banner">🗂️ Your personal library: import or write your own questions and practise them with instant feedback. Only you can see these.</div>`}
        <div class="card"><div class="row between"><div class="row"><button class="btn primary" id="add">＋ Add question</button><a class="btn soft" href="#/import">📥 Import questions</a></div>
          <div class="row"><button class="btn ghost sm" id="exp-csv" ${list.length ? '' : u.trusted('disabled')}>Export CSV</button><button class="btn ghost sm" id="exp-json" ${list.length ? '' : u.trusted('disabled')}>Export JSON</button></div></div>
          <div class="form-grid" style="margin-top:14px">
            <label class="field" style="grid-column:1/-1"><span>Search questions</span><input type="search" data-f="q" value="${f.q}" placeholder="Search text, topic or explanation"></label>
            ${sel('subject', 'Subject', subjects, f.subject)}${sel('level', 'Class / level', levels, f.level)}${sel('topic', 'Topic', ML.bank.topics(all, f.subject), f.topic)}
            ${sel('difficulty', 'Difficulty', u.DIFFICULTIES, f.difficulty)}${sel('type', 'Type', Object.entries(Q.TYPES), f.type)}${sel('bank', 'Bank', ML.bank.banks(all), f.bank)}
          </div></div>
        <div class="row between"><span class="muted"><b>${list.length}</b> of ${all.length} question(s) · <b id="sel-count">${selected.size}</b> selected</span>
          <div class="row"><button class="btn sm ghost" id="sel-all">Select all shown</button><button class="btn sm ghost" id="sel-none">Clear selection</button>
            ${teacher ? html`<button class="btn sm soft" id="mk-quiz">Create quiz from selected</button>` : ''}
            <button class="btn sm accent" id="practise">Practise ${selected.size ? 'selected' : 'shown'}</button>
            <button class="btn sm danger" id="del-sel">Delete selected</button></div></div>
        ${list.length ? html`<div class="table-wrap"><table><thead><tr><th><span class="sr-only">Select</span></th><th>Question</th><th>Type</th><th>Subject · Topic</th><th>Level</th><th>Difficulty</th><th>Marks</th><th>Bank</th><th>Actions</th></tr></thead><tbody>
          ${list.slice(0, limit).map((x) => html`<tr><td><input type="checkbox" data-sel="${x.id}" aria-label="Select question" ${selected.has(x.id) ? u.trusted('checked') : ''}></td>
            <td style="min-width:240px">${x.text}<div class="small muted">Answer: ${Q.correctText(x)}</div></td><td>${Q.TYPES[x.type]}${x.manual ? html`<br><span class="badge warn">teacher-marked</span>` : ''}</td>
            <td>${x.subject}<br><span class="small muted">${x.topic}</span></td><td>${x.level}</td><td>${x.difficulty}</td><td>${x.marks}</td>
            <td>${x.bank || 'General'}${teacher && x.practice ? html`<br><span class="badge orange">practice</span>` : ''}</td>
            <td><div class="row"><button class="btn sm ghost" data-edit="${x.id}">Edit</button><button class="btn sm ghost" data-del="${x.id}" aria-label="Delete question">🗑️</button></div></td></tr>`)}
          </tbody></table></div>${list.length > limit ? html`<div class="center"><button class="btn ghost" id="more">Show more (${list.length - limit} left)</button></div>` : ''}`
          : html`<div class="card">${ML.empty('🗂️', all.length ? 'No questions match these filters' : 'No questions yet', all.length ? 'Try clearing a filter.' : 'Add questions one by one or import a CSV/JSON file.', html`<a class="btn primary" href="#/import">Import questions</a>`)}</div>`}
      </div>`);
      bind(list);
    }

    function bind(list) {
      u.$$('[data-f]', root).forEach((el) => {
        const handler = () => { f[el.dataset.f] = el.value; if (el.dataset.f === 'subject') f.topic = ''; limit = 100; draw(); const n = u.$('[data-f="' + el.dataset.f + '"]', root); if (n && el.dataset.f === 'q') { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } };
        if (el.tagName === 'INPUT') el.oninput = u.debounce(handler, 250); else el.onchange = handler;
      });
      const more = u.$('#more', root); if (more) more.onclick = () => { limit += 100; draw(); };
      u.$$('[data-sel]', root).forEach((c) => { c.onchange = () => { if (c.checked) selected.add(c.dataset.sel); else selected.delete(c.dataset.sel); u.$('#sel-count', root).textContent = selected.size; u.$('#practise', root).textContent = 'Practise ' + (selected.size ? 'selected' : 'shown'); }; });
      u.$('#sel-all', root).onclick = () => { list.slice(0, limit).forEach((x) => selected.add(x.id)); draw(); };
      u.$('#sel-none', root).onclick = () => { selected.clear(); draw(); };
      u.$('#add', root).onclick = async () => {
        const raw = await editQuestion({ subject: f.subject, topic: f.topic, level: f.level, bank: f.bank || 'General', practice: false }, { title: 'Add a question', user, banks: ML.bank.banks(all) });
        if (!raw) return;
        const r = Q.validate(raw, {});
        if (all.some((x) => Q.dupKey(x) === Q.dupKey(r.q))) { u.toast('This question is already in the bank — not added twice.', 'error'); return; }
        await ML.bank.save(user, Q.toRecord(r.q, user, raw.bank, teacher ? { practice: !!raw.practice } : {}));
        u.toast('Question added.', 'success'); all = await ML.bank.visible(user); draw();
      };
      u.$$('[data-edit]', root).forEach((b) => { b.onclick = async () => {
        const rec = all.find((x) => x.id === b.dataset.edit);
        const raw = await editQuestion(Object.assign(Q.toRaw(rec), { bank: rec.bank, practice: rec.practice }), { title: 'Edit question', user, banks: ML.bank.banks(all) });
        if (!raw) return;
        const r = Q.validate(raw, {});
        const updated = Object.assign(Q.toRecord(r.q, { id: rec.ownerId, role: rec.ownerRole }, raw.bank, teacher ? { practice: !!raw.practice } : {}), { id: rec.id, createdAt: rec.createdAt, builtIn: rec.builtIn });
        try { await ML.bank.save(user, updated); u.toast('Question updated. Existing quizzes use the new version.', 'success'); all = await ML.bank.visible(user); draw(); } catch (e) { u.toast(e.message, 'error'); }
      }; });
      const delIds = async (ids) => {
        const quizzes = (await db.all('quizzes')).filter((qz) => qz.status !== 'practice' && qz.questionIds.some((id) => ids.includes(id)));
        const extra = quizzes.length ? ' They are used in ' + quizzes.length + ' quiz(zes) (' + quizzes.map((q) => q.title).slice(0, 3).join(', ') + ') and will be removed from them.' : '';
        if (!(await u.confirm('Delete ' + ids.length + ' question(s)? This cannot be undone.' + extra, { okLabel: 'Delete', danger: true }))) return;
        const n = await ML.bank.remove(user, ids);
        for (const qz of quizzes) { qz.questionIds = qz.questionIds.filter((id) => !ids.includes(id)); await db.put('quizzes', qz); }
        ids.forEach((id) => selected.delete(id));
        u.toast(n + ' question(s) deleted.', 'success'); all = await ML.bank.visible(user); draw();
      };
      u.$$('[data-del]', root).forEach((b) => { b.onclick = () => delIds([b.dataset.del]); });
      u.$('#del-sel', root).onclick = () => { if (!selected.size) { u.toast('Select questions first.', 'error'); return; } delIds(Array.from(selected)); };
      u.$('#exp-csv', root).onclick = () => { u.download('question-bank-' + new Date().toISOString().slice(0, 10) + '.csv', Q.exportCSV(list), 'text/csv'); u.toast('Exported ' + list.length + ' question(s) as CSV.', 'success'); };
      u.$('#exp-json', root).onclick = () => { u.download('question-bank-' + new Date().toISOString().slice(0, 10) + '.json', Q.exportJSON(list), 'application/json'); u.toast('Exported ' + list.length + ' question(s) as JSON.', 'success'); };
      const mk = u.$('#mk-quiz', root);
      if (mk) mk.onclick = () => {
        if (!selected.size) { u.toast('Select the questions you want in the quiz first.', 'error'); return; }
        try { sessionStorage.setItem('ml.quizDraftSel', JSON.stringify(Array.from(selected))); } catch (e) { ML.quizDraftSel = Array.from(selected); }
        location.hash = '#/teacher/quiz/new';
      };
      u.$('#practise', root).onclick = async () => {
        const ids = selected.size ? Array.from(selected) : list.map((x) => x.id);
        if (!ids.length) { u.toast('No questions to practise.', 'error'); return; }
        try {
          // practice quizzes may only contain questions the user can see, which `visible` already guarantees
          const qz = await ML.quizSvc.createPractice(user, { title: teacher ? 'Teacher practice run' : 'My library practice', subject: f.subject || 'Mixed', questionIds: ids });
          location.hash = '#/quiz/' + qz.id;
        } catch (e) { u.toast(e.message, 'error'); }
      };
    }
    draw();
  };

  // =============================== IMPORT QUESTIONS ===============================
  V.importQuestions = async (root, params, { user }) => {
    const teacher = user.role === 'teacher';
    let existing = await ML.bank.visible(user);
    const st = { step: 1, source: 'file', kind: '', fileName: '', raws: [], results: [], userInclude: {},
      dest: { subject: '', level: '', topic: '', forceSubject: false, forceTopic: false, forceLevel: false, bank: teacher ? 'Imported' : 'My questions', practice: false }, summary: null };

    function revalidate() {
      st.results = Q.validateBatch(st.raws, st.dest, existing);
      st.results.forEach((r, i) => { if (!r.errors.length && i in st.userInclude) r.include = st.userInclude[i]; if (r.errors.length) r.include = false; });
    }
    const steps = () => html`<div class="steps" aria-label="Import progress">${['1 · Choose source', '2 · Preview & fix', '3 · Done'].map((s, i) => html`<span class="${st.step === i + 1 ? 'on' : ''}">${s}</span>`)}</div>`;

    function draw() {
      if (st.step === 1) drawSource();
      else if (st.step === 2) drawPreview();
      else drawSummary();
    }

    function drawSource() {
      root.innerHTML = String(html`<div class="stack">${steps()}
        <div class="card stack">
          <h2>📥 Import questions ${teacher ? 'into the school question bank' : 'into your practice library'}</h2>
          <div class="tabs" role="tablist" style="max-width:620px">${[['file', '📄 Upload file'], ['paste', '📋 Paste text'], ['manual', '✍️ Enter manually']].map(([k, l]) => html`<button role="tab" data-src="${k}" class="${st.source === k ? 'active' : ''}">${l}</button>`)}</div>
          ${st.source === 'file' ? html`
            <label class="dropzone" id="drop" tabindex="0"><input type="file" id="qfile" accept=".csv,.json,.txt,text/csv,application/json,text/plain" class="sr-only">
              <span style="font-size:36px">📄</span><br><b>Choose a CSV, JSON or TXT file</b> or drop it here<br><span class="small muted">Max 2 MB and ${Q.LIMITS.questions} questions per import. Excel/Sheets users: save as CSV first.</span></label>`
          : st.source === 'paste' ? html`
            <label class="field"><span>Paste questions (plain-text format, CSV with a header row, or JSON)</span><textarea id="paste" style="min-height:240px;font-family:monospace" placeholder="${Q.TEXT_TEMPLATE}"></textarea></label>
            <div><button class="btn primary" id="parse">Check pasted questions</button></div>`
          : html`<p>Add questions one at a time. They will be checked and previewed before anything is saved.</p>
            <div class="row"><button class="btn primary" id="manual-add">＋ Write a question</button>${st.raws.length ? html`<button class="btn soft" id="to-preview">Review ${st.raws.length} question(s) →</button>` : ''}</div>`}
          <div class="form-msg" id="src-msg" role="alert"></div>
        </div>
        <div class="card stack"><h2>📑 Templates & format</h2>
          <p class="small muted">Download a template, fill it in (Excel, Google Sheets or any text editor), then import it. Columns: <code>type, question, option_a…option_f, answer, explanation, subject, level, topic, difficulty, marks, image, manual_marking</code>.</p>
          <div class="row"><button class="btn soft sm" data-tpl="csv">Download CSV template</button><button class="btn soft sm" data-tpl="json">Download JSON template</button><button class="btn soft sm" data-tpl="txt">Download text template</button></div>
          <details><summary class="small"><b>Format rules</b></summary><ul class="small">
            <li><b>type</b>: mcq, tf, short or fill (if blank we guess from the content and warn you).</li>
            <li><b>answer</b>: mcq → a letter (A–F) or the exact option text; tf → true/false; short/fill → accepted answers separated by <code>|</code>.</li>
            <li>Short answers with no accepted answers (or manual_marking = yes) are marked by a teacher.</li>
            <li><b>difficulty</b>: easy, medium or hard. <b>marks</b>: a number (default 1).</li>
            <li>Missing subject/topic can be filled in from the destination you choose on the next step.</li>
            <li>Any HTML or script in a file is shown as plain text — it is never run.</li></ul></details>
        </div></div>`);
      u.$$('[data-src]', root).forEach((b) => { b.onclick = () => { st.source = b.dataset.src; draw(); }; });
      u.$$('[data-tpl]', root).forEach((b) => { b.onclick = () => {
        const t = b.dataset.tpl;
        if (t === 'csv') u.download('m-learning-questions-template.csv', '﻿' + Q.CSV_TEMPLATE, 'text/csv');
        else if (t === 'json') u.download('m-learning-questions-template.json', Q.JSON_TEMPLATE, 'application/json');
        else u.download('m-learning-questions-template.txt', Q.TEXT_TEMPLATE, 'text/plain');
      }; });
      const msg = (t) => { const m = u.$('#src-msg', root); m.className = 'form-msg show error'; m.textContent = t; };
      const accept = (parsed, name) => {
        if (!parsed.raws.length) { msg('No questions were found.'); return; }
        try { st.raws = parsed.raws; st.kind = parsed.kind; st.fileName = name || ''; st.userInclude = {}; revalidate(); st.step = 2; draw(); }
        catch (e) { msg(e.message); }
      };
      const fileInput = u.$('#qfile', root);
      if (fileInput) {
        const handle = async (file) => {
          const m = u.$('#src-msg', root); m.className = 'form-msg show success'; m.textContent = 'Reading ' + file.name + '…';
          try { accept(await Q.rawFromFile(file), file.name); } catch (e) { msg(e.message); u.toast('Import failed — your existing question bank was not changed.', 'error'); }
        };
        fileInput.onchange = () => { if (fileInput.files[0]) handle(fileInput.files[0]); fileInput.value = ''; };
        const drop = u.$('#drop', root);
        drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } };
        ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
        ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
        drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handle(f); });
      }
      const parse = u.$('#parse', root);
      if (parse) parse.onclick = () => { try { accept(Q.rawFromPaste(u.$('#paste', root).value), 'pasted text'); } catch (e) { msg(e.message); } };
      const madd = u.$('#manual-add', root);
      if (madd) madd.onclick = async () => {
        const raw = await editQuestion({ subject: st.dest.subject, topic: st.dest.topic }, { title: 'Write a question', user });
        if (raw) { raw._row = st.raws.length + 1; st.raws.push(raw); st.kind = 'Manual'; u.toast('Question added to this import (' + st.raws.length + ').', 'success'); draw(); }
      };
      const tp = u.$('#to-preview', root); if (tp) tp.onclick = () => { revalidate(); st.step = 2; draw(); };
    }

    function drawPreview() {
      const R = st.results;
      const counts = { total: R.length, ok: R.filter((r) => !r.errors.length && !r.duplicate).length, warn: R.filter((r) => !r.errors.length && r.warnings.length).length,
        err: R.filter((r) => r.errors.length).length, dup: R.filter((r) => r.duplicate && !r.errors.length).length, inc: R.filter((r) => r.include).length };
      const subjects = Object.keys(u.SUBJECTS);
      const banks = ML.bank.banks(existing);
      root.innerHTML = String(html`<div class="stack">${steps()}
        <div class="grid cols-4">
          <div class="stat"><span class="label">Rows found (${st.kind}${st.fileName ? ' · ' + st.fileName : ''})</span><span class="value">${counts.total}</span></div>
          <div class="stat"><span class="label">Ready to import</span><span class="value" style="color:var(--ok)">${counts.inc}</span></div>
          <div class="stat"><span class="label">With errors (rejected)</span><span class="value" style="color:var(--bad)">${counts.err}</span></div>
          <div class="stat"><span class="label">Duplicates</span><span class="value" style="color:var(--primary-strong)">${counts.dup}</span></div>
        </div>
        <div class="card"><h2>🎯 Destination</h2>
          <div class="form-grid">
            <label class="field"><span>Subject (used when a row has none)</span><select data-d="subject"><option value="">From file</option>${subjects.map((s) => html`<option ${st.dest.subject === s ? 'selected' : ''}>${s}</option>`)}</select>
              <label class="check small"><input type="checkbox" data-d="forceSubject" ${st.dest.forceSubject ? u.trusted('checked') : ''}> Apply to every row</label></label>
            <label class="field"><span>Topic (used when a row has none)</span><input data-d="topic" maxlength="80" value="${st.dest.topic}" placeholder="e.g. Fractions">
              <label class="check small"><input type="checkbox" data-d="forceTopic" ${st.dest.forceTopic ? u.trusted('checked') : ''}> Apply to every row</label></label>
            <label class="field"><span>Class / level (used when a row has none)</span><select data-d="level"><option value="">From file</option>${u.LEVELS.map((l) => html`<option ${st.dest.level === l ? 'selected' : ''}>${l}</option>`)}</select>
              <label class="check small"><input type="checkbox" data-d="forceLevel" ${st.dest.forceLevel ? u.trusted('checked') : ''}> Apply to every row</label></label>
            <label class="field"><span>Question bank</span><input data-d="bank" maxlength="60" list="dest-banks" value="${st.dest.bank}"><datalist id="dest-banks">${banks.map((b) => html`<option value="${b}">`)}</datalist></label>
          </div>
          ${teacher ? html`<label class="check"><input type="checkbox" data-d="practice" ${st.dest.practice ? u.trusted('checked') : ''}> Allow students to use these questions for topic practice (answers are revealed during practice — leave off for test questions)</label>` : ''}
        </div>
        <div class="card stack"><div class="row between"><h2 style="margin:0">Preview</h2>
          <div class="row small"><span class="badge ok">valid</span><span class="badge warn">warning</span><span class="badge bad">error</span><span class="badge purple">duplicate</span></div></div>
          <p class="small muted">Rows with errors can't be imported until you fix them (✏️ Fix). Duplicates are skipped unless you tick them. Untick any row to exclude it.</p>
          <div class="table-wrap" style="max-height:60vh"><table><thead><tr><th>Include</th><th>#</th><th>Status</th><th>Question</th><th>Type</th><th>Answer</th><th>Subject · Topic · Level</th><th>Diff.</th><th>Marks</th><th></th></tr></thead><tbody>
            ${R.map((r, i) => {
              const q = r.q || {};
              const cls = r.errors.length ? 'row-error' : r.duplicate ? 'row-dup' : r.warnings.length ? 'row-warn' : '';
              return html`<tr class="${cls} ${r.include ? '' : 'excluded'}">
                <td><input type="checkbox" data-inc="${i}" aria-label="Include row ${r.row}" ${r.include ? u.trusted('checked') : ''} ${r.errors.length ? u.trusted('disabled') : ''}></td>
                <td>${r.row}</td>
                <td>${r.errors.length ? html`<span class="badge bad">Error</span>` : r.duplicate ? html`<span class="badge purple">Duplicate</span>` : r.warnings.length ? html`<span class="badge warn">Warning</span>` : html`<span class="badge ok">Valid</span>`}</td>
                <td style="min-width:220px">${q.text || html`<i class="muted">(missing)</i>`}${q.type === 'mcq' && q.options.length ? html`<div class="small muted">${q.options.map((o, k) => L[k] + ') ' + o).join('   ')}</div>` : ''}
                  ${r.errors.length || r.warnings.length || r.duplicate ? html`<ul class="issues">${r.errors.map((e) => html`<li class="e">${e}</li>`)}${r.duplicate ? html`<li class="w">${r.duplicate}</li>` : ''}${r.warnings.map((w) => html`<li class="w">${w}</li>`)}</ul>` : ''}</td>
                <td>${Q.TYPES[q.type] || '?'}</td>
                <td>${r.errors.length && q.type === 'mcq' && q.answerIndex == null ? '—' : q.type ? Q.correctText(q) : '—'}</td>
                <td>${q.subject || '—'}<br><span class="small muted">${q.topic || '—'} · ${q.level || '—'}</span></td><td>${q.difficulty}</td><td>${q.marks}</td>
                <td><div class="row"><button class="btn sm ghost" data-fix="${i}">✏️ ${r.errors.length ? 'Fix' : 'Edit'}</button><button class="btn sm ghost" data-rm="${i}" aria-label="Remove row">✕</button></div></td></tr>`;
            })}</tbody></table></div>
        </div>
        <div class="card row between"><button class="btn ghost" id="back">← Start over</button>
          <div class="row">${counts.err ? html`<button class="btn soft" id="dl-err">Download error report</button>` : ''}<button class="btn primary" id="confirm" ${counts.inc ? '' : u.trusted('disabled')}>Import ${counts.inc} question(s)</button></div></div>
      </div>`);
      bindPreview();
    }

    function bindPreview() {
      u.$$('[data-d]', root).forEach((el) => {
        const k = el.dataset.d;
        // re-render on the next tick: `change` fires during blur, and replacing the focused node mid-blur throws
        const h = () => { st.dest[k] = el.type === 'checkbox' ? el.checked : el.value.trim(); if (k !== 'bank' && k !== 'practice') setTimeout(() => { revalidate(); drawPreview(); }, 0); };
        if (el.tagName === 'INPUT' && el.type !== 'checkbox') el.onchange = h; else el.onchange = h;
      });
      u.$$('[data-inc]', root).forEach((c) => { c.onchange = () => { st.userInclude[c.dataset.inc] = c.checked; revalidate(); drawPreview(); }; });
      u.$$('[data-rm]', root).forEach((b) => { b.onclick = () => {
        const i = Number(b.dataset.rm); st.raws.splice(i, 1);
        const ui = {}; Object.entries(st.userInclude).forEach(([k, v]) => { k = Number(k); if (k < i) ui[k] = v; else if (k > i) ui[k - 1] = v; }); st.userInclude = ui;
        if (!st.raws.length) { st.step = 1; draw(); return; }
        revalidate(); drawPreview();
      }; });
      u.$$('[data-fix]', root).forEach((b) => { b.onclick = async () => {
        const i = Number(b.dataset.fix); const r = st.results[i];
        const base = Object.assign({}, st.raws[i]);
        if (r.q) {
          Object.assign(base, { type: r.q.type, subject: r.q.subject, topic: r.q.topic, level: r.q.level === 'All levels' ? '' : r.q.level,
            difficulty: u.DIFFICULTIES.includes(r.q.difficulty) ? r.q.difficulty : 'medium', marks: typeof r.q.marks === 'number' ? r.q.marks : 1 });
          if (r.q.type === 'mcq') { base.options = r.q.options; base.answer = r.q.answerIndex != null ? L[r.q.answerIndex] : ''; }
        }
        const raw = await editQuestion(base, { title: 'Fix row ' + r.row, user, defaults: st.dest });
        if (!raw) return;
        raw._row = r.row; st.raws[i] = raw; delete st.userInclude[i];
        revalidate(); drawPreview();
        u.toast('Row ' + r.row + ' updated.', 'success');
      }; });
      u.$('#back', root).onclick = async () => { if (await u.confirm('Discard this import and start over? Nothing has been saved yet.', { okLabel: 'Start over' })) { st.raws = []; st.step = 1; draw(); } };
      const de = u.$('#dl-err', root);
      if (de) de.onclick = () => u.download('import-errors.csv', Q.toCSV([['row', 'question', 'errors']].concat(st.results.filter((r) => r.errors.length).map((r) => [r.row, r.q ? r.q.text : '', r.errors.join(' | ')]))), 'text/csv');
      u.$('#confirm', root).onclick = confirmImport;
    }

    async function confirmImport() {
      const R = st.results;
      const chosen = R.filter((r) => r.include && !r.errors.length);
      const bank = st.dest.bank || (teacher ? 'Imported' : 'My questions');
      if (!(await u.confirm('Import ' + chosen.length + ' question(s) into “' + bank + '”?', { okLabel: 'Import now' }))) return;
      const btn = u.$('#confirm', root); u.setBusy(btn, true, 'Saving…');
      try {
        if (teacher) await ML.auth.requireTeacher();
        const records = chosen.map((r) => Q.toRecord(r.q, user, bank, teacher ? { practice: !!st.dest.practice } : {}));
        await db.putMany('questions', records); // all-or-nothing: on failure the existing bank is untouched
        st.summary = {
          imported: records.length, ids: records.map((x) => x.id), bank,
          skipped: R.filter((r) => !r.errors.length && !r.include).map((r) => ({ row: r.row, text: r.q.text, reason: r.duplicate || 'Excluded by you' })),
          rejected: R.filter((r) => r.errors.length).map((r) => ({ row: r.row, text: r.q ? r.q.text : '', reason: r.errors.join(' ') })),
        };
        st.step = 3; draw();
        u.toast(records.length + ' question(s) imported.', 'success');
      } catch (e) {
        u.setBusy(btn, false);
        u.toast((db.isQuotaError(e) ? 'Device storage is full. ' : 'Import failed: ' + e.message + '. ') + 'No questions were saved and your existing bank is unchanged.', 'error');
      }
    }

    function drawSummary() {
      const s = st.summary;
      root.innerHTML = String(html`<div class="stack">${steps()}
        <div class="card center stack"><span style="font-size:54px">🎉</span><h2>Import complete</h2>
          <div class="grid cols-3" style="text-align:left">
            <div class="stat"><span class="label">Imported</span><span class="value" style="color:var(--ok)">${s.imported}</span></div>
            <div class="stat"><span class="label">Skipped</span><span class="value">${s.skipped.length}</span></div>
            <div class="stat"><span class="label">Rejected (errors)</span><span class="value" style="color:var(--bad)">${s.rejected.length}</span></div></div>
          <p>Saved to the <b>${s.bank}</b> bank.</p>
          <div class="row" style="justify-content:center"><a class="btn primary" href="#/bank">Open question bank</a>${teacher ? html`<button class="btn soft" id="mk">Create a quiz from these</button>` : html`<button class="btn soft" id="pr">Practise them now</button>`}<button class="btn ghost" id="again">Import more</button></div></div>
        ${s.skipped.length || s.rejected.length ? html`<div class="card"><h2>Not imported</h2><div class="table-wrap"><table><thead><tr><th>Row</th><th>Question</th><th>Outcome</th><th>Reason</th></tr></thead><tbody>
          ${s.rejected.map((r) => html`<tr class="row-error"><td>${r.row}</td><td>${r.text || '—'}</td><td>Rejected</td><td>${r.reason}</td></tr>`)}
          ${s.skipped.map((r) => html`<tr><td>${r.row}</td><td>${r.text}</td><td>Skipped</td><td>${r.reason}</td></tr>`)}</tbody></table></div></div>` : ''}
      </div>`);
      u.$('#again', root).onclick = async () => { existing = await ML.bank.visible(user); st.raws = []; st.userInclude = {}; st.step = 1; draw(); };
      const mk = u.$('#mk', root);
      if (mk) mk.onclick = () => { try { sessionStorage.setItem('ml.quizDraftSel', JSON.stringify(s.ids)); } catch (e) { ML.quizDraftSel = s.ids; } location.hash = '#/teacher/quiz/new'; };
      const pr = u.$('#pr', root);
      if (pr) pr.onclick = async () => { try { const qz = await ML.quizSvc.createPractice(user, { title: 'Imported practice', subject: 'Mixed', questionIds: s.ids }); location.hash = '#/quiz/' + qz.id; } catch (e) { u.toast(e.message, 'error'); } };
    }

    draw();
  };
})();
