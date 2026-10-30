/* Tests supabase/schema.sql + seed.sql on a real Postgres engine (PGlite, in-process).
 * Supabase's `auth` and `storage` schemas are stubbed with the few pieces the schema uses.
 * Run: node tests/sql.test.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

let passed = 0; const failures = [];
const check = (cond, name) => { if (cond) { passed++; console.log('  ✓', name); } else { failures.push(name); console.log('  ✗', name); } };

const STUBS = `
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text not null, raw_user_meta_data jsonb, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema public, auth, storage to anon, authenticated;
grant execute on function auth.uid(), storage.foldername(text) to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
`;

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(STUBS);
  const schema = fs.readFileSync(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8');
  await db.exec(schema);
  await db.exec(schema); // must be re-runnable
  check(true, 'schema.sql runs (twice)');
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'seed.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'seed.sql'), 'utf8'));
  const counts = (await db.query("select (select count(*) from courses) c, (select count(*) from lessons) l, (select count(*) from questions) q, (select count(*) from question_keys) k, (select count(*) from quizzes) z")).rows[0];
  check(Number(counts.c) === 12 && Number(counts.l) === 24 && Number(counts.q) === 60 && Number(counts.k) === 60 && Number(counts.z) === 3, 'seed.sql loads (twice) with all sample rows');

  // ---- helpers: run SQL as a signed-in user, or anonymously ----
  async function as(uid, sql, params) {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
    try { return await db.query(sql, params || []); } finally { await db.exec('reset role;'); }
  }
  async function fails(uid, sql, params) { try { await as(uid, sql, params); return false; } catch (e) { return e.message || true; } }
  async function signUp(email, username, opts) {
    const r = await db.query('insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ($1, $2, $3) returning id',
      [email, JSON.stringify({ username, full_name: username + ' Test', level: (opts && opts.level) || 'JSS 1' }), opts && opts.confirmed ? new Date() : null]);
    return r.rows[0].id;
  }
  const confirm = (id) => db.query('update auth.users set email_confirmed_at = now() where id = $1', [id]);

  console.log('Accounts & roles');
  const ada = await signUp('ada@example.com', 'ada', { level: 'JSS 1' });
  const ben = await signUp('ben@example.com', 'ben', { level: 'JSS 2' });
  check((await db.query('select role from profiles where id=$1', [ada])).rows[0].role === 'student', 'sign-up creates a student profile');
  await db.query("insert into teacher_emails values ('sade@example.com')");
  const sade = await signUp('Sade@Example.com', 'msbello');
  check((await db.query('select role from profiles where id=$1', [sade])).rows[0].role === 'student', 'invited teacher stays student until email is confirmed');
  await confirm(sade);
  check((await db.query('select role from profiles where id=$1', [sade])).rows[0].role === 'teacher', 'confirming the invited email makes them a teacher');
  await db.query("insert into teacher_emails values ('mallory@example.com')");
  const mal = await signUp('mallory@example.com', 'mallory', { confirmed: true });
  check((await db.query('select role from profiles where id=$1', [mal])).rows[0].role === 'student', 'auto-confirmed sign-up never gets teacher role (no proof of email)');
  check(/role cannot be changed/.test(await fails(ada, "update profiles set role='teacher' where id=$1", [ada])), 'student cannot make themselves a teacher');
  check(/Username cannot/.test(await fails(ada, "update profiles set username='boss' where id=$1", [ada])), 'username cannot be changed');
  await as(ada, "update profiles set full_name='Ada Obi', level='JSS 1' where id=$1", [ada]);
  check((await db.query('select full_name from profiles where id=$1', [ada])).rows[0].full_name === 'Ada Obi', 'student can edit own name/class');
  check((await as(ada, 'select id from profiles')).rows.length === 1, 'student sees only own profile');
  check((await as(sade, 'select id from profiles')).rows.length === 4, 'teacher sees all profiles');
  await as(sade, "update profiles set level='JSS 2' where id=$1", [ada]); await as(sade, "update profiles set level='JSS 1' where id=$1", [ada]);
  check(true, 'teacher can change a student\'s class');
  check((await as(ada, "update profiles set full_name='Hacked' where id=$1 returning id", [ben])).rows.length === 0, 'student cannot edit another profile');
  check((await as(null, "select public.username_available('ada') a")).rows[0].a === false, 'username_available works for visitors');
  check(!!(await fails(null, 'select * from courses')), 'anonymous visitors cannot read content');
  check(/Teacher access/.test(await fails(ada, "select public.invite_teacher('x@example.com')")), 'student cannot invite teachers');
  await as(sade, "select public.invite_teacher('Second@Example.com')");
  check((await db.query("select 1 from teacher_emails where email='second@example.com'")).rows.length === 1, 'teacher can invite another teacher');

  console.log('Question bank & answer keys');
  await as(sade, "insert into questions (id, owner_id, owner_role, practice, bank, data) values ('q_test1', $1, 'teacher', false, 'Test', $2)",
    [sade, JSON.stringify({ type: 'mcq', text: 'Secret test question', options: ['a', 'b', 'c', 'd'], marks: 2, subject: 'Mathematics', topic: 'T' })]);
  await as(sade, "insert into question_keys values ('q_test1', $1)", [JSON.stringify({ answerIndex: 2, explanation: 'because c' })]);
  await as(sade, "insert into questions (id, owner_id, owner_role, practice, bank, data) values ('q_test2', $1, 'teacher', false, 'Test', $2)",
    [sade, JSON.stringify({ type: 'short', text: 'Explain photosynthesis', marks: 3, subject: 'Basic Science', topic: 'T' })]);
  await as(sade, "insert into question_keys values ('q_test2', $1)", [JSON.stringify({ accepted: [], manual: true, explanation: '' })]);
  check((await as(ada, "select id from questions where id like 'q_test%'")).rows.length === 0, 'students cannot see non-practice (test) questions');
  check((await as(ada, "select * from question_keys where question_id='q_test1'")).rows.length === 0, 'students cannot read test answer keys');
  check((await as(ada, 'select count(*) n from question_keys')).rows[0].n == 60, 'students can read keys for practice questions only');
  check(!!(await fails(ada, "insert into questions (id, owner_id, owner_role, practice, data) values ('q_x', $1, 'teacher', true, '{}')", [ada])), 'student cannot create teacher questions');
  await as(ada, "insert into questions (id, owner_id, owner_role, practice, data) values ('q_ada', $1, 'student', true, $2)", [ada, JSON.stringify({ type: 'tf', text: 'Ada private', subject: 'English', topic: 'X', marks: 1 })]);
  await as(ada, "insert into question_keys values ('q_ada', $1)", [JSON.stringify({ answer: 'true' })]);
  check((await as(ben, "select id from questions where id='q_ada'")).rows.length === 0, 'personal practice questions are private to the student');
  check((await as(sade, "select id from questions where id='q_ada'")).rows.length === 0, 'teachers do not see students\' personal libraries');
  check(!!(await fails(ada, "update questions set owner_role='teacher' where id='q_ada'")), 'student cannot re-label own question as a teacher question');
  check((await as(ada, "update question_keys set key='{}' where question_id='q_seed_001' returning 1")).rows.length === 0, 'student cannot edit teacher answer keys');
  check((await as(sade, "select count(*) n from questions")).rows[0].n == 62, 'teacher sees the whole school bank');

  console.log('Quizzes');
  const quiz = { id: 'qz_t', title: 'Week 1 Test', subject: 'Mixed', questionIds: ['q_test1', 'q_test2', 'q_seed_001', 'q_missing'], marks: { q_seed_001: 2 },
    timeLimitMin: 5, feedbackMode: 'after', shuffle: false, status: 'published', assign: { type: 'level', level: 'JSS 1', studentIds: [] }, createdBy: sade };
  await as(sade, "insert into quizzes (id, status, created_by, data) values ('qz_t', 'published', $1, $2)", [sade, JSON.stringify(quiz)]);
  check((await as(ada, "select id from quizzes where id='qz_t'")).rows.length === 1, 'assigned student (JSS 1) can see the quiz');
  check((await as(ben, "select id from quizzes where id='qz_t'")).rows.length === 0, 'student in another class cannot see it');
  check(/not been assigned/.test(await fails(ben, "select quiz_start('qz_t')")), 'unassigned student cannot start it');
  check(!!(await fails(ada, "update quizzes set status='draft' where id='qz_t'")) || (await as(ada, "update quizzes set status='draft' where id='qz_t' returning 1")).rows.length === 0, 'student cannot edit published quizzes');
  const start = (await as(ada, "select quiz_start('qz_t') r")).rows[0].r;
  const json = JSON.stringify(start);
  check(start.questions.length === 3 && start.missing === 1, 'quiz_start returns 3 questions and reports 1 missing');
  check(!/answerIndex|accepted|explanation|because c/.test(json), 'quiz_start sends no answer keys or explanations');
  check(start.questions.find((q) => q.id === 'q_seed_001').marks === 2, 'per-quiz marks override is applied');
  check(/after you submit/.test(await fails(ada, 'select quiz_check($1, $2, $3)', [start.sessionId, 'q_test1', '2'])), 'no instant feedback in "after" mode');
  check(!!(await fails(ben, 'select quiz_submit($1, $2)', [start.sessionId, '{}'])), 'another student cannot submit someone else\'s session');
  check(!!(await fails(ada, "insert into attempts (id, user_id, quiz_id, data) values ('fake', $1, 'qz_t', '{\"percent\":100}')", [ada])), 'students cannot write their own scores');
  const seedKey = (await db.query("select key from question_keys where question_id='q_seed_001'")).rows[0].key;
  const att = (await as(ada, 'select quiz_submit($1, $2, false) r', [start.sessionId, JSON.stringify({ q_test1: 2, q_test2: 'Plants make food', q_seed_001: seedKey.answerIndex })])).rows[0].r;
  check(att.correctCount === 2 && att.pendingCount === 1 && att.score === 4 && att.maxScore === 7 && att.status === 'pending-review' && att.percent === 57, 'server marks the attempt (4/7, one awaiting teacher) — got ' + att.score + '/' + att.maxScore);
  check((await db.query("select count(*) n from attempts where user_id=$1", [ada])).rows[0].n == 1, 'attempt stored');
  check((await as(ada, "select count(*) n from notifications")).rows[0].n == 1, 'result notification created for the student');
  check(!!(await fails(ada, 'select quiz_submit($1, $2)', [start.sessionId, '{}'])), 'a session can only be submitted once');
  check((await as(ben, 'select id from attempts')).rows.length === 0, 'students cannot see other students\' attempts');
  check((await as(ada, "update attempts set data = data || '{\"percent\":100}' returning id")).rows.length === 0, 'student cannot edit their attempt');
  check((await as(sade, "update attempts set data = data || '{\"gradedBy\":\"Mrs B\"}' returning id")).rows.length === 1, 'teacher can update (mark) attempts');
  check(!!(await fails(ada, "insert into notifications (id, user_id, data) values ('n_x', $1, '{}')", [ben])), 'student cannot send notifications to others');
  await as(sade, "insert into notifications (id, user_id, data) values ('n_t', $1, '{\"title\":\"New quiz\"}')", [ben]);
  check((await as(ben, 'select id from notifications')).rows.length === 1, 'teacher can notify a student');

  console.log('Instant feedback & locking');
  const imm = Object.assign({}, quiz, { id: 'qz_i', feedbackMode: 'immediate', assign: { type: 'all' }, questionIds: ['q_seed_001', 'q_seed_002'] });
  await as(sade, "insert into quizzes (id, status, created_by, data) values ('qz_i', 'published', $1, $2)", [sade, JSON.stringify(imm)]);
  const s2 = (await as(ben, "select quiz_start('qz_i') r")).rows[0].r;
  const wrong = (seedKey.answerIndex + 1) % 4;
  const c1 = (await as(ben, 'select quiz_check($1, $2, $3) r', [s2.sessionId, 'q_seed_001', String(wrong)])).rows[0].r;
  check(c1.correct === false && /^C\. /.test(c1.correctText) && c1.explanation, 'quiz_check reveals result + explanation');
  const c2 = (await as(ben, 'select quiz_check($1, $2, $3) r', [s2.sessionId, 'q_seed_001', String(seedKey.answerIndex)])).rows[0].r;
  check(c2.correct === false, 'checked answers are locked (changing it afterwards does not help)');
  const a2 = (await as(ben, 'select quiz_submit($1, $2) r', [s2.sessionId, JSON.stringify({ q_seed_001: seedKey.answerIndex })])).rows[0].r;
  check(a2.answers[0].correct === false, 'submit uses the locked answer');

  console.log('Teacher preview & practice');
  const s3 = (await as(sade, "select quiz_start('qz_t') r")).rows[0].r;
  const p3 = (await as(sade, 'select quiz_submit($1, $2) r', [s3.sessionId, '{}'])).rows[0].r;
  check(p3.preview === true && (await db.query('select count(*) n from attempts where user_id=$1', [sade])).rows[0].n == 0, 'teacher preview is marked but not stored');
  const pq = { id: 'pq_a', title: 'Practice', questionIds: ['q_seed_005', 'q_test1', 'q_ada'], feedbackMode: 'immediate', status: 'practice', createdBy: ada };
  await as(ada, "insert into quizzes (id, status, created_by, data) values ('pq_a', 'practice', $1, $2)", [ada, JSON.stringify(pq)]);
  const s4 = (await as(ada, "select quiz_start('pq_a') r")).rows[0].r;
  check(s4.questions.length === 2 && !s4.questions.some((q) => q.id === 'q_test1'), 'practice quizzes cannot smuggle in hidden test questions');
  check(!!(await fails(ben, "select quiz_start('pq_a')")), 'other students cannot start someone\'s practice quiz');
  check(!!(await fails(ada, "insert into quizzes (id, status, created_by, data) values ('qz_evil', 'published', $1, '{}')", [ada])), 'students cannot publish quizzes');

  console.log('Marking parity with the browser (ML.Q.mark)');
  const ctx = { console, crypto: require('crypto').webcrypto, TextEncoder, btoa, atob }; ctx.window = ctx; vm.createContext(ctx);
  ['util', 'questions'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx));
  const Q = ctx.ML.Q;
  const cases = [
    [{ type: 'mcq', options: ['a', 'b', 'c'], answerIndex: 1 }, [1, '1', 0, '', null, 'x', 2]],
    [{ type: 'tf', answer: 'false' }, ['false', 'true', '', null]],
    [{ type: 'fill', accepted: ['Photosynthesis'] }, ['photosynthesis', ' PHOTOSYNTHESIS. ', 'photo', '', null]],
    [{ type: 'short', accepted: ['1,000', 'x = 5'], manual: false }, ['1000', '1,000.', 'X  =  5', '1000.0', 'nope', '']],
    [{ type: 'short', accepted: [], manual: true }, ['some answer', '', null]],
    [{ type: 'short', accepted: ['yes'], manual: true }, ['Yes!', 'no']],
    [{ type: 'fill', accepted: ["'s", 'ﬁve'] }, ["'S", 'five']],
  ];
  let same = 0, total = 0, diffs = [];
  for (const [q, givens] of cases) {
    const { data, key } = Q.splitForStorage(Object.assign({ text: 't' }, q));
    for (const g of givens) {
      total++;
      const js = Q.mark(Object.assign({ accepted: [], manual: false }, q), g);
      const r = (await db.query('select ml_mark($1, $2, $3) m, ml_correct_text($1, $2) ct, ml_given_text($1, $3) gt', [JSON.stringify(data), JSON.stringify(key), JSON.stringify(g)])).rows[0];
      const jsCt = Q.correctText(Object.assign({ accepted: [], options: [] }, q)); const jsGt = Q.givenText(q, g);
      if (r.m === js && r.ct === jsCt && r.gt === jsGt) same++; else diffs.push(JSON.stringify({ q, g, sql: [r.m, r.ct, r.gt], js: [js, jsCt, jsGt] }));
    }
  }
  check(same === total, `server and browser mark identically (${same}/${total})` + (diffs.length ? '\n      ' + diffs.join('\n      ') : ''));

  console.log('Characters & storage');
  for (let i = 0; i < 30; i++) await as(ada, 'insert into characters (id, user_id, name, path, mime, width, height) values ($1, $2, $3, $4, $5, 10, 10)', ['ch' + i, ada, 'c' + i, ada + '/c_ch' + i, 'image/png']);
  check(/library is full/.test(await fails(ada, 'insert into characters (id, user_id, name, path, mime, width, height) values ($1, $2, $3, $4, $5, 10, 10)', ['ch31', ada, 'x', ada + '/c_ch31', 'image/png'])), '30-character limit enforced');
  check(!!(await fails(ada, 'insert into characters (id, user_id, name, path, mime, width, height) values ($1, $2, $3, $4, $5, 10, 10)', ['chx', ben, 'x', ben + '/c', 'image/png'])), 'cannot create characters for someone else');
  check((await as(ben, 'select id from characters')).rows.length === 0, 'characters are private');
  await as(ada, "insert into storage.objects (bucket_id, name) values ('media', $1), ('media', $2)", [ada + '/avatar', ada + '/c_ch1']);
  check(!!(await fails(ada, "insert into storage.objects (bucket_id, name) values ('media', $1)", [ben + '/avatar'])), 'cannot upload into another user\'s folder');
  check((await as(ben, 'select name from storage.objects')).rows.length === 0, 'students cannot see others\' files');
  const tv = (await as(sade, 'select name from storage.objects')).rows.map((r) => r.name);
  check(tv.length === 1 && tv[0].endsWith('/avatar'), 'teachers can see avatars but not students\' characters');

  console.log('Account deletion');
  check(/only teacher/.test(await fails(sade, 'select delete_my_account()')), 'the only teacher cannot delete their account');
  await as(ben, 'select delete_my_account()');
  check((await db.query('select count(*) n from profiles where id=$1', [ben])).rows[0].n == 0 && (await db.query('select count(*) n from attempts where user_id=$1', [ben])).rows[0].n == 0, 'deleting an account removes the profile and personal data');

  console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) { console.log('FAILED:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
