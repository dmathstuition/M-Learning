/* M Learning App — quiz player and results.
 * The player only receives student-safe question copies; correctness comes from ML.quizSvc. */
(function () {
  'use strict';
  const ML = (window.ML = window.ML || {});
  const V = (ML.views = ML.views || {});
  const { u, Q } = ML;
  const { html } = u;
  const L = Q.LETTERS;

  function imageHTML(ref) {
    if (!ref) return '';
    if (/^https:\/\//i.test(ref)) return html`<img src="${ref}" alt="Question image" loading="lazy" referrerpolicy="no-referrer" style="max-height:260px;border-radius:14px">`;
    return html`<p class="small muted">🖼️ Image reference: ${ref} (ask your teacher for this picture)</p>`;
  }

  V.quiz = async (root, { id }, { user, setTitle }) => {
    const qz = await ML.db.get('quizzes', id);
    if (!qz || !(await ML.quizSvc.canTake(user, qz))) {
      root.innerHTML = String(html`<div class="card empty"><span class="big">🔒</span><h2>Quiz not available</h2><p>This quiz doesn't exist or hasn't been assigned to you.</p><a class="btn primary" href="#/quizzes">Back to quizzes</a></div>`);
      return;
    }
    setTitle(qz.title);
    const preview = user.role === 'teacher' && qz.status !== 'practice';
    const prev = (await ML.quizSvc.attemptsFor(user)).filter((a) => a.quizId === id);
    root.innerHTML = String(html`<div class="quiz-wrap"><div class="card stack">
      <div class="row"><span class="badge purple">${u.subjectIcon(qz.subject)} ${qz.subject}</span>${qz.level ? html`<span class="badge">${qz.level}</span>` : ''}
        ${qz.status === 'practice' ? html`<span class="badge orange">Practice</span>` : ''}${preview ? html`<span class="badge warn">Teacher preview — not recorded</span>` : ''}</div>
      <h2 style="font-size:26px">${qz.title}</h2>
      ${qz.description ? html`<p class="muted">${qz.description}</p>` : ''}
      <div class="grid cols-3">
        <div class="stat"><span class="label">Questions</span><span class="value">${qz.questionIds.length}</span></div>
        <div class="stat"><span class="label">Timer</span><span class="value">${qz.timeLimitMin ? qz.timeLimitMin + ' min' : 'None'}</span></div>
        <div class="stat"><span class="label">Feedback</span><span class="value" style="font-size:20px">${qz.feedbackMode === 'immediate' ? 'After each question' : 'After submitting'}</span></div>
      </div>
      ${qz.dueDate ? html`<p>📅 Due: <b>${u.fmtDate(qz.dueDate, true)}</b>${qz.dueDate < Date.now() ? html` <span class="badge bad">Past due</span>` : ''}</p>` : ''}
      ${prev.length ? html`<p class="muted">You have attempted this quiz ${prev.length} time(s). Best score: <b>${Math.max(...prev.map((a) => a.percent))}%</b>.</p>` : ''}
      ${qz.timeLimitMin ? html`<p class="small muted">⏱️ The quiz submits automatically when the timer reaches zero.</p>` : ''}
      <div class="row"><button class="btn primary" id="start">Start quiz</button><a class="btn ghost" href="#/quizzes">Back</a></div>
    </div></div>`);
    u.$('#start', root).onclick = () => play(root, id, user, preview);
  };

  async function play(root, quizId, user, preview) {
    let session;
    try { session = await ML.quizSvc.start(user, quizId); }
    catch (e) { u.toast(e.message, 'error'); return; }
    const { quiz, questions, sessionId } = session;
    if (session.missing) u.toast(session.missing + ' question(s) in this quiz were deleted and have been skipped.', 'info');
    const st = { idx: 0, answers: {}, revealed: {}, timer: null, deadline: quiz.timeLimitMin ? Date.now() + quiz.timeLimitMin * 60000 : 0, submitting: false };
    const immediate = quiz.feedbackMode === 'immediate';

    const cleanup = () => { clearInterval(st.timer); ML.quizSvc.discard(sessionId); };
    ML.leaveGuard = async () => {
      const ok = await u.confirm('Leave this quiz? Your answers will be lost.', { okLabel: 'Leave quiz', danger: true });
      if (ok) cleanup();
      return ok;
    };

    function answered(q) { const a = st.answers[q.id]; return a != null && a !== ''; }

    function render() {
      const q = questions[st.idx];
      const rev = st.revealed[q.id];
      const given = st.answers[q.id];
      const locked = !!rev;
      let input;
      if (q.type === 'mcq') {
        input = html`<div class="options" role="radiogroup" aria-label="Answer options">${q.options.map((o, i) => {
          let cls = String(given) === String(i) ? 'selected' : '';
          if (rev) { if (rev.correctIndex === i) cls = 'right'; else if (String(given) === String(i)) cls = 'wrong'; }
          return html`<button type="button" class="option ${cls}" data-opt="${i}" role="radio" aria-checked="${String(given) === String(i)}" ${locked ? u.trusted('disabled') : ''}><span class="letter">${L[i]}</span><span>${o}</span></button>`;
        })}</div>`;
      } else if (q.type === 'tf') {
        input = html`<div class="options" role="radiogroup">${[['true', 'True'], ['false', 'False']].map(([v, label], i) => {
          let cls = given === v ? 'selected' : '';
          if (rev) { if (rev.correctValue === v) cls = 'right'; else if (given === v) cls = 'wrong'; }
          return html`<button type="button" class="option ${cls}" data-tf="${v}" role="radio" aria-checked="${given === v}" ${locked ? u.trusted('disabled') : ''}><span class="letter">${i ? 'F' : 'T'}</span><span>${label}</span></button>`;
        })}</div>`;
      } else if (q.type === 'fill') {
        input = html`<label class="field"><span>Your answer (fills the blank)</span><input id="ans" maxlength="200" autocomplete="off" value="${given || ''}" ${locked ? u.trusted('disabled') : ''}></label>`;
      } else {
        input = html`<label class="field"><span>Your answer</span><textarea id="ans" maxlength="2000" ${locked ? u.trusted('disabled') : ''}>${given || ''}</textarea></label>`;
      }
      let fb = '';
      if (rev) {
        const kind = rev.correct === true ? 'ok' : rev.correct === false ? 'bad' : 'pending';
        fb = html`<div class="feedback ${kind}" role="status"><b>${rev.correct === true ? '✅ Correct!' : rev.correct === false ? '❌ Not quite.' : '📝 Saved — your teacher will mark this answer.'}</b>
          ${rev.correct !== true && rev.correct !== null ? html`<div>Correct answer: <b>${rev.correctText}</b></div>` : ''}
          ${rev.explanation ? html`<div>💡 ${rev.explanation}</div>` : ''}</div>`;
      }
      const last = st.idx === questions.length - 1;
      root.innerHTML = String(html`<div class="quiz-wrap stack">
        <div class="card stack">
          <div class="q-head"><b style="flex:1">${quiz.title}</b>${st.deadline ? html`<span class="timer" id="timer" aria-live="off">⏱️ --:--</span>` : ''}
            ${preview ? html`<span class="badge warn">Preview</span>` : ''}</div>
          <div class="progress" aria-hidden="true"><i style="width:${u.pct(Object.keys(st.answers).filter((k) => st.answers[k] !== '').length, questions.length)}%"></i></div>
          <nav class="q-palette" aria-label="Question navigation">${questions.map((x, i) => {
            const r = st.revealed[x.id];
            const cls = [i === st.idx ? 'current' : '', answered(x) ? 'answered' : '', r ? (r.correct === true ? 'right' : r.correct === false ? 'wrong' : '') : ''].join(' ');
            return html`<button type="button" class="${cls}" data-go="${i}" aria-label="Question ${i + 1}${answered(x) ? ', answered' : ''}">${i + 1}</button>`;
          })}</nav>
        </div>
        <div class="card">
          <div class="row"><span class="badge purple">Question ${st.idx + 1} of ${questions.length}</span><span class="badge">${Q.TYPES[q.type]}</span><span class="badge">${q.marks} mark${q.marks === 1 ? '' : 's'}</span></div>
          <p class="q-text">${q.text}</p>
          ${imageHTML(q.image)}
          ${input}
          ${fb}
          <div class="q-nav">
            <button class="btn ghost" id="prev" ${st.idx === 0 ? u.trusted('disabled') : ''}>← Previous</button>
            ${immediate && !rev ? html`<button class="btn soft" id="check">Check answer</button>` : ''}
            ${!last ? html`<button class="btn primary" id="next">Next question →</button>` : ''}
            <span class="spacer"></span>
            <button class="btn ghost" id="restart">↺ Restart quiz</button>
            <button class="btn accent" id="submit">Submit quiz</button>
          </div>
        </div></div>`);
      bind();
      tick();
    }

    function saveInput() { const el = u.$('#ans', root); if (el && !el.disabled) st.answers[questions[st.idx].id] = el.value; }
    function bind() {
      const q = questions[st.idx];
      u.$$('[data-opt]', root).forEach((b) => { b.onclick = () => { st.answers[q.id] = Number(b.dataset.opt); render(); }; });
      u.$$('[data-tf]', root).forEach((b) => { b.onclick = () => { st.answers[q.id] = b.dataset.tf; render(); }; });
      const ans = u.$('#ans', root); if (ans) { ans.oninput = () => { st.answers[q.id] = ans.value; }; if (!ans.disabled) ans.focus(); }
      u.$$('[data-go]', root).forEach((b) => { b.onclick = () => { saveInput(); st.idx = Number(b.dataset.go); render(); }; });
      const prevB = u.$('#prev', root); if (prevB) prevB.onclick = () => { saveInput(); st.idx--; render(); };
      const nextB = u.$('#next', root); if (nextB) nextB.onclick = () => { saveInput(); st.idx++; render(); };
      const chk = u.$('#check', root);
      if (chk) chk.onclick = () => {
        saveInput();
        if (!answered(q)) { u.toast('Choose or type an answer first.', 'error'); return; }
        try {
          const r = ML.quizSvc.check(sessionId, q.id, st.answers[q.id]);
          // map the revealed answer to option positions for highlighting
          if (q.type === 'mcq') r.correctIndex = L.indexOf(r.correctText.charAt(0));
          if (q.type === 'tf') r.correctValue = r.correctText === 'True' ? 'true' : 'false';
          st.revealed[q.id] = r;
          render();
        } catch (e) { u.toast(e.message, 'error'); }
      };
      u.$('#restart', root).onclick = async () => {
        if (!(await u.confirm('Restart this quiz? All your answers so far will be cleared.', { okLabel: 'Restart' }))) return;
        cleanup(); ML.leaveGuard = null; play(root, quizId, user, preview);
      };
      u.$('#submit', root).onclick = () => submit(false);
    }

    function tick() {
      if (!st.deadline) return;
      clearInterval(st.timer);
      const update = () => {
        const el = u.$('#timer', root);
        if (!el || !document.body.contains(el)) { clearInterval(st.timer); return; }
        const left = Math.max(0, Math.round((st.deadline - Date.now()) / 1000));
        el.textContent = '⏱️ ' + String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
        el.classList.toggle('low', left <= 30);
        if (left <= 0) { clearInterval(st.timer); u.toast('Time is up! Your quiz has been submitted.', 'info'); submit(true); }
      };
      update();
      st.timer = setInterval(update, 1000);
    }

    async function submit(auto) {
      if (st.submitting) return;
      saveInput();
      const unanswered = questions.filter((q) => !answered(q)).length;
      if (!auto) {
        const msg = unanswered ? 'You have ' + unanswered + ' unanswered question(s). Submit anyway?' : 'Submit your quiz now?';
        if (!(await u.confirm(msg, { okLabel: 'Submit quiz' }))) return;
      }
      st.submitting = true;
      clearInterval(st.timer);
      try {
        const attempt = await ML.quizSvc.submit(sessionId, st.answers, { auto });
        ML.leaveGuard = null;
        if (preview) {
          renderResult(root, attempt, { preview: true, user });
        } else {
          ML.refreshBadges();
          location.hash = '#/result/' + attempt.id;
        }
      } catch (e) { st.submitting = false; u.toast(e.message, 'error'); }
    }

    render();
  }

  function renderResult(root, a, { preview, user }) {
    const pending = a.status === 'pending-review';
    const emoji = a.percent >= 80 ? '🏆' : a.percent >= 50 ? '🌟' : '💪';
    root.innerHTML = String(html`<div class="quiz-wrap stack">
      <div class="card stack center">
        ${preview ? html`<p><span class="badge warn">Teacher preview — this attempt was not saved</span></p>` : ''}
        <h2 style="font-size:24px">${emoji} ${a.quizTitle}</h2>
        <div class="score-ring" style="--p:${a.percent}"><div><span><b>${a.percent}%</b><span class="muted small">${a.score} / ${a.maxScore} marks</span></span></div></div>
        <p>${pending ? 'Some written answers are waiting for your teacher. Your score may go up after marking.' : a.percent >= 80 ? 'Excellent work! Keep it up.' : a.percent >= 50 ? 'Good effort — review the explanations below.' : 'Keep practising — every attempt helps you grow.'}</p>
        <div class="grid cols-4" style="text-align:left">
          <div class="stat"><span class="label">Questions</span><span class="value">${a.totalQuestions}</span></div>
          <div class="stat"><span class="label">Correct</span><span class="value" style="color:var(--ok)">${a.correctCount}</span></div>
          <div class="stat"><span class="label">Incorrect</span><span class="value" style="color:var(--bad)">${a.incorrectCount}</span></div>
          <div class="stat"><span class="label">${a.pendingCount ? 'Awaiting marking' : 'Time taken'}</span><span class="value" style="font-size:24px">${a.pendingCount ? a.pendingCount : u.fmtDuration(a.timeTakenSec)}</span></div>
        </div>
        <p class="small muted">Completed ${u.fmtDate(a.finishedAt, true)}${a.timerEnabled ? ' · Time limit ' + a.timeLimitMin + ' min · took ' + u.fmtDuration(a.timeTakenSec) : ''}${a.autoSubmitted ? ' · auto-submitted when time ran out' : ''}${a.gradedBy ? ' · marked by ' + a.gradedBy : ''}</p>
        ${user.role === 'teacher' && !preview ? html`<p class="small">Student: <b>${a.userName}</b> (${a.userLevel || 'no class'})</p>` : ''}
        <div class="row" style="justify-content:center">
          ${user.role === 'student' ? html`<a class="btn primary" href="#/quiz/${a.quizId}">↺ Retake quiz</a><a class="btn ghost" href="#/progress">My progress</a>` : ''}
          <a class="btn ghost" href="${user.role === 'teacher' ? '#/teacher/results' : '#/quizzes'}">Back to ${user.role === 'teacher' ? 'results' : 'quizzes'}</a>
        </div>
      </div>
      <div class="card stack"><h2>Answer review</h2>
        ${a.answers.map((r, i) => html`<div class="review-item ${r.correct === true ? 'ok' : r.correct === false ? 'bad' : 'pending'}">
          <div class="row between"><b>${i + 1}. ${r.text}</b><span class="badge ${r.correct === true ? 'ok' : r.correct === false ? 'bad' : 'warn'}">${r.correct === true ? 'Correct' : r.correct === false ? 'Incorrect' : 'Awaiting teacher'} · ${r.awarded}/${r.marks}</span></div>
          <div class="small">Your answer: <b>${r.givenText}</b></div>
          ${r.correct !== true ? html`<div class="small">Correct answer: <b>${r.correctText}</b></div>` : ''}
          ${r.explanation ? html`<div class="small muted">💡 ${r.explanation}</div>` : ''}
        </div>`)}
      </div></div>`);
  }

  V.result = async (root, { id }, { user, setTitle }) => {
    const a = await ML.quizSvc.attempt(user, id);
    if (!a) { root.innerHTML = String(html`<div class="card empty"><span class="big">🔍</span><h2>Result not found</h2><p>You can only view your own results.</p><a class="btn primary" href="#/quizzes">Back</a></div>`); return; }
    setTitle('Result: ' + a.quizTitle);
    renderResult(root, a, { preview: false, user });
  };
})();
