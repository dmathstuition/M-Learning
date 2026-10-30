/* M Learning App — online mode (Supabase).
 * If a Supabase URL + publishable key are configured, this file switches the app from local
 * IndexedDB to Supabase: real accounts (Supabase Auth), a shared database protected by Row Level
 * Security, server-side quiz marking, and private image storage. With no config the app stays local.
 *
 * Config sources, in order:
 *   1. window.ML_CONFIG = { supabaseUrl, supabaseKey }   (js/config.js — for any static host)
 *   2. GET /api/config                                     (Vercel function reading env variables)
 * Only the PUBLISHABLE (anon) key ever reaches the browser. Never put the service_role key here. */
(function () {
  'use strict';
  const ML = (window.ML = window.ML || {});
  const { u, Q } = ML;
  const remote = (ML.remote = Object.assign(ML.remote || {}, { enabled: false, client: null }));
  const BUCKET = 'media';
  let sb = null;

  // ---------------- config ----------------
  async function loadConfig() {
    const c = window.ML_CONFIG || {};
    if (c.supabaseUrl && c.supabaseKey) return c;
    if (location.protocol === 'file:') return null;
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(c.configEndpoint || '/api/config', { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) return null;
      const j = await r.json();
      return j && j.supabaseUrl && j.supabaseKey ? j : null;
    } catch (e) { return null; }
  }

  function friendly(error) {
    const m = String((error && (error.message || error.error_description)) || error || 'Unknown error');
    if (/row-level security|permission denied/i.test(m)) return 'You do not have permission to do that.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Could not reach the server. Check your internet connection and try again.';
    if (/JWT expired|invalid JWT|refresh token/i.test(m)) return 'Your session has expired. Please log in again.';
    return m.replace(/^.*?ERROR:\s*/, '');
  }
  function fail(error) { const e = new Error(friendly(error)); e.cause = error; return e; }
  const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const iso = (ms) => new Date(ms || Date.now()).toISOString();
  const ms = (ts) => (ts ? new Date(ts).getTime() : null);

  // ---------------- generic JSON-document tables ----------------
  // Each record is stored whole in `data` plus a few real columns used by RLS and indexes.
  const DOC = {
    courses: { table: 'courses', cols: () => ({}), idx: {} },
    lessons: { table: 'lessons', cols: (r) => ({ course_id: r.courseId }), idx: { courseId: 'course_id' } },
    quizzes: { table: 'quizzes', cols: (r) => ({ status: r.status, created_by: isUuid(r.createdBy) ? r.createdBy : null }), idx: {} },
    attempts: { table: 'attempts', cols: (r) => ({ user_id: r.userId, quiz_id: r.quizId, finished_at: iso(r.finishedAt) }), idx: { userId: 'user_id', quizId: 'quiz_id' }, updateOnly: true },
    notifications: { table: 'notifications', cols: (r) => ({ user_id: r.userId }), idx: { userId: 'user_id' } },
    progress: { table: 'progress', cols: (r) => ({ user_id: r.userId }), idx: { userId: 'user_id' } },
  };
  const fromDoc = (row) => Object.assign({}, row.data, { id: row.id });

  /** PostgREST returns at most 1000 rows per request — page through everything. */
  async function selectAll(build) {
    const out = []; const size = 1000;
    for (let from = 0; ; from += size) {
      const { data, error } = await build().range(from, from + size - 1);
      if (error) throw fail(error);
      out.push(...data);
      if (data.length < size) return out;
    }
  }

  // ---------------- questions (public part + answer key) ----------------
  const Q_SELECT = 'id, owner_id, owner_role, practice, bank, data, question_keys(key)';
  function fromQuestion(row) {
    const k = Array.isArray(row.question_keys) ? row.question_keys[0] : row.question_keys;
    return Q.joinFromStorage(Object.assign({}, row.data, { id: row.id, ownerId: row.owner_id || 'system', ownerRole: row.owner_role, practice: row.practice, bank: row.bank }), k ? k.key : null);
  }
  async function putQuestions(recs) {
    if (!recs.length) return;
    const rows = []; const keys = [];
    recs.forEach((r) => {
      const { data, key } = Q.splitForStorage(r);
      rows.push({ id: r.id, owner_id: isUuid(r.ownerId) ? r.ownerId : null, owner_role: r.ownerRole === 'student' ? 'student' : 'teacher',
        practice: !!r.practice, bank: r.bank || 'General', data, updated_at: iso() });
      keys.push({ question_id: r.id, key });
    });
    for (let i = 0; i < rows.length; i += 500) {
      let res = await sb.from('questions').upsert(rows.slice(i, i + 500), { onConflict: 'id' });
      if (res.error) throw fail(res.error);
      res = await sb.from('question_keys').upsert(keys.slice(i, i + 500), { onConflict: 'question_id' });
      if (res.error) throw fail(res.error);
    }
  }

  // ---------------- profiles (users store) ----------------
  const avatarCache = new Map(); // userId -> {path, blob}
  async function download(path) {
    const { data, error } = await sb.storage.from(BUCKET).download(path);
    if (error) throw fail(error);
    return data;
  }
  async function fromProfile(row, withAvatar) {
    const user = { id: row.id, role: row.role, fullName: row.full_name, username: row.username, email: row.email, level: row.level,
      preferredSubjects: row.preferred_subjects || [], avatar: null, createdAt: ms(row.created_at), lastActiveAt: ms(row.last_active_at), avatarPath: row.avatar_path };
    if (withAvatar && row.avatar_path) {
      const c = avatarCache.get(row.id);
      if (c && c.path === row.avatar_path) user.avatar = c.blob;
      else { try { user.avatar = await download(row.avatar_path); avatarCache.set(row.id, { path: row.avatar_path, blob: user.avatar }); } catch (e) { /* missing file: show initials */ } }
    }
    return user;
  }
  async function putProfile(user) {
    const patch = { full_name: user.fullName, level: user.level || '', preferred_subjects: user.preferredSubjects || [], last_active_at: iso(user.lastActiveAt) };
    const me = await A.currentUser();
    if (me && me.id === user.id) { // only the owner manages their own photo
      const cached = avatarCache.get(user.id);
      if (user.avatar && (!cached || cached.blob !== user.avatar)) {
        const path = user.id + '/avatar';
        const { error } = await sb.storage.from(BUCKET).upload(path, user.avatar, { upsert: true, contentType: user.avatar.type || 'image/webp', cacheControl: '60' });
        if (error) throw fail(error);
        patch.avatar_path = path; avatarCache.set(user.id, { path, blob: user.avatar });
      } else if (!user.avatar && user.avatarPath) {
        await sb.storage.from(BUCKET).remove([user.avatarPath]);
        patch.avatar_path = null; avatarCache.delete(user.id);
      }
    }
    const { error } = await sb.from('profiles').update(patch).eq('id', user.id);
    if (error) throw fail(error);
    return user;
  }

  // ---------------- characters (row + image file) ----------------
  const charBlobs = new Map(); // id -> Blob
  async function fromCharacter(row) {
    let blob = charBlobs.get(row.id);
    if (!blob) { blob = await download(row.path); charBlobs.set(row.id, blob); }
    return { id: row.id, userId: row.user_id, name: row.name, blob, type: row.mime, width: row.width, height: row.height, createdAt: ms(row.created_at), path: row.path };
  }
  async function putCharacter(rec) {
    const path = rec.userId + '/c_' + rec.id;
    if (rec.blob && charBlobs.get(rec.id) !== rec.blob) {
      const { error } = await sb.storage.from(BUCKET).upload(path, rec.blob, { upsert: true, contentType: rec.type, cacheControl: '3600' });
      if (error) throw fail(error);
      charBlobs.set(rec.id, rec.blob);
    }
    const { error } = await sb.from('characters').upsert({ id: rec.id, user_id: rec.userId, name: rec.name, path, mime: rec.type, width: rec.width, height: rec.height, created_at: iso(rec.createdAt) }, { onConflict: 'id' });
    if (error) {
      await sb.storage.from(BUCKET).remove([path]); charBlobs.delete(rec.id); // don't leave an orphan file
      throw fail(error);
    }
    return rec;
  }

  // ---------------- the ML.db implementation ----------------
  const remoteDb = {
    async open() { return true; },
    async get(store, key) {
      if (DOC[store]) {
        const { data, error } = await sb.from(DOC[store].table).select('id, data').eq('id', key).maybeSingle();
        if (error) throw fail(error);
        return data ? fromDoc(data) : undefined;
      }
      if (store === 'questions') {
        const { data, error } = await sb.from('questions').select(Q_SELECT).eq('id', key).maybeSingle();
        if (error) throw fail(error);
        return data ? fromQuestion(data) : undefined;
      }
      if (store === 'users') {
        const { data, error } = await sb.from('profiles').select('*').eq('id', key).maybeSingle();
        if (error) throw fail(error);
        return data ? fromProfile(data, true) : undefined;
      }
      if (store === 'characters') {
        const { data, error } = await sb.from('characters').select('*').eq('id', key).maybeSingle();
        if (error) throw fail(error);
        return data ? fromCharacter(data) : undefined;
      }
      return undefined; // meta, sessions: not used online
    },
    async all(store) {
      if (DOC[store]) return (await selectAll(() => sb.from(DOC[store].table).select('id, data').order('id'))).map(fromDoc);
      if (store === 'questions') return (await selectAll(() => sb.from('questions').select(Q_SELECT).order('id'))).map(fromQuestion);
      if (store === 'users') return Promise.all((await selectAll(() => sb.from('profiles').select('*').order('id'))).map((r) => fromProfile(r, false)));
      return [];
    },
    async byIndex(store, index, value) {
      if (DOC[store]) {
        const col = DOC[store].idx[index]; if (!col) throw new Error('No index ' + index + ' on ' + store);
        return (await selectAll(() => sb.from(DOC[store].table).select('id, data').eq(col, value).order('id'))).map(fromDoc);
      }
      if (store === 'questions' && index === 'ownerId') return (await selectAll(() => sb.from('questions').select(Q_SELECT).eq('owner_id', value).order('id'))).map(fromQuestion);
      if (store === 'users' && (index === 'role' || index === 'username')) {
        const rows = await selectAll(() => sb.from('profiles').select('*').eq(index, String(value).toLowerCase()).order('id'));
        return Promise.all(rows.map((r) => fromProfile(r, false)));
      }
      if (store === 'characters' && index === 'userId') {
        const rows = await selectAll(() => sb.from('characters').select('*').eq('user_id', value).order('created_at'));
        return Promise.all(rows.map(fromCharacter));
      }
      return [];
    },
    async put(store, rec) {
      if (DOC[store]) {
        const d = DOC[store];
        const row = Object.assign({ id: rec.id, data: rec }, d.cols(rec));
        const res = d.updateOnly
          ? await sb.from(d.table).update(row).eq('id', rec.id)
          : await sb.from(d.table).upsert(row, { onConflict: 'id' });
        if (res.error) throw fail(res.error);
        return rec;
      }
      if (store === 'questions') { await putQuestions([rec]); return rec; }
      if (store === 'users') return putProfile(rec);
      if (store === 'characters') return putCharacter(rec);
      return rec; // meta/sessions: ignored online
    },
    async putMany(store, recs) {
      if (store === 'questions') { await putQuestions(recs); return recs; }
      if (DOC[store] && !DOC[store].updateOnly) {
        const d = DOC[store];
        for (let i = 0; i < recs.length; i += 500) {
          const { error } = await sb.from(d.table).upsert(recs.slice(i, i + 500).map((r) => Object.assign({ id: r.id, data: r }, d.cols(r))), { onConflict: 'id' });
          if (error) throw fail(error);
        }
        return recs;
      }
      for (const r of recs) await this.put(store, r);
      return recs;
    },
    async del(store, key) { return this.delMany(store, [key]); },
    async delMany(store, keys) {
      if (!keys.length) return;
      const table = DOC[store] ? DOC[store].table : store === 'questions' ? 'questions' : store === 'characters' ? 'characters' : null;
      if (!table) return;
      if (store === 'characters') {
        const { data } = await sb.from('characters').select('path').in('id', keys);
        if (data && data.length) await sb.storage.from(BUCKET).remove(data.map((r) => r.path));
        keys.forEach((k) => charBlobs.delete(k));
      }
      for (let i = 0; i < keys.length; i += 200) {
        const { error } = await sb.from(table).delete().in('id', keys.slice(i, i + 200));
        if (error) throw fail(error);
      }
    },
  };

  // ---------------- auth ----------------
  let cache = null; let cacheAt = 0;
  const redirectTo = () => location.origin + location.pathname;
  const A = {
    cryptoReady: () => true,
    async teacherExists() { return true; },           // teachers are created by invitation, not first-run setup
    async currentUser(force) {
      const { data } = await sb.auth.getSession();
      const session = data && data.session;
      if (!session) { cache = null; return null; }
      if (cache && cache.id === session.user.id && !(force && Date.now() - cacheAt > 60000)) return cache;
      const { data: row, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      if (error) { if (cache && cache.id === session.user.id) return cache; throw fail(error); }
      if (!row) { cache = null; return null; }
      cache = await fromProfile(row, true); cacheAt = Date.now();
      return cache;
    },
    setCached(user) { if (cache && user && cache.id === user.id) { cache = user; cacheAt = Date.now(); } },
    async createAccount(data, role) {
      if (role === 'teacher') throw new Error('Teacher accounts are created by invitation. Ask an existing teacher to invite your email address.');
      const errors = ML.auth.validateAccount(data);
      if (Object.keys(errors).length) { const e = new Error('Please fix the highlighted fields.'); e.fields = errors; throw e; }
      const username = data.username.trim().toLowerCase();
      const avail = await sb.rpc('username_available', { p_username: username });
      if (avail.error) throw fail(avail.error);
      if (avail.data === false) { const e = new Error('That username is already taken.'); e.fields = { username: 'That username is already taken.' }; throw e; }
      const { data: res, error } = await sb.auth.signUp({ email: data.email.trim().toLowerCase(), password: data.password,
        options: { emailRedirectTo: redirectTo(), data: { username, full_name: data.fullName.trim(), level: data.level || '' } } });
      if (error) {
        if (/registered|exists/i.test(error.message)) { const e = new Error('An account with that email already exists. Try logging in.'); e.fields = { email: 'Email already registered.' }; throw e; }
        throw fail(error);
      }
      // Supabase returns a user with no identities when the email is already registered (anti-enumeration)
      if (res.user && Array.isArray(res.user.identities) && res.user.identities.length === 0) {
        const e = new Error('An account with that email already exists. Try logging in.'); e.fields = { email: 'Email already registered.' }; throw e;
      }
      if (!res.session) return { needsConfirmation: true, email: data.email.trim() };
      cache = null;
      return { signedIn: true };
    },
    async login(identifier, password) {
      identifier = String(identifier || '').trim().toLowerCase();
      if (!identifier || !password) throw new Error('Enter your email and password.');
      if (!identifier.includes('@')) throw new Error('Please log in with the email address you registered with.');
      const { error } = await sb.auth.signInWithPassword({ email: identifier, password });
      if (error) {
        if (/invalid login credentials/i.test(error.message)) throw new Error('Incorrect email or password.');
        if (/email not confirmed/i.test(error.message)) throw new Error('Please confirm your email first — check your inbox for the link we sent.');
        throw fail(error);
      }
      cache = null;
      const user = await A.currentUser();
      if (!user) throw new Error('Your account profile could not be loaded. Please contact your teacher.');
      sb.from('profiles').update({ last_active_at: iso() }).eq('id', user.id).then(() => {});
      return user;
    },
    async logout() { cache = null; avatarCache.clear(); charBlobs.clear(); await sb.auth.signOut().catch(() => {}); },
    async changePassword(user, current, next, confirm) {
      const { error: e1 } = await sb.auth.signInWithPassword({ email: user.email, password: current });
      if (e1) throw new Error('Current password is incorrect.');
      const err = ML.auth.RULES.password(next); if (err) throw new Error(err);
      if (next !== confirm) throw new Error('New passwords do not match.');
      const { error } = await sb.auth.updateUser({ password: next });
      if (error) throw fail(error);
    },
    async resetPasswordFor() { throw new Error('Online accounts reset their own password by email. Use "Send reset email".'); },
    async sendResetEmail(email) {
      const { error } = await sb.auth.resetPasswordForEmail(String(email).trim().toLowerCase(), { redirectTo: redirectTo() });
      if (error) throw fail(error);
    },
    async setNewPassword(next, confirm) {
      const err = ML.auth.RULES.password(next); if (err) throw new Error(err);
      if (next !== confirm) throw new Error('Passwords do not match.');
      const { error } = await sb.auth.updateUser({ password: next });
      if (error) throw fail(error);
    },
    async requireTeacher() { const me = await A.currentUser(); if (!me || me.role !== 'teacher') throw new Error('Teacher access required.'); return me; },
    async requireUser() { const me = await A.currentUser(); if (!me) throw new Error('Please sign in.'); return me; },
    async findByUsername() { return null; },
  };

  // ---------------- quiz engine (server-side marking) ----------------
  const QZ = {
    async start(user, quizId) {
      const { data, error } = await sb.rpc('quiz_start', { p_quiz_id: quizId });
      if (error) throw fail(error);
      return data;
    },
    async check(sessionId, qid, given) {
      const { data, error } = await sb.rpc('quiz_check', { p_session: sessionId, p_qid: qid, p_given: given == null ? null : given });
      if (error) throw fail(error);
      return data;
    },
    discard() { /* abandoned sessions are cleaned up by the server after a day */ },
    async submit(sessionId, answers, opts) {
      const { data, error } = await sb.rpc('quiz_submit', { p_session: sessionId, p_answers: answers || {}, p_auto: !!(opts && opts.auto) });
      if (error) throw fail(error);
      return data;
    },
  };

  // ---------------- account deletion & invitations ----------------
  async function deleteAccount() {
    const me = await A.currentUser();
    if (!me) return;
    const files = await sb.storage.from(BUCKET).list(me.id, { limit: 1000 });
    if (files.data && files.data.length) await sb.storage.from(BUCKET).remove(files.data.map((f) => me.id + '/' + f.name));
    const { error } = await sb.rpc('delete_my_account');
    if (error) throw fail(error);
    await A.logout();
  }
  async function inviteTeacher(email) {
    const { error } = await sb.rpc('invite_teacher', { p_email: email });
    if (error) throw fail(error);
  }

  /** Called once at start-up. Returns true when online mode is active. */
  remote.init = async function () {
    const cfg = await loadConfig();
    if (!cfg) return false;
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(cfg.supabaseUrl) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(cfg.supabaseUrl)) {
      console.error('M Learning: SUPABASE_URL looks wrong:', cfg.supabaseUrl); return false;
    }
    if (!window.supabase || !window.supabase.createClient) { console.error('M Learning: Supabase library failed to load.'); return false; }
    if (/service_role|sb_secret_/.test(cfg.supabaseKey) || /"role"\s*:\s*"service_role"/.test(atobSafe(cfg.supabaseKey.split('.')[1]))) {
      // Refuse to run with a secret key: it would bypass every security rule for anyone visiting the site.
      document.getElementById('app').textContent = 'Configuration error: a secret Supabase key was supplied to the browser. Use the publishable (anon) key instead.';
      throw new Error('Refusing to use a Supabase secret/service_role key in the browser.');
    }
    sb = window.supabase.createClient(cfg.supabaseUrl.replace(/\/$/, ''), cfg.supabaseKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'ml.supabase.auth' },
    });
    remote.client = sb;
    sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') { remote.recovery = true; setTimeout(() => { location.hash = '#/reset'; }, 0); }
      if (event === 'SIGNED_OUT') cache = null;
    });
    await sb.auth.getSession(); // waits for any ?code= from an email link to be exchanged
    if (/[?&]code=/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash); // tidy URL
    ML.db.setImpl(remoteDb);
    Object.assign(ML.auth, A);
    Object.assign(ML.quizSvc, QZ);
    ML.seed.run = async () => false; // online content comes from supabase/seed.sql
    Object.assign(remote, { enabled: true, deleteAccount, inviteTeacher, url: cfg.supabaseUrl });
    return true;
  };
  function atobSafe(s) { try { return atob(String(s || '').replace(/-/g, '+').replace(/_/g, '/')); } catch (e) { return ''; } }
})();
