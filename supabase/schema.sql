-- =====================================================================
-- M Learning App — Supabase schema
-- Run once in: Supabase Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run: objects are created with IF NOT EXISTS / OR REPLACE.
--
-- Security model
--  * Every table has Row Level Security (RLS) enabled.
--  * Students see only their own profile, attempts, progress, notifications,
--    characters and personal practice questions.
--  * Teachers see school-wide content and every student's results
--    (one school per project — there is no per-class teacher ownership).
--  * Answer keys live in question_keys. Students can read a key only for
--    their own questions or teacher questions marked "practice".
--  * Quizzes are started, checked and marked by SECURITY DEFINER functions,
--    so students never receive the answer key for a graded quiz and cannot
--    write their own scores.
--  * Nobody can make themselves a teacher. Teacher role comes from
--    teacher_emails (on email confirmation) or a manual UPDATE by the owner.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.teacher_emails (
  email      text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  role               text not null default 'student' check (role in ('student', 'teacher')),
  username           text not null check (username ~ '^[a-z0-9_.]{3,20}$'),
  full_name          text not null check (char_length(full_name) between 2 and 60),
  email              text not null,
  level              text not null default '' check (char_length(level) <= 40),
  preferred_subjects jsonb not null default '[]'::jsonb,
  avatar_path        text,
  created_at         timestamptz not null default now(),
  last_active_at     timestamptz not null default now()
);
create unique index if not exists profiles_username_key on public.profiles (username);
create index if not exists profiles_role_idx on public.profiles (role);

create table if not exists public.courses (
  id         text primary key,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lessons (
  id         text primary key,
  course_id  text not null references public.courses(id) on delete cascade,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lessons_course_idx on public.lessons (course_id);

-- Question text/options (no answer) ...
create table if not exists public.questions (
  id         text primary key,
  owner_id   uuid references public.profiles(id) on delete cascade, -- null = built-in sample
  owner_role text not null check (owner_role in ('student', 'teacher')),
  practice   boolean not null default false,
  bank       text not null default 'General',
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists questions_owner_idx on public.questions (owner_id);
-- ... and the answer key, kept separately so RLS can hide it.
create table if not exists public.question_keys (
  question_id text primary key references public.questions(id) on delete cascade,
  key         jsonb not null  -- {answerIndex, answer, accepted[], manual, explanation}
);

create table if not exists public.quizzes (
  id         text primary key,
  status     text not null check (status in ('draft', 'published', 'practice')),
  created_by uuid references public.profiles(id) on delete set null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quiz_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  quiz_id    text not null references public.quizzes(id) on delete cascade,
  order_ids  jsonb not null,
  locked     jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now()
);
create index if not exists quiz_sessions_user_idx on public.quiz_sessions (user_id);

create table if not exists public.attempts (
  id          text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  quiz_id     text not null,           -- no FK: results survive quiz deletion
  data        jsonb not null,
  finished_at timestamptz not null default now()
);
create index if not exists attempts_user_idx on public.attempts (user_id);
create index if not exists attempts_quiz_idx on public.attempts (quiz_id);

create table if not exists public.notifications (
  id         text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  data       jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id);

create table if not exists public.progress (
  id      text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  data    jsonb not null
);
create index if not exists progress_user_idx on public.progress (user_id);

create table if not exists public.characters (
  id         text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  path       text not null,
  mime       text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  width      int not null,
  height     int not null,
  created_at timestamptz not null default now()
);
create index if not exists characters_user_idx on public.characters (user_id);

-- ---------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------
create or replace function public.is_teacher() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher');
$$;

-- Same rules as the app's normAnswer(): NFKC, lower-case, collapse spaces, trim, drop trailing . ! ? ; ,
create or replace function public.ml_norm(t text) returns text
language sql immutable set search_path = public as $$
  select btrim(regexp_replace(btrim(regexp_replace(lower(normalize(coalesce(t, ''), NFKC)), '\s+', ' ', 'g')), '[.!?;,]+$', ''));
$$;

-- Returns true / false, or NULL when a teacher must mark it. Mirrors ML.Q.mark().
create or replace function public.ml_mark(q jsonb, k jsonb, given jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  t   text := q->>'type';
  g   text := case when given is null or jsonb_typeof(given) = 'null' then '' else given #>> '{}' end;
  a   text; nn text; gg text;
  hit boolean := false;
begin
  if t = 'mcq' then
    return case when g ~ '^\d+$' and (k->>'answerIndex') ~ '^\d+$' then g::int = (k->>'answerIndex')::int else false end;
  elsif t = 'tf' then
    return g = coalesce(k->>'answer', '');
  end if;
  g := ml_norm(g);
  if g <> '' then
    for a in select jsonb_array_elements_text(coalesce(k->'accepted', '[]'::jsonb)) loop
      nn := ml_norm(a);
      if nn = g then hit := true; exit; end if;
      nn := replace(nn, ',', ''); gg := replace(g, ',', '');
      if nn ~ '^-?\d+(\.\d+)?$' and gg ~ '^-?\d+(\.\d+)?$' then
        if abs(nn::numeric - gg::numeric) < 1e-9 then hit := true; exit; end if;
      end if;
    end loop;
  end if;
  if hit then return true; end if;
  if t = 'short' and coalesce((k->>'manual')::boolean, false) then
    return case when g <> '' then null else false end;
  end if;
  return false;
end $$;

create or replace function public.ml_correct_text(q jsonb, k jsonb) returns text
language sql immutable set search_path = public as $$
  select case q->>'type'
    when 'mcq' then chr(65 + (k->>'answerIndex')::int) || '. ' || coalesce(q->'options'->>((k->>'answerIndex')::int), '')
    when 'tf'  then case when k->>'answer' = 'true' then 'True' else 'False' end
    else coalesce(
      (select string_agg(x, ' / ') from jsonb_array_elements_text(coalesce(k->'accepted', '[]'::jsonb)) x),
      'Marked by your teacher')
  end;
$$;

create or replace function public.ml_given_text(q jsonb, given jsonb) returns text
language sql immutable set search_path = public as $$
  select case
    when given is null or jsonb_typeof(given) = 'null' or (given #>> '{}') = '' then 'No answer'
    when q->>'type' = 'mcq' then
      case when (given #>> '{}') ~ '^\d+$'
        then chr(65 + (given #>> '{}')::int) || '. ' || coalesce(q->'options'->>((given #>> '{}')::int), '')
        else given #>> '{}' end
    when q->>'type' = 'tf' then case when given #>> '{}' = 'true' then 'True' else 'False' end
    else given #>> '{}'
  end;
$$;

create or replace function public.quiz_assigned(d jsonb, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case coalesce(d #>> '{assign,type}', 'all')
    when 'all' then true
    when 'level' then exists (select 1 from public.profiles p where p.id = uid and p.level <> '' and p.level = d #>> '{assign,level}')
    when 'students' then coalesce(d #> '{assign,studentIds}', '[]'::jsonb) ? uid::text
    else false
  end;
$$;

-- ---------------------------------------------------------------------
-- Triggers: profile creation, teacher promotion, field guards
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, role, username, full_name, email, level)
  values (new.id, 'student',
          lower(btrim(coalesce(meta->>'username', ''))),
          btrim(coalesce(meta->>'full_name', '')),
          lower(new.email),
          left(coalesce(meta->>'level', ''), 40));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Promote to teacher only AFTER the person proves they own the invited email.
create or replace function public.promote_invited_teacher() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.teacher_emails where email = lower(new.email)) then
    update public.profiles set role = 'teacher' where id = new.id;
    delete from public.teacher_emails where email = lower(new.email);
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.promote_invited_teacher();

-- Clients may not change role, username or email (auth.uid() is NULL for the
-- SQL editor and for the triggers above, so the owner can still promote people).
create or replace function public.guard_profile() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null then
    if new.role is distinct from old.role then raise exception 'The account role cannot be changed from the app.'; end if;
    if new.username is distinct from old.username then raise exception 'Username cannot be changed.'; end if;
    if new.email is distinct from old.email then raise exception 'Email cannot be changed here.'; end if;
    if new.id is distinct from old.id or new.created_at is distinct from old.created_at then raise exception 'Not allowed.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles
  for each row execute function public.guard_profile();

create or replace function public.limit_characters() returns trigger
language plpgsql set search_path = public as $$
begin
  if (select count(*) from public.characters where user_id = new.user_id) >= 30 then
    raise exception 'Your library is full (30 characters). Delete one to add another.';
  end if;
  return new;
end $$;
drop trigger if exists limit_characters on public.characters;
create trigger limit_characters before insert on public.characters
  for each row execute function public.limit_characters();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.teacher_emails enable row level security;   -- no policies: SQL editor / RPC only
alter table public.profiles       enable row level security;
alter table public.courses        enable row level security;
alter table public.lessons        enable row level security;
alter table public.questions      enable row level security;
alter table public.question_keys  enable row level security;
alter table public.quizzes        enable row level security;
alter table public.quiz_sessions  enable row level security;   -- no policies: RPC only
alter table public.attempts       enable row level security;
alter table public.notifications  enable row level security;
alter table public.progress       enable row level security;
alter table public.characters     enable row level security;

do $$ declare r record; begin
  -- drop old versions of our policies so this file can be re-run
  for r in select policyname, tablename from pg_policies where schemaname = 'public' and policyname like 'ml_%' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- profiles
create policy ml_profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_teacher());
create policy ml_profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_teacher()) with check (id = auth.uid() or public.is_teacher());

-- courses & lessons: everyone signed in reads, teachers write
create policy ml_courses_select on public.courses for select to authenticated using (true);
create policy ml_courses_write  on public.courses for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy ml_lessons_select on public.lessons for select to authenticated using (true);
create policy ml_lessons_write  on public.lessons for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

-- questions
create policy ml_questions_select on public.questions for select to authenticated
  using (owner_id = auth.uid()
      or (owner_role = 'teacher' and practice)
      or (owner_role = 'teacher' and public.is_teacher()));
create policy ml_questions_insert on public.questions for insert to authenticated
  with check ((owner_role = 'teacher' and owner_id = auth.uid() and public.is_teacher())
           or (owner_role = 'student' and owner_id = auth.uid()));
create policy ml_questions_update on public.questions for update to authenticated
  using ((owner_role = 'teacher' and public.is_teacher()) or (owner_role = 'student' and owner_id = auth.uid()))
  with check ((owner_role = 'teacher' and public.is_teacher()) or (owner_role = 'student' and owner_id = auth.uid()));
create policy ml_questions_delete on public.questions for delete to authenticated
  using ((owner_role = 'teacher' and public.is_teacher()) or (owner_role = 'student' and owner_id = auth.uid()));

-- answer keys follow the visibility of their question (RLS applies inside the subquery)
create policy ml_keys_select on public.question_keys for select to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id));
create policy ml_keys_write on public.question_keys for all to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id
                 and ((q.owner_role = 'teacher' and public.is_teacher()) or (q.owner_role = 'student' and q.owner_id = auth.uid()))))
  with check (exists (select 1 from public.questions q where q.id = question_id
                 and ((q.owner_role = 'teacher' and public.is_teacher()) or (q.owner_role = 'student' and q.owner_id = auth.uid()))));

-- quizzes
create policy ml_quizzes_select on public.quizzes for select to authenticated
  using (public.is_teacher()
      or (status = 'published' and public.quiz_assigned(data, auth.uid()))
      or (status = 'practice' and created_by = auth.uid()));
create policy ml_quizzes_insert on public.quizzes for insert to authenticated
  with check (public.is_teacher() or (status = 'practice' and created_by = auth.uid()));
create policy ml_quizzes_update on public.quizzes for update to authenticated
  using (public.is_teacher() or (status = 'practice' and created_by = auth.uid()))
  with check (public.is_teacher() or (status = 'practice' and created_by = auth.uid()));
create policy ml_quizzes_delete on public.quizzes for delete to authenticated
  using (public.is_teacher() or (status = 'practice' and created_by = auth.uid()));

-- attempts: written only by quiz_submit(); teachers may re-mark
create policy ml_attempts_select on public.attempts for select to authenticated
  using (user_id = auth.uid() or public.is_teacher());
create policy ml_attempts_update on public.attempts for update to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- notifications
create policy ml_notes_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy ml_notes_insert on public.notifications for insert to authenticated
  with check (user_id = auth.uid() or public.is_teacher());
create policy ml_notes_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ml_notes_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

-- progress
create policy ml_progress_select on public.progress for select to authenticated
  using (user_id = auth.uid() or public.is_teacher());
create policy ml_progress_write on public.progress for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- characters (private to their owner)
create policy ml_characters_all on public.characters for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and path like auth.uid()::text || '/%');

-- ---------------------------------------------------------------------
-- RPC functions (called with supabase.rpc)
-- ---------------------------------------------------------------------
create or replace function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where username = lower(btrim(p_username)));
$$;

create or replace function public.invite_teacher(p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_teacher() then raise exception 'Teacher access required.'; end if;
  if p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then raise exception 'Enter a valid email address.'; end if;
  insert into public.teacher_emails (email) values (lower(btrim(p_email))) on conflict do nothing;
end $$;

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Please sign in.'; end if;
  if (select role from public.profiles where id = uid) = 'teacher'
     and (select count(*) from public.profiles where role = 'teacher') < 2 then
    raise exception 'You are the only teacher. Invite another teacher before deleting this account.';
  end if;
  delete from auth.users where id = uid;   -- cascades to profile and all personal rows
end $$;

-- Start a quiz: checks access, returns questions WITHOUT answers or explanations.
create or replace function public.quiz_start(p_quiz_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  qz public.quizzes;
  ordered text[];
  sid uuid;
begin
  if uid is null then raise exception 'Please sign in.'; end if;
  select * into me from public.profiles where id = uid;
  if not found then raise exception 'Your profile is missing. Please sign out and in again.'; end if;
  select * into qz from public.quizzes where id = p_quiz_id;
  if not found then raise exception 'This quiz no longer exists.'; end if;
  if qz.status = 'practice' then
    if qz.created_by is distinct from uid then raise exception 'This quiz has not been assigned to you.'; end if;
  elsif me.role <> 'teacher' and not (qz.status = 'published' and public.quiz_assigned(qz.data, uid)) then
    raise exception 'This quiz has not been assigned to you.';
  end if;

  select array_agg(q.id order by case when coalesce((qz.data->>'shuffle')::boolean, false) then random() else t.ord::double precision end)
    into ordered
    from jsonb_array_elements_text(coalesce(qz.data->'questionIds', '[]'::jsonb)) with ordinality as t(qid, ord)
    join public.questions q on q.id = t.qid
   where qz.status <> 'practice'                                   -- graded quiz: any question the teacher chose
      or q.owner_id = uid                                          -- practice: own questions
      or (q.owner_role = 'teacher' and (q.practice or me.role = 'teacher'));
  if ordered is null then raise exception 'This quiz has no questions yet.'; end if;

  delete from public.quiz_sessions where user_id = uid and started_at < now() - interval '1 day';
  insert into public.quiz_sessions (user_id, quiz_id, order_ids) values (uid, qz.id, to_jsonb(ordered)) returning id into sid;

  return jsonb_build_object(
    'sessionId', sid,
    'missing', jsonb_array_length(coalesce(qz.data->'questionIds', '[]'::jsonb)) - cardinality(ordered),
    'quiz', jsonb_build_object('id', qz.id, 'title', qz.data->>'title', 'subject', qz.data->>'subject',
      'description', coalesce(qz.data->>'description', ''), 'timeLimitMin', coalesce((qz.data->>'timeLimitMin')::numeric, 0),
      'feedbackMode', coalesce(qz.data->>'feedbackMode', 'after'), 'practice', qz.status = 'practice'),
    'questions', (select jsonb_agg(jsonb_build_object(
        'id', q.id, 'type', q.data->>'type', 'text', q.data->>'text',
        'options', case when q.data->>'type' = 'mcq' then coalesce(q.data->'options', '[]'::jsonb) else '[]'::jsonb end,
        'image', coalesce(q.data->>'image', ''),
        'marks', coalesce((qz.data->'marks'->>q.id)::numeric, (q.data->>'marks')::numeric, 1),
        'topic', q.data->>'topic', 'subject', q.data->>'subject')
      order by array_position(ordered, q.id))
      from public.questions q where q.id = any(ordered)));
end $$;

-- Instant feedback for one question (immediate-feedback quizzes only). Locks the answer.
create or replace function public.quiz_check(p_session uuid, p_qid text, p_given jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.quiz_sessions; qz public.quizzes; qd jsonb; kk jsonb; g jsonb;
begin
  select * into s from public.quiz_sessions where id = p_session and user_id = auth.uid();
  if not found then raise exception 'Quiz session expired. Restart the quiz.'; end if;
  select * into qz from public.quizzes where id = s.quiz_id;
  if coalesce(qz.data->>'feedbackMode', 'after') <> 'immediate' then raise exception 'Feedback is shown after you submit this quiz.'; end if;
  if not (s.order_ids ? p_qid) then raise exception 'Question not found.'; end if;
  if not (s.locked ? p_qid) then
    update public.quiz_sessions set locked = locked || jsonb_build_object(p_qid, coalesce(p_given, 'null'::jsonb)) where id = s.id
      returning locked into s.locked;
  end if;
  g := s.locked -> p_qid;
  select q.data, k.key into qd, kk from public.questions q left join public.question_keys k on k.question_id = q.id where q.id = p_qid;
  return jsonb_build_object('correct', public.ml_mark(qd, kk, g), 'correctText', public.ml_correct_text(qd, kk),
    'explanation', coalesce(kk->>'explanation', ''), 'given', g);
end $$;

-- Mark a quiz on the server and store the attempt. Teacher previews are returned but not stored.
create or replace function public.quiz_submit(p_session uuid, p_answers jsonb, p_auto boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.quiz_sessions; qz public.quizzes; me public.profiles;
  r record; given jsonb; corr boolean; mk numeric;
  rows jsonb := '[]'::jsonb;
  n int := 0; nc int := 0; ni int := 0; np int := 0;
  score numeric := 0; maxs numeric := 0; pct int;
  practice boolean; preview boolean;
  elapsed int; tl numeric; att jsonb; att_id text;
  ms_start bigint; ms_end bigint;
begin
  select * into s from public.quiz_sessions where id = p_session and user_id = auth.uid();
  if not found then raise exception 'Quiz session expired. Restart the quiz.'; end if;
  select * into qz from public.quizzes where id = s.quiz_id;
  if not found then raise exception 'This quiz no longer exists.'; end if;
  select * into me from public.profiles where id = s.user_id;
  p_answers := coalesce(p_answers, '{}'::jsonb);

  for r in
    select t.qid, q.data as qd, k.key as kk
      from jsonb_array_elements_text(s.order_ids) with ordinality as t(qid, ord)
      join public.questions q on q.id = t.qid
      left join public.question_keys k on k.question_id = q.id
     order by t.ord
  loop
    given := case when s.locked ? r.qid then s.locked -> r.qid else p_answers -> r.qid end;
    mk := coalesce((qz.data->'marks'->>r.qid)::numeric, (r.qd->>'marks')::numeric, 1);
    corr := public.ml_mark(r.qd, r.kk, given);
    n := n + 1;
    if corr is true then nc := nc + 1; score := score + mk; elsif corr is false then ni := ni + 1; else np := np + 1; end if;
    maxs := maxs + mk;
    rows := rows || jsonb_build_array(jsonb_build_object(
      'qid', r.qid, 'type', r.qd->>'type', 'text', r.qd->>'text', 'options', coalesce(r.qd->'options', '[]'::jsonb),
      'topic', r.qd->>'topic', 'given', coalesce(given, '""'::jsonb), 'givenText', public.ml_given_text(r.qd, given),
      'correct', corr, 'correctText', public.ml_correct_text(r.qd, r.kk), 'explanation', coalesce(r.kk->>'explanation', ''),
      'marks', mk, 'awarded', case when corr is true then mk else 0 end));
  end loop;

  practice := qz.status = 'practice';
  preview  := me.role = 'teacher' and not practice;
  pct := case when maxs > 0 then round(round(score, 2) / maxs * 100)::int else 0 end;
  elapsed := greatest(0, round(extract(epoch from (now() - s.started_at))))::int;
  tl := coalesce((qz.data->>'timeLimitMin')::numeric, 0);
  ms_start := (extract(epoch from s.started_at) * 1000)::bigint;
  ms_end := (extract(epoch from now()) * 1000)::bigint;
  att_id := 'at_' || replace(gen_random_uuid()::text, '-', '');

  att := jsonb_build_object(
    'id', att_id, 'quizId', qz.id, 'quizTitle', qz.data->>'title', 'subject', qz.data->>'subject',
    'userId', me.id, 'userName', me.full_name, 'userLevel', me.level,
    'practice', practice, 'preview', preview, 'startedAt', ms_start, 'finishedAt', ms_end,
    'timerEnabled', tl > 0, 'timeLimitMin', tl, 'timeTakenSec', elapsed,
    'autoSubmitted', coalesce(p_auto, false),
    'late', tl > 0 and elapsed > tl * 60 + 60,         -- submitted well after the timer ran out
    'answers', rows, 'totalQuestions', n, 'correctCount', nc, 'incorrectCount', ni, 'pendingCount', np,
    'score', round(score, 2), 'maxScore', maxs, 'percent', pct,
    'status', case when np > 0 then 'pending-review' else 'marked' end);

  delete from public.quiz_sessions where id = s.id;
  if preview then return att; end if;

  insert into public.attempts (id, user_id, quiz_id, data, finished_at) values (att_id, me.id, qz.id, att, now());
  if not practice then
    insert into public.notifications (id, user_id, data)
    values ('n_' || replace(gen_random_uuid()::text, '-', ''), me.id, jsonb_build_object(
      'id', null, 'userId', me.id, 'type', 'result', 'title', 'Result: ' || (qz.data->>'title'),
      'body', case when np > 0
        then 'Scored ' || round(score, 2) || '/' || maxs || ' so far — written answers are waiting for your teacher.'
        else 'You scored ' || pct || '% (' || round(score, 2) || '/' || maxs || ').' end,
      'link', '#/result/' || att_id, 'read', false, 'createdAt', ms_end));
  end if;
  return att;
end $$;

-- Lock down function access: nothing for anonymous visitors except the username check.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.is_teacher(), public.quiz_assigned(jsonb, uuid),
  public.invite_teacher(text), public.delete_my_account(),
  public.quiz_start(text), public.quiz_check(uuid, text, jsonb), public.quiz_submit(uuid, jsonb, boolean),
  public.ml_norm(text), public.ml_mark(jsonb, jsonb, jsonb), public.ml_correct_text(jsonb, jsonb), public.ml_given_text(jsonb, jsonb)
  to authenticated;

-- Table privileges (RLS still decides which rows). anon gets nothing.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on public.courses, public.lessons, public.questions, public.question_keys,
  public.quizzes, public.notifications, public.progress, public.characters to authenticated;
grant select, update on public.profiles, public.attempts to authenticated;
revoke all on public.teacher_emails, public.quiz_sessions from authenticated;

-- ---------------------------------------------------------------------
-- Storage: one private bucket "media" with a folder per user
--   {user_id}/avatar        profile photo (teachers may view)
--   {user_id}/c_{id}        character images (owner only)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists ml_media_select on storage.objects;
drop policy if exists ml_media_insert on storage.objects;
drop policy if exists ml_media_update on storage.objects;
drop policy if exists ml_media_delete on storage.objects;
create policy ml_media_select on storage.objects for select to authenticated
  using (bucket_id = 'media' and ((storage.foldername(name))[1] = auth.uid()::text
         or (public.is_teacher() and name like '%/avatar')));
create policy ml_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy ml_media_update on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy ml_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- FIRST TEACHER: before you register in the app, run this with YOUR email.
-- You become a teacher when you click the confirmation link in your email.
--   insert into public.teacher_emails (email) values ('you@example.com');
-- Already registered? Promote directly instead:
--   update public.profiles set role = 'teacher' where email = 'you@example.com';
-- ---------------------------------------------------------------------
