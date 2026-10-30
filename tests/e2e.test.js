/* End-to-end test for M Learning App using Playwright + Chromium.
 * Run:  npm install playwright (if needed) && node tests/e2e.test.js
 * Starts its own static server, drives a real browser, and exits non-zero on failure. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.csv': 'text/csv', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  if (p === '/api/config') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; } // like Vercel with no Supabase env vars → local mode
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});

// ---- tiny PNG encoder (RGBA, with transparency) so the test needs no image files ----
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) {
    const i = y * (w * 4 + 1) + 1 + x * 4; const inside = (x - w / 2) ** 2 + (y - h / 2) ** 2 < (w / 2.3) ** 2;
    raw[i] = rgb[0]; raw[i + 1] = rgb[1]; raw[i + 2] = rgb[2]; raw[i + 3] = inside ? 255 : 0; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let passed = 0; const failures = [];
function check(cond, name) { if (cond) { passed++; console.log('  ✓', name); } else { failures.push(name); console.log('  ✗', name); } }

(async () => {
  await new Promise((r) => server.listen(0, r));
  const BASE = 'http://localhost:' + server.address().port + '/';
  // Use Playwright's own browser; fall back to a system Chromium if that version isn't downloaded.
  const fallback = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].filter((x) => x && fs.existsSync(x));
  const browser = await chromium.launch().catch((e) => { if (!fallback.length) throw e; return chromium.launch({ executablePath: fallback[0] }); });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  const errors = []; let alerts = 0;
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
  p.on('dialog', async (d) => { alerts++; await d.dismiss(); });
  const modalBtn = (label) => p.locator('dialog.modal button', { hasText: label }).click();
  const hash = () => p.evaluate(() => location.hash);
  const fill = async (sel, v) => p.fill(sel, v);
  async function login(user, pw) { await p.goto(BASE + '#/login'); await fill('input[name=username]', user); await fill('input[name=password]', pw); await p.click('button[type=submit]'); await p.waitForFunction(() => !location.hash.startsWith('#/login')); await p.waitForTimeout(300); }
  async function logout() { await p.evaluate(() => ML.logout()); await p.waitForFunction(() => location.hash === '#/login'); }

  console.log('Accounts & roles');
  await p.goto(BASE); await p.waitForSelector('text=Set up M Learning');
  await fill('input[name=fullName]', 'Mrs Sade Bello'); await fill('input[name=username]', 'msbello'); await fill('input[name=email]', 'sade@example.com');
  await fill('input[name=password]', 'short'); await fill('input[name=confirm]', 'other'); await p.click('button[type=submit]');
  check(await p.locator('.field.invalid').count() >= 2, 'registration validation shows field errors');
  await fill('input[name=password]', 'Teach1234'); await fill('input[name=confirm]', 'Teach1234'); await p.click('button[type=submit]');
  await p.waitForFunction(() => location.hash === '#/teacher'); check(true, 'first-run teacher setup lands on teacher dashboard');
  const stored = await p.evaluate(async () => (await ML.db.all('users'))[0]);
  check(stored.pw && stored.pw.hash && !JSON.stringify(stored).includes('Teach1234'), 'password stored as salted hash, never plain text');
  await logout();
  await p.goto(BASE + '#/register');
  await fill('input[name=fullName]', 'Ada Obi'); await fill('input[name=username]', 'ada'); await fill('input[name=email]', 'sade@example.com');
  await fill('input[name=password]', 'Learn1234'); await fill('input[name=confirm]', 'Learn1234'); await p.click('button[type=submit]');
  await p.waitForSelector('.form-msg.error'); check(/email/i.test(await p.textContent('.form-msg')), 'duplicate email rejected');
  await fill('input[name=email]', 'ada@example.com'); await p.click('button[type=submit]');
  await p.waitForFunction(() => location.hash === '#/home'); await p.waitForSelector('text=Hi, Ada');
  check(true, 'student registers and sees personalised dashboard');
  await p.goto(BASE + '#/teacher'); await p.waitForTimeout(500);
  check((await hash()) === '#/home', 'student is redirected away from teacher dashboard');
  check(await p.locator('a[href="#/teacher/students"]').count() === 0, 'teacher navigation hidden from students');
  const studentBank = await p.evaluate(async () => (await ML.bank.visible(await ML.auth.currentUser())).length);
  check(studentBank === 0, 'student cannot see teacher question bank (answer keys)');
  const denied = await p.evaluate(async () => { try { await ML.quizSvc.save({ title: 'x', questionIds: ['a'], assign: { type: 'all' } }, true); return false; } catch (e) { return /Teacher/.test(e.message); } });
  check(denied, 'teacher-only service calls refuse student accounts');

  console.log('Character import & background');
  await p.goto(BASE + '#/character');
  await p.setInputFiles('#file', { name: 'fox.png', mimeType: 'image/png', buffer: png(400, 500, [240, 120, 40]) });
  await p.waitForSelector('#apply'); check(await p.locator('.preview-box img').count() === 1, 'preview shown before applying');
  await p.click('#apply'); await p.waitForTimeout(400);
  check(await p.evaluate(() => document.documentElement.classList.contains('has-character') && document.getElementById('char-img').src.startsWith('blob:')), 'applied character becomes the app background');
  await p.setInputFiles('#file', { name: 'blue-cat.png', mimeType: 'image/png', buffer: png(300, 300, [40, 90, 240]) });
  await p.waitForSelector('#save-only'); await p.click('#save-only'); await p.waitForTimeout(400);
  check(await p.locator('.char-card').count() >= 3 && await p.locator('.char-grid .char-card').count() === 2, 'library holds both characters');
  const firstSrc = await p.getAttribute('#char-img', 'src');
  await p.locator('[data-use]').first().click(); await p.waitForTimeout(400);
  check((await p.getAttribute('#char-img', 'src')) !== firstSrc, 'Use switches background immediately (no reload)');
  await p.setInputFiles('#file', { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('this is not really an image file at all, just text pretending to be png'.repeat(3)) });
  await p.waitForSelector('#preview-area .form-msg.error'); check(/real PNG/.test(await p.textContent('#preview-area')), 'renamed non-image file is rejected');
  await p.setInputFiles('#file', { name: 'notes.gif', mimeType: 'image/gif', buffer: Buffer.alloc(500) });
  await p.waitForSelector('#preview-area .form-msg.error'); check(/Unsupported/.test(await p.textContent('#preview-area')), 'unsupported extension rejected');
  await p.reload(); await p.waitForTimeout(800);
  check(await p.evaluate(() => document.documentElement.classList.contains('has-character')), 'character background restored after refresh');
  await p.goto(BASE + '#/courses'); await p.waitForTimeout(300);
  check(await p.evaluate(() => document.documentElement.classList.contains('has-character')), 'character stays visible on other pages');
  await p.click('#theme-btn'); await p.waitForTimeout(200);
  check(await p.evaluate(() => document.documentElement.dataset.theme === 'dark' && document.documentElement.classList.contains('has-character')), 'dark mode keeps the character background');
  await p.screenshot({ path: path.join(OUT, 'courses-dark-character.png'), fullPage: false });
  await p.click('#theme-btn');
  await p.goto(BASE + '#/character'); await p.waitForSelector('#remove'); await p.click('#remove'); await p.waitForTimeout(300);
  check(await p.evaluate(() => !document.documentElement.classList.contains('has-character')), 'Remove restores the default background');
  check(await p.locator('.char-grid .char-card').count() === 2, 'Remove keeps saved characters in the library');
  await p.locator('[data-del]').first().click(); await modalBtn('Delete'); await p.waitForTimeout(300);
  check(await p.locator('.char-grid .char-card').count() === 1, 'Delete (after confirmation) removes one saved character');
  await p.locator('[data-use]').first().click(); await p.waitForTimeout(300);

  console.log('Lessons & practice');
  await p.goto(BASE + '#/lesson/l_math_frac'); await p.waitForSelector('text=Worked examples');
  await p.check('#complete'); await p.waitForTimeout(200);
  await p.click('#practice'); await p.waitForSelector('#start'); await p.click('#start'); await p.waitForSelector('.q-text');
  if (await p.locator('[data-opt]').count()) await p.locator('[data-opt]').first().click(); else if (await p.locator('[data-tf]').count()) await p.locator('[data-tf]').first().click(); else await p.fill('#ans', '2/3');
  await p.click('#check');
  await p.waitForSelector('.feedback'); check(true, 'topic practice gives instant feedback');
  await p.goto(BASE + '#/home'); await modalBtn('Leave quiz'); await p.waitForTimeout(400);
  check((await hash()) === '#/home', 'leaving a quiz asks for confirmation');

  console.log('Quiz engine (instant feedback)');
  await p.goto(BASE + '#/quiz/qz_math_start'); await p.click('#start'); await p.waitForSelector('.q-text');
  const n = await p.locator('.q-palette button').count();
  const cheat = await p.evaluate(() => document.getElementById('view').innerHTML.includes('Counting from the right'));
  check(!cheat, 'explanations are not in the page before answering');
  for (let i = 0; i < n; i++) {
    if (await p.locator('[data-opt]').count()) await p.locator('[data-opt]').nth(1).click(); else if (await p.locator('[data-tf]').count()) await p.locator('[data-tf="false"]').click(); else await p.fill('#ans', '17');
    await p.click('#check'); await p.waitForSelector('.feedback');
    if (i < n - 1) await p.click('#next');
  }
  await p.click('#prev'); check(await p.locator('.feedback').count() === 1, 'Previous shows the locked, already-checked answer');
  await p.click('#submit'); await modalBtn('Submit quiz');
  await p.waitForSelector('.score-ring'); const pct = await p.textContent('.score-ring b');
  check(/\d+%/.test(pct), 'results page shows score: ' + pct);
  const att = await p.evaluate(async () => (await ML.db.all('attempts')).find((a) => a.quizId === 'qz_math_start'));
  check(att && att.totalQuestions === n && att.correctCount + att.incorrectCount === n && att.quizTitle && att.finishedAt, 'attempt records name/date/total/correct/incorrect');

  console.log('Quiz engine (feedback after submit, timer)');
  await p.goto(BASE + '#/quiz/qz_eng_gram'); await p.click('#start'); await p.waitForSelector('.q-text');
  check(await p.locator('#timer').count() === 1 && await p.locator('#check').count() === 0, 'timer shown and no instant feedback in "after" mode');
  await p.locator('[data-go]').nth(3).click(); check((await p.textContent('.badge.purple')).includes('Question 4'), 'question palette navigation works');
  await p.click('#restart'); await modalBtn('Restart'); await p.waitForSelector('.q-text'); check(true, 'Restart quiz works');
  if (await p.locator('[data-opt]').count()) await p.locator('[data-opt]').first().click();
  await p.click('#submit'); await modalBtn('Submit quiz'); await p.waitForSelector('.score-ring');
  const att2 = await p.evaluate(async () => (await ML.db.all('attempts')).find((a) => a.quizId === 'qz_eng_gram'));
  check(att2.timerEnabled && att2.timeLimitMin === 8 && att2.timeTakenSec >= 0, 'timed attempt records time taken');
  await p.goto(BASE + '#/progress'); await p.waitForSelector('text=Score history');
  check(await p.locator('table tbody tr').count() >= 2, 'progress page lists score history');
  await p.screenshot({ path: path.join(OUT, 'student-progress.png'), fullPage: true });
  await p.goto(BASE + '#/home'); await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, 'student-dashboard.png'), fullPage: true });
  const otherAttempt = await p.evaluate(async () => { const a = await ML.db.put('attempts', { id: 'at_other', userId: 'someone_else', quizId: 'x', quizTitle: 'Secret', answers: [], finishedAt: Date.now(), percent: 1 }); return !!(await ML.quizSvc.attempt(await ML.auth.currentUser(), 'at_other')); });
  check(!otherAttempt, 'student cannot open another student\'s result');
  await p.evaluate(() => ML.db.del('attempts', 'at_other'));
  await logout();

  console.log('Teacher: import questions');
  await login('msbello', 'Teach1234');
  await p.goto(BASE + '#/import');
  await p.setInputFiles('#qfile', path.join(ROOT, 'templates', 'test-import-with-errors.csv'));
  await p.waitForSelector('text=Destination');
  const stat = async (i) => Number(await p.locator('.stat .value').nth(i).textContent());
  check(await stat(0) === 7, 'parsed all 7 rows');
  check(await stat(2) === 4, 'flagged 4 rows with errors');
  check(await stat(3) === 1, 'flagged 1 duplicate row');
  check(await stat(1) === 2, '2 rows ready to import');
  // fix row 4 (bad answer letter)
  await p.locator('tr', { hasText: 'Which is a prime number?' }).locator('[data-fix]').click();
  await p.fill('dialog input[name=opt2]', '7'); await p.selectOption('dialog select[name=mcqAnswer]', 'C');
  await modalBtn('Save question'); await p.waitForTimeout(300);
  check(await stat(1) === 3 && await stat(2) === 3, 'fixing a row makes it importable');
  await p.selectOption('[data-d=subject]', 'English'); await p.fill('[data-d=topic]', 'Geography Words'); await p.locator('[data-d=topic]').dispatchEvent('change'); await p.waitForTimeout(200);
  check(!(await p.textContent('table')).includes('Topic is missing'), 'destination topic fills a missing topic');
  await p.fill('[data-d=bank]', 'Week 1 Test'); await p.locator('[data-d=bank]').dispatchEvent('change');
  const before = await p.evaluate(async () => (await ML.db.all('questions')).length);
  await p.click('#confirm'); await modalBtn('Import now');
  await p.waitForSelector('text=Import complete');
  const after = await p.evaluate(async () => (await ML.db.all('questions')).length);
  check(after - before === 3, 'imported exactly the 3 valid included rows');
  check(/Rejected/.test(await p.textContent('#view')), 'summary lists rejected rows with reasons');
  await p.goto(BASE + '#/bank'); await p.fill('[data-f=q]', 'plain text'); await p.waitForTimeout(500);
  check(await p.locator('td', { hasText: '<script>alert("hi")</script>' }).count() === 1 && alerts === 0, 'imported <script> is shown as text and never runs');
  await p.screenshot({ path: path.join(OUT, 'teacher-bank.png'), fullPage: false });
  // bad file types
  await p.goto(BASE + '#/import');
  await p.setInputFiles('#qfile', { name: 'book.xlsx', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('PK\u0003\u0004 fake') });
  await p.waitForSelector('#src-msg.error'); check(/CSV/.test(await p.textContent('#src-msg')), 'spreadsheet file gets a helpful "save as CSV" error');
  await p.setInputFiles('#qfile', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"questions": [ {"question": "x", ') });
  await p.waitForSelector('#src-msg.error'); check(/not valid JSON/.test(await p.textContent('#src-msg')), 'malformed JSON reported clearly');
  check(await p.evaluate(async () => (await ML.db.all('questions')).length) === after, 'failed imports leave the bank unchanged');
  // paste import
  await p.click('[data-src=paste]');
  await p.fill('#paste', 'Q: 2 + 3 = ?\nA) 4\nB) 5\nC) 6\nD) 7\nAnswer: B\nTopic: Addition\nSubject: Mathematics\n\nQ: The capital of Nigeria is ___.\nType: fill\nAnswer: Abuja\nTopic: Geography Words\nSubject: English');
  await p.click('#parse'); await p.waitForSelector('text=Destination');
  check(await stat(1) === 2, 'pasted plain-text questions parsed');
  await p.click('#confirm'); await modalBtn('Import now'); await p.waitForSelector('text=Import complete');

  console.log('Teacher: build, preview and publish a quiz');
  await p.goto(BASE + '#/teacher/quiz/new');
  await p.fill('#qf input[name=title]', 'Week 1 Mixed Test');
  await p.selectOption('[data-p=subject]', 'English'); await p.waitForTimeout(400);
  const addable = await p.locator('[data-add]').count();
  for (let i = 0; i < Math.min(3, addable); i++) await p.locator('[data-add]').first().click();
  await p.selectOption('[data-p=subject]', 'Basic Science'); await p.waitForTimeout(300);
  await p.locator('li', { hasText: 'reduce pollution' }).locator('[data-add]').click();
  await p.fill('#qf input[name=time]', '5'); await p.selectOption('#qf select[name=feedback]', 'after');
  await p.click('#preview'); await p.waitForSelector('dialog #show-key');
  check(await p.locator('dialog .key[hidden]').count() >= 4, 'quiz preview hides the answer key by default');
  await modalBtn('Close');
  await p.click('#publish'); await p.waitForFunction(() => location.hash === '#/teacher/quizzes');
  check(await p.locator('td', { hasText: 'Week 1 Mixed Test' }).count() === 1, 'quiz published');
  await p.locator('tr', { hasText: 'Week 1 Mixed Test' }).locator('a', { hasText: 'Try' }).click(); await p.click('#start'); await p.waitForSelector('.q-text');
  await p.click('#submit'); await modalBtn('Submit quiz'); await p.waitForSelector('text=Teacher preview');
  check(await p.evaluate(async () => !(await ML.db.all('attempts')).some((a) => a.userId === ML.settings.userId)), 'teacher preview attempts are not stored');
  await logout();

  console.log('Student takes the new quiz; teacher marks it');
  await login('ada', 'Learn1234');
  await p.goto(BASE + '#/notifications'); await p.waitForSelector('text=Notifications'); await p.waitForTimeout(300); check(await p.locator('text=New quiz: Week 1 Mixed Test').count() === 1, 'student notified about assigned quiz');
  await p.locator('[data-read]').first().click(); await p.waitForTimeout(300);
  await p.goto(BASE + '#/quizzes'); await p.locator('a', { hasText: 'Week 1 Mixed Test' }).click(); await p.click('#start'); await p.waitForSelector('.q-text');
  const qn = await p.locator('.q-palette button').count();
  for (let i = 0; i < qn; i++) {
    if (await p.locator('[data-opt]').count()) await p.locator('[data-opt]').first().click();
    else if (await p.locator('[data-tf]').count()) await p.locator('[data-tf="true"]').click();
    else await p.fill('#ans', 'Recycling and proper waste disposal');
    if (i < qn - 1) await p.click('#next');
  }
  await p.click('#submit'); await modalBtn('Submit quiz'); await p.waitForSelector('.score-ring');
  check(await p.locator('text=Awaiting teacher').count() >= 1, 'teacher-marked question shows as awaiting marking');
  await logout();
  await login('msbello', 'Teach1234');
  await p.goto(BASE + '#/teacher/results'); await p.locator('[data-mark]').first().click();
  await p.waitForSelector('dialog [data-q]');
  for (const inp of await p.locator('dialog [data-q]').all()) if (!(await inp.inputValue())) await inp.fill('2');
  await modalBtn('Save marks'); await p.waitForTimeout(400);
  const graded = await p.evaluate(async () => (await ML.db.all('attempts')).find((a) => a.quizTitle === 'Week 1 Mixed Test'));
  check(graded.status === 'marked' && graded.gradedBy, 'teacher marking finalises the score (' + graded.percent + '%)');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#export')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  check(/Ada Obi/.test(csv) && /Week 1 Mixed Test/.test(csv), 'results export CSV contains the attempt');
  await p.goto(BASE + '#/teacher/students'); await p.locator('[data-reset]').first().click();
  await p.fill('#prompt-input', 'NewPass99'); await modalBtn('Set password'); await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(OUT, 'teacher-students.png') });
  await p.goto(BASE + '#/teacher'); await p.waitForTimeout(300); await p.screenshot({ path: path.join(OUT, 'teacher-dashboard.png'), fullPage: true });
  await logout();
  await login('ada', 'NewPass99'); check((await hash()) === '#/home', 'student logs in with teacher-reset password');
  await p.goto(BASE + '#/notifications'); await p.waitForTimeout(500); check(await p.locator('text=Marked: Week 1 Mixed Test').count() === 1, 'student notified when marking is done');

  console.log('Mobile layout');
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(BASE + '#/home'); await p.waitForTimeout(500);
  check(await p.locator('.bottom-nav').isVisible(), 'bottom navigation on phones');
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, 'no horizontal scrolling at phone width');
  await p.screenshot({ path: path.join(OUT, 'mobile-dashboard.png'), fullPage: false });
  await p.goto(BASE + '#/quiz/qz_math_start'); await p.click('#start'); await p.waitForSelector('.q-text'); await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(OUT, 'mobile-quiz.png') });

  check(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close(); server.close();
  console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) { console.log('FAILED:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
