/* M Learning App — question model, import parsing/validation, marking.
 * Imported content is untrusted: it is treated as plain data, length-limited, stripped of control
 * characters and always rendered through the escaping template. Nothing from a file is ever executed. */
(function () {
  'use strict';
  const ML = (window.ML = window.ML || {});
  const { u } = ML;

  const LIMITS = { fileBytes: 2 * 1024 * 1024, questions: 1000, text: 1000, option: 300, explanation: 2000, field: 80, maxOptions: 6 };
  const TYPES = { mcq: 'Multiple choice', tf: 'True / False', short: 'Short answer', fill: 'Fill in the blank' };
  const TYPE_ALIASES = {
    mcq: 'mcq', mc: 'mcq', 'multiple choice': 'mcq', 'multiple-choice': 'mcq', multiplechoice: 'mcq', multiple_choice: 'mcq', objective: 'mcq',
    tf: 'tf', 'true/false': 'tf', 'true-false': 'tf', truefalse: 'tf', true_false: 'tf', 'true or false': 'tf', boolean: 'tf',
    short: 'short', 'short answer': 'short', 'short-answer': 'short', short_answer: 'short', written: 'short', theory: 'short',
    fill: 'fill', 'fill in the blank': 'fill', 'fill-in-the-blank': 'fill', fill_in_the_blank: 'fill', blank: 'fill', fib: 'fill', gap: 'fill',
  };
  const LETTERS = 'ABCDEF';

  // ---------- cleaning ----------
  function clean(v, max) {
    let s = String(v == null ? '' : v);
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim(); // control chars
    if (/^'[=+\-@]/.test(s)) s = s.slice(1); // undo spreadsheet formula-guard from our own exports
    return max && s.length > max ? s.slice(0, max) : s;
  }
  const looksLikeMarkup = (s) => /<\s*\/?\s*[a-z!][^>]*>/i.test(s) || /javascript:/i.test(s);

  function normAnswer(s) {
    return String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?;,]+$/, '').trim();
  }
  /** Light normalisation for comparing options: keeps punctuation (so "." and "?" differ). */
  function normOption(s) { return String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function normText(s) { return normAnswer(s).replace(/[^a-z0-9 ]/g, ''); }
  function dupKey(q) {
    return [q.type, normText(q.text), (q.options || []).map(normOption).sort().join('|')].join('::');
  }

  // ---------- CSV ----------
  /** RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF/LF, BOM. Returns array of rows (arrays). */
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const rows = []; let row = []; let field = ''; let i = 0; let inQ = false;
    // auto-detect ; delimiter (common in some locales) from the header line
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const delim = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
    while (i < text.length) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { inQ = true; i++; continue; }
      if (c === delim) { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (inQ) throw new Error('The CSV file has an unclosed quotation mark. Check that every opening " has a closing ".');
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }
  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-?\d+(\.\d+)?$/.test(s))) s = "'" + s; // CSV/formula injection guard
    return '"' + s.replace(/"/g, '""') + '"';
  }
  const toCSV = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

  const HEADER_ALIASES = {
    type: 'type', question_type: 'type', qtype: 'type',
    question: 'text', text: 'text', question_text: 'text', prompt: 'text',
    option_a: 'a', a: 'a', optiona: 'a', option1: 'a', option_1: 'a',
    option_b: 'b', b: 'b', optionb: 'b', option2: 'b', option_2: 'b',
    option_c: 'c', c: 'c', optionc: 'c', option3: 'c', option_3: 'c',
    option_d: 'd', d: 'd', optiond: 'd', option4: 'd', option_4: 'd',
    option_e: 'e', e: 'e', optione: 'e', option5: 'e', option_5: 'e',
    option_f: 'f', f: 'f', optionf: 'f', option6: 'f', option_6: 'f',
    options: 'options',
    answer: 'answer', correct: 'answer', correct_answer: 'answer', answer_key: 'answer', accepted_answers: 'answer',
    explanation: 'explanation', reason: 'explanation', solution: 'explanation',
    subject: 'subject', level: 'level', class: 'level', grade: 'level', class_level: 'level',
    topic: 'topic', difficulty: 'difficulty', marks: 'marks', mark: 'marks', points: 'marks', score: 'marks',
    image: 'image', image_ref: 'image', image_url: 'image', picture: 'image',
    manual_marking: 'manual', teacher_marking: 'manual', manual: 'manual',
  };
  function csvToRaw(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('The CSV needs a header row and at least one question row.');
    const header = rows[0].map((h) => HEADER_ALIASES[String(h).trim().toLowerCase().replace(/[\s-]+/g, '_')] || null);
    if (!header.includes('text')) throw new Error('The CSV header must include a "question" column. Download the sample template to see the expected columns.');
    return rows.slice(1).map((r, idx) => {
      const o = { _row: idx + 2 };
      header.forEach((h, i) => { if (h) o[h] = r[i] == null ? '' : r[i]; });
      const opts = [];
      ['a', 'b', 'c', 'd', 'e', 'f'].forEach((k) => { if (o[k] != null && String(o[k]).trim() !== '') opts.push(o[k]); delete o[k]; });
      if (opts.length) o.options = opts;
      else if (typeof o.options === 'string' && o.options.trim()) o.options = o.options.split('|');
      return o;
    });
  }

  function jsonToRaw(text) {
    let data;
    try { data = JSON.parse(text.replace(/^﻿/, '')); }
    catch (e) { throw new Error('This is not valid JSON: ' + e.message); }
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.questions) ? data.questions : null);
    if (!list) throw new Error('The JSON must be an array of questions, or an object with a "questions" array.');
    return list.map((q, idx) => {
      if (!q || typeof q !== 'object' || Array.isArray(q)) return { _row: idx + 1, _bad: 'Item is not a question object.' };
      const o = { _row: idx + 1 };
      for (const [k, v] of Object.entries(q)) {
        const key = HEADER_ALIASES[String(k).trim().toLowerCase().replace(/[\s-]+/g, '_')] || (k === 'acceptedAnswers' ? 'answer' : null);
        if (!key) continue;
        if (key.length === 1) { (o._opts = o._opts || {})[key] = v; continue; }
        o[key] = v;
      }
      if (o._opts) { o.options = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => o._opts[k]).filter((v) => v != null && String(v).trim() !== ''); delete o._opts; }
      if (Array.isArray(o.answer)) o.answer = o.answer.join('|');
      return o;
    });
  }

  /** Pasted plain-text format (blocks separated by blank lines):
   *   Q: What is 2 + 2?      (the "Q:" prefix is optional on the first line)
   *   A) 3   B) 4 ...         (one option per line: "A)", "A." or "A:")
   *   Answer: B
   *   Explanation: ...        Optional: Type:, Topic:, Subject:, Level:, Difficulty:, Marks:, Image: */
  function textToRaw(text) {
    const blocks = text.replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    if (!blocks.length) throw new Error('Nothing to import — paste at least one question.');
    return blocks.map((block, idx) => {
      const o = { _row: idx + 1 };
      const opts = [];
      const textLines = [];
      block.split('\n').forEach((line) => {
        const l = line.trim();
        let m;
        if ((m = l.match(/^([A-F])[).:]\s+(.+)$/))) { opts.push(m[2]); return; }
        if ((m = l.match(/^(q|question)\s*[:.)]\s*(.*)$/i))) { textLines.push(m[2]); return; }
        if ((m = l.match(/^(answer|ans|correct|type|topic|subject|level|class|difficulty|marks|explanation|image)\s*:\s*(.*)$/i))) {
          const k = HEADER_ALIASES[m[1].toLowerCase()] || (m[1].toLowerCase() === 'ans' ? 'answer' : m[1].toLowerCase());
          o[k] = m[2]; return;
        }
        if (o.explanation != null) { o.explanation += ' ' + l; return; }
        textLines.push(l.replace(/^\d+[).]\s+/, ''));
      });
      o.text = textLines.join(' ');
      if (opts.length) o.options = opts;
      return o;
    });
  }

  // ---------- normalisation + validation ----------
  /** Convert a raw record into a question draft and collect errors (block import) and warnings. */
  function validate(raw, defaults) {
    defaults = defaults || {};
    const errors = []; const warnings = [];
    if (raw._bad) return { q: null, errors: [raw._bad], warnings, row: raw._row };
    const q = {
      type: '', text: clean(raw.text, LIMITS.text + 1), options: [], answerIndex: null, answer: '', accepted: [],
      explanation: clean(raw.explanation, LIMITS.explanation + 1),
      subject: clean(raw.subject, LIMITS.field) || defaults.subject || '',
      level: clean(raw.level, LIMITS.field) || defaults.level || '',
      topic: clean(raw.topic, LIMITS.field) || defaults.topic || '',
      difficulty: clean(raw.difficulty, 20).toLowerCase(), marks: raw.marks, image: clean(raw.image, 500),
      manual: /^(1|true|yes|y)$/i.test(clean(raw.manual)),
    };
    if (defaults.forceSubject && defaults.subject) q.subject = defaults.subject;
    if (defaults.forceTopic && defaults.topic) q.topic = defaults.topic;
    if (defaults.forceLevel && defaults.level) q.level = defaults.level;
    const answerRaw = clean(raw.answer, LIMITS.explanation);
    let opts = Array.isArray(raw.options) ? raw.options.map((o) => clean(o, LIMITS.option + 1)).filter((o) => o !== '') : [];

    // type
    const t = clean(raw.type, 40).toLowerCase();
    if (t) { q.type = TYPE_ALIASES[t] || ''; if (!q.type) errors.push('Unknown question type "' + t + '". Use mcq, tf, short or fill.'); }
    else if (opts.length) q.type = 'mcq';
    else if (/^(true|false|t|f)$/i.test(answerRaw)) q.type = 'tf';
    else if (/_{3,}/.test(q.text)) q.type = 'fill';
    else q.type = 'short';
    if (!t && q.type) warnings.push('No type given — treated as ' + TYPES[q.type] + '.');

    // text
    if (!q.text) errors.push('Question text is missing.');
    if (q.text.length > LIMITS.text) { errors.push('Question text is longer than ' + LIMITS.text + ' characters.'); q.text = q.text.slice(0, LIMITS.text); }
    if (q.explanation.length > LIMITS.explanation) { warnings.push('Explanation was shortened to ' + LIMITS.explanation + ' characters.'); q.explanation = q.explanation.slice(0, LIMITS.explanation); }
    if ([q.text, q.explanation, ...opts].some(looksLikeMarkup)) warnings.push('Contains HTML/script-like text. It will be shown as plain text and never run.');

    // answers by type
    if (q.type === 'mcq') {
      if (opts.some((o) => o.length > LIMITS.option)) { errors.push('An option is longer than ' + LIMITS.option + ' characters.'); opts = opts.map((o) => o.slice(0, LIMITS.option)); }
      if (opts.length < 2) errors.push('Multiple-choice questions need at least 2 options (found ' + opts.length + ').');
      if (opts.length > LIMITS.maxOptions) errors.push('At most ' + LIMITS.maxOptions + ' options are allowed.');
      if (new Set(opts.map(normOption)).size !== opts.length) errors.push('Two or more options are identical.');
      q.options = opts.slice(0, LIMITS.maxOptions);
      if (!answerRaw) errors.push('Correct answer is missing.');
      else {
        let idx = -1;
        if (/^[A-F]$/i.test(answerRaw)) idx = LETTERS.indexOf(answerRaw.toUpperCase());
        if (idx < 0) idx = q.options.findIndex((o) => normOption(o) === normOption(answerRaw));
        if (idx < 0) idx = q.options.findIndex((o) => normAnswer(o) === normAnswer(answerRaw));
        if (idx < 0 || idx >= q.options.length) errors.push('Answer "' + answerRaw + '" does not match any option (use a letter A–' + LETTERS[Math.max(0, q.options.length - 1)] + ' or the exact option text).');
        else q.answerIndex = idx;
      }
      if (opts.length && opts.length !== 4) warnings.push(opts.length + ' options (4 is typical).');
    } else if (q.type === 'tf') {
      if (/^(true|t|yes|y)$/i.test(answerRaw)) q.answer = 'true';
      else if (/^(false|f|no|n)$/i.test(answerRaw)) q.answer = 'false';
      else errors.push(answerRaw ? 'True/False answer must be "true" or "false" (got "' + answerRaw + '").' : 'Correct answer is missing.');
    } else if (q.type === 'short' || q.type === 'fill') {
      q.accepted = answerRaw.split('|').map((a) => a.trim()).filter(Boolean).slice(0, 20);
      if (q.type === 'fill') {
        if (!q.accepted.length) errors.push('Fill-in-the-blank questions need at least one accepted answer.');
        if (q.text && !/_{3,}/.test(q.text)) warnings.push('No blank found — add "___" where the answer goes.');
      } else if (!q.accepted.length) {
        q.manual = true;
        warnings.push('No accepted answers — this question will be marked by a teacher.');
      }
    }

    // metadata
    if (!q.subject) errors.push('Subject is missing (set it in the file or choose a destination subject).');
    if (!q.topic) errors.push('Topic is missing (set it in the file or choose a destination topic).');
    if (!q.level) { q.level = 'All levels'; warnings.push('No class/level — set to "All levels".'); }
    if (!q.difficulty) { q.difficulty = 'medium'; warnings.push('No difficulty — set to medium.'); }
    else if (!u.DIFFICULTIES.includes(q.difficulty)) { errors.push('Difficulty must be easy, medium or hard (got "' + q.difficulty + '").'); }
    if (raw.marks === '' || raw.marks == null) q.marks = 1;
    else { const m = Number(raw.marks); if (!Number.isFinite(m) || m <= 0 || m > 100) errors.push('Marks must be a number between 0 and 100.'); else q.marks = Math.round(m * 100) / 100; }
    if (q.image && !/^https:\/\/[^\s"'<>]+$/i.test(q.image) && !/^[\w\-. /]+\.(png|jpe?g|webp|gif|svg)$/i.test(q.image)) {
      warnings.push('Image reference ignored — use an https:// address or a file name like diagram1.png.'); q.image = '';
    }
    return { q, errors, warnings, row: raw._row };
  }

  /** Validate a whole batch; flags duplicates inside the batch and against an existing bank. */
  function validateBatch(raws, defaults, existing) {
    if (raws.length > LIMITS.questions) throw new Error('Too many questions in one import (' + raws.length + '). The limit is ' + LIMITS.questions + ' — split the file.');
    const seen = new Map();
    const existingKeys = new Set((existing || []).map(dupKey));
    return raws.map((raw, i) => {
      const r = validate(raw, defaults);
      if (r.row == null) r.row = i + 1;
      r.index = i; r.include = !r.errors.length; r.duplicate = null;
      if (r.q && r.q.text) {
        const k = dupKey(r.q);
        if (existingKeys.has(k)) { r.duplicate = 'Already in your question bank.'; r.include = false; }
        else if (seen.has(k)) { r.duplicate = 'Duplicate of row ' + seen.get(k) + ' in this import.'; r.include = false; }
        else seen.set(k, r.row);
      }
      return r;
    });
  }

  /** Read and sniff an uploaded file. Never trusts the extension alone. */
  async function rawFromFile(file) {
    const name = (file.name || '').toLowerCase();
    const ext = name.includes('.') ? name.split('.').pop() : '';
    if (['xlsx', 'xls', 'ods', 'numbers'].includes(ext)) throw new Error('Spreadsheet files can\'t be read directly. In Excel/Google Sheets/LibreOffice choose "Save as / Download → CSV", then import the CSV.');
    if (!['csv', 'json', 'txt'].includes(ext)) throw new Error('Unsupported file type ".' + (ext || '?') + '". Import a .csv, .json or .txt file.');
    if (file.size > LIMITS.fileBytes) throw new Error('File is too large (' + (file.size / 1048576).toFixed(1) + ' MB). The limit is 2 MB.');
    if (file.size === 0) throw new Error('The file is empty.');
    const head = await u.readFileBytes(file, 8);
    if (head[0] === 0x50 && head[1] === 0x4b) throw new Error('This file is a zipped/Office document, not plain text. Save it as CSV first.');
    const text = await u.readFileText(file);
    if (/\u0000/.test(text)) throw new Error('This file contains binary data and is not a text CSV/JSON file.');
    const trimmed = text.replace(/^﻿/, '').trimStart();
    if (ext === 'json' || ((ext === 'txt') && /^[[{]/.test(trimmed))) return { kind: 'JSON', raws: jsonToRaw(text) };
    if (ext === 'csv') {
      if (/^[[{]/.test(trimmed)) throw new Error('This .csv file actually contains JSON. Rename it to .json.');
      return { kind: 'CSV', raws: csvToRaw(text) };
    }
    return { kind: 'Text', raws: textToRaw(text) };
  }
  function rawFromPaste(text) {
    const t = String(text || '').trim();
    if (!t) throw new Error('Paste some questions first.');
    if (t.length > LIMITS.fileBytes) throw new Error('Pasted text is too long. Split it into smaller imports.');
    if (/^[[{]/.test(t)) return { kind: 'JSON', raws: jsonToRaw(t) };
    const first = t.split('\n', 1)[0].toLowerCase();
    if (/(^|[,;])\s*"?question"?\s*([,;]|$)/.test(first)) return { kind: 'CSV', raws: csvToRaw(t) };
    return { kind: 'Text', raws: textToRaw(t) };
  }

  /** Turn a validated draft into a stored question record. */
  function toRecord(q, owner, bank, extra) {
    return Object.assign({
      id: u.uid('q'), type: q.type, text: q.text, options: q.type === 'mcq' ? q.options : [],
      answerIndex: q.type === 'mcq' ? q.answerIndex : null, answer: q.type === 'tf' ? q.answer : '',
      accepted: (q.type === 'short' || q.type === 'fill') ? q.accepted : [], manual: q.type === 'short' ? !!q.manual : false,
      explanation: q.explanation, subject: q.subject, level: q.level, topic: q.topic, difficulty: q.difficulty,
      marks: q.marks, image: q.image || '', bank: bank || 'General', ownerId: owner.id, ownerRole: owner.role,
      practice: owner.role === 'student', createdAt: Date.now(), updatedAt: Date.now(),
    }, extra || {});
  }
  /** Convert a stored record back to the flat raw form (for editing & export). */
  function toRaw(q) {
    return {
      type: q.type, text: q.text, options: q.options || [],
      answer: q.type === 'mcq' ? LETTERS[q.answerIndex] : q.type === 'tf' ? q.answer : (q.accepted || []).join('|'),
      explanation: q.explanation, subject: q.subject, level: q.level, topic: q.topic, difficulty: q.difficulty,
      marks: q.marks, image: q.image, manual: q.manual ? 'yes' : '',
    };
  }

  const CSV_HEADER = ['type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'option_e', 'option_f', 'answer', 'explanation', 'subject', 'level', 'topic', 'difficulty', 'marks', 'image', 'manual_marking'];
  function exportCSV(list) {
    return toCSV([CSV_HEADER].concat(list.map((q) => {
      const r = toRaw(q); const o = r.options;
      return [r.type, r.text, o[0], o[1], o[2], o[3], o[4], o[5], r.answer, r.explanation, r.subject, r.level, r.topic, r.difficulty, r.marks, r.image, r.manual];
    })));
  }
  function exportJSON(list) {
    return JSON.stringify({ format: 'm-learning-questions', version: 1, questions: list.map((q) => {
      const r = toRaw(q); const out = { type: r.type, question: r.text };
      if (q.type === 'mcq') out.options = r.options;
      out.answer = r.answer; out.explanation = r.explanation; out.subject = r.subject; out.level = r.level; out.topic = r.topic;
      out.difficulty = r.difficulty; out.marks = r.marks; if (r.image) out.image = r.image; if (q.manual) out.manual_marking = true;
      return out;
    }) }, null, 2);
  }

  // ---------- marking ----------
  function isNumeric(s) { return /^-?\d+(\.\d+)?$/.test(s); }
  /** Returns true / false, or null when a teacher must mark it. */
  function mark(q, given) {
    if (q.type === 'mcq') return given != null && given !== '' && Number(given) === q.answerIndex;
    if (q.type === 'tf') return given === q.answer;
    const g = normAnswer(given);
    const hit = !!g && (q.accepted || []).some((a) => {
      const n = normAnswer(a);
      if (n === g) return true;
      const nn = n.replace(/,/g, ''), gg = g.replace(/,/g, '');
      return isNumeric(nn) && isNumeric(gg) && Math.abs(parseFloat(nn) - parseFloat(gg)) < 1e-9;
    });
    if (hit) return true;
    if (q.type === 'short' && q.manual) return g ? null : false;
    return false;
  }
  function correctText(q) {
    if (q.type === 'mcq') return LETTERS[q.answerIndex] + '. ' + (q.options[q.answerIndex] || '');
    if (q.type === 'tf') return q.answer === 'true' ? 'True' : 'False';
    if (q.accepted && q.accepted.length) return q.accepted.join(' / ');
    return 'Marked by your teacher';
  }
  function givenText(q, given) {
    if (given == null || given === '') return 'No answer';
    if (q.type === 'mcq') return LETTERS[Number(given)] + '. ' + (q.options[Number(given)] || '');
    if (q.type === 'tf') return given === 'true' ? 'True' : 'False';
    return String(given);
  }
  /** Student-safe copy: no answer key, no explanation. */
  function stripForStudent(q, marks) {
    return { id: q.id, type: q.type, text: q.text, options: q.type === 'mcq' ? q.options.slice() : [], image: q.image || '', marks: marks != null ? marks : q.marks, topic: q.topic, subject: q.subject };
  }

  const CSV_TEMPLATE = toCSV([
    CSV_HEADER,
    ['mcq', 'What is 7 × 8?', '54', '56', '64', '48', '', '', 'B', '7 × 8 = 56. Think of 7 × 4 = 28, then double it.', 'Mathematics', 'Primary 5', 'Multiplication', 'easy', '1', '', ''],
    ['tf', 'A noun is a naming word.', '', '', '', '', '', '', 'true', 'Nouns name people, places, animals and things.', 'English', 'Primary 4', 'Parts of Speech', 'easy', '1', '', ''],
    ['fill', 'The process by which plants make food is called ___.', '', '', '', '', '', '', 'photosynthesis', 'Plants use sunlight, water and carbon dioxide to make glucose.', 'Basic Science', 'JSS 1', 'Living Things', 'medium', '2', '', ''],
    ['short', 'Solve for x: 3x + 5 = 20', '', '', '', '', '', '', '5|x=5|x = 5', '3x = 15, so x = 5.', 'Mathematics', 'JSS 1', 'Linear Equations', 'medium', '2', '', ''],
    ['short', 'In one or two sentences, explain why we need computers in schools.', '', '', '', '', '', '', '', 'Look for: faster research, typing, record keeping, learning programs.', 'Computer Studies', 'JSS 1', 'Introduction to Computers', 'medium', '3', '', 'yes'],
  ]);
  const JSON_TEMPLATE = JSON.stringify({ format: 'm-learning-questions', version: 1, questions: [
    { type: 'mcq', question: 'What is 7 × 8?', options: ['54', '56', '64', '48'], answer: 'B', explanation: '7 × 8 = 56.', subject: 'Mathematics', level: 'Primary 5', topic: 'Multiplication', difficulty: 'easy', marks: 1 },
    { type: 'tf', question: 'A noun is a naming word.', answer: 'true', explanation: 'Nouns name people, places, animals and things.', subject: 'English', level: 'Primary 4', topic: 'Parts of Speech', difficulty: 'easy', marks: 1 },
    { type: 'fill', question: 'The process by which plants make food is called ___.', answer: 'photosynthesis', explanation: 'Plants use sunlight, water and carbon dioxide.', subject: 'Basic Science', level: 'JSS 1', topic: 'Living Things', difficulty: 'medium', marks: 2 },
    { type: 'short', question: 'Solve for x: 3x + 5 = 20', answer: ['5', 'x=5', 'x = 5'], explanation: '3x = 15, so x = 5.', subject: 'Mathematics', level: 'JSS 1', topic: 'Linear Equations', difficulty: 'medium', marks: 2 },
    { type: 'short', question: 'Explain why we need computers in schools.', answer: '', manual_marking: true, explanation: 'Look for: research, typing, record keeping.', subject: 'Computer Studies', level: 'JSS 1', topic: 'Introduction to Computers', difficulty: 'medium', marks: 3 },
  ] }, null, 2);
  const TEXT_TEMPLATE = [
    'Q: What is 7 × 8?', 'A) 54', 'B) 56', 'C) 64', 'D) 48', 'Answer: B', 'Explanation: 7 × 8 = 56.', 'Topic: Multiplication', 'Subject: Mathematics', 'Difficulty: easy', '',
    'Q: A noun is a naming word.', 'Type: tf', 'Answer: true', 'Topic: Parts of Speech', 'Subject: English', '',
    'Q: Water boils at ___ degrees Celsius at sea level.', 'Type: fill', 'Answer: 100|100°C', 'Topic: Matter', 'Subject: Basic Science',
  ].join('\n');

  ML.Q = { LIMITS, TYPES, LETTERS, parseCSV, toCSV, csvToRaw, jsonToRaw, textToRaw, validate, validateBatch, rawFromFile, rawFromPaste,
    toRecord, toRaw, exportCSV, exportJSON, mark, correctText, givenText, stripForStudent, dupKey, normAnswer,
    CSV_TEMPLATE, JSON_TEMPLATE, TEXT_TEMPLATE };
})();
