/* M Learning App — local accounts
 * Passwords are never stored: we store a salted PBKDF2-SHA256 hash (Web Crypto).
 * IMPORTANT LIMITATION: accounts exist only in this browser on this device. Role checks here
 * protect the UI flow, but anyone with full access to this device's browser storage could read
 * or alter it. Real protection needs the server described in README.md. */
(function () {
  'use strict';
  const ML = (window.ML = window.ML || {});
  const { db, prefs } = ML;
  const ITERATIONS = 150000;
  const SESSION_KEY = 'ml.session';
  const SESSION_DAYS = 7;

  const enc = new TextEncoder();
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  function cryptoReady() { return !!(window.crypto && crypto.subtle); }

  async function hashPassword(password, saltB64, iterations) {
    if (!cryptoReady()) throw new Error('Secure password hashing needs a secure context. Open the app via http://localhost or https (see README).');
    const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iterations || ITERATIONS }, key, 256);
    return { salt: b64(salt), hash: b64(new Uint8Array(bits)), iterations: iterations || ITERATIONS };
  }
  function safeEqual(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

  // ---------- validation (shared by registration, teacher-created accounts and profile edits) ----------
  const RULES = {
    fullName(v) { v = (v || '').trim(); if (v.length < 2) return 'Enter your full name (at least 2 characters).'; if (v.length > 60) return 'Full name must be 60 characters or fewer.'; if (/[<>]/.test(v)) return 'Name cannot contain < or >.'; return ''; },
    username(v) { v = (v || '').trim(); if (!/^[a-zA-Z0-9_.]{3,20}$/.test(v)) return 'Username must be 3–20 characters: letters, numbers, _ or . only.'; return ''; },
    email(v) { v = (v || '').trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) || v.length > 120) return 'Enter a valid email address.'; return ''; },
    password(v) { v = v || ''; if (v.length < 8) return 'Password must be at least 8 characters.'; if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return 'Password must include at least one letter and one number.'; if (v.length > 128) return 'Password is too long.'; return ''; },
  };
  function validateAccount(data, { requirePassword = true } = {}) {
    const errors = {};
    ['fullName', 'username', 'email'].forEach((f) => { const e = RULES[f](data[f]); if (e) errors[f] = e; });
    if (requirePassword) {
      const e = RULES.password(data.password); if (e) errors.password = e;
      if (data.password !== data.confirm) errors.confirm = 'Passwords do not match.';
    }
    return errors;
  }

  async function findByUsername(username) {
    const list = await db.byIndex('users', 'username', String(username || '').trim().toLowerCase());
    return list[0] || null;
  }
  async function teacherExists() { return (await db.byIndex('users', 'role', 'teacher')).length > 0; }

  /** Create an account. Teacher accounts may only be created during first-run setup or by a signed-in teacher. */
  async function createAccount(data, role) {
    role = role === 'teacher' ? 'teacher' : 'student';
    const errors = validateAccount(data);
    if (Object.keys(errors).length) { const e = new Error('Please fix the highlighted fields.'); e.fields = errors; throw e; }
    if (role === 'teacher' && (await teacherExists())) {
      const me = await currentUser();
      if (!me || me.role !== 'teacher') throw new Error('Only a signed-in teacher can create teacher accounts.');
    }
    const username = data.username.trim().toLowerCase();
    if (await findByUsername(username)) { const e = new Error('That username is already taken.'); e.fields = { username: 'That username is already taken.' }; throw e; }
    const all = await db.all('users');
    const email = data.email.trim().toLowerCase();
    if (all.some((u) => u.email === email)) { const e = new Error('An account with that email already exists on this device.'); e.fields = { email: 'Email already registered.' }; throw e; }
    const pw = await hashPassword(data.password);
    const user = {
      id: ML.u.uid('u'), role, fullName: data.fullName.trim(), username, email,
      level: data.level || (role === 'student' ? 'JSS 1' : ''), preferredSubjects: data.preferredSubjects || [],
      pw, avatar: null, createdAt: Date.now(), lastActiveAt: Date.now(),
    };
    await db.put('users', user);
    return user;
  }

  // ---------- login + lockout ----------
  function lockInfo(username) { return prefs.get('lock.' + username, { count: 0, until: 0 }); }
  async function login(username, password, remember) {
    username = String(username || '').trim().toLowerCase();
    if (!username || !password) throw new Error('Enter your username and password.');
    const lock = lockInfo(username);
    if (lock.until > Date.now()) throw new Error('Too many failed attempts. Try again in ' + Math.ceil((lock.until - Date.now()) / 1000) + ' seconds.');
    const user = await findByUsername(username);
    // Always run the hash so response time does not reveal whether the username exists.
    const check = await hashPassword(password, user ? user.pw.salt : b64(new Uint8Array(16)), user ? user.pw.iterations : ITERATIONS);
    if (!user || !safeEqual(check.hash, user.pw.hash)) {
      const count = lock.count + 1;
      prefs.set('lock.' + username, { count: count >= 5 ? 0 : count, until: count >= 5 ? Date.now() + 60000 : 0 });
      throw new Error('Incorrect username or password.');
    }
    prefs.remove('lock.' + username);
    await startSession(user, remember);
    user.lastActiveAt = Date.now();
    await db.put('users', user);
    return user;
  }

  async function startSession(user, remember) {
    const t = new Uint8Array(32); crypto.getRandomValues(t);
    const token = Array.from(t, (x) => x.toString(16).padStart(2, '0')).join('');
    await db.put('sessions', { token, userId: user.id, createdAt: Date.now(), expires: Date.now() + (remember ? SESSION_DAYS * 86400000 : 12 * 3600000) });
    try { (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, token); } catch (e) { /* storage unavailable: session lasts for this page only */ }
    cache = user;
  }

  let cache = null;
  function readToken() {
    try { return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY); } catch (e) { return null; }
  }
  async function currentUser(force) {
    if (cache && !force) return cache;
    const token = readToken();
    if (!token) return (cache = null);
    const s = await db.get('sessions', token);
    if (!s || s.expires < Date.now()) { if (s) await db.del('sessions', token); clearToken(); return (cache = null); }
    cache = (await db.get('users', s.userId)) || null;
    return cache;
  }
  function clearToken() { try { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } }
  async function logout() {
    const token = readToken();
    if (token) await db.del('sessions', token).catch(() => {});
    clearToken();
    cache = null;
  }

  async function changePassword(user, current, next, confirm) {
    const check = await hashPassword(current, user.pw.salt, user.pw.iterations);
    if (!safeEqual(check.hash, user.pw.hash)) throw new Error('Current password is incorrect.');
    const err = RULES.password(next); if (err) throw new Error(err);
    if (next !== confirm) throw new Error('New passwords do not match.');
    user.pw = await hashPassword(next);
    await db.put('users', user);
  }
  /** Teacher-only: set a new password for a student who forgot theirs (there is no email service). */
  async function resetPasswordFor(userId, next) {
    await requireTeacher();
    const err = RULES.password(next); if (err) throw new Error(err);
    const u = await db.get('users', userId); if (!u) throw new Error('Account not found.');
    u.pw = await hashPassword(next);
    await db.put('users', u);
    // sign the user out everywhere on this device
    const sessions = await db.all('sessions');
    await db.delMany('sessions', sessions.filter((s) => s.userId === userId).map((s) => s.token));
  }

  async function requireTeacher() {
    const me = await currentUser();
    if (!me || me.role !== 'teacher') throw new Error('Teacher access required.');
    return me;
  }
  async function requireUser() {
    const me = await currentUser();
    if (!me) throw new Error('Please sign in.');
    return me;
  }
  function setCached(u) { if (cache && u && cache.id === u.id) cache = u; }

  ML.auth = { RULES, validateAccount, createAccount, login, logout, currentUser, teacherExists, changePassword,
    resetPasswordFor, requireTeacher, requireUser, findByUsername, cryptoReady, setCached };
})();
