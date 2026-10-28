-- Oct 28, 2026 — More broker contact details + YachtPics-only notes.
--   profiles: office_phone, instagram_handle (bare, lowercase), facebook_url
--   (full https://www.facebook.com/… URL), birthday_month / birthday_day (no
--   year, ever). The existing `phone` is shown as "Mobile".
--   broker_admin_notes: private notes about a broker, read and written only
--   by admins through the service role (RLS on, no policies).
-- Applied live; kept here so the repo matches. Safe to run more than once.

alter table public.profiles
  add column if not exists office_phone text,
  add column if not exists instagram_handle text,
  add column if not exists facebook_url text,
  add column if not exists birthday_month smallint check (birthday_month between 1 and 12),
  add column if not exists birthday_day smallint check (birthday_day between 1 and 31);

create table if not exists public.broker_admin_notes (
  broker_id uuid primary key references public.profiles(id) on delete cascade,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.broker_admin_notes enable row level security;  -- no policies: service-role only
