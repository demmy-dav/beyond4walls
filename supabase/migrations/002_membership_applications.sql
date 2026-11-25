-- Membership applications from /membership (api/membership.js).
-- Each valid submission is saved here BEFORE any email is sent, so a Resend
-- outage never loses a member. Rows whose team email did not go out are
-- flagged for retry:
--
--   select * from public.membership_applications
--   where team_email_status <> 'sent' order by created_at;
--
-- Only the API writes here, with the service role key. RLS is on with no
-- policies, so the anon/authenticated keys cannot read or write this table.

create table if not exists public.membership_applications (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),

  full_name            text not null,
  email                text not null,
  phone                text not null,
  gender               text,
  age_range            text not null,
  state                text not null,
  city                 text not null,
  role                 text not null,
  organisation         text,
  level                text,
  why                  text not null,
  interests            text[] not null default '{}',
  skills               text,
  going_further        text not null,
  consent              boolean not null,
  updates              boolean not null default false,

  -- Delivery tracking: 'pending' (just saved), 'sent', or 'failed' (retry)
  team_email_status    text not null default 'pending'
                       check (team_email_status in ('pending', 'sent', 'failed')),
  team_email_attempts  integer not null default 0,
  team_email_error     text,
  team_email_sent_at   timestamptz,
  confirmation_sent    boolean
);

create index if not exists membership_applications_retry_idx
  on public.membership_applications (created_at)
  where team_email_status <> 'sent';

create index if not exists membership_applications_email_idx
  on public.membership_applications (email);

alter table public.membership_applications enable row level security;
