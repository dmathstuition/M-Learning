/* M Learning App — character import, library and app background.
 * Images are validated by extension, MIME type AND magic bytes, decoded, size-checked, then
 * downscaled (max 1600 px) before being stored as Blobs in IndexedDB, so huge photos can't slow the app. */
(function () {
  'use strict';
  const ML = (window.ML = window.ML || {});
  const { u, db } = ML;

  const MAX_BYTES = 10 * 1024 * 1024;   // raw upload limit
  const MAX_DIM = 1600;                 // stored image longest side
  const MAX_SOURCE_PIXELS = 50e6;       // refuse absurd images before decoding work
  const MAX_CHARACTERS = 30;
  const ALLOWED = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

  function sniff(bytes) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    return null;
  }

  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { resolve({ img, url }); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image could not be opened. It may be damaged or in an unsupported format.')); };
      img.src = url;
    });
  }

  let webpEncode = null;
  function canEncodeWebp() {
    if (webpEncode == null) { try { const c = document.createElement('canvas'); c.width = c.height = 1; webpEncode = c.toDataURL('image/webp').startsWith('data:image/webp'); } catch (e) { webpEncode = false; } }
    return webpEncode;
  }

  /** Validate + process an image file. Returns {blob, width, height, type, hasAlpha?} or throws a friendly Error. */
  async function processImage(file, maxDim) {
    maxDim = maxDim || MAX_DIM;
    if (!file) throw new Error('No file selected.');
    const ext = (file.name || '').toLowerCase().split('.').pop();
    if (!ALLOWED[ext]) throw new Error('Unsupported file type. Please choose a PNG, JPG, JPEG or WebP image.');
    if (file.type && !Object.values(ALLOWED).includes(file.type)) throw new Error('This file is not a supported image (' + file.type + ').');
    if (file.size > MAX_BYTES) throw new Error('Image is too large (' + (file.size / 1048576).toFixed(1) + ' MB). Maximum is 10 MB.');
    if (file.size < 100) throw new Error('This file is too small to be a valid image.');
    const real = sniff(await u.readFileBytes(file, 12));
    if (!real) throw new Error('The file content is not a real PNG, JPG or WebP image (it may just be renamed).');
    const { img, url } = await loadImage(file);
    try {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) throw new Error('This image has no size information.');
      if (w * h > MAX_SOURCE_PIXELS) throw new Error('Image dimensions are too large (' + w + '×' + h + '). Please use a smaller image.');
      if (w < 64 || h < 64) throw new Error('Image is too small (' + w + '×' + h + '). Use at least 64×64 pixels.');
      const scale = Math.min(1, maxDim / Math.max(w, h));
      const cw = Math.round(w * scale), ch = Math.round(h * scale);
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, cw, ch);
      // JPEGs have no transparency → keep JPEG. PNG/WebP may be transparent → WebP (alpha-capable) or PNG.
      const outType = real === 'image/jpeg' ? 'image/jpeg' : (canEncodeWebp() ? 'image/webp' : 'image/png');
      const blob = await new Promise((res) => canvas.toBlob(res, outType, 0.9));
      if (!blob) throw new Error('Could not process this image.');
      return { blob, width: cw, height: ch, type: outType, original: { w, h, type: real } };
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------- library (per user) ----------
  async function list(userId) { return (await db.byIndex('characters', 'userId', userId)).sort((a, b) => b.createdAt - a.createdAt); }
  async function add(userId, name, processed) {
    const existing = await list(userId);
    if (existing.length >= MAX_CHARACTERS) throw new Error('Your library is full (' + MAX_CHARACTERS + ' characters). Delete one to add another.');
    name = String(name || '').trim().slice(0, 40) || 'My character';
    const rec = { id: u.uid('ch'), userId, name, blob: processed.blob, type: processed.type, width: processed.width, height: processed.height, createdAt: Date.now() };
    try { await db.put('characters', rec); }
    catch (e) { if (db.isQuotaError(e)) throw new Error('Your device storage is full. Delete some saved characters and try again.'); throw e; }
    return rec;
  }
  async function rename(userId, id, name) {
    const rec = await db.get('characters', id);
    if (!rec || rec.userId !== userId) throw new Error('Character not found.');
    rec.name = String(name).trim().slice(0, 40) || rec.name;
    await db.put('characters', rec);
    return rec;
  }
  async function remove(userId, id) {
    const rec = await db.get('characters', id);
    if (!rec || rec.userId !== userId) throw new Error('Character not found.');
    await db.del('characters', id);
    const s = ML.settings.get();
    if (s.activeCharacterId === id) { ML.settings.set({ activeCharacterId: null }); await bg.refresh(); }
  }

  // ---------- background layer ----------
  const bg = {
    url: null, currentId: null,
    async refresh() {
      const layer = document.getElementById('char-layer');
      const img = document.getElementById('char-img');
      if (!layer || !img) return;
      const s = ML.settings.get();
      const user = await ML.auth.currentUser();
      applyVars(s);
      let rec = null;
      if (user && s.activeCharacterId) {
        rec = await db.get('characters', s.activeCharacterId).catch(() => null);
        if (rec && rec.userId !== user.id) rec = null;
        if (!rec) ML.settings.set({ activeCharacterId: null }); // was deleted
      }
      if (!rec) {
        if (this.url) URL.revokeObjectURL(this.url);
        this.url = null; this.currentId = null;
        img.removeAttribute('src'); img.alt = '';
        document.documentElement.classList.remove('has-character');
        return;
      }
      if (this.currentId !== rec.id) {
        const nextUrl = URL.createObjectURL(rec.blob);
        img.src = nextUrl; img.alt = '';
        if (this.url) URL.revokeObjectURL(this.url);
        this.url = nextUrl; this.currentId = rec.id;
      }
      document.documentElement.classList.add('has-character');
    },
  };
  function applyVars(s) {
    const r = document.documentElement.style;
    r.setProperty('--char-opacity', String(s.bgOpacity / 100));
    r.setProperty('--char-brightness', String(s.bgBrightness / 100));
    r.setProperty('--char-overlay', String(s.bgOverlay / 100));
    r.setProperty('--char-size', s.bgSize + 'vh');
    document.documentElement.dataset.charPos = s.bgPosition;
  }

  ML.chars = { processImage, list, add, rename, remove, MAX_BYTES, MAX_CHARACTERS };
  ML.bg = bg;
  ML.bg.applyVars = applyVars;
})();
