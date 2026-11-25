-- Beyond4walls volunteer applications: schema, row level security, storage.
-- Source of truth: "Beyond4walls Volunteer Application Process: Website Guide".
--
-- Who writes what:
--   * Applicants never write to the database directly. Applications, challenge
--     submissions and stage changes go through the API (api/*), which validates
--     everything and uses the service role key.
--   * Applicants (signed in by email code / magic link) can only READ their own
--     application, challenge release, challenge brief and submission.
--   * Staff (rows in profiles: admin / lead / reviewer) can read everything and
--     write scores. Scores and notes are never readable by applicants.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.staff_role as enum ('admin', 'lead', 'reviewer');

-- The five statuses applicants see on the status tracker, in order
create type public.app_stage as enum (
  'received', 'under_review', 'challenge_released', 'interview_scheduled', 'decision_made'
);

create type public.decision_outcome as enum ('offer', 'not_selected');

create type public.score_stage as enum ('grit', 'challenge', 'interview');

-- ---------------------------------------------------------------------------
-- Roles (Stage 1 cards). Hours, skills and the Lead's question are set by
-- each role's Lead; empty values are hidden on the website.
-- ---------------------------------------------------------------------------
create table public.roles (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  title         text not null check (char_length(title) between 2 and 80),
  description   text not null check (char_length(description) between 1 and 600),
  hours         text check (char_length(hours) <= 80),
  skills        text check (char_length(skills) <= 300),
  lead_question text check (char_length(lead_question) <= 300),
  status        text not null default 'open' check (status in ('open', 'closed')),
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Staff profiles (admins, role Leads, reviewers). Create the auth user first
-- (Supabase dashboard > Authentication > Add user), then insert a row here.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  full_name       text check (char_length(full_name) <= 100),
  role            public.staff_role not null,
  lead_of_role_id uuid references public.roles (id) on delete set null,
  created_at      timestamptz not null default now(),
  check (role <> 'lead' or lead_of_role_id is not null)
);

-- SECURITY DEFINER so policies can check staff membership without
-- recursing through the profiles policies.
create function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

create function public.staff_role() returns public.staff_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Applications (Stages 1-3)
-- application_id is the human-friendly ID quoted in every email (B4W-2026-0001).
-- Other tables refer to an application by its uuid in a column named
-- application_id.
-- ---------------------------------------------------------------------------
create table public.application_counters (
  year        int primary key,
  last_number int not null
);

create table public.applications (
  id               uuid primary key default gen_random_uuid(),
  application_id   text not null unique,
  user_id          uuid not null references auth.users (id) on delete restrict,
  email            text not null check (char_length(email) <= 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  name             text not null check (char_length(name) between 2 and 100),
  phone            text not null check (char_length(phone) <= 20),
  role_id          uuid not null references public.roles (id),
  second_role_id   uuid references public.roles (id),
  hours_per_week   text not null check (char_length(hours_per_week) <= 40),
  start_date       date not null,
  commitment_ack   boolean not null check (commitment_ack),
  consent          boolean not null check (consent),
  answers          jsonb not null check (jsonb_typeof(answers) = 'object'),
  stage            public.app_stage not null default 'received',
  interview_at     timestamptz,
  decision         public.decision_outcome,
  stage_updated_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  check (second_role_id is null or second_role_id <> role_id),
  check ((stage = 'decision_made') = (decision is not null))
);

create index applications_user_id_idx on public.applications (user_id);
create index applications_role_stage_idx on public.applications (role_id, stage);
create index applications_email_idx on public.applications (lower(email));

-- B4W-<year>-<0001>, numbered per year in Lagos time
create function public.assign_application_id() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  y int := extract(year from (now() at time zone 'Africa/Lagos'))::int;
  n int;
begin
  insert into public.application_counters as c (year, last_number)
  values (y, 1)
  on conflict (year) do update set last_number = c.last_number + 1
  returning last_number into n;
  new.application_id := format('B4W-%s-%s', y, lpad(n::text, greatest(4, length(n::text)), '0'));
  return new;
end;
$$;

create trigger applications_assign_id
  before insert on public.applications
  for each row execute function public.assign_application_id();

-- ---------------------------------------------------------------------------
-- Role challenges (Stage 4)
-- ---------------------------------------------------------------------------
create table public.challenges (
  id         uuid primary key default gen_random_uuid(),
  role_id    uuid not null references public.roles (id) on delete cascade,
  title      text not null check (char_length(title) between 2 and 120),
  brief      text not null check (char_length(brief) between 1 and 4000),
  resources  text check (char_length(resources) <= 2000),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index challenges_one_active_per_role on public.challenges (role_id) where active;

create table public.challenge_releases (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.applications (id) on delete cascade,
  challenge_id   uuid not null references public.challenges (id),
  released_at    timestamptz not null default now(),
  due_at         timestamptz not null,
  released_by    uuid references auth.users (id) on delete set null
);

-- due_at is always released_at + 72 hours when a challenge is released
create function public.set_challenge_due_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.due_at := new.released_at + interval '72 hours';
  return new;
end;
$$;

create trigger challenge_releases_due_at
  before insert on public.challenge_releases
  for each row execute function public.set_challenge_due_at();

create table public.submissions (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.applications (id) on delete cascade,
  text           text check (char_length(text) <= 10000),
  file_path      text check (char_length(file_path) <= 200),
  file_name      text check (char_length(file_name) <= 150),
  file_type      text check (char_length(file_type) <= 100),
  file_size      int  check (file_size between 1 and 5242880),
  submitted_at   timestamptz not null default now(),
  locked         boolean not null default true,
  check (text is not null or file_path is not null)
);

-- The deadline is enforced in the database too, so even a service-role
-- write cannot land after due_at. Submissions are final once made.
create function public.enforce_submission_deadline() returns trigger
language plpgsql set search_path = '' as $$
declare
  deadline timestamptz;
begin
  if tg_op = 'UPDATE' and old.locked then
    raise exception 'This submission is locked' using errcode = 'P0001';
  end if;
  select due_at into deadline from public.challenge_releases where application_id = new.application_id;
  if deadline is null then
    raise exception 'No challenge has been released for this application' using errcode = 'P0001';
  end if;
  if now() >= deadline then
    raise exception 'The 72-hour deadline has passed' using errcode = 'P0001';
  end if;
  new.submitted_at := now();
  return new;
end;
$$;

create trigger submissions_deadline
  before insert or update on public.submissions
  for each row execute function public.enforce_submission_deadline();

-- Releases an application's role challenge and moves it to challenge_released
-- in one transaction. Server-only (service role).
create function public.release_challenge(p_application uuid, p_released_by uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role uuid;
  v_stage public.app_stage;
  v_challenge uuid;
  v_title text;
  v_due timestamptz;
begin
  select role_id, stage into v_role, v_stage from public.applications where id = p_application for update;
  if not found then
    raise exception 'application_not_found' using errcode = 'P0001';
  end if;
  if v_stage not in ('received', 'under_review') then
    raise exception 'wrong_stage' using errcode = 'P0001';
  end if;
  select id, title into v_challenge, v_title from public.challenges where role_id = v_role and active limit 1;
  if not found then
    raise exception 'no_active_challenge' using errcode = 'P0001';
  end if;
  insert into public.challenge_releases (application_id, challenge_id, released_by)
  values (p_application, v_challenge, p_released_by)
  returning due_at into v_due;
  update public.applications set stage = 'challenge_released', stage_updated_at = now() where id = p_application;
  return jsonb_build_object('due_at', v_due, 'challenge_title', v_title);
end;
$$;
revoke execute on function public.release_challenge(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_challenge(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Scores (staff only). G.R.I.T. is scored 1-5 on each of the four traits;
-- the challenge and interview get a single 1-5 score.
-- ---------------------------------------------------------------------------
create function public.valid_grit(j jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(j) = 'object'
     and (select count(*) from jsonb_object_keys(j)) = 4
     and (select count(*) from jsonb_each(j) e
          where e.key in ('g', 'r', 'i', 't')
            and jsonb_typeof(e.value) = 'number'
            and (e.value #>> '{}') ~ '^[1-5]$') = 4;
$$;

create table public.scores (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  stage          public.score_stage not null,
  reviewer_id    uuid not null references public.profiles (id) on delete cascade,
  score          smallint check (score between 1 and 5),
  grit           jsonb check (grit is null or public.valid_grit(grit)),
  notes          text check (char_length(notes) <= 5000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (application_id, stage, reviewer_id),
  check ((stage = 'grit' and grit is not null and score is null)
      or (stage <> 'grit' and score is not null and grit is null))
);

-- ---------------------------------------------------------------------------
-- Row level security: on for every table. No policy = no access.
-- ---------------------------------------------------------------------------
alter table public.roles                enable row level security;
alter table public.profiles             enable row level security;
alter table public.application_counters enable row level security;
alter table public.applications         enable row level security;
alter table public.challenges           enable row level security;
alter table public.challenge_releases   enable row level security;
alter table public.submissions          enable row level security;
alter table public.scores               enable row level security;

-- Defence in depth: signed-out visitors get nothing but the public role list
revoke all on public.profiles, public.application_counters, public.applications,
  public.challenges, public.challenge_releases, public.submissions, public.scores
  from anon;
revoke all on public.application_counters from authenticated;
-- Applicants and staff read through RLS; all writes except scores and role
-- status go through the API with the service role
revoke insert, update, delete on public.applications, public.challenges,
  public.challenge_releases, public.submissions, public.profiles from authenticated;

-- Roles: anyone can read; only admins can change (e.g. open/close a role)
create policy "Roles are public" on public.roles
  for select to anon, authenticated using (true);
create policy "Admins manage roles" on public.roles
  for all to authenticated
  using (public.staff_role() = 'admin') with check (public.staff_role() = 'admin');

-- Profiles: staff see the staff list (to show reviewer names); nobody else
create policy "Staff read profiles" on public.profiles
  for select to authenticated using (public.is_staff());

-- Applications: your own, or any if you're staff
create policy "Applicants read own application" on public.applications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Staff read applications" on public.applications
  for select to authenticated using (public.is_staff());

-- Challenge releases: your own, or any if you're staff
create policy "Applicants read own release" on public.challenge_releases
  for select to authenticated using (
    exists (select 1 from public.applications a
            where a.id = challenge_releases.application_id and a.user_id = (select auth.uid())));
create policy "Staff read releases" on public.challenge_releases
  for select to authenticated using (public.is_staff());

-- Challenges: an applicant sees a brief only once it has been released to them
create policy "Applicants read released challenge" on public.challenges
  for select to authenticated using (
    exists (select 1 from public.challenge_releases r
            join public.applications a on a.id = r.application_id
            where r.challenge_id = challenges.id and a.user_id = (select auth.uid())));
create policy "Staff read challenges" on public.challenges
  for select to authenticated using (public.is_staff());

-- Submissions: your own, or any if you're staff
create policy "Applicants read own submission" on public.submissions
  for select to authenticated using (
    exists (select 1 from public.applications a
            where a.id = submissions.application_id and a.user_id = (select auth.uid())));
create policy "Staff read submissions" on public.submissions
  for select to authenticated using (public.is_staff());

-- Scores and notes: staff only, never applicants. Reviewers write their own.
create policy "Staff read scores" on public.scores
  for select to authenticated using (public.is_staff());
create policy "Staff add own scores" on public.scores
  for insert to authenticated with check (public.is_staff() and reviewer_id = (select auth.uid()));
create policy "Staff edit own scores" on public.scores
  for update to authenticated
  using (reviewer_id = (select auth.uid())) with check (reviewer_id = (select auth.uid()));

-- Server-only helper: find an auth user by email (callable with the service role only)
create function public.auth_user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
revoke execute on function public.auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for challenge uploads (5 MB; pdf, doc, docx, png,
-- jpg, txt). No storage policies on purpose: uploads and downloads only
-- happen through short-lived signed URLs issued by the API.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('challenge-uploads', 'challenge-uploads', false, 5242880, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'text/plain'
])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Seed: the ten roles (descriptions from the volunteer page) and the guide's
-- example challenge for each. Hours, skills and most Lead questions are left
-- for each Lead to fill in.
-- ---------------------------------------------------------------------------
insert into public.roles (slug, title, description, lead_question, sort_order) values
  ('partnerships', 'Strategic Partnerships', 'You go out and find the people and organizations who believe in what we''re building enough to stand behind it. Every partnership you close is a door opening for someone we haven''t met yet.', null, 1),
  ('communications', 'Communications & PR', 'You take everything we''re building and give it a voice the world can hear. Without you, great work happens in silence. With you, it becomes a movement.', null, 2),
  ('programs', 'Programs & Logistics', 'You turn ideas into things that actually happen, on the ground, on time, for real people. You''re the hands that build what everyone else imagines.', null, 3),
  ('finance', 'Finance', 'You make sure every dream we chase is one we can actually afford to chase, and chase well. You protect the house so it can keep growing.', null, 4),
  ('students', 'Student Relations', 'You''re planting Beyond 4walls into the soil of every campus we touch, one Campus Leader at a time, each one carrying the same fire you carry.', null, 5),
  ('it', 'IT & Technology', 'You make sure nothing we build is ever lost. Every idea, every event, every win, you keep it alive and accessible, long after the moment has passed.', null, 6),
  ('research', 'Research & Development', 'You keep us honest and forward looking. You find what''s true, what''s working, and what''s next, including through the Monitoring & Evaluation team that reports through you.', null, 7),
  ('events', 'Event Experience', 'You''re where the vision becomes something people can feel with their own senses, in a room, at an event, in a moment they won''t forget.', null, 8),
  ('alumni', 'Alumni & Community', 'You make sure nobody who''s ever been part of this family truly leaves it. You keep the circle widening instead of closing.', null, 9),
  ('volunteers', 'Volunteer Management', 'You find the people willing to give their time for something bigger than themselves, and you make sure that gift is never wasted.', 'What makes a volunteer stay?', 10);

insert into public.challenges (role_id, title, brief)
select r.id, c.title, c.brief
from (values
  ('communications', 'Announce an event', 'Draft a short social media post announcing an event of your choice.'),
  ('finance', 'Budget a workshop', 'Build a simple budget for a 100-person workshop.'),
  ('programs', 'Plan a workshop day', 'Lay out a one-day schedule for a youth workshop.'),
  ('volunteers', 'Recruit and keep 20 volunteers', 'Outline how you would recruit and keep 20 volunteers.'),
  ('partnerships', 'Invite a sponsor', 'Write a short outreach message inviting a company to sponsor an event.'),
  ('events', 'The first ten minutes', 'Describe how you would make the first ten minutes of an event unforgettable.'),
  ('it', 'Organise a growing team''s files', 'Explain how you would organise and back up the files of a growing team.'),
  ('research', 'Did the workshop change anything?', 'Outline how you would measure whether a workshop changed anything for participants.'),
  ('students', 'Reach a campus', 'Draft a plan for reaching students on a campus you know well.'),
  ('alumni', 'Keep past participants involved', 'Suggest three ways to keep past participants involved.')
) as c(slug, title, brief)
join public.roles r on r.slug = c.slug;
