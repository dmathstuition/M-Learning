/* M Learning App — student-facing pages: dashboard, courses, lessons, quizzes, progress,
 * character studio, profile, settings and notifications. */
(function () {
  'use strict';
  const ML = (window.ML = window.ML || {});
  const V = (ML.views = ML.views || {});
  const { u, db } = ML;
  const { html } = u;

  const firstName = (n) => String(n || '').split(/\s+/)[0];
  const subjectsList = () => Object.keys(u.SUBJECTS);
  const empty = (icon, title, text, action) => html`<div class="empty"><span class="big">${icon}</span><b>${title}</b><p>${text}</p>${action || ''}</div>`;
  ML.empty = empty;

  function quizStatus(qz, attempts) {
    const mine = attempts.filter((a) => a.quizId === qz.id);
    if (mine.some((a) => a.status === 'pending-review')) return html`<span class="badge warn">Awaiting marking</span>`;
    if (mine.length) return html`<span class="badge ok">Best ${Math.max(...mine.map((a) => a.percent))}%</span>`;
    if (qz.dueDate && qz.dueDate < Date.now()) return html`<span class="badge bad">Past due</span>`;
    if (qz.dueDate) return html`<span class="badge orange">Due ${u.fmtDate(qz.dueDate)}</span>`;
    return html`<span class="badge purple">Not started</span>`;
  }

  /** Practice topics available to students from the shared teacher bank. */
  async function practiceTopics() {
    const qs = (await db.all('questions')).filter((q) => q.ownerRole === 'teacher' && q.practice);
    const map = new Map();
    qs.forEach((q) => { const k = q.subject + '|' + q.topic.toLowerCase(); const e = map.get(k) || { subject: q.subject, topic: q.topic, ids: [] }; e.ids.push(q.id); map.set(k, e); });
    return Array.from(map.values()).sort((a, b) => a.subject.localeCompare(b.subject) || a.topic.localeCompare(b.topic));
  }
  async function startPractice(user, subject, topic) {
    const t = (await practiceTopics()).find((x) => x.subject === subject && x.topic.toLowerCase() === topic.toLowerCase());
    try {
      const qz = await ML.quizSvc.createPractice(user, { title: 'Practice: ' + (t ? t.topic : topic), subject, questionIds: t ? t.ids : [] });
      location.hash = '#/quiz/' + qz.id;
    } catch (e) { u.toast(e.message, 'error'); }
  }
  ML.startPractice = startPractice;

  // =============================== DASHBOARD ===============================
  V.home = async (root, params, { user }) => {
    if (user.role === 'teacher') { location.replace('#/teacher'); return; }
    const [sum, quizzes, notes, courses, lessons] = await Promise.all([ML.progress.summary(user.id), ML.quizSvc.visibleFor(user), ML.notify.list(user.id), ML.courses.all(), ML.courses.allLessons()]);
    const s = ML.settings.get();
    const tab = params.query.get('tab') === 'practice' ? 'practice' : 'learn';
    const level = params.query.get('level') || user.level || 'all';
    const levels = Array.from(new Set(courses.map((c) => c.level))).sort((a, b) => u.LEVELS.indexOf(a) - u.LEVELS.indexOf(b));
    const lessonsAt = lessons.filter((l) => level === 'all' || l.level === level);
    const doneIds = new Set(sum.done.map((d) => d.lessonId));
    const recent = (s.recentLessons || []).map((id) => lessons.find((l) => l.id === id)).filter(Boolean).slice(0, 4);
    const pendingQuizzes = quizzes.filter((q) => !sum.attempts.some((a) => a.quizId === q.id));
    const subjectOrder = subjectsList().sort((a, b) => (a === s.preferredSubject ? -1 : b === s.preferredSubject ? 1 : 0));
    const hours = sum.studySeconds / 3600;

    root.innerHTML = String(html`
      <div class="row" style="margin-bottom:10px">${ML.avatarHTML(user)}<div><b style="font-size:20px">Hi, ${firstName(user.fullName)} 👋</b><div class="muted small">${user.level || 'Student'} · @${user.username}</div></div></div>
      <div class="tabs" role="tablist" style="max-width:520px">
        <button role="tab" class="${tab === 'learn' ? 'active' : ''}" aria-selected="${tab === 'learn'}" data-tab="learn">📘 Learning</button>
        <button role="tab" class="${tab === 'practice' ? 'active' : ''}" aria-selected="${tab === 'practice'}" data-tab="practice">📝 Practicing</button>
      </div>
      <h2 class="hero-title">Your personal learning plan<span class="accent">${tab === 'learn' ? 'Built for ' + (level === 'all' ? 'every level' : level) : 'Practice makes progress'}</span></h2>
      ${tab === 'learn' ? html`
        <div class="chips" role="group" aria-label="Filter by class">
          <button class="chip ${level === 'all' ? 'active' : ''}" data-level="all">🎓 All</button>
          ${levels.map((l) => html`<button class="chip ${level === l ? 'active' : ''}" data-level="${l}">🎓 ${l}</button>`)}
        </div>
        <div class="grid cols-2" style="margin-top:16px">
          <div class="panel tint-blue">
            <div class="row between" style="margin-bottom:12px"><span class="row"><span class="chip" style="min-height:32px">Subjects</span><span class="chip" style="min-height:32px">🎓 ${level === 'all' ? 'All levels' : level}</span></span><span class="small muted">${lessonsAt.length} lessons</span></div>
            <div class="tile-grid">
              ${subjectOrder.map((sub) => {
                const ls = lessonsAt.filter((l) => l.subject === sub); const d = ls.filter((l) => doneIds.has(l.id)).length;
                return html`<a class="subject-tile" style="background:var(--surface-solid)" href="#/courses?subject=${encodeURIComponent(sub)}${level !== 'all' ? '&level=' + encodeURIComponent(level) : ''}">
                  <span class="emoji">${u.subjectIcon(sub)}</span><b>${u.SUBJECTS[sub].short}</b><small>${ls.length} lessons · ${d} done</small><span class="progress"><i style="width:${u.pct(d, ls.length)}%"></i></span></a>`;
              })}
            </div>
          </div>
          <div class="panel tint-pink">
            <div class="row between" style="margin-bottom:12px"><span class="chip" style="min-height:32px">Shortcuts</span></div>
            <div class="tile-grid">
              <a class="subject-tile" style="background:var(--surface-solid)" href="#/character"><span class="emoji">🎭</span><b>Characters</b><small>Your library</small></a>
              <a class="subject-tile" style="background:var(--surface-solid)" href="#/bank"><span class="emoji">🗂️</span><b>Questions</b><small>Question library</small></a>
              <a class="subject-tile" style="background:var(--surface-solid)" href="#/progress"><span class="emoji">📈</span><b>Progress</b><small>${sum.lessonsDone}/${sum.lessonsTotal} lessons</small></a>
            </div>
          </div>
        </div>
        <div class="section-head"><h2>Continue learning</h2><a href="#/courses">See all</a></div>
        ${recent.length ? html`<div class="grid cols-2">${recent.map((l) => html`<a class="list-item" href="#/lesson/${l.id}"><span style="font-size:30px">${u.subjectIcon(l.subject)}</span>
          <span class="grow"><span class="title">${l.title}</span><br><span class="small muted">${l.subject} · ${l.level} · ${l.minutes} min</span></span>${doneIds.has(l.id) ? html`<span class="badge ok">Done</span>` : html`<span class="badge orange">Resume</span>`}</a>`)}</div>`
          : html`<div class="card">${empty('📚', 'No lessons opened yet', 'Pick a subject above to start your first lesson.')}</div>`}
      ` : html`
        <div class="section-head" style="margin-top:6px"><h2>Quizzes for you</h2><a href="#/quizzes">See all</a></div>
        ${pendingQuizzes.length ? html`<div class="grid cols-2">${pendingQuizzes.slice(0, 4).map((q) => html`<a class="list-item" href="#/quiz/${q.id}"><span style="font-size:30px">${u.subjectIcon(q.subject)}</span>
          <span class="grow"><span class="title">${q.title}</span><br><span class="small muted">${q.questionIds.length} questions${q.timeLimitMin ? ' · ' + q.timeLimitMin + ' min' : ''}</span></span>${quizStatus(q, sum.attempts)}</a>`)}</div>`
          : html`<div class="card">${empty('🎉', 'All caught up!', 'You have attempted every assigned quiz. Try topic practice below.')}</div>`}
        <div class="section-head"><h2>Recent quiz scores</h2><a href="#/progress">History</a></div>
        <div class="card">${sum.attempts.length ? html`<ul class="list">${sum.attempts.slice(0, 5).map((a) => html`<li><a class="list-item" href="#/result/${a.id}"><span class="grow"><span class="title">${a.quizTitle}</span><br><span class="small muted">${u.fmtDate(a.finishedAt, true)}</span></span>
          <span class="badge ${a.percent >= 50 ? 'ok' : 'bad'}">${a.percent}%</span></a></li>`)}</ul>` : empty('📝', 'No quiz attempts yet', 'Your scores will appear here.')}</div>
      `}
      <div class="section-head"><h2>Your stats</h2></div>
      <div class="grid cols-4">
        <div class="stat"><span class="ico">🕒</span><span class="label">Study hours</span><span class="value">${hours < 10 ? hours.toFixed(1) : Math.round(hours)}</span></div>
        <div class="stat"><span class="ico">📗</span><span class="label">Lessons done</span><span class="value">${sum.lessonsDone}</span></div>
        <div class="stat"><span class="ico">📝</span><span class="label">Quizzes taken</span><span class="value">${sum.attempts.length}</span></div>
        <div class="stat"><span class="ico">⭐</span><span class="label">Average score</span><span class="value">${sum.attempts.length ? sum.avg + '%' : '—'}</span></div>
      </div>
      <div class="grid cols-2" style="margin-top:18px">
        <div class="card"><div class="row between"><h2>🔔 Notifications</h2><a href="#/notifications" class="small">View all</a></div>
          ${notes.length ? html`<ul class="list">${notes.slice(0, 3).map((n) => html`<li><a class="list-item ${n.read ? '' : 'unread'}" href="${n.link || '#/notifications'}"><span class="grow"><span class="title">${n.title}</span><br><span class="small muted">${u.timeAgo(n.createdAt)}</span></span></a></li>`)}</ul>` : empty('🔕', 'No notifications', 'New lessons, quizzes and results will show up here.')}</div>
        <div class="card" style="background:linear-gradient(160deg,var(--tint-orange),var(--tint-purple))">
          <div class="row"><div style="flex:1"><span class="badge purple">Featured</span><h2 style="font-size:24px;margin-top:8px">Science Play 🎓</h2>
            <p class="muted">Discover the magic of science in a playful way with Professor Hoot — living things, matter, energy and more.</p>
            <a class="btn dark" href="#/courses?subject=Basic%20Science">Explore science</a></div><div style="width:130px">${ML.MASCOT}</div></div></div>
      </div>`);
    u.$$('[data-tab]', root).forEach((b) => { b.onclick = () => { location.hash = '#/home' + (b.dataset.tab === 'practice' ? '?tab=practice' : ''); }; });
    u.$$('[data-level]', root).forEach((b) => { b.onclick = () => { location.hash = '#/home?level=' + encodeURIComponent(b.dataset.level); }; });
  };

  // =============================== COURSE LIBRARY ===============================
  V.courses = async (root, params, { user }) => {
    const [courses, lessons, done] = await Promise.all([ML.courses.all(), ML.courses.allLessons(), ML.progress.completed(user.id)]);
    const doneIds = new Set(done.map((d) => d.lessonId));
    const levels = Array.from(new Set(courses.map((c) => c.level))).sort((a, b) => u.LEVELS.indexOf(a) - u.LEVELS.indexOf(b));
    const f = { q: params.query.get('q') || '', subject: params.query.get('subject') || '', level: params.query.get('level') || '', difficulty: params.query.get('difficulty') || '' };
    root.innerHTML = String(html`
      <div class="card"><div class="form-grid">
        <label class="field" style="grid-column:1/-1"><span>Search courses, lessons and topics</span><input id="f-q" type="search" placeholder="e.g. fractions, nouns, energy" value="${f.q}"></label>
        <label class="field"><span>Subject</span><select id="f-subject"><option value="">All subjects</option>${subjectsList().map((s) => html`<option ${f.subject === s ? 'selected' : ''}>${s}</option>`)}</select></label>
        <label class="field"><span>Class / level</span><select id="f-level"><option value="">All levels</option>${levels.map((l) => html`<option ${f.level === l ? 'selected' : ''}>${l}</option>`)}</select></label>
        <label class="field"><span>Difficulty</span><select id="f-diff"><option value="">Any</option>${u.DIFFICULTIES.map((d) => html`<option ${f.difficulty === d ? 'selected' : ''}>${d}</option>`)}</select></label>
      </div></div>
      <div id="results"></div>`);
    const draw = () => {
      const q = u.$('#f-q', root).value.trim().toLowerCase();
      const sub = u.$('#f-subject', root).value, lev = u.$('#f-level', root).value, dif = u.$('#f-diff', root).value;
      const cs = courses.filter((c) => (!sub || c.subject === sub) && (!lev || c.level === lev) && (!dif || c.difficulty === dif));
      const ls = lessons.filter((l) => (!sub || l.subject === sub) && (!lev || l.level === lev) && (!dif || l.difficulty === dif));
      const hit = (t) => !q || String(t).toLowerCase().includes(q);
      const courseHits = cs.filter((c) => hit(c.title) || hit(c.description) || ls.some((l) => l.courseId === c.id && (hit(l.title) || hit(l.topic))));
      const lessonHits = q ? ls.filter((l) => hit(l.title) || hit(l.topic) || hit(l.body)) : [];
      u.$('#results', root).innerHTML = String(html`
        ${q ? html`<div class="section-head"><h2>Lessons matching “${q}”</h2><span class="muted small">${lessonHits.length} found</span></div>
          ${lessonHits.length ? html`<div class="grid cols-2">${lessonHits.slice(0, 12).map((l) => html`<a class="list-item" href="#/lesson/${l.id}"><span style="font-size:28px">${u.subjectIcon(l.subject)}</span><span class="grow"><span class="title">${l.title}</span><br><span class="small muted">${l.subject} · ${l.level} · ${l.topic}</span></span>${doneIds.has(l.id) ? html`<span class="badge ok">Done</span>` : ''}</a>`)}</div>` : html`<p class="muted">No lessons match.</p>`}` : ''}
        <div class="section-head"><h2>Courses</h2><span class="muted small">${courseHits.length} course(s)</span></div>
        ${courseHits.length ? html`<div class="grid cols-3">${courseHits.map((c) => {
          const cl = lessons.filter((l) => l.courseId === c.id); const d = cl.filter((l) => doneIds.has(l.id)).length;
          return html`<a class="card" href="#/course/${c.id}" style="text-decoration:none;color:inherit;background:${u.trusted((u.SUBJECTS[c.subject] || {}).tint || 'var(--surface-solid)')}">
            <div class="row between"><span style="font-size:40px">${u.subjectIcon(c.subject)}</span><span class="badge">${c.difficulty}</span></div>
            <h2 style="margin-top:8px">${c.title}</h2><p class="small muted">${c.subject} · ${c.level}</p><p class="small">${c.description}</p>
            <div class="row between small"><span>${cl.length} lessons</span><span>${u.pct(d, cl.length)}% done</span></div><span class="progress"><i style="width:${u.pct(d, cl.length)}%"></i></span></a>`;
        })}</div>` : html`<div class="card">${empty('🔎', 'No courses found', 'Try a different search or clear the filters.')}</div>`}`);
    };
    u.$('#f-q', root).oninput = u.debounce(draw, 150);
    ['#f-subject', '#f-level', '#f-diff'].forEach((s) => { u.$(s, root).onchange = draw; });
    draw();
  };

  V.course = async (root, { id }, { user, setTitle }) => {
    const c = await db.get('courses', id);
    if (!c) { root.innerHTML = String(html`<div class="card">${empty('🔍', 'Course not found', 'It may have been removed.', html`<a class="btn primary" href="#/courses">Course library</a>`)}</div>`); return; }
    setTitle(c.title);
    const [ls, done] = await Promise.all([ML.courses.lessons(id), ML.progress.completed(user.id)]);
    const doneIds = new Set(done.map((d) => d.lessonId));
    root.innerHTML = String(html`<div class="stack">
      <div class="card" style="background:${u.trusted((u.SUBJECTS[c.subject] || {}).tint || 'var(--surface-solid)')}"><div class="row"><span style="font-size:54px">${u.subjectIcon(c.subject)}</span><div style="flex:1">
        <div class="row"><span class="badge purple">${c.subject}</span><span class="badge">${c.level}</span><span class="badge">${c.difficulty}</span></div>
        <h2 style="font-size:26px;margin-top:8px">${c.title}</h2><p>${c.description}</p></div></div>
        <div class="row small"><b>${ls.filter((l) => doneIds.has(l.id)).length} / ${ls.length}</b> lessons completed</div>
        <span class="progress"><i style="width:${u.pct(ls.filter((l) => doneIds.has(l.id)).length, ls.length)}%"></i></span>
        ${user.role === 'teacher' ? html`<p><a class="btn soft sm" href="#/teacher/course/${c.id}">✏️ Edit course</a></p>` : ''}</div>
      <div class="card"><h2>Lessons</h2>${ls.length ? html`<ul class="list">${ls.map((l, i) => html`<li><a class="list-item" href="#/lesson/${l.id}">
        <span class="badge ${doneIds.has(l.id) ? 'ok' : 'purple'}" style="min-width:34px;justify-content:center">${doneIds.has(l.id) ? '✓' : i + 1}</span>
        <span class="grow"><span class="title">${l.title}</span><br><span class="small muted">Topic: ${l.topic} · ${l.difficulty} · ${l.minutes || 10} min</span></span><span>→</span></a></li>`)}</ul>`
        : empty('🧱', 'No lessons yet', 'Your teacher hasn\'t added lessons to this course.')}</div></div>`);
  };

  // =============================== LESSON ===============================
  V.lesson = async (root, { id }, { user, setTitle }) => {
    const l = await db.get('lessons', id);
    if (!l) { root.innerHTML = String(html`<div class="card">${empty('🔍', 'Lesson not found', 'It may have been removed by a teacher.', html`<a class="btn primary" href="#/courses">Course library</a>`)}</div>`); return; }
    setTitle(l.title);
    const [course, siblings, complete, topics] = await Promise.all([db.get('courses', l.courseId), ML.courses.lessons(l.courseId), ML.progress.isComplete(user.id, l.id), practiceTopics()]);
    const pos = siblings.findIndex((x) => x.id === l.id);
    const prev = siblings[pos - 1], next = siblings[pos + 1];
    const practice = topics.find((t) => t.subject === l.subject && t.topic.toLowerCase() === l.topic.toLowerCase());
    ML.progress.touchRecent(l.id);
    const opened = Date.now();
    ML.onLeave = () => ML.progress.addTime(user, Math.round((Date.now() - opened) / 1000));

    root.innerHTML = String(html`<div class="stack" style="max-width:860px;margin:0 auto">
      <div class="card">
        <div class="row"><a class="badge purple" href="#/course/${l.courseId}">${u.subjectIcon(l.subject)} ${course ? course.title : l.subject}</a><span class="badge">${l.level}</span><span class="badge">Topic: ${l.topic}</span><span class="badge">${l.minutes || 10} min</span></div>
        <h2 style="font-size:clamp(24px,3vw,32px);margin-top:10px">${l.title}</h2>
        <div class="lesson-body">${u.renderLite(l.body)}</div>
      </div>
      ${l.examples && l.examples.length ? html`<div class="card"><h2>✏️ Worked examples</h2>${l.examples.map((e, i) => html`<div class="example">
        <b>Example ${i + 1}: ${e.problem}</b>
        <details class="reveal"><summary>Show the solution</summary><ol>${e.steps.map((s) => html`<li>${s}</li>`)}</ol><p class="ans">Answer: ${e.answer}</p></details></div>`)}</div>` : ''}
      <div class="card stack">
        <h2>🎯 Practice</h2>
        ${practice ? html`<p>${practice.ids.length} practice question(s) on <b>${practice.topic}</b> with instant feedback and explanations.</p><div><button class="btn accent" id="practice">Practise this topic</button></div>`
          : html`<p class="muted">No practice questions for this topic yet.</p>`}
        <label class="check"><input type="checkbox" id="complete" ${complete ? u.trusted('checked') : ''}> I have completed this lesson</label>
      </div>
      <div class="row between">${prev ? html`<a class="btn ghost" href="#/lesson/${prev.id}">← ${prev.title}</a>` : html`<span></span>`}${next ? html`<a class="btn primary" href="#/lesson/${next.id}">${next.title} →</a>` : html`<a class="btn primary" href="#/course/${l.courseId}">Back to course</a>`}</div>
    </div>`);
    const pb = u.$('#practice', root); if (pb) pb.onclick = () => startPractice(user, l.subject, l.topic);
    u.$('#complete', root).onchange = async (e) => {
      try {
        if (e.target.checked) { await ML.progress.complete(user, l); u.toast('Lesson marked as complete. Great job! 🎉', 'success'); }
        else { await ML.progress.uncomplete(user, l.id); u.toast('Lesson marked as not complete.'); }
      } catch (err) { u.toast('Could not save progress: ' + err.message, 'error'); e.target.checked = !e.target.checked; }
    };
  };

  // =============================== QUIZZES ===============================
  V.quizzes = async (root, params, { user }) => {
    if (user.role === 'teacher') { location.replace('#/teacher/quizzes'); return; }
    const [quizzes, attempts, topics, myBank] = await Promise.all([ML.quizSvc.visibleFor(user), ML.quizSvc.attemptsFor(user), practiceTopics(), ML.bank.visible(user)]);
    const bySubject = {};
    topics.forEach((t) => { (bySubject[t.subject] = bySubject[t.subject] || []).push(t); });
    root.innerHTML = String(html`<div class="stack">
      <div class="section-head" style="margin-top:0"><h2>Assigned quizzes</h2><span class="muted small">${quizzes.length} available</span></div>
      ${quizzes.length ? html`<div class="grid cols-2">${quizzes.map((q) => html`<a class="list-item" style="background:var(--surface-solid)" href="#/quiz/${q.id}"><span style="font-size:32px">${u.subjectIcon(q.subject)}</span>
        <span class="grow"><span class="title">${q.title}</span><br><span class="small muted">${q.subject} · ${q.questionIds.length} questions${q.timeLimitMin ? ' · ⏱️ ' + q.timeLimitMin + ' min' : ''} · feedback ${q.feedbackMode === 'immediate' ? 'instant' : 'after submit'}</span></span>${quizStatus(q, attempts)}</a>`)}</div>`
        : html`<div class="card">${empty('📭', 'No quizzes assigned yet', 'When your teacher publishes a quiz for you, it appears here.')}</div>`}
      <div class="section-head"><h2>Topic practice</h2><span class="muted small">Instant feedback</span></div>
      <div class="grid cols-2">${Object.entries(bySubject).map(([sub, ts]) => html`<div class="card"><h2>${u.subjectIcon(sub)} ${sub}</h2>
        <div class="row">${ts.map((t) => html`<button class="chip" data-sub="${t.subject}" data-topic="${t.topic}">${t.topic} <span class="badge">${t.ids.length}</span></button>`)}</div></div>`)}</div>
      ${myBank.length ? html`<div class="card row between"><span>🗂️ You have <b>${myBank.length}</b> question(s) in your personal question library.</span><a class="btn soft" href="#/bank">Practise my questions</a></div>` : ''}
      <div class="section-head"><h2>Score history</h2></div>
      ${scoreTable(attempts)}
    </div>`);
    u.$$('[data-topic]', root).forEach((b) => { b.onclick = () => startPractice(user, b.dataset.sub, b.dataset.topic); });
  };

  function scoreTable(attempts, showStudent) {
    if (!attempts.length) return html`<div class="card">${empty('📝', 'No attempts yet', 'Complete a quiz to see your score history.')}</div>`;
    return html`<div class="table-wrap"><table><thead><tr>${showStudent ? html`<th>Student</th>` : ''}<th>Quiz</th><th>Date completed</th><th>Questions</th><th>Correct</th><th>Incorrect</th><th>Score</th><th>%</th><th>Time</th><th></th></tr></thead><tbody>
      ${attempts.map((a) => html`<tr>${showStudent ? html`<td>${a.userName}<br><span class="small muted">${a.userLevel}</span></td>` : ''}<td>${a.quizTitle}${a.practice ? html` <span class="badge orange">practice</span>` : ''}${a.status === 'pending-review' ? html` <span class="badge warn">awaiting marking</span>` : ''}</td>
        <td>${u.fmtDate(a.finishedAt, true)}</td><td>${a.totalQuestions}</td><td>${a.correctCount}</td><td>${a.incorrectCount}</td><td>${a.score}/${a.maxScore}</td><td><b>${a.percent}%</b></td>
        <td>${a.timerEnabled ? u.fmtDuration(a.timeTakenSec) + ' / ' + a.timeLimitMin + 'm' : u.fmtDuration(a.timeTakenSec)}</td><td><a class="btn sm ghost" href="#/result/${a.id}">View</a></td></tr>`)}
    </tbody></table></div>`;
  }
  ML.scoreTable = scoreTable;

  // =============================== PROGRESS ===============================
  function lineChart(attempts) {
    const pts = attempts.slice(0, 10).reverse();
    if (pts.length < 2) return html`<p class="muted small">Complete at least two quizzes to see your score trend.</p>`;
    const W = 600, H = 180, P = 28;
    const x = (i) => P + (i * (W - 2 * P)) / (pts.length - 1);
    const y = (v) => H - P - (v / 100) * (H - 2 * P);
    const line = pts.map((a, i) => x(i) + ',' + y(a.percent)).join(' ');
    // numbers only below — built from computed values, not user text
    return u.trusted(`<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Last ${pts.length} quiz scores">
      ${[0, 50, 100].map((v) => `<line class="grid-line" x1="${P}" x2="${W - P}" y1="${y(v)}" y2="${y(v)}"/><text x="2" y="${y(v) + 4}">${v}%</text>`).join('')}
      <polygon class="area" points="${x(0)},${H - P} ${line} ${x(pts.length - 1)},${H - P}"/><polyline class="line" points="${line}"/>
      ${pts.map((a, i) => `<circle cx="${x(i)}" cy="${y(a.percent)}" r="5"/>`).join('')}</svg>`);
  }

  V.progress = async (root, params, { user }) => {
    const sum = await ML.progress.summary(user.id);
    const activity = sum.done.map((d) => ({ t: d.completedAt, icon: '📗', text: 'Completed lesson: ' + d.title, link: '#/lesson/' + d.lessonId }))
      .concat(sum.attempts.map((a) => ({ t: a.finishedAt, icon: '📝', text: (a.practice ? 'Practised: ' : 'Quiz: ') + a.quizTitle + ' — ' + a.percent + '%', link: '#/result/' + a.id })))
      .sort((a, b) => b.t - a.t).slice(0, 10);
    root.innerHTML = String(html`<div class="stack">
      <div class="grid cols-4">
        <div class="stat"><span class="ico">📗</span><span class="label">Lessons completed</span><span class="value">${sum.lessonsDone}<span class="small muted"> / ${sum.lessonsTotal}</span></span></div>
        <div class="stat"><span class="ico">📝</span><span class="label">Quizzes attempted</span><span class="value">${sum.attempts.length}</span></div>
        <div class="stat"><span class="ico">⭐</span><span class="label">Average score</span><span class="value">${sum.attempts.length ? sum.avg + '%' : '—'}</span></div>
        <div class="stat"><span class="ico">🕒</span><span class="label">Study time</span><span class="value" style="font-size:24px">${u.fmtDuration(sum.studySeconds)}</span></div>
      </div>
      <div class="grid cols-2">
        <div class="card"><h2>Subject progress</h2><div class="bars">${Object.entries(sum.bySubject).map(([s, b]) => html`<div>
          <div class="bar-row"><span>${u.subjectIcon(s)} ${u.SUBJECTS[s] ? u.SUBJECTS[s].short : s}</span><span class="progress" title="Lessons"><i style="width:${b.pct}%"></i></span><b>${b.pct}%</b></div>
          <div class="small muted" style="margin-left:140px">${b.done}/${b.total} lessons · ${b.quizzes} quiz${b.quizzes === 1 ? '' : 'zes'}${b.quizzes ? ' · avg ' + b.avg + '%' : ''}</div></div>`)}</div></div>
        <div class="card"><h2>Score trend</h2>${lineChart(sum.attempts)}</div>
      </div>
      <div class="card"><h2>Recent activity</h2>${activity.length ? html`<ul class="list">${activity.map((a) => html`<li><a class="list-item" href="${a.link}"><span>${a.icon}</span><span class="grow">${a.text}</span><span class="small muted">${u.timeAgo(a.t)}</span></a></li>`)}</ul>` : empty('🌱', 'No activity yet', 'Open a lesson or take a quiz to get started.')}</div>
      <div class="section-head"><h2>Score history</h2></div>
      ${scoreTable(sum.attempts)}
    </div>`);
  };

  // =============================== CHARACTER STUDIO ===============================
  V.character = async (root, params, { user }) => {
    let pending = null; // processed image waiting for Apply/Cancel
    let previewUrl = null;
    const thumbUrls = [];
    ML.onLeave = () => { thumbUrls.forEach((x) => URL.revokeObjectURL(x)); if (previewUrl) URL.revokeObjectURL(previewUrl); };

    async function draw() {
      thumbUrls.splice(0).forEach((x) => URL.revokeObjectURL(x));
      const s = ML.settings.get();
      const lib = await ML.chars.list(user.id);
      const active = lib.find((c) => c.id === s.activeCharacterId);
      const urlFor = (c) => { const x = URL.createObjectURL(c.blob); thumbUrls.push(x); return x; };
      root.innerHTML = String(html`<div class="stack">
        <div class="grid cols-2">
          <div class="card stack">
            <h2>📥 Import a character</h2>
            <label class="dropzone" id="drop" tabindex="0"><input type="file" id="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" class="sr-only">
              <span style="font-size:40px">🖼️</span><br><b>Tap to choose an image</b> or drag it here<br><span class="small muted">PNG, JPG, JPEG or WebP · up to 10 MB · transparent PNGs look best</span></label>
            <div id="preview-area">${pending ? html`
              <div class="preview-box"><img src="${previewUrl}" alt="Preview of imported character"></div>
              <p class="small muted">${pending.processed.original.w}×${pending.processed.original.h} → saved at ${pending.processed.width}×${pending.processed.height} (${Math.round(pending.processed.blob.size / 1024)} KB)</p>
              <label class="field"><span>Character name</span><input id="char-name" maxlength="40" value="${pending.name}"></label>
              <div class="row"><button class="btn primary" id="apply">✨ Apply character</button><button class="btn soft" id="save-only">Save to library</button><button class="btn ghost" id="cancel">Cancel</button></div>`
              : html`<p class="muted small">After choosing an image you'll see a preview before anything is applied.</p>`}</div>
          </div>
          <div class="card stack">
            <h2>🎭 Current background</h2>
            ${active ? html`<div class="row"><div class="char-card active" style="width:120px"><div class="thumb"><img src="${urlFor(active)}" alt="${active.name}"></div></div>
              <div><b>${active.name}</b><p class="small muted">Shown behind every page — dashboard, subjects, quizzes and profile.</p></div></div>`
              : html`<p class="muted">Default background (no character). Import one or choose from your library.</p>`}
            <div class="row"><button class="btn soft" id="change">🔄 Change character</button>${active ? html`<button class="btn ghost" id="remove">Remove character</button>` : ''}</div>
            <label class="field"><span>Character opacity: <b id="v-op">${s.bgOpacity}%</b></span><input type="range" id="r-op" min="10" max="100" value="${s.bgOpacity}"></label>
            <label class="field"><span>Character brightness: <b id="v-br">${s.bgBrightness}%</b></span><input type="range" id="r-br" min="40" max="140" value="${s.bgBrightness}"></label>
            <label class="field"><span>Readability overlay: <b id="v-ov">${s.bgOverlay}%</b></span><input type="range" id="r-ov" min="0" max="85" value="${s.bgOverlay}"></label>
            <label class="field"><span>Character size: <b id="v-sz">${s.bgSize}%</b></span><input type="range" id="r-sz" min="40" max="100" value="${s.bgSize}"></label>
            <label class="field"><span>Position</span><select id="pos">${[['right', 'Bottom right'], ['left', 'Bottom left'], ['center', 'Bottom centre'], ['cover', 'Fill the screen']].map(([v, l]) => html`<option value="${v}" ${s.bgPosition === v ? 'selected' : ''}>${l}</option>`)}</select></label>
            <div><button class="btn ghost" id="reset">Reset to default background</button></div>
          </div>
        </div>
        <div class="card" id="library"><div class="row between"><h2>📚 Character library</h2><span class="muted small">${lib.length} / ${ML.chars.MAX_CHARACTERS} saved</span></div>
          ${lib.length ? html`<div class="char-grid">${lib.map((c) => html`<div class="char-card ${c.id === s.activeCharacterId ? 'active' : ''}">
            <div class="thumb"><img src="${urlFor(c)}" alt="${c.name}" loading="lazy"></div>
            <span class="name" title="${c.name}">${c.name}</span>
            ${c.id === s.activeCharacterId ? html`<span class="badge orange">★ Active</span>` : html`<button class="btn sm primary" data-use="${c.id}">Use</button>`}
            <div class="row"><button class="btn sm ghost" data-rename="${c.id}">Rename</button><button class="btn sm ghost" data-del="${c.id}" aria-label="Delete ${c.name}">🗑️</button></div>
          </div>`)}</div>` : empty('🧸', 'Your library is empty', 'Imported characters are saved here so you can switch between them anytime.')}
        </div></div>`);
      bind(lib);
    }

    async function choose(file) {
      const area = u.$('#preview-area', root);
      area.innerHTML = '<div class="loading" style="min-height:120px"><div><div class="spinner"></div>Checking image…</div></div>';
      try {
        const processed = await ML.chars.processImage(file);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(processed.blob);
        pending = { processed, name: (file.name || 'Character').replace(/\.[^.]+$/, '').slice(0, 40) };
        await draw();
      } catch (e) {
        pending = null;
        area.innerHTML = String(html`<div class="form-msg show error" role="alert">${e.message}</div>`);
        u.toast(e.message, 'error');
      }
    }
    async function savePending(apply) {
      const name = u.$('#char-name', root).value.trim() || pending.name;
      try {
        const rec = await ML.chars.add(user.id, name, pending.processed);
        pending = null; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null;
        if (apply) { ML.settings.set({ activeCharacterId: rec.id }); await ML.bg.refresh(); u.toast('“' + rec.name + '” is now your background!', 'success'); }
        else u.toast('Saved “' + rec.name + '” to your library.', 'success');
        await draw();
      } catch (e) { u.toast(e.message, 'error'); }
    }
    function slider(id, key, label) {
      const el = u.$(id, root);
      el.oninput = () => { u.$(label, root).textContent = el.value + '%'; ML.bg.applyVars(Object.assign(ML.settings.get(), { [key]: Number(el.value) })); };
      el.onchange = () => { ML.settings.set({ [key]: Number(el.value) }); };
    }
    function bind(lib) {
      const input = u.$('#file', root), drop = u.$('#drop', root);
      input.onchange = () => { if (input.files[0]) choose(input.files[0]); input.value = ''; };
      drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
      drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) choose(f); });
      const ap = u.$('#apply', root); if (ap) ap.onclick = () => savePending(true);
      const so = u.$('#save-only', root); if (so) so.onclick = () => savePending(false);
      const ca = u.$('#cancel', root); if (ca) ca.onclick = () => { pending = null; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; draw(); };
      u.$('#change', root).onclick = () => { if (lib.length) { u.$('#library', root).scrollIntoView({ behavior: 'smooth' }); u.toast('Pick a character from your library, or import a new one.'); } else input.click(); };
      const rm = u.$('#remove', root);
      if (rm) rm.onclick = async () => { ML.settings.set({ activeCharacterId: null }); await ML.bg.refresh(); u.toast('Character removed from background. It is still saved in your library.', 'success'); draw(); };
      slider('#r-op', 'bgOpacity', '#v-op'); slider('#r-br', 'bgBrightness', '#v-br'); slider('#r-ov', 'bgOverlay', '#v-ov'); slider('#r-sz', 'bgSize', '#v-sz');
      u.$('#pos', root).onchange = (e) => { ML.settings.set({ bgPosition: e.target.value }); ML.bg.applyVars(ML.settings.get()); };
      u.$('#reset', root).onclick = async () => {
        if (!(await u.confirm('Reset to the default background? Your saved characters stay in your library.', { okLabel: 'Reset' }))) return;
        ML.settings.reset(['activeCharacterId', 'bgOpacity', 'bgBrightness', 'bgOverlay', 'bgSize', 'bgPosition']);
        await ML.bg.refresh(); u.toast('Default background restored.', 'success'); draw();
      };
      u.$$('[data-use]', root).forEach((b) => { b.onclick = async () => { ML.settings.set({ activeCharacterId: b.dataset.use }); await ML.bg.refresh(); u.toast('Background changed!', 'success'); draw(); }; });
      u.$$('[data-rename]', root).forEach((b) => { b.onclick = async () => {
        const c = lib.find((x) => x.id === b.dataset.rename);
        const name = await u.prompt('Rename character', 'New name', c.name, { maxLength: 40 });
        if (!name) return;
        try { await ML.chars.rename(user.id, c.id, name); u.toast('Renamed.', 'success'); draw(); } catch (e) { u.toast(e.message, 'error'); }
      }; });
      u.$$('[data-del]', root).forEach((b) => { b.onclick = async () => {
        const c = lib.find((x) => x.id === b.dataset.del);
        if (!(await u.confirm('Permanently delete “' + c.name + '” from your library? This cannot be undone.', { okLabel: 'Delete', danger: true }))) return;
        try { await ML.chars.remove(user.id, c.id); u.toast('Character deleted.', 'success'); draw(); } catch (e) { u.toast(e.message, 'error'); }
      }; });
    }
    await draw();
  };

  // =============================== PROFILE ===============================
  V.profile = async (root, params, { user }) => {
    const sum = user.role === 'student' ? await ML.progress.summary(user.id) : null;
    const pref = new Set(user.preferredSubjects || []);
    root.innerHTML = String(html`<div class="stack" style="max-width:900px;margin:0 auto">
      <div class="card row">${ML.avatarHTML(user, 'xl')}<div style="flex:1"><h2 style="font-size:24px;margin:0">${user.fullName}</h2><p class="muted">@${user.username} · ${user.role === 'teacher' ? 'Teacher' : user.level || 'Student'}</p>
        <div class="row"><label class="btn soft sm">📷 Change photo<input type="file" id="avatar" accept=".png,.jpg,.jpeg,.webp" class="sr-only"></label>${user.avatar ? html`<button class="btn ghost sm" id="rm-avatar">Remove photo</button>` : ''}</div></div></div>
      ${sum ? html`<div class="grid cols-4">
        <div class="stat"><span class="label">Lessons completed</span><span class="value">${sum.lessonsDone}</span></div>
        <div class="stat"><span class="label">Quizzes</span><span class="value">${sum.attempts.length}</span></div>
        <div class="stat"><span class="label">Average</span><span class="value">${sum.attempts.length ? sum.avg + '%' : '—'}</span></div>
        <a class="stat" href="#/progress" style="text-decoration:none;color:inherit"><span class="label">Full report</span><span class="value" style="font-size:20px">View progress →</span></a></div>` : ''}
      <form class="card" id="pf" novalidate><h2>Account details</h2><div class="form-msg"></div>
        <div class="form-grid">
          <label class="field"><span>Full name</span><input name="fullName" maxlength="60" value="${user.fullName}"><p class="field-error"></p></label>
          <label class="field"><span>Username (cannot be changed)</span><input value="${user.username}" disabled></label>
          <label class="field"><span>Email${ML.remote.enabled ? ' (used to log in — cannot be changed here)' : ''}</span><input name="email" type="email" maxlength="120" value="${user.email}" ${ML.remote.enabled ? u.trusted('disabled') : ''}><p class="field-error"></p></label>
          ${user.role === 'student' ? html`<label class="field"><span>Class / level</span><select name="level">${u.LEVELS.map((l) => html`<option ${user.level === l ? 'selected' : ''}>${l}</option>`)}</select></label>` : ''}
        </div>
        <fieldset style="border:0;padding:0;margin:0 0 14px"><legend class="small" style="font-weight:500;margin-bottom:6px">Preferred subjects</legend><div class="row">
          ${subjectsList().map((s) => html`<label class="check chip"><input type="checkbox" name="pref" value="${s}" ${pref.has(s) ? u.trusted('checked') : ''}> ${u.subjectIcon(s)} ${s}</label>`)}</div></fieldset>
        <button class="btn primary" type="submit">Save changes</button></form>
      <form class="card" id="pw" novalidate><h2>Change password</h2><div class="form-msg"></div>
        <div class="form-grid">
          <label class="field"><span>Current password</span><input name="current" type="password" autocomplete="current-password"></label>
          <label class="field"><span>New password</span><input name="next" type="password" autocomplete="new-password"></label>
          <label class="field"><span>Confirm new password</span><input name="confirm" type="password" autocomplete="new-password"></label>
        </div><button class="btn soft" type="submit">Update password</button></form>
      ${sum ? html`<div class="section-head"><h2>Quiz history</h2></div>${scoreTable(sum.attempts.slice(0, 10))}` : ''}
    </div>`);
    const pf = u.$('#pf', root);
    pf.onsubmit = async (e) => {
      e.preventDefault();
      const errs = {}; const n = ML.auth.RULES.fullName(pf.fullName.value); if (n) errs.fullName = n; const em = ML.auth.RULES.email(pf.email.value); if (em) errs.email = em;
      ML.fieldErrors(pf, errs); if (Object.keys(errs).length) return;
      const email = ML.remote.enabled ? user.email : pf.email.value.trim().toLowerCase();
      if (!ML.remote.enabled && (await db.all('users')).some((x) => x.id !== user.id && x.email === email)) { ML.fieldErrors(pf, { email: 'Another account uses this email.' }); return; }
      const prefs = u.$$('input[name=pref]:checked', pf).map((x) => x.value);
      await ML.users.update(user, { fullName: pf.fullName.value.trim(), email, level: pf.level ? pf.level.value : user.level, preferredSubjects: prefs });
      if (prefs[0] && !ML.settings.get().preferredSubject) ML.settings.set({ preferredSubject: prefs[0] });
      u.toast('Profile saved.', 'success'); ML.rerender();
    };
    const pw = u.$('#pw', root);
    pw.onsubmit = async (e) => {
      e.preventDefault();
      const msg = u.$('.form-msg', pw);
      try { await ML.auth.changePassword(await db.get('users', user.id), pw.current.value, pw.next.value, pw.confirm.value); pw.reset(); msg.className = 'form-msg show success'; msg.textContent = 'Password updated.'; }
      catch (err) { msg.className = 'form-msg show error'; msg.textContent = err.message; }
    };
    u.$('#avatar', root).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const p = await ML.chars.processImage(f, 256); await ML.users.update(user, { avatar: p.blob }); u.toast('Profile photo updated.', 'success'); ML.rerender(); }
      catch (err) { u.toast(err.message, 'error'); }
    };
    const rm = u.$('#rm-avatar', root); if (rm) rm.onclick = async () => { await ML.users.update(user, { avatar: null }); ML.rerender(); };
  };

  // =============================== SETTINGS ===============================
  V.settings = async (root, params, { user }) => {
    const s = ML.settings.get();
    const est = await db.estimate();
    const notifSupported = 'Notification' in window;
    root.innerHTML = String(html`<div class="stack" style="max-width:820px;margin:0 auto">
      <div class="card stack"><h2>🎨 Appearance</h2>
        <div class="tabs" role="radiogroup" aria-label="Theme"><button data-theme-set="light" class="${s.theme === 'light' ? 'active' : ''}">☀️ Light</button><button data-theme-set="dark" class="${s.theme === 'dark' ? 'active' : ''}">🌙 Dark</button></div>
        <p class="small muted">Switching theme keeps your character background.</p>
        <label class="check"><input type="checkbox" id="motion" ${s.reduceMotion ? u.trusted('checked') : ''}> Reduce animations</label>
        <a class="btn soft" href="#/character" style="align-self:flex-start">🎭 Character background settings</a>
      </div>
      <div class="card stack"><h2>📚 Learning</h2>
        <label class="field"><span>Preferred subject (shown first on your dashboard)</span><select id="pref"><option value="">No preference</option>${subjectsList().map((x) => html`<option ${s.preferredSubject === x ? 'selected' : ''}>${x}</option>`)}</select></label>
      </div>
      <div class="card stack"><h2>🔔 Notifications</h2>
        <p class="small muted">In-app notifications are always on. Browser notifications appear when the app is open in a background tab.</p>
        ${notifSupported ? html`<label class="check"><input type="checkbox" id="push" ${s.browserNotifications && Notification.permission === 'granted' ? u.trusted('checked') : ''}> Show browser notifications ${Notification.permission === 'denied' ? html`<span class="badge bad">Blocked in browser settings</span>` : ''}</label>`
          : html`<p class="badge warn">This browser does not support notifications.</p>`}
      </div>
      <div class="card stack"><h2>💾 Storage</h2>
        ${ML.remote.enabled ? html`<p>Your account, lessons, quiz results and characters are saved <b>online</b> and available on any device you log in from. Theme and background settings are saved per device.</p>`
          : html`<p>All your data is stored <b>only in this browser on this device</b>. It is not synced to other devices, and clearing browser data deletes it.</p>`}
        ${est ? html`<p class="small muted">Using about ${(est.usage / 1048576).toFixed(1)} MB of ${(est.quota / 1048576).toFixed(0)} MB available to this app.</p>` : ''}
        ${ML.prefs.available ? '' : html`<p class="badge warn">Browser storage for settings is blocked — settings will reset when you close the app.</p>`}
      </div>
      <div class="card stack"><h2>⚠️ Account</h2>
        <div class="row"><button class="btn ghost" id="logout">Log out</button><button class="btn danger" id="delete">Delete my account</button></div>
      </div></div>`);
    u.$$('[data-theme-set]', root).forEach((b) => { b.onclick = () => { ML.settings.set({ theme: b.dataset.themeSet }); ML.applyTheme(b.dataset.themeSet); ML.updateThemeButton(); u.$$('[data-theme-set]', root).forEach((x) => x.classList.toggle('active', x === b)); }; });
    u.$('#motion', root).onchange = (e) => { ML.settings.set({ reduceMotion: e.target.checked }); document.documentElement.classList.toggle('reduce-motion', e.target.checked); };
    u.$('#pref', root).onchange = (e) => { ML.settings.set({ preferredSubject: e.target.value }); u.toast('Preferred subject saved.', 'success'); };
    const push = u.$('#push', root);
    if (push) push.onchange = async () => {
      if (push.checked) {
        const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
        if (perm !== 'granted') { push.checked = false; u.toast('Permission was not granted, so browser notifications stay off.', 'error'); ML.settings.set({ browserNotifications: false }); return; }
      }
      ML.settings.set({ browserNotifications: push.checked });
      u.toast('Browser notifications ' + (push.checked ? 'on' : 'off') + '.', 'success');
    };
    u.$('#logout', root).onclick = () => ML.logout();
    u.$('#delete', root).onclick = async () => {
      if (user.role === 'teacher' && (await db.byIndex('users', 'role', 'teacher')).length < 2) { u.toast('You are the only teacher. Create another teacher account before deleting this one.', 'error'); return; }
      const typed = await u.prompt('Delete account', 'Type your username (' + user.username + ') to permanently delete your account and all your data', '', { okLabel: 'Delete forever', check: (v) => (v.toLowerCase() === user.username ? '' : 'Username does not match.') });
      if (!typed) return;
      if (ML.remote.enabled) {
        try { await ML.remote.deleteAccount(); ML.prefs.remove('settings.' + user.id); await ML.logout(); }
        catch (e) { u.toast(e.message, 'error'); }
        return;
      }
      const uid = user.id;
      const [att, prog, chars, notes, sessions, qs] = await Promise.all([db.byIndex('attempts', 'userId', uid), db.byIndex('progress', 'userId', uid), db.byIndex('characters', 'userId', uid), db.byIndex('notifications', 'userId', uid), db.all('sessions'), db.byIndex('questions', 'ownerId', uid)]);
      await db.delMany('attempts', att.map((x) => x.id)); await db.delMany('progress', prog.map((x) => x.id)); await db.delMany('characters', chars.map((x) => x.id));
      await db.delMany('notifications', notes.map((x) => x.id)); await db.delMany('sessions', sessions.filter((x) => x.userId === uid).map((x) => x.token));
      if (user.role === 'student') await db.delMany('questions', qs.map((x) => x.id));
      await db.del('users', uid); ML.prefs.remove('settings.' + uid);
      await ML.logout();
    };
  };

  // =============================== NOTIFICATIONS ===============================
  V.notifications = async (root, params, { user }) => {
    const list = await ML.notify.list(user.id);
    const icons = { lesson: '📗', quiz: '📝', deadline: '⏰', result: '🏅', reminder: '💡', info: 'ℹ️' };
    root.innerHTML = String(html`<div class="card stack" style="max-width:820px;margin:0 auto">
      <div class="row between"><h2 style="margin:0">Notifications</h2><div class="row"><button class="btn sm soft" id="all" ${list.some((n) => !n.read) ? '' : u.trusted('disabled')}>Mark all as read</button><button class="btn sm ghost" id="clear" ${list.length ? '' : u.trusted('disabled')}>Clear all</button></div></div>
      ${list.length ? html`<ul class="list">${list.map((n) => html`<li><div class="list-item ${n.read ? '' : 'unread'}"><span style="font-size:24px">${icons[n.type] || '🔔'}</span>
        <span class="grow"><span class="title">${n.title}</span><br><span class="small">${n.body}</span><br><span class="small muted">${u.fmtDate(n.createdAt, true)}</span></span>
        <span class="row">${n.link ? html`<button class="btn sm primary" data-open="${n.id}">Open</button>` : ''}${n.read ? '' : html`<button class="btn sm ghost" data-read="${n.id}">Mark read</button>`}</span></div></li>`)}</ul>`
        : empty('🔕', 'You\'re all caught up', 'New lessons, assigned quizzes, deadlines and results will appear here.')}</div>`);
    const byId = Object.fromEntries(list.map((n) => [n.id, n]));
    u.$$('[data-read]', root).forEach((b) => { b.onclick = async () => { await ML.notify.markRead(user.id, b.dataset.read); ML.rerender(); }; });
    u.$$('[data-open]', root).forEach((b) => { b.onclick = async () => { await ML.notify.markRead(user.id, b.dataset.open); const l = byId[b.dataset.open].link; if (/^#\/[\w/?=&%.-]*$/.test(l)) location.hash = l; }; });
    const all = u.$('#all', root); all.onclick = async () => { await ML.notify.markAll(user.id); ML.rerender(); };
    const clr = u.$('#clear', root); clr.onclick = async () => { if (await u.confirm('Clear all notifications? This cannot be undone.', { okLabel: 'Clear all', danger: true })) { await ML.notify.clear(user.id); ML.rerender(); } };
  };
})();
