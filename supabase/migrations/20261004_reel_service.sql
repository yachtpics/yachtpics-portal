-- Oct 4, 2026 — Reel Service: a paid add-on (billed outside the app) where
-- YachtPics delivers social reels every month for EACH active listing of an
-- enrolled broker (default 4 per listing per month).
--
--   reel_service_subscriptions — one row per enrolled broker (admin toggle).
--   reel_service_jobs          — the monthly plan: one row per reel to make,
--                                slots numbered per listing per month.
--
-- All writes go through admin API routes / cron with the service role.
-- Brokers can read their own enrolment row and their own ready/delivered jobs.
-- Additive only; safe to run twice.

create table if not exists public.reel_service_subscriptions (
  broker_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  reels_per_listing integer not null default 4 check (reels_per_listing between 1 and 10),
  started_at timestamptz not null default now(),
  note text,
  updated_at timestamptz not null default now()
);

alter table public.reel_service_subscriptions enable row level security;

drop policy if exists "reel_service_subscriptions admin all" on public.reel_service_subscriptions;
create policy "reel_service_subscriptions admin all" on public.reel_service_subscriptions
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "reel_service_subscriptions broker reads own" on public.reel_service_subscriptions;
create policy "reel_service_subscriptions broker reads own" on public.reel_service_subscriptions
  for select using (broker_id = auth.uid());

create table if not exists public.reel_service_jobs (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  slot integer not null,
  angle text not null,
  look text not null,
  settings jsonb not null default '{}'::jsonb,
  status text not null default 'planned'
    check (status in ('planned', 'rendering', 'ready', 'delivered', 'failed')),
  video_path text,
  storage_host text,
  caption text,
  error text,
  created_at timestamptz not null default now(),
  rendered_at timestamptz,
  delivered_at timestamptz,
  unique (listing_id, period, slot)
);

create index if not exists reel_service_jobs_period_idx on public.reel_service_jobs(period, broker_id);
create index if not exists reel_service_jobs_listing_idx on public.reel_service_jobs(listing_id, period);

alter table public.reel_service_jobs enable row level security;

drop policy if exists "reel_service_jobs admin all" on public.reel_service_jobs;
create policy "reel_service_jobs admin all" on public.reel_service_jobs
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "reel_service_jobs broker reads own finished" on public.reel_service_jobs;
create policy "reel_service_jobs broker reads own finished" on public.reel_service_jobs
  for select using (broker_id = auth.uid() and status in ('ready', 'delivered'));

-- Video-led reels (Oct 4, later): the planner needs each listing video's
-- length to cut segments and to tell when a listing has too little footage.
-- Measured in the admin's browser (Reel Service "Measure videos", and every
-- Reel Service render) and written back here. Null = not measured yet.
alter table public.videos add column if not exists duration_sec numeric;
