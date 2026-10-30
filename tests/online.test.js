/* Online-mode wiring test. Points the app at a FAKE Supabase URL and answers its HTTP requests
 * (Auth, PostgREST tables, RPCs) from this script, so we can verify the real supabase-js client
 * sends the right requests and the app handles the responses. It does NOT test a real database —
 * tests/sql.test.js covers the SQL/RLS side. Run: node tests/online.test.js */
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const SB = 'https://fake-project.supabase.co';
const UID = '11111111-2222-4333-8444-555555555555';
let apiConfig = { supabaseUrl: SB, supabaseKey: 'sb_publishable_test123' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  if (p === '/api/config') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(apiConfig)); return; }
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});

// sample content from the real seed, shaped like database rows
const ctx = { console, crypto: require('crypto').webcrypto, TextEncoder, btoa, atob }; ctx.window = ctx; vm.createContext(ctx);
['util', 'questions', 'seed'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx));
const seed = ctx.ML.seed.build({ stableIds: true });
const TABLES = {
  courses: seed.courses.map((c) => ({ id: c.id, data: c })),
  lessons: seed.lessons.map((l) => ({ id: l.id, course_id: l.courseId, data: l })),
  quizzes: seed.quizzes.map((q) => ({ id: q.id, data: q })),
  attempts: [], notifications: [], progress: [], questions: [], characters: [],
};
const PROFILE = { id: UID, role: 'student', username: 'ada', full_name: 'Ada Obi', email: 'ada@example.com', level: 'JSS 1', preferred_subjects: [], avatar_path: null, created_at: new Date().toISOString(), last_active_at: new Date().toISOString() };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ sub: UID, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig';
const SESSION = { access_token: JWT, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh', user: { id: UID, email: PROFILE.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, identities: [{ id: '1' }], created_at: PROFILE.created_at } };

let passed = 0; const failures = [];
const check = (c, n) => { if (c) { passed++; console.log('  ✓', n); } else { failures.push(n); console.log('  ✗', n); } };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const BASE = 'http://localhost:' + server.address().port + '/';
  const fallback = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].filter((x) => x && fs.existsSync(x));
  const browser = await chromium.launch().catch((e) => { if (!fallback.length) throw e; return chromium.launch({ executablePath: fallback[0] }); });
  const page = await browser.newPage();
  const errors = []; const calls = [];
  page.on('pageerror', (e) => errors.push(e.message));

  let signupHasSession = false;
  await page.route(SB + '/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname; const m = req.method();
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ m, p, q: url.search, body, auth: req.headers().authorization || '', apikey: req.headers().apikey || '' });
    const json = (status, data, headers) => route.fulfill({ status, contentType: 'application/json', headers: Object.assign({ 'access-control-allow-origin': '*' }, headers || {}), body: data === undefined ? '' : JSON.stringify(data) });
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (p === '/auth/v1/token') {
      if (body && body.password === 'Learn1234') return json(200, SESSION);
      return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    }
    if (p === '/auth/v1/signup') return json(200, signupHasSession ? SESSION : Object.assign({}, SESSION.user, { identities: [{ id: '2' }], confirmation_sent_at: new Date().toISOString() }));
    if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    if (p === '/auth/v1/user') return json(200, SESSION.user);
    if (p === '/rest/v1/rpc/username_available') return json(200, true);
    if (p === '/rest/v1/rpc/quiz_start') return json(200, { sessionId: 'sess-1', missing: 0, quiz: { id: body.p_quiz_id, title: 'Mathematics Starter Quiz', subject: 'Mathematics', description: '', timeLimitMin: 0, feedbackMode: 'immediate', practice: false },
      questions: [{ id: 'q_seed_001', type: 'mcq', text: 'What is the value of the digit 6 in 46,215?', options: ['6', '600', '6,000', '60,000'], image: '', marks: 1, topic: 'Place Value', subject: 'Mathematics' },
        { id: 'q_seed_004', type: 'fill', text: '8 × 7 = ___', options: [], image: '', marks: 1, topic: 'Multiplication', subject: 'Mathematics' }] });
    if (p === '/rest/v1/rpc/quiz_check') return json(200, { correct: body.p_given === 2, correctText: 'C. 6,000', explanation: 'Counting from the right…', given: body.p_given });
    if (p === '/rest/v1/rpc/quiz_submit') {
      const att = { id: 'at_1', quizId: 'qz_math_start', quizTitle: 'Mathematics Starter Quiz', subject: 'Mathematics', userId: UID, userName: 'Ada Obi', userLevel: 'JSS 1', practice: false, startedAt: Date.now() - 60000, finishedAt: Date.now(),
        timerEnabled: false, timeLimitMin: 0, timeTakenSec: 60, autoSubmitted: false, totalQuestions: 2, correctCount: 1, incorrectCount: 1, pendingCount: 0, score: 1, maxScore: 2, percent: 50, status: 'marked',
        answers: [{ qid: 'q_seed_001', type: 'mcq', text: 'What is the value of the digit 6 in 46,215?', options: [], givenText: 'C. 6,000', correct: true, correctText: 'C. 6,000', explanation: '', marks: 1, awarded: 1 },
          { qid: 'q_seed_004', type: 'fill', text: '8 × 7 = ___', options: [], givenText: '54', correct: false, correctText: '56', explanation: '', marks: 1, awarded: 0 }] };
      TABLES.attempts.push({ id: att.id, user_id: UID, quiz_id: att.quizId, data: att });
      return json(200, att);
    }
    const tm = p.match(/^\/rest\/v1\/(\w+)$/);
    if (tm) {
      const t = tm[1];
      if (m === 'PATCH' || m === 'DELETE') return json(204);
      if (m === 'POST') return json(201);
      let rows = t === 'profiles' ? [PROFILE] : (TABLES[t] || []);
      url.searchParams.forEach((v, k) => { if (/^eq\./.test(v)) rows = rows.filter((r) => String(r[k]) === v.slice(3)); });
      const single = /vnd\.pgrst\.object/.test(req.headers().accept || '');
      if (single) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' });
      return json(200, rows, { 'content-range': '0-' + Math.max(0, rows.length - 1) + '/' + rows.length });
    }
    return json(404, { message: 'not mocked: ' + p });
  });

  console.log('Online mode start-up');
  await page.goto(BASE); await page.waitForSelector('text=Welcome back!');
  check(await page.locator('input[name=username][type=email]').count() === 1, 'login asks for email in online mode');
  check(await page.locator('text=stored securely online').count() === 1, 'login page says data is online');
  check(await page.evaluate(() => ML.remote.enabled === true), 'app switched to Supabase');

  console.log('Login');
  await page.fill('input[name=username]', 'ada@example.com'); await page.fill('input[name=password]', 'wrongpass1'); await page.click('button[type=submit]');
  await page.waitForSelector('.form-msg.error'); check(/Incorrect email or password/.test(await page.textContent('.form-msg')), 'wrong password shows a friendly error');
  await page.fill('input[name=password]', 'Learn1234'); await page.click('button[type=submit]');
  await page.waitForSelector('text=Hi, Ada'); check(true, 'login loads the profile and dashboard');
  const tokenCall = calls.find((c) => c.p === '/auth/v1/token');
  check(tokenCall && tokenCall.apikey === 'sb_publishable_test123' && tokenCall.body.email === 'ada@example.com', 'login uses Supabase Auth with the publishable key');
  const authed = calls.filter((c) => c.p.startsWith('/rest/v1/') && c.auth === 'Bearer ' + JWT);
  check(authed.length > 0, 'database requests carry the signed-in user\'s token');
  check(await page.evaluate(() => !!localStorage.getItem('ml.supabase.auth')), 'session persisted for next visit');

  console.log('Content & quiz via RPC');
  await page.goto(BASE + '#/courses'); await page.waitForTimeout(800);
  check(await page.locator('a.card').count() === 12, 'course library loads 12 courses from the database');
  await page.goto(BASE + '#/quiz/qz_math_start'); await page.click('#start'); await page.waitForSelector('.q-text');
  const startCall = calls.find((c) => c.p === '/rest/v1/rpc/quiz_start');
  check(startCall && startCall.body.p_quiz_id === 'qz_math_start', 'quiz starts through the quiz_start function');
  await page.locator('[data-opt]').nth(2).click(); await page.click('#check'); await page.waitForSelector('.feedback.ok');
  const chk = calls.find((c) => c.p === '/rest/v1/rpc/quiz_check');
  check(chk && chk.body.p_session === 'sess-1' && chk.body.p_qid === 'q_seed_001' && chk.body.p_given === 2, 'answer checked on the server (quiz_check)');
  await page.click('#next'); await page.fill('#ans', '54'); await page.click('#submit');
  await page.locator('dialog.modal button', { hasText: 'Submit quiz' }).click();
  await page.waitForSelector('.score-ring'); check((await page.textContent('.score-ring b')) === '50%', 'server-marked result is shown');
  const sub = calls.find((c) => c.p === '/rest/v1/rpc/quiz_submit');
  check(sub && sub.body.p_session === 'sess-1' && sub.body.p_answers.q_seed_004 === '54' && sub.body.p_auto === false, 'answers sent to quiz_submit');
  check(!calls.some((c) => c.p === '/rest/v1/attempts' && c.m === 'POST'), 'the browser never writes scores directly');

  console.log('Logout & registration');
  await page.evaluate(() => ML.logout()); await page.waitForSelector('text=Welcome back!');
  check(calls.some((c) => c.p === '/auth/v1/logout'), 'logout signs out of Supabase');
  await page.goto(BASE + '#/register');
  await page.fill('input[name=fullName]', 'Ben Ade'); await page.fill('input[name=username]', 'ben'); await page.fill('input[name=email]', 'ben@example.com');
  await page.fill('input[name=password]', 'Learn1234'); await page.fill('input[name=confirm]', 'Learn1234'); await page.click('button[type=submit]');
  await page.waitForSelector('.form-msg.success'); check(/confirmation link/.test(await page.textContent('.form-msg')), 'sign-up asks the student to confirm their email');
  const su = calls.find((c) => c.p === '/auth/v1/signup');
  check(su && su.body.data.username === 'ben' && su.body.data.level === 'JSS 1' && !JSON.stringify(su.body.data).includes('Learn1234'), 'sign-up sends profile details (not the password) as metadata');
  check(calls.some((c) => c.p === '/rest/v1/rpc/username_available'), 'username availability checked first');
  await page.goto(BASE + '#/forgot'); await page.waitForSelector('text=Reset your password'); check(true, 'password reset page available');

  console.log('Safety');
  apiConfig = { supabaseUrl: SB, supabaseKey: b64u({ alg: 'HS256' }) + '.' + b64u({ role: 'service_role' }) + '.x' };
  const p2 = await browser.newPage(); await p2.goto(BASE); await p2.waitForTimeout(800);
  check(/secret Supabase key/.test(await p2.textContent('#app')), 'app refuses to run with a service_role key');
  apiConfig = {}; const p3 = await browser.newPage(); await p3.goto(BASE); await p3.waitForTimeout(800);
  check(await p3.evaluate(() => ML.remote.enabled === false), 'no config → local mode');

  check(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close(); server.close();
  console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) { console.log('FAILED:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
