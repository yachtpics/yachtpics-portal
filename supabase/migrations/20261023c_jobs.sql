-- Oct 23, 2026 — Background job queue (`jobs`).
--
-- Admin bulk actions (Re-publish live boats, the photo thumbnail backfill,
-- labelling photos across many listings) used to run as a loop in the admin's
-- browser tab and stopped when the tab closed. They now go in this table and
-- a server worker (/api/jobs/work) runs them one ~40 s batch at a time,
-- re-calling itself until the job is finished. The admin pages poll the row
-- for progress. See src/lib/jobs/.
--
--   status       queued → running → done | failed | cancelled
--   total/done/failed   progress counters shown on the progress bar
--   cursor       where the next batch starts (handler-specific JSON)
--   log          last ~200 human-readable lines [{at, text}]
--   locked_until a worker's lease on the row while it runs a batch; a crashed
--                worker's lease simply expires and the next worker resumes
--   steps        batches run so far (runaway guard caps it)
--   step_errors  consecutive failed/timed-out batches (3 → job fails)
--
-- Admins only: no broker or assistant access. The worker and the admin API
-- routes use the service role. Additive only; safe to run twice.

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  params jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  total integer,
  done integer not null default 0,
  failed integer not null default 0,
  cursor jsonb,
  log jsonb not null default '[]'::jsonb,
  error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  locked_until timestamptz,
  steps integer not null default 0,
  step_errors integer not null default 0
);

-- Columns added after the first draft (no-ops on a fresh table).
alter table public.jobs add column if not exists locked_until timestamptz;
alter table public.jobs add column if not exists steps integer not null default 0;
alter table public.jobs add column if not exists step_errors integer not null default 0;

-- The worker picks the oldest waiting job; the Jobs page lists the newest.
create index if not exists jobs_status_created_idx on public.jobs (status, created_at);

-- At most one queued/running job per kind + identical params, so a double
-- click (or two admins) can't start the same bulk run twice. md5 keeps the
-- index entry small when params carry a long list of listing ids.
create unique index if not exists jobs_one_active_idx
  on public.jobs (kind, md5(params::text))
  where status in ('queued', 'running');

alter table public.jobs enable row level security;

drop policy if exists "jobs admin all" on public.jobs;
create policy "jobs admin all" on public.jobs
  for all using (public.is_admin()) with check (public.is_admin());
