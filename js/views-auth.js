/* M Learning App — login, registration and first-run teacher setup. */
(function () {
  'use strict';
  const ML = (window.ML = window.ML || {});
  const V = (ML.views = ML.views || {});
  const { u, auth } = ML;
  const { html } = u;

  // App-made SVG mascot ("Professor Hoot") — static markup, no user data.
  const MASCOT = u.trusted(`<svg class="mascot" viewBox="0 0 160 150" role="img" aria-label="Professor Hoot, the M Learning owl">
    <ellipse cx="80" cy="140" rx="46" ry="7" fill="rgba(80,60,160,.15)"/>
    <path d="M38 70 Q36 130 80 136 Q124 130 122 70 Q120 40 80 38 Q40 40 38 70Z" fill="#c9824a"/>
    <path d="M52 92 Q80 140 108 92 Q104 128 80 130 Q56 128 52 92Z" fill="#f3d3a8"/>
    <circle cx="62" cy="72" r="18" fill="#fff" stroke="#e46a4c" stroke-width="5"/><circle cx="98" cy="72" r="18" fill="#fff" stroke="#e46a4c" stroke-width="5"/>
    <path d="M54 74 Q62 66 70 74" stroke="#2b2b3b" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M90 74 Q98 66 106 74" stroke="#2b2b3b" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M80 80 L74 90 L86 90Z" fill="#f2a516"/>
    <path d="M44 36 L80 22 L116 36 L80 50Z" fill="#2c3460"/><rect x="62" y="40" width="36" height="12" rx="3" fill="#2c3460"/>
    <path d="M116 36 L118 58" stroke="#f2a516" stroke-width="3"/><circle cx="118" cy="60" r="4" fill="#f2a516"/>
    <text x="10" y="40" font-family="Outfit,Arial" font-size="14" fill="#f08a24" transform="rotate(-18 20 40)">E=mc²</text>
    <path d="M136 92 h10 M141 87 v10" stroke="#5b8cff" stroke-width="4" stroke-linecap="round"/></svg>`);
  ML.MASCOT = MASCOT;

  function fieldErrors(form, errors) {
    u.$$('.field', form).forEach((f) => { f.classList.remove('invalid'); const p = u.$('.field-error', f); if (p) p.textContent = ''; });
    Object.entries(errors || {}).forEach(([name, msg]) => {
      const input = form.elements[name]; if (!input) return;
      const f = input.closest('.field'); f.classList.add('invalid');
      const p = u.$('.field-error', f); if (p) p.textContent = msg;
      input.setAttribute('aria-invalid', 'true');
    });
    const first = Object.keys(errors || {})[0];
    if (first && form.elements[first]) form.elements[first].focus();
  }
  function formMsg(form, text, kind) { const m = u.$('.form-msg', form); m.textContent = text; m.className = 'form-msg show ' + kind; }
  ML.fieldErrors = fieldErrors;

  const F = (name, label, type, extra) => html`<label class="field"><span>${label}</span>
    <input name="${name}" type="${type}" ${u.trusted(extra || '')}><p class="field-error" aria-live="polite"></p></label>`;

  function banner() {
    return html`<p class="small muted center" style="margin-top:14px">🔒 Accounts and data are stored <b>only in this browser on this device</b>. They are not synced online.</p>`;
  }

  V.login = async (root) => {
    const hasTeacher = await auth.teacherExists();
    root.innerHTML = String(html`<div class="auth-wrap"><form class="auth-card" novalidate>
      <div class="brand"><span class="brand-logo">M</span><span><b>M Learning</b><small>Learn • Grow • Achieve</small></span></div>
      ${MASCOT}
      <h1>Welcome back!</h1>
      <div class="form-msg" role="alert"></div>
      ${F('username', 'Username', 'text', 'autocomplete="username" autocapitalize="none" required')}
      ${F('password', 'Password', 'password', 'autocomplete="current-password" required')}
      <label class="check"><input type="checkbox" name="remember" checked> Keep me signed in for 7 days</label>
      <button class="btn primary" style="width:100%;margin-top:12px" type="submit">Log in</button>
      <p class="switch">New student? <a href="#/register">Create an account</a></p>
      <details class="small muted"><summary>Forgot your password?</summary>
        <p>This version has no email server, so automatic password recovery is not available. Ask your teacher to reset your password from <b>Teacher Dashboard → Students</b>.</p></details>
      ${hasTeacher ? '' : html`<p class="switch">First time on this device? <a href="#/setup">Set up a teacher account</a></p>`}
      ${banner()}
    </form></div>`);
    const form = u.$('form', root);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const errors = {};
      if (!form.username.value.trim()) errors.username = 'Enter your username.';
      if (!form.password.value) errors.password = 'Enter your password.';
      fieldErrors(form, errors);
      if (Object.keys(errors).length) return;
      const btn = u.$('button[type=submit]', form);
      u.setBusy(btn, true, 'Checking…');
      try {
        const user = await auth.login(form.username.value, form.password.value, form.remember.checked);
        formMsg(form, 'Welcome, ' + user.fullName + '!', 'success');
        if (user.role === 'student') ML.notify.reminders(user).catch(() => {});
        location.hash = user.role === 'teacher' ? '#/teacher' : '#/home';
      } catch (err) { formMsg(form, err.message, 'error'); form.password.value = ''; form.password.focus(); }
      finally { u.setBusy(btn, false); }
    };
  };

  function accountForm(title, intro, submitLabel, extra) {
    return html`<div class="auth-wrap"><form class="auth-card" novalidate>
      <div class="brand"><span class="brand-logo">M</span><span><b>M Learning</b><small>Learn • Grow • Achieve</small></span></div>
      <h1>${title}</h1><p class="muted center">${intro}</p>
      <div class="form-msg" role="alert"></div>
      ${F('fullName', 'Full name', 'text', 'autocomplete="name" maxlength="60" required')}
      ${F('username', 'Username', 'text', 'autocomplete="username" autocapitalize="none" maxlength="20" required')}
      ${F('email', 'Email address', 'email', 'autocomplete="email" maxlength="120" required')}
      ${extra || ''}
      ${F('password', 'Password (8+ characters, with a letter and a number)', 'password', 'autocomplete="new-password" maxlength="128" required')}
      ${F('confirm', 'Confirm password', 'password', 'autocomplete="new-password" maxlength="128" required')}
      <button class="btn primary" style="width:100%;margin-top:8px" type="submit">${submitLabel}</button>
      <p class="switch">Already have an account? <a href="#/login">Log in</a></p>
      ${banner()}
    </form></div>`;
  }
  async function handleCreate(form, role) {
    const data = { fullName: form.fullName.value, username: form.username.value, email: form.email.value, password: form.password.value, confirm: form.confirm.value, level: form.level ? form.level.value : '' };
    const errors = auth.validateAccount(data);
    fieldErrors(form, errors);
    if (Object.keys(errors).length) { formMsg(form, 'Please fix the highlighted fields.', 'error'); return; }
    const btn = u.$('button[type=submit]', form);
    u.setBusy(btn, true, 'Creating account…');
    try {
      await auth.createAccount(data, role);
      formMsg(form, 'Account created! Signing you in…', 'success');
      await auth.login(data.username, data.password, false);
      u.toast('Welcome to M Learning, ' + data.fullName.trim() + '!', 'success');
      location.hash = role === 'teacher' ? '#/teacher' : '#/home';
    } catch (err) { fieldErrors(form, err.fields || {}); formMsg(form, err.message, 'error'); }
    finally { u.setBusy(btn, false); }
  }

  V.register = async (root) => {
    const levelSel = html`<label class="field"><span>Class / level</span><select name="level">${u.LEVELS.map((l) => html`<option ${l === 'JSS 1' ? 'selected' : ''}>${l}</option>`)}</select><p class="field-error"></p></label>`;
    root.innerHTML = String(accountForm('Create your student account', 'Start learning in under a minute.', 'Create account', levelSel));
    const form = u.$('form', root);
    form.onsubmit = (e) => { e.preventDefault(); handleCreate(form, 'student'); };
  };

  V.setup = async (root) => {
    if (await auth.teacherExists()) {
      root.innerHTML = String(html`<div class="auth-wrap"><div class="auth-card center"><h1>Already set up</h1>
        <p>A teacher account already exists on this device. New teacher accounts can be added by a signed-in teacher from <b>Students → Add account</b>.</p>
        <a class="btn primary" href="#/login">Go to login</a></div></div>`);
      return;
    }
    root.innerHTML = String(accountForm('Set up M Learning', 'Create the first teacher account for this device. Teachers manage courses, questions and quizzes.', 'Create teacher account'));
    const form = u.$('form', root);
    u.$('.switch', form).insertAdjacentHTML('beforebegin', String(html`<p class="switch">Just a student? <a href="#/register">Register as a student instead</a></p>`));
    form.onsubmit = (e) => { e.preventDefault(); handleCreate(form, 'teacher'); };
  };
})();
