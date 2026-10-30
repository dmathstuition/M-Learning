/* M Learning App — teacher-only pages. Routes are role-guarded in app.js and every write goes
 * through services that call ML.auth.requireTeacher(). */
(function () {
  'use strict';
  const ML = (window.ML = window.ML || {});
  const V = (ML.views = ML.views || {});
  const { u, db, Q } = ML;
  const { html } = u;

  const empty = (...a) => ML.empty(...a);

  // =============================== DASHBOARD ===============================
  V.teacherHome = async (root, params, { user }) => {
    const [students, quizzes, attempts, questions, courses, lessons] = await Promise.all([ML.users.students(), ML.quizSvc.all(), ML.quizSvc.attemptsFor(user), ML.bank.visible(user), ML.courses.all(), ML.courses.allLessons()]);
    const pending = attempts.filter((a) => a.status === 'pending-review');
    const avg = attempts.length ? Math.round(attempts.reduce((s, a) => s + a.percent, 0) / attempts.length) : 0;
    const perStudent = students.map((s) => { const at = attempts.filter((a) => a.userId === s.id); return { s, n: at.length, avg: at.length ? Math.round(at.reduce((x, a) => x + a.percent, 0) / at.length) : null }; });
    const needHelp = perStudent.filter((p) => p.avg != null && p.avg < 50);
    root.innerHTML = String(html`<div class="stack">
      <h2 class="hero-title">Good to see you, ${user.fullName.split(' ')[0]}<span class="accent">Here's your class today</span></h2>
      <div class="grid cols-4">
        <a class="stat" href="#/teacher/students" style="text-decoration:none;color:inherit"><span class="ico">👥</span><span class="label">Students</span><span class="value">${students.length}</span></a>
        <a class="stat" href="#/teacher/quizzes" style="text-decoration:none;color:inherit"><span class="ico">📝</span><span class="label">Published quizzes</span><span class="value">${quizzes.filter((q) => q.status === 'published').length}</span></a>
        <a class="stat" href="#/bank" style="text-decoration:none;color:inherit"><span class="ico">🗂️</span><span class="label">Questions in bank</span><span class="value">${questions.length}</span></a>
        <a class="stat" href="#/teacher/results" style="text-decoration:none;color:inherit"><span class="ico">⭐</span><span class="label">Average score</span><span class="value">${attempts.length ? avg + '%' : '—'}</span></a>
      </div>
      <div class="card"><h2>Quick actions</h2><div class="row">
        <a class="btn primary" href="#/import">📥 Import questions</a><a class="btn soft" href="#/teacher/quiz/new">📝 Create quiz</a>
        <a class="btn soft" href="#/teacher/course/new">📚 New course</a><a class="btn soft" href="#/teacher/students">👥 Add student</a><a class="btn ghost" href="#/teacher/results">📊 Export results</a></div></div>
      <div class="grid cols-2">
        <div class="card"><div class="row between"><h2>✍️ Waiting for marking</h2><span class="badge ${pending.length ? 'warn' : 'ok'}">${pending.length}</span></div>
          ${pending.length ? html`<ul class="list">${pending.slice(0, 6).map((a) => html`<li><div class="list-item"><span class="grow"><span class="title">${a.userName} — ${a.quizTitle}</span><br><span class="small muted">${a.pendingCount} answer(s) · ${u.timeAgo(a.finishedAt)}</span></span><button class="btn sm primary" data-mark="${a.id}">Mark</button></div></li>`)}</ul>`
            : empty('✅', 'Nothing to mark', 'Written answers that need marking will appear here.')}</div>
        <div class="card"><h2>🆕 Latest results</h2>
          ${attempts.length ? html`<ul class="list">${attempts.slice(0, 6).map((a) => html`<li><a class="list-item" href="#/result/${a.id}"><span class="grow"><span class="title">${a.userName}</span><br><span class="small muted">${a.quizTitle} · ${u.timeAgo(a.finishedAt)}</span></span><span class="badge ${a.percent >= 50 ? 'ok' : 'bad'}">${a.percent}%</span></a></li>`)}</ul>`
            : empty('📭', 'No results yet', 'When students submit quizzes, results appear here.')}</div>
        <div class="card"><h2>🆘 Students who may need help</h2><p class="small muted">Average quiz score below 50%.</p>
          ${needHelp.length ? html`<ul class="list">${needHelp.map((p) => html`<li><a class="list-item" href="#/teacher/student/${p.s.id}"><span class="grow"><span class="title">${p.s.fullName}</span><br><span class="small muted">${p.s.level} · ${p.n} quiz(zes)</span></span><span class="badge bad">${p.avg}%</span></a></li>`)}</ul>` : empty('🌟', 'Everyone is on track', 'No student is averaging below 50%.')}</div>
        <div class="card"><h2>📚 Content</h2><p>${courses.length} courses · ${lessons.length} lessons · ${questions.length} questions · ${quizzes.length} quizzes</p>
          <div class="row"><a class="btn soft sm" href="#/teacher/courses">Manage courses</a><a class="btn soft sm" href="#/bank">Question bank</a><a class="btn soft sm" href="#/teacher/quizzes">Quizzes</a></div></div>
      </div></div>`);
    u.$$('[data-mark]', root).forEach((b) => { b.onclick = () => markAttempt(b.dataset.mark); });
  };

  /** Modal for marking written answers on one attempt. */
  async function markAttempt(id) {
    const a = await db.get('attempts', id);
    if (!a) { u.toast('Attempt not found.', 'error'); return; }
    const rows = a.answers.filter((r) => r.type === 'short' || r.type === 'fill');
    const res = await u.modal({
      title: 'Mark: ' + a.userName + ' — ' + a.quizTitle, wide: true,
      body: html`<div class="stack">${rows.map((r) => html`<div class="review-item ${r.correct === null ? 'pending' : r.correct ? 'ok' : 'bad'}">
        <b>${r.text}</b><div class="small">Student's answer: <b>${r.givenText}</b></div><div class="small muted">Expected: ${r.correctText}${r.explanation ? ' · ' + r.explanation : ''}</div>
        <label class="field" style="max-width:200px;margin-top:6px"><span>Marks (0–${r.marks})</span><input type="number" min="0" max="${r.marks}" step="0.5" data-q="${r.qid}" value="${r.correct === null ? '' : r.awarded}"></label></div>`)}</div>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Save marks', kind: 'primary', value: (d) => {
        const out = {}; u.$$('[data-q]', d).forEach((i) => { if (i.value !== '') out[i.dataset.q] = Number(i.value); }); return out; } }],
    });
    if (!res) return;
    try { const upd = await ML.quizSvc.grade(id, res); u.toast('Saved. ' + upd.userName + ' now has ' + upd.percent + '%' + (upd.pendingCount ? ' (' + upd.pendingCount + ' still unmarked)' : '') + '.', 'success'); ML.rerender(); }
    catch (e) { u.toast(e.message, 'error'); }
  }

  // =============================== COURSES ===============================
  V.teacherCourses = async (root) => {
    const [courses, lessons] = await Promise.all([ML.courses.all(), ML.courses.allLessons()]);
    root.innerHTML = String(html`<div class="stack"><div class="row between"><p class="muted" style="margin:0">${courses.length} course(s). Lessons belong to courses; each lesson has a topic that links it to practice questions.</p><a class="btn primary" href="#/teacher/course/new">＋ New course</a></div>
      ${courses.length ? html`<div class="table-wrap"><table><thead><tr><th>Course</th><th>Subject</th><th>Level</th><th>Difficulty</th><th>Lessons</th><th>Actions</th></tr></thead><tbody>
        ${courses.map((c) => html`<tr><td><b>${c.title}</b><div class="small muted">${c.description}</div></td><td>${u.subjectIcon(c.subject)} ${c.subject}</td><td>${c.level}</td><td>${c.difficulty}</td><td>${lessons.filter((l) => l.courseId === c.id).length}</td>
          <td><div class="row"><a class="btn sm soft" href="#/teacher/course/${c.id}">Edit</a><a class="btn sm ghost" href="#/course/${c.id}">View</a><button class="btn sm ghost" data-del="${c.id}" aria-label="Delete course">🗑️</button></div></td></tr>`)}
      </tbody></table></div>` : html`<div class="card">${empty('📚', 'No courses yet', 'Create your first course.')}</div>`}</div>`);
    u.$$('[data-del]', root).forEach((b) => { b.onclick = async () => {
      const c = courses.find((x) => x.id === b.dataset.del); const n = lessons.filter((l) => l.courseId === c.id).length;
      if (!(await u.confirm('Delete the course “' + c.title + '” and its ' + n + ' lesson(s)? Student completion records for these lessons will no longer count. This cannot be undone.', { okLabel: 'Delete course', danger: true }))) return;
      try { await ML.courses.deleteCourse(c.id); u.toast('Course deleted.', 'success'); ML.rerender(); } catch (e) { u.toast(e.message, 'error'); }
    }; });
  };

  V.teacherCourse = async (root, { id }, { user, setTitle }) => {
    const isNew = id === 'new';
    const c = isNew ? { id: u.uid('c'), subject: 'Mathematics', level: 'JSS 1', title: '', description: '', difficulty: 'easy', createdBy: user.id, createdAt: Date.now() } : await db.get('courses', id);
    if (!c) { root.innerHTML = String(html`<div class="card">${empty('🔍', 'Course not found', '')}</div>`); return; }
    setTitle(isNew ? 'New course' : 'Edit: ' + c.title);
    const lessons = isNew ? [] : await ML.courses.lessons(c.id);
    root.innerHTML = String(html`<div class="stack" style="max-width:900px;margin:0 auto">
      <form class="card" id="cf" novalidate><h2>Course details</h2><div class="form-msg"></div>
        <label class="field"><span>Title</span><input name="title" maxlength="80" required value="${c.title}"></label>
        <div class="form-grid">
          <label class="field"><span>Subject</span><select name="subject">${Object.keys(u.SUBJECTS).map((s) => html`<option ${c.subject === s ? 'selected' : ''}>${s}</option>`)}</select></label>
          <label class="field"><span>Class / level</span><select name="level">${u.LEVELS.map((l) => html`<option ${c.level === l ? 'selected' : ''}>${l}</option>`)}</select></label>
          <label class="field"><span>Difficulty</span><select name="difficulty">${u.DIFFICULTIES.map((d) => html`<option ${c.difficulty === d ? 'selected' : ''}>${d}</option>`)}</select></label>
        </div>
        <label class="field"><span>Description</span><textarea name="description" maxlength="400" style="min-height:80px">${c.description}</textarea></label>
        <button class="btn primary" type="submit">${isNew ? 'Create course' : 'Save course'}</button></form>
      ${isNew ? '' : html`<div class="card"><div class="row between"><h2 style="margin:0">Lessons</h2><a class="btn soft" href="#/teacher/lesson/new?course=${c.id}">＋ Add lesson</a></div>
        ${lessons.length ? html`<ul class="list" style="margin-top:12px">${lessons.map((l, i) => html`<li><div class="list-item"><span class="badge purple">${i + 1}</span><span class="grow"><span class="title">${l.title}</span><br><span class="small muted">Topic: ${l.topic} · ${l.difficulty}</span></span>
          <span class="row"><button class="btn sm ghost" data-up="${i}" ${i === 0 ? u.trusted('disabled') : ''} aria-label="Move up">↑</button><button class="btn sm ghost" data-down="${i}" ${i === lessons.length - 1 ? u.trusted('disabled') : ''} aria-label="Move down">↓</button>
          <a class="btn sm soft" href="#/teacher/lesson/${l.id}">Edit</a><button class="btn sm ghost" data-del="${l.id}" aria-label="Delete lesson">🗑️</button></span></div></li>`)}</ul>`
          : empty('🧱', 'No lessons yet', 'Add the first lesson to this course.')}</div>`}
    </div>`);
    const f = u.$('#cf', root);
    f.onsubmit = async (e) => {
      e.preventDefault();
      Object.assign(c, { title: f.title.value, subject: f.subject.value, level: f.level.value, difficulty: f.difficulty.value, description: f.description.value });
      try { await ML.courses.saveCourse(c); u.toast(isNew ? 'Course created. Now add lessons.' : 'Course saved.', 'success'); if (isNew) location.hash = '#/teacher/course/' + c.id; else ML.rerender(); }
      catch (err) { const m = u.$('.form-msg', f); m.className = 'form-msg show error'; m.textContent = err.message; }
    };
    const move = async (i, d) => { const a = lessons[i], b = lessons[i + d]; const t = a.order; a.order = b.order; b.order = t; if (a.order === b.order) a.order += d; await db.putMany('lessons', [a, b]); ML.rerender(); };
    u.$$('[data-up]', root).forEach((b) => { b.onclick = () => move(Number(b.dataset.up), -1); });
    u.$$('[data-down]', root).forEach((b) => { b.onclick = () => move(Number(b.dataset.down), 1); });
    u.$$('[data-del]', root).forEach((b) => { b.onclick = async () => {
      const l = lessons.find((x) => x.id === b.dataset.del);
      if (!(await u.confirm('Delete the lesson “' + l.title + '”? This cannot be undone.', { okLabel: 'Delete', danger: true }))) return;
      await ML.courses.deleteLesson(l.id); u.toast('Lesson deleted.', 'success'); ML.rerender();
    }; });
  };

  V.teacherLesson = async (root, params, { setTitle }) => {
    const isNew = params.id === 'new';
    let l;
    if (isNew) {
      const courseId = params.query.get('course');
      const course = courseId && await db.get('courses', courseId);
      if (!course) { root.innerHTML = String(html`<div class="card">${empty('🔍', 'Choose a course first', 'Lessons are added from a course page.', html`<a class="btn primary" href="#/teacher/courses">Courses</a>`)}</div>`); return; }
      const sibs = await ML.courses.lessons(courseId);
      l = { id: u.uid('l'), courseId, title: '', topic: '', difficulty: course.difficulty, minutes: 10, order: sibs.length ? Math.max(...sibs.map((s) => s.order)) + 1 : 0, body: '', examples: [], createdAt: Date.now() };
    } else l = await db.get('lessons', params.id);
    if (!l) { root.innerHTML = String(html`<div class="card">${empty('🔍', 'Lesson not found', '')}</div>`); return; }
    setTitle(isNew ? 'New lesson' : 'Edit: ' + l.title);
    root.innerHTML = String(html`<div class="grid cols-2">
      <form class="card" id="lf" novalidate><h2>Lesson</h2><div class="form-msg"></div>
        <label class="field"><span>Title</span><input name="title" maxlength="100" value="${l.title}"></label>
        <div class="form-grid">
          <label class="field"><span>Topic (links to practice questions)</span><input name="topic" maxlength="80" value="${l.topic}"></label>
          <label class="field"><span>Difficulty</span><select name="difficulty">${u.DIFFICULTIES.map((d) => html`<option ${l.difficulty === d ? 'selected' : ''}>${d}</option>`)}</select></label>
          <label class="field"><span>Minutes</span><input name="minutes" type="number" min="1" max="180" value="${l.minutes || 10}"></label>
        </div>
        <label class="field"><span>Content — use <code>## Heading</code>, <code>- bullet</code>, <code>&gt; tip</code>, blank line = new paragraph</span><textarea name="body" style="min-height:260px">${l.body}</textarea></label>
        <label class="field"><span>Worked examples — blocks of <code>Problem:</code>, <code>Step:</code> (repeat), <code>Answer:</code>, separated by a blank line</span><textarea name="examples" style="min-height:160px">${ML.courses.examplesToText(l.examples)}</textarea></label>
        <div class="row"><button class="btn primary" type="submit">${isNew ? 'Create lesson' : 'Save lesson'}</button><a class="btn ghost" href="#/teacher/course/${l.courseId}">Cancel</a></div>
      </form>
      <div class="card"><h2>Live preview</h2><div id="pv" class="lesson-body"></div></div></div>`);
    const f = u.$('#lf', root);
    const preview = () => {
      const ex = ML.courses.parseExamples(f.examples.value);
      u.$('#pv', root).innerHTML = String(html`<h2>${f.title.value || 'Untitled lesson'}</h2>${u.renderLite(f.body.value)}${ex.map((e, i) => html`<div class="example"><b>Example ${i + 1}: ${e.problem}</b><ol>${e.steps.map((s) => html`<li>${s}</li>`)}</ol><p class="ans">Answer: ${e.answer}</p></div>`)}`);
    };
    f.oninput = u.debounce(preview, 200); preview();
    f.onsubmit = async (e) => {
      e.preventDefault();
      Object.assign(l, { title: f.title.value, topic: f.topic.value, difficulty: f.difficulty.value, minutes: Math.max(1, Math.min(180, Number(f.minutes.value) || 10)), body: f.body.value, examples: ML.courses.parseExamples(f.examples.value) });
      try { await ML.courses.saveLesson(l, isNew); u.toast(isNew ? 'Lesson created — students in this class were notified.' : 'Lesson saved.', 'success'); location.hash = '#/teacher/course/' + l.courseId; }
      catch (err) { const m = u.$('.form-msg', f); m.className = 'form-msg show error'; m.textContent = err.message; m.scrollIntoView({ block: 'center' }); }
    };
  };

  // =============================== QUIZZES ===============================
  function assignText(qz, students) {
    const a = qz.assign || { type: 'all' };
    if (a.type === 'all') return 'All students';
    if (a.type === 'level') return 'Class: ' + a.level;
    return (a.studentIds || []).map((id) => (students.find((s) => s.id === id) || { fullName: '?' }).fullName).join(', ');
  }
  V.teacherQuizzes = async (root, params, { user }) => {
    const [quizzes, attempts, students] = await Promise.all([ML.quizSvc.all(), ML.quizSvc.attemptsFor(user), ML.users.students()]);
    root.innerHTML = String(html`<div class="stack"><div class="row between"><p class="muted" style="margin:0">${quizzes.length} quiz(zes). Build quizzes from the question bank, then publish them to all students, a class, or chosen students.</p><a class="btn primary" href="#/teacher/quiz/new">＋ New quiz</a></div>
      ${quizzes.length ? html`<div class="table-wrap"><table><thead><tr><th>Quiz</th><th>Status</th><th>Assigned to</th><th>Due</th><th>Questions</th><th>Attempts</th><th>Avg</th><th>Actions</th></tr></thead><tbody>
        ${quizzes.map((q) => { const at = attempts.filter((a) => a.quizId === q.id); return html`<tr><td><b>${q.title}</b><div class="small muted">${q.subject} · ${q.timeLimitMin ? q.timeLimitMin + ' min · ' : ''}feedback ${q.feedbackMode === 'immediate' ? 'instant' : 'after submit'}</div></td>
          <td><span class="badge ${q.status === 'published' ? 'ok' : 'warn'}">${q.status}</span></td><td>${assignText(q, students)}</td><td>${q.dueDate ? u.fmtDate(q.dueDate, true) : '—'}</td><td>${q.questionIds.length}</td>
          <td>${at.length}</td><td>${at.length ? Math.round(at.reduce((s, a) => s + a.percent, 0) / at.length) + '%' : '—'}</td>
          <td><div class="row"><a class="btn sm soft" href="#/teacher/quiz/${q.id}">Edit</a><a class="btn sm ghost" href="#/quiz/${q.id}">Try</a><a class="btn sm ghost" href="#/teacher/results?quiz=${q.id}">Results</a><button class="btn sm ghost" data-del="${q.id}" aria-label="Delete quiz">🗑️</button></div></td></tr>`; })}
      </tbody></table></div>` : html`<div class="card">${empty('📝', 'No quizzes yet', 'Create one from your question bank.')}</div>`}</div>`);
    u.$$('[data-del]', root).forEach((b) => { b.onclick = async () => {
      const q = quizzes.find((x) => x.id === b.dataset.del);
      if (!(await u.confirm('Delete the quiz “' + q.title + '”? Students will no longer see it. Past results are kept.', { okLabel: 'Delete quiz', danger: true }))) return;
      await ML.quizSvc.remove(q.id); u.toast('Quiz deleted.', 'success'); ML.rerender();
    }; });
  };

  V.quizBuilder = async (root, { id }, { user, setTitle }) => {
    const isNew = id === 'new';
    let qz = isNew ? null : await db.get('quizzes', id);
    if (!isNew && (!qz || qz.status === 'practice')) { root.innerHTML = String(html`<div class="card">${empty('🔍', 'Quiz not found', '')}</div>`); return; }
    if (isNew) {
      let pre = [];
      try { pre = JSON.parse(sessionStorage.getItem('ml.quizDraftSel') || '[]'); sessionStorage.removeItem('ml.quizDraftSel'); } catch (e) { pre = ML.quizDraftSel || []; }
      ML.quizDraftSel = null;
      qz = { id: u.uid('qz'), title: '', description: '', subject: '', level: '', questionIds: Array.isArray(pre) ? pre.filter((x) => typeof x === 'string') : [], marks: {}, timeLimitMin: 0, feedbackMode: 'after', shuffle: false, status: 'draft', assign: { type: 'all', level: '', studentIds: [] }, dueDate: null, createdBy: user.id, createdAt: Date.now() };
    }
    setTitle(isNew ? 'New quiz' : 'Edit: ' + qz.title);
    const [bankAll, students] = await Promise.all([ML.bank.visible(user), ML.users.students()]);
    const byId = new Map(bankAll.map((q) => [q.id, q]));
    qz.questionIds = qz.questionIds.filter((x) => byId.has(x));
    if (!qz.subject && qz.questionIds.length) qz.subject = byId.get(qz.questionIds[0]).subject;
    const pf = { q: '', subject: qz.subject || '', topic: '', difficulty: '' };
    const toLocalInput = (ts) => { if (!ts) return ''; const d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

    function readForm() {
      const f = u.$('#qf', root); if (!f) return;
      qz.title = f.title.value; qz.description = f.description.value.slice(0, 400); qz.subject = f.subject.value; qz.level = f.level.value;
      qz.timeLimitMin = Math.max(0, Math.round(Number(f.time.value) || 0)); qz.feedbackMode = f.feedback.value; qz.shuffle = f.shuffle.checked;
      qz.assign = { type: f.assignType.value, level: f.assignLevel.value, studentIds: u.$$('input[name=stu]:checked', f).map((x) => x.value) };
      qz.dueDate = f.due.value ? new Date(f.due.value).getTime() : null;
      u.$$('[data-mk]', root).forEach((i) => { const v = Number(i.value); if (v > 0 && v <= 100) qz.marks[i.dataset.mk] = v; else delete qz.marks[i.dataset.mk]; });
    }

    function draw() {
      const sel = qz.questionIds.map((x) => byId.get(x)).filter(Boolean);
      const total = sel.reduce((s, q) => s + Number(qz.marks[q.id] || q.marks), 0);
      const pick = bankAll.filter((q) => !qz.questionIds.includes(q.id) && (!pf.subject || q.subject === pf.subject) && (!pf.topic || q.topic === pf.topic) && (!pf.difficulty || q.difficulty === pf.difficulty)
        && (!pf.q || q.text.toLowerCase().includes(pf.q.toLowerCase()) || q.topic.toLowerCase().includes(pf.q.toLowerCase())));
      root.innerHTML = String(html`<div class="stack">
        <form class="card" id="qf" novalidate><div class="row between"><h2 style="margin:0">Quiz settings</h2><span class="badge ${qz.status === 'published' ? 'ok' : 'warn'}">${qz.status}</span></div><div class="form-msg" id="qmsg"></div>
          <div class="form-grid" style="margin-top:12px">
            <label class="field" style="grid-column:1/-1"><span>Title</span><input name="title" maxlength="100" value="${qz.title}" placeholder="e.g. Fractions Test — Week 3"></label>
            <label class="field" style="grid-column:1/-1"><span>Instructions for students (optional)</span><input name="description" maxlength="400" value="${qz.description || ''}"></label>
            <label class="field"><span>Subject</span><select name="subject"><option value="">Mixed</option>${Object.keys(u.SUBJECTS).map((s) => html`<option ${qz.subject === s ? 'selected' : ''}>${s}</option>`)}</select></label>
            <label class="field"><span>Class / level label</span><select name="level"><option value="">Any</option>${u.LEVELS.map((l) => html`<option ${qz.level === l ? 'selected' : ''}>${l}</option>`)}</select></label>
            <label class="field"><span>Time limit (minutes, 0 = no timer)</span><input name="time" type="number" min="0" max="300" value="${qz.timeLimitMin || 0}"></label>
            <label class="field"><span>Feedback</span><select name="feedback"><option value="immediate" ${qz.feedbackMode === 'immediate' ? 'selected' : ''}>Immediately after each question</option><option value="after" ${qz.feedbackMode === 'after' ? 'selected' : ''}>Only after the quiz is submitted</option></select></label>
            <label class="field"><span>Due date (optional)</span><input name="due" type="datetime-local" value="${toLocalInput(qz.dueDate)}"></label>
            <label class="field"><span>Assign to</span><select name="assignType"><option value="all" ${qz.assign.type === 'all' ? 'selected' : ''}>All students</option><option value="level" ${qz.assign.type === 'level' ? 'selected' : ''}>A class / level</option><option value="students" ${qz.assign.type === 'students' ? 'selected' : ''}>Chosen students</option></select></label>
            <label class="field" data-show="level"><span>Class</span><select name="assignLevel"><option value="">—</option>${u.LEVELS.map((l) => html`<option ${qz.assign.level === l ? 'selected' : ''}>${l}</option>`)}</select></label>
          </div>
          <div data-show="students" class="field"><span>Students</span>${students.length ? html`<div class="row">${students.map((s) => html`<label class="check chip"><input type="checkbox" name="stu" value="${s.id}" ${(qz.assign.studentIds || []).includes(s.id) ? u.trusted('checked') : ''}> ${s.fullName} <span class="small muted">${s.level}</span></label>`)}</div>` : html`<p class="muted small">No student accounts yet.</p>`}</div>
          <label class="check"><input type="checkbox" name="shuffle" ${qz.shuffle ? u.trusted('checked') : ''}> Randomise question order for each attempt</label>
        </form>
        <div class="grid cols-2">
          <div class="card"><div class="row between"><h2 style="margin:0">Selected questions (${sel.length})</h2><span class="badge purple">${total} marks</span></div>
            ${sel.length ? html`<ol class="list" style="margin-top:12px">${sel.map((q, i) => html`<li class="list-item"><span class="badge">${i + 1}</span><span class="grow"><span class="small">${q.text}</span><br><span class="small muted">${Q.TYPES[q.type]} · ${q.topic}</span></span>
              <label class="small">Marks <input class="input" style="width:70px;min-height:36px;padding:4px 8px" type="number" min="0.5" max="100" step="0.5" data-mk="${q.id}" value="${qz.marks[q.id] || q.marks}"></label>
              <span class="row"><button class="btn sm ghost" data-up="${i}" aria-label="Move up" ${i === 0 ? u.trusted('disabled') : ''}>↑</button><button class="btn sm ghost" data-rm="${q.id}" aria-label="Remove">✕</button></span></li>`)}</ol>`
              : empty('➕', 'No questions selected', 'Add questions from the bank on the right.')}</div>
          <div class="card"><h2>Add from question bank</h2>
            <div class="form-grid"><label class="field"><span>Search</span><input type="search" data-p="q" value="${pf.q}"></label>
              <label class="field"><span>Subject</span><select data-p="subject"><option value="">All</option>${Array.from(new Set(bankAll.map((q) => q.subject))).sort().map((s) => html`<option ${pf.subject === s ? 'selected' : ''}>${s}</option>`)}</select></label>
              <label class="field"><span>Topic</span><select data-p="topic"><option value="">All</option>${ML.bank.topics(bankAll, pf.subject).map((t) => html`<option ${pf.topic === t ? 'selected' : ''}>${t}</option>`)}</select></label>
              <label class="field"><span>Difficulty</span><select data-p="difficulty"><option value="">All</option>${u.DIFFICULTIES.map((d) => html`<option ${pf.difficulty === d ? 'selected' : ''}>${d}</option>`)}</select></label></div>
            <div class="row between"><span class="small muted">${pick.length} available</span><span class="row"><button class="btn sm soft" id="add-all" ${pick.length ? '' : u.trusted('disabled')}>Add all ${Math.min(pick.length, 50)}</button><button class="btn sm ghost" id="add-rand" ${pick.length ? '' : u.trusted('disabled')}>Add 5 random</button></span></div>
            <ul class="list" style="max-height:420px;overflow:auto;margin-top:8px">${pick.slice(0, 80).map((q) => html`<li class="list-item"><span class="grow small">${q.text}<br><span class="muted">${Q.TYPES[q.type]} · ${q.topic} · ${q.difficulty}</span></span><button class="btn sm primary" data-add="${q.id}">Add</button></li>`)}</ul>
            ${bankAll.length ? '' : html`<p class="muted">Your question bank is empty. <a href="#/import">Import questions</a> first.</p>`}</div>
        </div>
        <div class="card row between"><a class="btn ghost" href="#/teacher/quizzes">Cancel</a>
          <div class="row"><button class="btn soft" id="preview">👁️ Preview</button><button class="btn ghost" id="draft">Save as draft</button>
            ${qz.status === 'published' ? html`<button class="btn ghost" id="unpub">Unpublish</button>` : ''}<button class="btn primary" id="publish">${qz.status === 'published' ? 'Save & keep published' : 'Publish to students'}</button></div></div>
      </div>`);
      bind(pick);
    }
    function syncAssign() { const t = u.$('#qf', root).assignType.value; u.$$('[data-show]', root).forEach((el) => { el.hidden = el.dataset.show !== t; }); }
    function bind(pick) {
      syncAssign();
      u.$('#qf', root).assignType.onchange = syncAssign;
      u.$('#qf', root).onsubmit = (e) => e.preventDefault();
      u.$$('[data-p]', root).forEach((el) => { const h = () => { readForm(); pf[el.dataset.p] = el.value; if (el.dataset.p === 'subject') pf.topic = ''; draw(); }; if (el.tagName === 'INPUT') el.oninput = u.debounce(h, 300); else el.onchange = h; });
      u.$$('[data-add]', root).forEach((b) => { b.onclick = () => { readForm(); qz.questionIds.push(b.dataset.add); draw(); }; });
      u.$$('[data-rm]', root).forEach((b) => { b.onclick = () => { readForm(); qz.questionIds = qz.questionIds.filter((x) => x !== b.dataset.rm); draw(); }; });
      u.$$('[data-up]', root).forEach((b) => { b.onclick = () => { readForm(); const i = Number(b.dataset.up); const a = qz.questionIds; [a[i - 1], a[i]] = [a[i], a[i - 1]]; draw(); }; });
      const aa = u.$('#add-all', root); if (aa) aa.onclick = () => { readForm(); qz.questionIds.push(...pick.slice(0, 50).map((q) => q.id)); draw(); };
      const ar = u.$('#add-rand', root); if (ar) ar.onclick = () => { readForm(); qz.questionIds.push(...u.shuffle(pick).slice(0, 5).map((q) => q.id)); draw(); };
      u.$('#preview', root).onclick = () => { readForm(); previewQuiz(qz, byId); };
      const save = async (publish) => {
        readForm();
        if (publish === 'unpublish') qz.status = 'draft';
        try {
          await ML.quizSvc.save(qz, publish === true);
          u.toast(publish === true ? 'Quiz published. Assigned students have been notified.' : publish === 'unpublish' ? 'Quiz unpublished — students can no longer see it.' : 'Draft saved.', 'success');
          location.hash = '#/teacher/quizzes';
        } catch (e) { const m = u.$('#qmsg', root); m.className = 'form-msg show error'; m.textContent = e.message; m.scrollIntoView({ block: 'center' }); }
      };
      u.$('#draft', root).onclick = () => save(false);
      u.$('#publish', root).onclick = () => save(true);
      const up = u.$('#unpub', root); if (up) up.onclick = () => save('unpublish');
    }
    draw();
  }

  async function previewQuiz(qz, byId) {
    const sel = qz.questionIds.map((x) => byId.get(x)).filter(Boolean);
    if (!sel.length) { u.toast('Add some questions first.', 'error'); return; }
    await u.modal({
      title: 'Preview: ' + (qz.title || 'Untitled quiz'), wide: true,
      body: html`<p class="small muted">${sel.length} questions · ${sel.reduce((s, q) => s + Number(qz.marks[q.id] || q.marks), 0)} marks · ${qz.timeLimitMin ? qz.timeLimitMin + ' min timer' : 'no timer'} · feedback ${qz.feedbackMode === 'immediate' ? 'after each question' : 'after submission'}${qz.shuffle ? ' · order randomised' : ''}</p>
        <label class="check"><input type="checkbox" id="show-key"> Show answer key (students never see this before submitting)</label>
        <ol class="stack" style="padding-left:20px">${sel.map((q) => html`<li><b>${q.text}</b> <span class="badge">${qz.marks[q.id] || q.marks} mk</span>
          ${q.type === 'mcq' ? html`<ol type="A">${q.options.map((o) => html`<li>${o}</li>`)}</ol>` : q.type === 'tf' ? html`<div class="small">True / False</div>` : html`<div class="small muted">[${Q.TYPES[q.type]} — student types an answer]</div>`}
          <div class="small key" hidden>✅ ${Q.correctText(q)}${q.explanation ? ' — ' + q.explanation : ''}</div></li>`)}</ol>`,
      onOpen: (d) => { u.$('#show-key', d).onchange = (e) => u.$$('.key', d).forEach((k) => { k.hidden = !e.target.checked; }); },
      actions: [{ label: 'Close', value: null, kind: 'primary' }],
    });
  }

  // =============================== RESULTS ===============================
  V.teacherResults = async (root, params, { user }) => {
    const [attempts, quizzes, students] = await Promise.all([ML.quizSvc.attemptsFor(user), ML.quizSvc.all(), ML.users.students()]);
    const f = { quiz: params.query.get('quiz') || '', student: '', status: '' };
    function list() { return attempts.filter((a) => (!f.quiz || a.quizId === f.quiz) && (!f.student || a.userId === f.student) && (!f.status || a.status === f.status)); }
    function draw() {
      const l = list();
      const avg = l.length ? Math.round(l.reduce((s, a) => s + a.percent, 0) / l.length) : 0;
      root.innerHTML = String(html`<div class="stack">
        <div class="card"><div class="form-grid">
          <label class="field"><span>Quiz</span><select data-f="quiz"><option value="">All quizzes</option>${quizzes.map((q) => html`<option value="${q.id}" ${f.quiz === q.id ? 'selected' : ''}>${q.title}</option>`)}</select></label>
          <label class="field"><span>Student</span><select data-f="student"><option value="">All students</option>${students.map((s) => html`<option value="${s.id}" ${f.student === s.id ? 'selected' : ''}>${s.fullName}</option>`)}</select></label>
          <label class="field"><span>Status</span><select data-f="status"><option value="">Any</option><option value="marked" ${f.status === 'marked' ? 'selected' : ''}>Marked</option><option value="pending-review" ${f.status === 'pending-review' ? 'selected' : ''}>Awaiting marking</option></select></label>
        </div><div class="row between"><span class="muted">${l.length} result(s) · average ${l.length ? avg + '%' : '—'}</span><button class="btn soft" id="export" ${l.length ? '' : u.trusted('disabled')}>⬇️ Export CSV</button></div></div>
        ${l.length ? html`<div class="table-wrap"><table><thead><tr><th>Student</th><th>Quiz</th><th>Completed</th><th>Correct</th><th>Incorrect</th><th>Score</th><th>%</th><th>Time</th><th></th></tr></thead><tbody>
          ${l.map((a) => html`<tr><td>${a.userName}<br><span class="small muted">${a.userLevel}</span></td><td>${a.quizTitle}${a.status === 'pending-review' ? html`<br><span class="badge warn">${a.pendingCount} to mark</span>` : ''}</td><td>${u.fmtDate(a.finishedAt, true)}</td>
            <td>${a.correctCount}/${a.totalQuestions}</td><td>${a.incorrectCount}</td><td>${a.score}/${a.maxScore}</td><td><b>${a.percent}%</b></td><td>${u.fmtDuration(a.timeTakenSec)}${a.autoSubmitted ? html`<br><span class="small muted">auto-submitted</span>` : ''}</td>
            <td><div class="row"><a class="btn sm ghost" href="#/result/${a.id}">View</a>${a.answers.some((r) => r.type === 'short' || r.type === 'fill') ? html`<button class="btn sm ${a.status === 'pending-review' ? 'primary' : 'ghost'}" data-mark="${a.id}">${a.status === 'pending-review' ? 'Mark' : 'Re-mark'}</button>` : ''}</div></td></tr>`)}
        </tbody></table></div>` : html`<div class="card">${empty('📭', 'No results', 'No quiz attempts match these filters.')}</div>`}</div>`);
      u.$$('[data-f]', root).forEach((el) => { el.onchange = () => { f[el.dataset.f] = el.value; draw(); }; });
      u.$$('[data-mark]', root).forEach((b) => { b.onclick = () => markAttempt(b.dataset.mark); });
      const ex = u.$('#export', root);
      ex.onclick = () => {
        const rows = [['Student', 'Username', 'Class', 'Quiz', 'Completed', 'Total questions', 'Correct', 'Incorrect', 'Awaiting marking', 'Score', 'Max score', 'Percent', 'Time taken (s)', 'Time limit (min)', 'Status']];
        l.forEach((a) => { const s = students.find((x) => x.id === a.userId) || {}; rows.push([a.userName, s.username || '', a.userLevel, a.quizTitle, new Date(a.finishedAt).toISOString(), a.totalQuestions, a.correctCount, a.incorrectCount, a.pendingCount, a.score, a.maxScore, a.percent, a.timeTakenSec, a.timeLimitMin || '', a.status]); });
        u.download('quiz-results-' + new Date().toISOString().slice(0, 10) + '.csv', '﻿' + Q.toCSV(rows), 'text/csv');
        u.toast('Exported ' + l.length + ' result(s).', 'success');
      };
    }
    draw();
  };

  // =============================== STUDENTS ===============================
  V.teacherStudents = async (root) => {
    const [students, attempts, teachers] = await Promise.all([ML.users.students(), db.all('attempts'), db.byIndex('users', 'role', 'teacher')]);
    const prog = await db.all('progress');
    let q = '', lev = '';
    function draw() {
      const l = students.filter((s) => (!q || (s.fullName + ' ' + s.username + ' ' + s.email).toLowerCase().includes(q)) && (!lev || s.level === lev));
      root.innerHTML = String(html`<div class="stack">
        <div class="card"><div class="row between"><div class="row" style="flex:1"><input class="input" style="max-width:320px" type="search" id="sq" placeholder="Search students" value="${q}">
          <select class="input" style="max-width:180px" id="sl"><option value="">All classes</option>${u.LEVELS.map((x) => html`<option ${lev === x ? 'selected' : ''}>${x}</option>`)}</select></div>
          <button class="btn primary" id="add">＋ Add account</button></div>
          <p class="small muted">Students can also register themselves. ${teachers.length} teacher account(s) on this device.</p></div>
        ${l.length ? html`<div class="table-wrap"><table><thead><tr><th>Student</th><th>Class</th><th>Lessons done</th><th>Quizzes</th><th>Average</th><th>Last active</th><th>Actions</th></tr></thead><tbody>
          ${l.map((s) => { const at = attempts.filter((a) => a.userId === s.id && !a.practice); const done = prog.filter((p) => p.userId === s.id && p.type === 'lesson').length;
            return html`<tr><td><b>${s.fullName}</b><br><span class="small muted">@${s.username} · ${s.email}</span></td><td>${s.level || '—'}</td><td>${done}</td><td>${at.length}</td>
              <td>${at.length ? Math.round(at.reduce((x, a) => x + a.percent, 0) / at.length) + '%' : '—'}</td><td>${s.lastActiveAt ? u.timeAgo(s.lastActiveAt) : '—'}</td>
              <td><div class="row"><a class="btn sm soft" href="#/teacher/student/${s.id}">Progress</a><button class="btn sm ghost" data-class="${s.id}">Class</button><button class="btn sm ghost" data-reset="${s.id}">Reset password</button></div></td></tr>`; })}
        </tbody></table></div>` : html`<div class="card">${empty('👥', students.length ? 'No students match' : 'No students yet', 'Students can register from the login page, or you can add accounts here.')}</div>`}</div>`);
      u.$('#sq', root).oninput = u.debounce((e) => { q = e.target.value.toLowerCase(); draw(); const n = u.$('#sq', root); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250);
      u.$('#sl', root).onchange = (e) => { lev = e.target.value; draw(); };
      u.$('#add', root).onclick = addAccount;
      u.$$('[data-class]', root).forEach((b) => { b.onclick = async () => {
        const s = students.find((x) => x.id === b.dataset.class);
        const r = await u.modal({ title: 'Change class for ' + s.fullName, body: html`<label class="field"><span>Class / level</span><select id="lv">${u.LEVELS.map((x) => html`<option ${s.level === x ? 'selected' : ''}>${x}</option>`)}</select></label>`,
          actions: [{ label: 'Cancel', value: null }, { label: 'Save', kind: 'primary', value: (d) => u.$('#lv', d).value }] });
        if (!r) return;
        await ML.auth.requireTeacher(); s.level = r; await db.put('users', s); u.toast(s.fullName + ' moved to ' + r + '.', 'success'); draw();
      }; });
      u.$$('[data-reset]', root).forEach((b) => { b.onclick = async () => {
        const s = students.find((x) => x.id === b.dataset.reset);
        const pw = await u.prompt('Reset password for ' + s.fullName, 'New password (8+ characters, a letter and a number). Tell the student privately.', '', { type: 'text', maxLength: 128, okLabel: 'Set password', check: (v) => ML.auth.RULES.password(v) });
        if (!pw) return;
        try { await ML.auth.resetPasswordFor(s.id, pw); u.toast('Password reset. ' + s.fullName + ' has been signed out on this device.', 'success'); } catch (e) { u.toast(e.message, 'error'); }
      }; });
    }
    async function addAccount() {
      const res = await u.modal({ title: 'Add an account', wide: true,
        body: html`<form id="af" class="form-grid" novalidate>
          <label class="field"><span>Account type</span><select name="role"><option value="student">Student</option><option value="teacher">Teacher</option></select></label>
          <label class="field"><span>Class / level (students)</span><select name="level">${u.LEVELS.map((l) => html`<option ${l === 'JSS 1' ? 'selected' : ''}>${l}</option>`)}</select></label>
          ${['fullName|Full name|text', 'username|Username|text', 'email|Email|email', 'password|Temporary password|text', 'confirm|Confirm password|text'].map((x) => { const [n, l, t] = x.split('|'); return html`<label class="field"><span>${l}</span><input name="${n}" type="${t}" maxlength="120"><p class="field-error"></p></label>`; })}
          <div class="form-msg" style="grid-column:1/-1"></div></form>`,
        actions: [{ label: 'Cancel', value: null }, { label: 'Create account', kind: 'primary',
          validate: async (d) => {
            const f = u.$('#af', d);
            const data = { fullName: f.fullName.value, username: f.username.value, email: f.email.value, password: f.password.value, confirm: f.confirm.value, level: f.role.value === 'student' ? f.level.value : '' };
            const errs = ML.auth.validateAccount(data); ML.fieldErrors(f, errs);
            if (Object.keys(errs).length) return false;
            try { await ML.auth.createAccount(data, f.role.value); return true; }
            catch (e) { ML.fieldErrors(f, e.fields || {}); const m = u.$('.form-msg', f); m.className = 'form-msg show error'; m.textContent = e.message; return false; }
          }, value: true }] });
      if (res) { u.toast('Account created.', 'success'); ML.rerender(); }
    }
    draw();
  };

  V.teacherStudent = async (root, { id }, { setTitle }) => {
    const s = await db.get('users', id);
    if (!s || s.role !== 'student') { root.innerHTML = String(html`<div class="card">${empty('🔍', 'Student not found', '')}</div>`); return; }
    setTitle(s.fullName);
    const sum = await ML.progress.summary(s.id);
    const formal = sum.attempts.filter((a) => !a.practice);
    root.innerHTML = String(html`<div class="stack">
      <div class="card row">${ML.avatarHTML(s, 'xl')}<div><h2 style="margin:0">${s.fullName}</h2><p class="muted">@${s.username} · ${s.level} · ${s.email}</p><p class="small muted">Joined ${u.fmtDate(s.createdAt)} · last active ${s.lastActiveAt ? u.timeAgo(s.lastActiveAt) : '—'}</p></div></div>
      <div class="grid cols-4">
        <div class="stat"><span class="label">Lessons completed</span><span class="value">${sum.lessonsDone}/${sum.lessonsTotal}</span></div>
        <div class="stat"><span class="label">Assigned quizzes taken</span><span class="value">${formal.length}</span></div>
        <div class="stat"><span class="label">Practice sessions</span><span class="value">${sum.attempts.length - formal.length}</span></div>
        <div class="stat"><span class="label">Average (all)</span><span class="value">${sum.attempts.length ? sum.avg + '%' : '—'}</span></div></div>
      <div class="card"><h2>Subject progress</h2><div class="bars">${Object.entries(sum.bySubject).map(([sub, b]) => html`<div class="bar-row"><span>${u.subjectIcon(sub)} ${u.SUBJECTS[sub] ? u.SUBJECTS[sub].short : sub}</span><span class="progress"><i style="width:${b.pct}%"></i></span><b>${b.pct}%</b></div>`)}</div></div>
      <div class="section-head"><h2>Quiz history</h2></div>${ML.scoreTable(sum.attempts)}
      <div class="card"><h2>Completed lessons</h2>${sum.done.length ? html`<ul class="list">${sum.done.sort((a, b) => b.completedAt - a.completedAt).map((d) => html`<li class="list-item"><span>📗</span><span class="grow">${d.title}<br><span class="small muted">${d.subject}</span></span><span class="small muted">${u.fmtDate(d.completedAt)}</span></li>`)}</ul>` : empty('📭', 'None yet', '')}</div>
    </div>`);
  };
})();
