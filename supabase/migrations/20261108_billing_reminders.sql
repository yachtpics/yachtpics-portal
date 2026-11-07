-- Nov 8, 2026 — Billing: payment reminders..
-- Run after 20261107b_billing_terms_footers.sql.
--
-- Additive and re-runnable. Same rules as 20261107: RLS grants reads only
-- (each login its own rows); every write goes through /api/admin/books/* or
-- the billing_reminders job with the service role.
--
--  1. billing_reminder_schedules — one row per login: the days past the due
--     date at which a reminder goes out (ascending, 1..120), and an on/off.
--     Charlie (owner) starts at {12} so a mailed check has time to arrive;
--     everyone else starts empty and sets their own in Settings.
--  2. billing_invoices.reminders_paused — per-invoice pause ("a check is on
--     the way"). Still editable after send.
--  3. billing_reminders_sent — one row per (invoice, day step). The unique key
--     is what makes the daily run safe to repeat: a step is claimed by
--     inserting this row before the email goes.
set local lock_timeout = '5s';

-- ─── 1. Per-login schedule ────────────────────────────────────────────────
create table if not exists public.billing_reminder_schedules (
  profile_id uuid primary key references public.billing_staff(profile_id) on delete cascade,
  days integer[] not null default '{}',
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint billing_reminder_schedules_days_check
    check (cardinality(days) <= 10 and 1 <= all (days) and 120 >= all (days))
);

insert into public.billing_reminder_schedules (profile_id, days, enabled)
select s.profile_id, case when s.is_owner then '{12}'::integer[] else '{}'::integer[] end, true
  from public.billing_staff s
on conflict (profile_id) do nothing;

-- ─── 2. Per-invoice pause ─────────────────────────────────────────────────
alter table public.billing_invoices add column if not exists reminders_paused boolean not null default false;

-- ─── 3. What has gone out ─────────────────────────────────────────────────
create table if not exists public.billing_reminders_sent (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.billing_invoices(id) on delete cascade,
  owner_id uuid not null,                       -- = billing_invoices.owner_id
  day integer not null check (day between 1 and 120),
  sent_to text,
  email_log_id uuid,                            -- email_log.id (no FK; logging is best-effort)
  resend_id text,
  sent_at timestamptz not null default now(),
  unique (invoice_id, day)
);
create index if not exists billing_reminders_sent_owner_idx on public.billing_reminders_sent (owner_id, sent_at);
create index if not exists billing_reminders_sent_invoice_idx on public.billing_reminders_sent (invoice_id, sent_at desc);

-- ─── RLS: reads only; no write policies ───────────────────────────────────
alter table public.billing_reminder_schedules enable row level security;
alter table public.billing_reminders_sent enable row level security;

-- Own schedule; the owner may also read the others' (view only — edits are
-- own-row only, enforced in /api/admin/books/reminders).
drop policy if exists billing_reminder_schedules_read on public.billing_reminder_schedules;
create policy billing_reminder_schedules_read on public.billing_reminder_schedules for select to authenticated
  using ((profile_id = (select auth.uid()) or (select public.billing_is_owner())) and (select public.billing_is_staff()));

drop policy if exists billing_reminders_sent_read on public.billing_reminders_sent;
create policy billing_reminders_sent_read on public.billing_reminders_sent for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.billing_is_staff()));
