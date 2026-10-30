/* M Learning App — services: settings, notifications, progress, courses and the quiz engine core. */
(function () {
  'use strict';
  const ML = (window.ML = window.ML || {});
  const { u, db, prefs, auth, Q } = ML;

  // ======================= SETTINGS (per user, small → localStorage) =======================
  const DEFAULTS = { theme: 'light', activeCharacterId: null, bgOpacity: 85, bgBrightness: 100, bgOverlay: 30, bgSize: 85, bgPosition: 'right',
    preferredSubject: '', browserNotifications: false, reduceMotion: false, recentLessons: [] };
  const settings = {
    userId: null,
    key() { return 'settings.' + (this.userId || 'guest'); },
    get() { return Object.assign({}, DEFAULTS, { theme: prefs.get('theme', DEFAULTS.theme) }, prefs.get(this.key(), {})); },
    set(patch) {
      const next = Object.assign(this.get(), patch);
      const ok = prefs.set(this.key(), next);
      if ('theme' in patch) prefs.set('theme', patch.theme);
      if (!ok) u.toast('Settings could not be saved permanently (browser storage is unavailable). They will reset when you close the app.', 'error');
      return next;
    },
    reset(keys) { const d = {}; keys.forEach((k) => { d[k] = DEFAULTS[k]; }); return this.set(d); },
    DEFAULTS,
  };
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#0b1020' : '#eef0fb';
  }

  // ======================= NOTIFICATIONS =======================
  const notify = {
    async add(userId, n) {
      const id = n.key ? 'n_' + userId + '_' + n.key : u.uid('n');
      if (n.key && (await db.get('notifications', id))) return null; // de-duplicate reminders
      const rec = { id, userId, type: n.type || 'info', title: n.title, body: n.body || '', link: n.link || '', read: false, createdAt: Date.now() };
      await db.put('notifications', rec);
      this.browserPush(userId, rec);
      return rec;
    },
    async list(userId) { return (await db.byIndex('notifications', 'userId', userId)).sort((a, b) => b.createdAt - a.createdAt); },
    async unread(userId) { return (await this.list(userId)).filter((n) => !n.read).length; },
    async markRead(userId, id) { const n = await db.get('notifications', id); if (n && n.userId === userId) { n.read = true; await db.put('notifications', n); } },
    async markAll(userId) { const l = await this.list(userId); await db.putMany('notifications', l.map((n) => Object.assign(n, { read: true }))); },
    async clear(userId) { const l = await this.list(userId); await db.delMany('notifications', l.map((n) => n.id)); },
    /** Real browser notifications only if the user enabled them AND granted permission. */
    browserPush(userId, rec) {
      try {
        if (settings.userId !== userId || !settings.get().browserNotifications) return;
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        if (!document.hidden) return; // the in-app bell already shows it
        new Notification('M Learning — ' + rec.title, { body: rec.body });
      } catch (e) { /* not supported on this browser (e.g. some mobile browsers) */ }
    },
    async toStudents(students, n) { for (const s of students) await this.add(s.id, n); },
    /** Create due-date and study reminders for a student (de-duplicated per day/quiz). */
    async reminders(user) {
      if (user.role !== 'student') return;
      const quizzes = await quizSvc.visibleFor(user);
      const attempts = await db.byIndex('attempts', 'userId', user.id);
      const done = new Set(attempts.map((a) => a.quizId));
      for (const qz of quizzes) {
        if (!qz.dueDate || done.has(qz.id)) continue;
        const left = qz.dueDate - Date.now();
        if (left > 0 && left < 2 * 86400000) {
          await this.add(user.id, { key: 'due_' + qz.id, type: 'deadline', title: 'Quiz due soon: ' + qz.title, body: 'Due ' + u.fmtDate(qz.dueDate, true) + '.', link: '#/quiz/' + qz.id });
        }
      }
      const last = Math.max(user.lastActiveAt || 0, ...attempts.map((a) => a.finishedAt || 0));
      if (Date.now() - last > 2 * 86400000) {
        await this.add(user.id, { key: 'remind_' + new Date().toISOString().slice(0, 10), type: 'reminder', title: 'Time to learn!', body: 'You haven\'t studied for a couple of days. A 10-minute lesson keeps your streak going.', link: '#/courses' });
      }
    },
  };

  // ======================= USERS =======================
  const users = {
    async students() { return (await db.byIndex('users', 'role', 'student')).sort((a, b) => a.fullName.localeCompare(b.fullName)); },
    async update(user, patch) {
      const fresh = await db.get('users', user.id);
      Object.assign(fresh, patch);
      await db.put('users', fresh);
      auth.setCached(fresh);
      return fresh;
    },
    avatarUrl: new Map(),
    url(user) {
      if (!user || !user.avatar) return '';
      const c = this.avatarUrl.get(user.id);
      if (c && c.blob === user.avatar) return c.url;
      if (c) URL.revokeObjectURL(c.url);
      const url = URL.createObjectURL(user.avatar);
      this.avatarUrl.set(user.id, { blob: user.avatar, url });
      return url;
    },
  };

  // ======================= COURSES & LESSONS =======================
  const courses = {
    async all() { return (await db.all('courses')).sort((a, b) => a.subject.localeCompare(b.subject) || u.LEVELS.indexOf(a.level) - u.LEVELS.indexOf(b.level)); },
    async lessons(courseId) { return (await db.byIndex('lessons', 'courseId', courseId)).sort((a, b) => a.order - b.order); },
    async allLessons() { return (await db.all('lessons')).sort((a, b) => a.order - b.order); },
    async saveCourse(c) {
      await auth.requireTeacher();
      const err = [];
      if (!c.title || c.title.trim().length < 3) err.push('Title must be at least 3 characters.');
      if (!c.subject) err.push('Choose a subject.');
      if (!c.level) err.push('Choose a class/level.');
      if (err.length) throw new Error(err.join(' '));
      c.title = c.title.trim().slice(0, 80); c.description = String(c.description || '').trim().slice(0, 400);
      return db.put('courses', c);
    },
    async deleteCourse(id) {
      await auth.requireTeacher();
      const ls = await this.lessons(id);
      await db.delMany('lessons', ls.map((l) => l.id));
      await db.del('courses', id);
    },
    async saveLesson(l, isNew) {
      const me = await auth.requireTeacher();
      if (!l.title || l.title.trim().length < 3) throw new Error('Lesson title must be at least 3 characters.');
      if (!l.topic || !l.topic.trim()) throw new Error('Lesson topic is required (it links the lesson to practice questions).');
      if (!l.body || l.body.trim().length < 20) throw new Error('Lesson content must be at least 20 characters.');
      const course = await db.get('courses', l.courseId);
      if (!course) throw new Error('Course not found.');
      Object.assign(l, { subject: course.subject, level: course.level, title: l.title.trim().slice(0, 100), topic: l.topic.trim().slice(0, 80), body: l.body.slice(0, 20000) });
      await db.put('lessons', l);
      if (isNew) {
        const studs = (await users.students()).filter((s) => !course.level || s.level === course.level);
        await notify.toStudents(studs, { type: 'lesson', title: 'New lesson: ' + l.title, body: course.subject + ' · ' + course.title + ' (added by ' + me.fullName + ')', link: '#/lesson/' + l.id });
      }
      return l;
    },
    async deleteLesson(id) { await auth.requireTeacher(); await db.del('lessons', id); },
    /** Parse "Problem: / Step: / Answer:" blocks from the teacher's lesson editor. */
    parseExamples(text) {
      return String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map((b) => {
        const ex = { problem: '', steps: [], answer: '' };
        b.split('\n').forEach((line) => {
          const m = line.match(/^\s*(problem|step|answer)\s*:\s*(.*)$/i);
          if (!m) { if (line.trim()) ex.steps.push(line.trim()); return; }
          const k = m[1].toLowerCase();
          if (k === 'step') ex.steps.push(m[2].trim()); else ex[k] = m[2].trim();
        });
        return ex;
      }).filter((e) => e.problem);
    },
    examplesToText(list) { return (list || []).map((e) => ['Problem: ' + e.problem].concat(e.steps.map((s) => 'Step: ' + s), ['Answer: ' + e.answer]).join('\n')).join('\n\n'); },
  };

  // ======================= PROGRESS =======================
  const progress = {
    async list(userId) { return db.byIndex('progress', 'userId', userId); },
    async completed(userId) { return (await this.list(userId)).filter((p) => p.type === 'lesson'); },
    async isComplete(userId, lessonId) { return !!(await db.get('progress', 'p_' + userId + '_' + lessonId)); },
    async complete(user, lesson) {
      await db.put('progress', { id: 'p_' + user.id + '_' + lesson.id, type: 'lesson', userId: user.id, lessonId: lesson.id, courseId: lesson.courseId, subject: lesson.subject, title: lesson.title, completedAt: Date.now() });
    },
    async uncomplete(user, lessonId) { await db.del('progress', 'p_' + user.id + '_' + lessonId); },
    async addTime(user, seconds) {
      if (!user || seconds < 5) return;
      const id = 't_' + user.id;
      const rec = (await db.get('progress', id)) || { id, type: 'time', userId: user.id, seconds: 0 };
      rec.seconds += Math.min(seconds, 1800); // cap idle tabs at 30 min per visit
      await db.put('progress', rec);
    },
    async studySeconds(userId) { const r = await db.get('progress', 't_' + userId); return r ? r.seconds : 0; },
    touchRecent(lessonId) {
      const s = settings.get();
      const list = [lessonId].concat((s.recentLessons || []).filter((x) => x !== lessonId)).slice(0, 6);
      settings.set({ recentLessons: list });
    },
    /** Summary used by the student dashboard, progress page and teacher views. */
    async summary(userId) {
      const [done, attempts, lessons, secs] = await Promise.all([this.completed(userId), db.byIndex('attempts', 'userId', userId), courses.allLessons(), this.studySeconds(userId)]);
      const marked = attempts.slice().sort((a, b) => b.finishedAt - a.finishedAt);
      const avg = marked.length ? Math.round(marked.reduce((s, a) => s + a.percent, 0) / marked.length) : 0;
      const bySubject = {};
      Object.keys(u.SUBJECTS).forEach((s) => { bySubject[s] = { total: 0, done: 0, quizzes: 0, avg: 0, sum: 0 }; });
      lessons.forEach((l) => { (bySubject[l.subject] = bySubject[l.subject] || { total: 0, done: 0, quizzes: 0, avg: 0, sum: 0 }).total++; });
      const doneIds = new Set(done.map((d) => d.lessonId));
      lessons.forEach((l) => { if (doneIds.has(l.id)) bySubject[l.subject].done++; });
      marked.forEach((a) => { const b = bySubject[a.subject]; if (b) { b.quizzes++; b.sum += a.percent; } });
      Object.values(bySubject).forEach((b) => { b.avg = b.quizzes ? Math.round(b.sum / b.quizzes) : 0; b.pct = u.pct(b.done, b.total); });
      const quizTime = attempts.reduce((s, a) => s + (a.timeTakenSec || 0), 0);
      return { lessonsDone: done.length, lessonsTotal: lessons.length, done, attempts: marked, avg, bySubject, studySeconds: secs + quizTime };
    },
  };

  // ======================= QUESTION BANK =======================
  const bank = {
    /** Teachers see the shared school bank; students see only their personal practice questions. */
    async visible(user) {
      const all = await db.all('questions');
      return user.role === 'teacher' ? all.filter((q) => q.ownerRole === 'teacher') : all.filter((q) => q.ownerId === user.id);
    },
    async save(user, q) {
      const ex = q.id ? await db.get('questions', q.id) : null;
      if (ex && !this.canEdit(user, ex)) throw new Error('You cannot edit this question.');
      if (user.role !== 'teacher') q.ownerId = user.id;
      q.updatedAt = Date.now();
      return db.put('questions', q);
    },
    canEdit(user, q) { return user.role === 'teacher' ? q.ownerRole === 'teacher' : q.ownerId === user.id; },
    async remove(user, ids) {
      const all = await Promise.all(ids.map((id) => db.get('questions', id)));
      const ok = all.filter((q) => q && this.canEdit(user, q)).map((q) => q.id);
      await db.delMany('questions', ok);
      return ok.length;
    },
    banks(list) { return Array.from(new Set(list.map((q) => q.bank || 'General'))).sort(); },
    topics(list, subject) { return Array.from(new Set(list.filter((q) => !subject || q.subject === subject).map((q) => q.topic))).sort(); },
  };

  // ======================= QUIZ ENGINE (data side) =======================
  // The quiz player UI only ever receives student-safe copies of questions (no answer key or
  // explanation). Answers are checked here. This keeps the answer key out of the rendered page,
  // but in a browser-only app it is not a security boundary — see README.
  const live = new Map(); // sessionId -> {quiz, full questions, user, locked}
  const quizSvc = {
    async all() { return (await db.all('quizzes')).filter((q) => q.status !== 'practice').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); },
    isAssigned(user, qz) {
      if (qz.status !== 'published') return false;
      const a = qz.assign || { type: 'all' };
      if (a.type === 'all') return true;
      if (a.type === 'level') return !!user.level && user.level === a.level;
      if (a.type === 'students') return (a.studentIds || []).includes(user.id);
      return false;
    },
    async visibleFor(user) { return (await this.all()).filter((qz) => this.isAssigned(user, qz)); },
    async canTake(user, qz) {
      if (!qz) return false;
      if (qz.status === 'practice') return qz.createdBy === user.id;
      if (user.role === 'teacher') return true; // preview/try
      return this.isAssigned(user, qz);
    },
    async start(user, quizId) {
      const qz = await db.get('quizzes', quizId);
      if (!qz) throw new Error('This quiz no longer exists.');
      if (!(await this.canTake(user, qz))) throw new Error('This quiz has not been assigned to you.');
      const qs = (await Promise.all(qz.questionIds.map((id) => db.get('questions', id)))).filter(Boolean);
      if (!qs.length) throw new Error('This quiz has no questions yet.');
      const ordered = qz.shuffle ? u.shuffle(qs) : qs;
      const sid = u.uid('qs');
      live.set(sid, { quiz: qz, questions: ordered, user, locked: {}, startedAt: Date.now() });
      return {
        sessionId: sid, missing: qz.questionIds.length - qs.length,
        quiz: { id: qz.id, title: qz.title, subject: qz.subject, description: qz.description, timeLimitMin: qz.timeLimitMin || 0, feedbackMode: qz.feedbackMode, practice: qz.status === 'practice' },
        questions: ordered.map((q) => Q.stripForStudent(q, (qz.marks || {})[q.id])),
      };
    },
    /** Immediate-feedback mode only: lock the answer and reveal the result for this question. */
    check(sessionId, qid, given) {
      const s = live.get(sessionId);
      if (!s) throw new Error('Quiz session expired. Restart the quiz.');
      if (s.quiz.feedbackMode !== 'immediate') throw new Error('Feedback is shown after you submit this quiz.');
      const q = s.questions.find((x) => x.id === qid);
      if (!q) throw new Error('Question not found.');
      if (!(qid in s.locked)) s.locked[qid] = given;
      const g = s.locked[qid];
      const r = Q.mark(q, g);
      return { correct: r, correctText: Q.correctText(q), explanation: q.explanation || '', given: g };
    },
    discard(sessionId) { live.delete(sessionId); },
    async submit(sessionId, answers, opts) {
      const s = live.get(sessionId);
      if (!s) throw new Error('Quiz session expired. Restart the quiz.');
      const { quiz, questions, user } = s;
      const rows = questions.map((q) => {
        const given = q.id in s.locked ? s.locked[q.id] : answers[q.id];
        const marks = Number((quiz.marks || {})[q.id] || q.marks || 1);
        const correct = Q.mark(q, given);
        return { qid: q.id, type: q.type, text: q.text, options: q.options || [], topic: q.topic, given: given == null ? '' : given,
          givenText: Q.givenText(q, given), correct, correctText: Q.correctText(q), explanation: q.explanation || '',
          marks, awarded: correct === true ? marks : 0 };
      });
      const attempt = this.tally({
        id: u.uid('at'), quizId: quiz.id, quizTitle: quiz.title, subject: quiz.subject, userId: user.id, userName: user.fullName, userLevel: user.level || '',
        practice: quiz.status === 'practice', startedAt: s.startedAt, finishedAt: Date.now(),
        timerEnabled: !!quiz.timeLimitMin, timeLimitMin: quiz.timeLimitMin || 0, timeTakenSec: Math.round((Date.now() - s.startedAt) / 1000),
        autoSubmitted: !!(opts && opts.auto), answers: rows,
      });
      live.delete(sessionId);
      // Teacher "try it" runs are previews: shown once, never stored in results.
      attempt.preview = user.role === 'teacher' && !attempt.practice;
      if (attempt.preview) return attempt;
      await db.put('attempts', attempt);
      if (!attempt.practice) {
        await notify.add(user.id, { type: 'result', title: 'Result: ' + quiz.title, body: attempt.status === 'pending-review'
          ? 'Scored ' + attempt.score + '/' + attempt.maxScore + ' so far — written answers are waiting for your teacher.'
          : 'You scored ' + attempt.percent + '% (' + attempt.score + '/' + attempt.maxScore + ').', link: '#/result/' + attempt.id });
      }
      return attempt;
    },
    tally(a) {
      const rows = a.answers;
      a.totalQuestions = rows.length;
      a.correctCount = rows.filter((r) => r.correct === true).length;
      a.incorrectCount = rows.filter((r) => r.correct === false).length;
      a.pendingCount = rows.filter((r) => r.correct === null).length;
      a.score = Math.round(rows.reduce((s, r) => s + (r.awarded || 0), 0) * 100) / 100;
      a.maxScore = rows.reduce((s, r) => s + r.marks, 0);
      a.percent = u.pct(a.score, a.maxScore);
      a.status = a.pendingCount ? 'pending-review' : 'marked';
      return a;
    },
    /** Teacher marks written answers. awards: {qid: marks} */
    async grade(attemptId, awards) {
      const me = await auth.requireTeacher();
      const a = await db.get('attempts', attemptId);
      if (!a) throw new Error('Attempt not found.');
      a.answers.forEach((r) => {
        if (!(r.qid in awards)) return;
        const m = Math.max(0, Math.min(r.marks, Number(awards[r.qid]) || 0));
        r.awarded = m; r.correct = m > 0; r.teacherMarked = true;
      });
      this.tally(a); a.gradedBy = me.fullName; a.gradedAt = Date.now();
      await db.put('attempts', a);
      await notify.add(a.userId, { type: 'result', title: 'Marked: ' + a.quizTitle, body: 'Your teacher marked your written answers. Final score ' + a.percent + '%.', link: '#/result/' + a.id });
      return a;
    },
    async createPractice(user, { title, subject, questionIds }) {
      if (!questionIds.length) throw new Error('No practice questions available for this topic yet.');
      // keep only one practice quiz per user/title to avoid clutter
      const existing = (await db.all('quizzes')).filter((q) => q.status === 'practice' && q.createdBy === user.id);
      await db.delMany('quizzes', existing.filter((q) => q.title === title).map((q) => q.id));
      const qz = { id: u.uid('pq'), title, subject, level: user.level || '', description: 'Practice — instant feedback', questionIds: u.shuffle(questionIds).slice(0, 15),
        marks: {}, timeLimitMin: 0, feedbackMode: 'immediate', shuffle: false, status: 'practice', assign: { type: 'students', studentIds: [user.id] }, createdBy: user.id, createdAt: Date.now() };
      await db.put('quizzes', qz);
      return qz;
    },
    async save(qz, publishing) {
      const me = await auth.requireTeacher();
      if (!qz.title || qz.title.trim().length < 3) throw new Error('Quiz title must be at least 3 characters.');
      if (!qz.questionIds.length) throw new Error('Select at least one question.');
      if (qz.timeLimitMin && (qz.timeLimitMin < 1 || qz.timeLimitMin > 300)) throw new Error('Time limit must be between 1 and 300 minutes (or 0 for no timer).');
      if (qz.assign.type === 'students' && !qz.assign.studentIds.length) throw new Error('Choose at least one student, or assign to a class/all students.');
      if (qz.assign.type === 'level' && !qz.assign.level) throw new Error('Choose a class to assign the quiz to.');
      const wasPublished = (await db.get('quizzes', qz.id) || {}).status === 'published';
      qz.title = qz.title.trim().slice(0, 100);
      if (publishing) { qz.status = 'published'; qz.publishedAt = qz.publishedAt || Date.now(); }
      qz.updatedAt = Date.now(); qz.createdBy = qz.createdBy || me.id;
      await db.put('quizzes', qz);
      if (publishing && !wasPublished) {
        const studs = (await users.students()).filter((s) => this.isAssigned(s, qz));
        await notify.toStudents(studs, { type: 'quiz', title: 'New quiz: ' + qz.title, body: (qz.dueDate ? 'Due ' + u.fmtDate(qz.dueDate, true) + '. ' : '') + qz.questionIds.length + ' questions' + (qz.timeLimitMin ? ', ' + qz.timeLimitMin + ' min timer.' : '.'), link: '#/quiz/' + qz.id });
      }
      return qz;
    },
    async remove(id) { await auth.requireTeacher(); await db.del('quizzes', id); },
    async attemptsFor(user) {
      if (user.role === 'teacher') return (await db.all('attempts')).filter((a) => !a.practice).sort((a, b) => b.finishedAt - a.finishedAt);
      return (await db.byIndex('attempts', 'userId', user.id)).sort((a, b) => b.finishedAt - a.finishedAt);
    },
    async attempt(user, id) {
      const a = await db.get('attempts', id);
      if (!a) return null;
      if (user.role !== 'teacher' && a.userId !== user.id) return null; // students see only their own
      return a;
    },
  };

  ML.settings = settings; ML.applyTheme = applyTheme; ML.notify = notify; ML.users = users;
  ML.courses = courses; ML.progress = progress; ML.bank = bank; ML.quizSvc = quizSvc;
})();
