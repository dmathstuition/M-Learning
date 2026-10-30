/* M Learning App — router, layout and start-up. */
(function () {
  'use strict';
  const ML = (window.ML = window.ML || {});
  const { u, auth, settings, notify } = ML;
  const { html } = u;
  const V = ML.views;

  // [pattern, view, options]. roles: who may open it. public: no login needed.
  const ROUTES = [
    ['/login', V.login, { public: true, bare: true }],
    ['/register', V.register, { public: true, bare: true }],
    ['/setup', V.setup, { public: true, bare: true }],
    ['/home', V.home, { title: 'Home' }],
    ['/courses', V.courses, { title: 'Course Library' }],
    ['/course/:id', V.course, { title: 'Course' }],
    ['/lesson/:id', V.lesson, { title: 'Lesson' }],
    ['/quizzes', V.quizzes, { title: 'Quizzes' }],
    ['/quiz/:id', V.quiz, { title: 'Quiz' }],
    ['/result/:id', V.result, { title: 'Quiz Result' }],
    ['/progress', V.progress, { title: 'My Progress', roles: ['student'] }],
    ['/character', V.character, { title: 'My Character' }],
    ['/profile', V.profile, { title: 'Profile' }],
    ['/settings', V.settings, { title: 'Settings' }],
    ['/notifications', V.notifications, { title: 'Notifications' }],
    ['/bank', V.bank, { title: 'Question Bank' }],
    ['/import', V.importQuestions, { title: 'Import Questions' }],
    ['/teacher', V.teacherHome, { title: 'Teacher Dashboard', roles: ['teacher'] }],
    ['/teacher/courses', V.teacherCourses, { title: 'Manage Courses', roles: ['teacher'] }],
    ['/teacher/course/:id', V.teacherCourse, { title: 'Edit Course', roles: ['teacher'] }],
    ['/teacher/lesson/:id', V.teacherLesson, { title: 'Edit Lesson', roles: ['teacher'] }],
    ['/teacher/quizzes', V.teacherQuizzes, { title: 'Manage Quizzes', roles: ['teacher'] }],
    ['/teacher/quiz/:id', V.quizBuilder, { title: 'Quiz Builder', roles: ['teacher'] }],
    ['/teacher/results', V.teacherResults, { title: 'Results', roles: ['teacher'] }],
    ['/teacher/students', V.teacherStudents, { title: 'Students', roles: ['teacher'] }],
    ['/teacher/student/:id', V.teacherStudent, { title: 'Student Progress', roles: ['teacher'] }],
  ];

  function match(path) {
    for (const [pattern, view, opts] of ROUTES) {
      const pp = pattern.split('/'), xp = path.split('/');
      if (pp.length !== xp.length) continue;
      const params = {};
      if (pp.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = decodeURIComponent(xp[i])), true) : p === xp[i]))) return { view, opts, params };
    }
    return null;
  }

  const NAV = {
    student: [
      ['Learn', [['#/home', '🏠', 'Home'], ['#/courses', '📚', 'Courses'], ['#/quizzes', '📝', 'Quizzes'], ['#/bank', '🗂️', 'Question Library'], ['#/progress', '📈', 'Progress']]],
      ['Me', [['#/character', '🎭', 'My Character'], ['#/notifications', '🔔', 'Notifications', 'notif'], ['#/profile', '👤', 'Profile'], ['#/settings', '⚙️', 'Settings']]],
    ],
    teacher: [
      ['Teach', [['#/teacher', '🧑‍🏫', 'Teacher Dashboard'], ['#/teacher/courses', '🏗️', 'Manage Courses'], ['#/bank', '🗂️', 'Question Bank'], ['#/import', '📥', 'Import Questions'], ['#/teacher/quizzes', '📝', 'Quizzes'], ['#/teacher/results', '📊', 'Results'], ['#/teacher/students', '👥', 'Students']]],
      ['Browse', [['#/courses', '📚', 'Course Library']]],
      ['Me', [['#/character', '🎭', 'My Character'], ['#/notifications', '🔔', 'Notifications', 'notif'], ['#/profile', '👤', 'Profile'], ['#/settings', '⚙️', 'Settings']]],
    ],
  };
  const BOTTOM = {
    student: [['#/home', '🏠', 'Home'], ['#/courses', '📚', 'Courses'], ['#/quizzes', '📝', 'Quizzes'], ['#/character', '🎭', 'Character'], ['#/progress', '📈', 'Progress']],
    teacher: [['#/teacher', '🧑‍🏫', 'Dashboard'], ['#/bank', '🗂️', 'Bank'], ['#/teacher/quizzes', '📝', 'Quizzes'], ['#/teacher/results', '📊', 'Results'], ['#/character', '🎭', 'Character']],
  };

  function avatarHTML(user, cls) {
    const url = ML.users.url(user);
    const initials = (user.fullName || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
    return url ? html`<span class="avatar ${cls || ''}"><img src="${url}" alt="${user.fullName}"></span>` : html`<span class="avatar ${cls || ''}" aria-hidden="true">${initials}</span>`;
  }
  ML.avatarHTML = avatarHTML;

  function renderShell(user) {
    const app = u.$('#app');
    const nav = NAV[user.role];
    app.innerHTML = String(html`
      <div class="shell">
        <aside class="sidebar" id="sidebar" aria-label="Main navigation">
          <a class="brand" href="${user.role === 'teacher' ? '#/teacher' : '#/home'}"><span class="brand-logo">M</span><span><b>M Learning</b><small>Learn • Grow • Achieve</small></span></a>
          ${nav.map(([label, items]) => html`<div class="nav-label">${label}</div><nav class="nav">${items.map(([href, ico, text, badge]) =>
            html`<a href="${href}" data-nav><span class="ico">${ico}</span>${text}${badge ? html`<span class="count" data-badge="${badge}" hidden></span>` : ''}</a>`)}</nav>`)}
          <nav class="nav"><a href="#" id="logout-link"><span class="ico">🚪</span>Log out</a></nav>
          <div class="sidebar-foot">Signed in as <b>${user.username}</b> (${user.role}).<br>Data is stored on this device only.</div>
        </aside>
        <main class="main">
          <div class="topbar">
            <button class="round-btn menu-btn" id="menu-btn" aria-label="Open menu">☰</button>
            <button class="round-btn" id="back-btn" aria-label="Go back">←</button>
            <h1 id="page-title">M Learning</h1>
            <a class="round-btn" href="#/notifications" aria-label="Notifications">🔔<span class="dot" data-badge="notif" hidden></span></a>
            <button class="round-btn ring" id="theme-btn" aria-label="Toggle dark mode"></button>
            <a href="#/profile" class="avatar-link" aria-label="Profile">${avatarHTML(user)}</a>
          </div>
          <div id="view"></div>
        </main>
      </div>
      <nav class="bottom-nav" aria-label="Quick navigation">${BOTTOM[user.role].map(([href, ico, text]) => html`<a href="${href}" data-nav><span class="ico">${ico}</span>${text}</a>`)}</nav>`);
    u.$('#logout-link').onclick = async (e) => { e.preventDefault(); if (await u.confirm('Log out of M Learning?', { okLabel: 'Log out' })) await logout(); };
    u.$('#back-btn').onclick = () => { if (history.length > 1) history.back(); else location.hash = '#/home'; };
    u.$('#theme-btn').onclick = () => toggleTheme();
    u.$('#menu-btn').onclick = () => toggleMenu(true);
    updateThemeButton();
    shellUser = user.id + ':' + user.role + ':' + (user.avatar ? user.avatar.size : 0) + ':' + user.fullName;
  }
  function toggleMenu(open) {
    const sb = u.$('#sidebar'); if (!sb) return;
    sb.classList.toggle('open', open);
    let scrim = u.$('.scrim');
    if (open && !scrim) { scrim = document.createElement('div'); scrim.className = 'scrim'; scrim.onclick = () => toggleMenu(false); document.body.appendChild(scrim); }
    if (!open && scrim) scrim.remove();
  }
  function toggleTheme() {
    const t = settings.get().theme === 'dark' ? 'light' : 'dark';
    settings.set({ theme: t }); ML.applyTheme(t); updateThemeButton();
    // character background is a separate layer, so it stays exactly as it was
  }
  function updateThemeButton() { const b = u.$('#theme-btn'); if (b) b.textContent = settings.get().theme === 'dark' ? '☀️' : '🌙'; }
  ML.updateThemeButton = updateThemeButton;

  async function refreshBadges(user) {
    const n = await notify.unread(user.id).catch(() => 0);
    u.$$('[data-badge="notif"]').forEach((el) => { el.hidden = !n; el.textContent = n > 99 ? '99+' : String(n); });
  }
  ML.refreshBadges = async () => { const me = await auth.currentUser(); if (me) refreshBadges(me); };

  async function logout() {
    ML.leaveGuard = null;
    await auth.logout();
    settings.userId = null;
    ML.applyTheme(settings.get().theme);
    await ML.bg.refresh();
    shellUser = null;
    u.toast('You have been logged out.', 'success');
    location.hash = '#/login';
  }

  let shellUser = null;
  let ignoreNext = false;
  let lastHash = '';
  async function route() {
    if (ignoreNext) { ignoreNext = false; return; }
    let path = (location.hash || '').replace(/^#/, '') || '';
    // guard: leaving an in-progress quiz
    if (ML.leaveGuard && location.hash !== lastHash) {
      const ok = await ML.leaveGuard();
      if (!ok) { ignoreNext = true; location.hash = lastHash; return; }
      ML.leaveGuard = null;
    }
    const user = await auth.currentUser(true);
    settings.userId = user ? user.id : null;
    if (!path || path === '/') path = user ? (user.role === 'teacher' ? '/teacher' : '/home') : '/login';
    const qs = path.includes('?') ? path.slice(path.indexOf('?') + 1) : '';
    path = path.split('?')[0];
    const m = match(path);
    if (m) m.params.query = new URLSearchParams(qs);
    if (!m) { location.replace('#' + (user ? (user.role === 'teacher' ? '/teacher' : '/home') : '/login')); return; }
    if (!m.opts.public && !user) { location.replace('#/login'); return; }
    if (m.opts.public && user) { location.replace(user.role === 'teacher' ? '#/teacher' : '#/home'); return; }
    if (m.opts.roles && !m.opts.roles.includes(user.role)) {
      u.toast(user.role === 'student' ? 'That page is for teachers only.' : 'That page is for students.', 'error');
      location.replace(user.role === 'teacher' ? '#/teacher' : '#/home'); return;
    }
    lastHash = location.hash;
    if (ML.onLeave) { const f = ML.onLeave; ML.onLeave = null; try { await f(); } catch (e) { console.warn(e); } }
    ML.applyTheme(settings.get().theme);
    document.documentElement.classList.toggle('reduce-motion', !!settings.get().reduceMotion);
    toggleMenu(false);
    let root;
    if (m.opts.bare) { shellUser = null; root = u.$('#app'); root.innerHTML = ''; }
    else {
      const sig = user.id + ':' + user.role + ':' + (user.avatar ? user.avatar.size : 0) + ':' + user.fullName;
      if (shellUser !== sig) renderShell(user);
      root = u.$('#view');
      u.$('#page-title').textContent = m.opts.title || 'M Learning';
      u.$$('[data-nav]').forEach((a) => {
        const href = a.getAttribute('href').slice(1);
        a.classList.toggle('active', path === href || (href !== '/home' && href !== '/teacher' && path.startsWith(href + '/')));
      });
      root.innerHTML = '<div class="loading"><div><div class="spinner"></div>Loading…</div></div>';
      refreshBadges(user);
    }
    document.title = (m.opts.title ? m.opts.title + ' · ' : '') + 'M Learning App';
    await ML.bg.refresh();
    try {
      await m.view(root, m.params, { user, setTitle: (t) => { const h = u.$('#page-title'); if (h) h.textContent = t; document.title = t + ' · M Learning App'; } });
    } catch (e) {
      console.error(e);
      root.innerHTML = String(html`<div class="card empty"><span class="big">😵</span><h2>Something went wrong</h2><p>${e.message || String(e)}</p><a class="btn primary" href="#/home">Go home</a></div>`);
    }
    window.scrollTo(0, 0);
  }
  ML.navigate = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
  ML.rerender = () => route();
  ML.logout = logout;

  async function start() {
    ML.applyTheme(settings.get().theme);
    try {
      await ML.db.open();
      await ML.seed.run();
    } catch (e) {
      u.$('#app').innerHTML = String(html`<div class="fatal card"><h1>Storage unavailable</h1><p>${e.message}</p>
        <p class="muted">M Learning saves lessons, quizzes and characters in your browser's IndexedDB storage. It may be blocked in private/incognito mode or by browser settings. Please open the app in a normal browser window.</p></div>`);
      return;
    }
    if (!auth.cryptoReady()) {
      u.toast('Secure password hashing is unavailable here. Open the app via http://localhost (see README).', 'error');
    }
    // keep track of reading time on lessons etc.
    window.addEventListener('hashchange', route);
    window.addEventListener('beforeunload', (e) => { if (ML.leaveGuard) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleMenu(false); });
    const me = await auth.currentUser();
    if (me && me.role === 'student') notify.reminders(me).catch(() => {});
    if (!me && !(await auth.teacherExists()) && !location.hash.startsWith('#/register')) location.hash = '#/setup';
    route();
  }
  start();
})();
