/* M Learning App — local persistence
 * IndexedDB holds accounts, content, question banks, attempts and character images (as Blobs).
 * localStorage holds small preferences only. Both are wrapped so failures are reported, not thrown blindly.
 * NOTE: this data lives only in this browser on this device. It is NOT synchronised anywhere. */
(function () {
  'use strict';
  const ML = (window.ML = window.ML || {});
  const NAME = 'm-learning-app';
  const VERSION = 1;
  const STORES = {
    users: { keyPath: 'id', indexes: [['username', 'username', { unique: true }], ['role', 'role']] },
    sessions: { keyPath: 'token' },
    courses: { keyPath: 'id' },
    lessons: { keyPath: 'id', indexes: [['courseId', 'courseId']] },
    questions: { keyPath: 'id', indexes: [['ownerId', 'ownerId']] },
    quizzes: { keyPath: 'id' },
    attempts: { keyPath: 'id', indexes: [['userId', 'userId'], ['quizId', 'quizId']] },
    notifications: { keyPath: 'id', indexes: [['userId', 'userId']] },
    progress: { keyPath: 'id', indexes: [['userId', 'userId']] },
    characters: { keyPath: 'id', indexes: [['userId', 'userId']] },
    meta: { keyPath: 'key' },
  };

  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!('indexedDB' in window) || !window.indexedDB) return reject(new Error('IndexedDB is not available in this browser.'));
      let r;
      try { r = indexedDB.open(NAME, VERSION); } catch (e) { return reject(e); }
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const [n, cfg] of Object.entries(STORES)) {
          if (d.objectStoreNames.contains(n)) continue;
          const s = d.createObjectStore(n, { keyPath: cfg.keyPath });
          (cfg.indexes || []).forEach(([i, k, o]) => s.createIndex(i, k, o || {}));
        }
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('Could not open the database.'));
      r.onblocked = () => reject(new Error('The database is blocked by another open tab. Close other M Learning tabs and reload.'));
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }

  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const done = (t) => new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('The save was cancelled.'));
  });

  async function get(store, key) { const d = await open(); return req(d.transaction(store).objectStore(store).get(key)); }
  async function all(store) { const d = await open(); return req(d.transaction(store).objectStore(store).getAll()); }
  async function byIndex(store, index, value) { const d = await open(); return req(d.transaction(store).objectStore(store).index(index).getAll(value)); }
  async function put(store, value) { const d = await open(); const t = d.transaction(store, 'readwrite'); t.objectStore(store).put(value); await done(t); return value; }
  /** All-or-nothing write: if any record fails, none are saved (existing data is preserved). */
  async function putMany(store, values) { const d = await open(); const t = d.transaction(store, 'readwrite'); const s = t.objectStore(store); values.forEach((v) => s.put(v)); await done(t); return values; }
  async function del(store, key) { const d = await open(); const t = d.transaction(store, 'readwrite'); t.objectStore(store).delete(key); await done(t); }
  async function delMany(store, keys) { const d = await open(); const t = d.transaction(store, 'readwrite'); const s = t.objectStore(store); keys.forEach((k) => s.delete(k)); await done(t); }

  function isQuotaError(e) { return e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message || ''))); }

  // ---------- small preferences (localStorage with in-memory fallback) ----------
  const mem = {};
  let storageOk = true;
  try { const k = '__ml_test'; localStorage.setItem(k, '1'); localStorage.removeItem(k); } catch (e) { storageOk = false; }
  const prefs = {
    available: storageOk,
    get(key, def) {
      try { const v = localStorage.getItem('ml.' + key); return v == null ? (key in mem ? mem[key] : def) : JSON.parse(v); }
      catch (e) { return key in mem ? mem[key] : def; }
    },
    set(key, value) {
      mem[key] = value;
      try { localStorage.setItem('ml.' + key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove(key) { delete mem[key]; try { localStorage.removeItem('ml.' + key); } catch (e) { /* ignore */ } },
  };

  async function estimate() {
    try { if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate(); } catch (e) { /* ignore */ }
    return null;
  }

  // ML.db is a facade: by default it uses IndexedDB (this file). In online mode js/remote.js
  // swaps in a Supabase implementation with the same methods, so the rest of the app is unchanged.
  const local = { open, get, all, byIndex, put, putMany, del, delMany };
  let impl = local;
  ML.db = {
    open: (...a) => impl.open(...a), get: (...a) => impl.get(...a), all: (...a) => impl.all(...a),
    byIndex: (...a) => impl.byIndex(...a), put: (...a) => impl.put(...a), putMany: (...a) => impl.putMany(...a),
    del: (...a) => impl.del(...a), delMany: (...a) => impl.delMany(...a),
    setImpl(next) { impl = next; }, isQuotaError, estimate,
  };
  ML.remote = ML.remote || { enabled: false };
  ML.prefs = prefs;
})();
