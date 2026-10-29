-- Open / click / sign-in tracking for campaign emails (Oct 29).
-- Written only by the server (service role); RLS on with no policies, and
-- anon/authenticated have no grants, so nothing reaches it from the browser.
create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  email_log_id uuid not null references public.email_log(id) on delete cascade,
  broker_id uuid,                -- the recipient's profile id (broker or assistant)
  kind text not null check (kind in ('open', 'click', 'signin')),
  url text,
  ua text,
  ip_hash text,
  created_at timestamptz not null default now()
);

create index if not exists email_events_log_kind_idx on public.email_events (email_log_id, kind, created_at desc);
create index if not exists email_events_broker_idx on public.email_events (broker_id, created_at desc);
-- One sign-in per email.
create unique index if not exists email_events_one_signin_idx on public.email_events (email_log_id) where kind = 'signin';

alter table public.email_events enable row level security;
revoke all on public.email_events from anon, authenticated;

-- Sign-in attribution looks up a recipient's latest emails.
create index if not exists email_log_recipient_sent_idx on public.email_log (recipient_id, sent_at desc);
