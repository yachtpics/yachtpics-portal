-- Oct 29, 2026 — Admin > Storage timed out (photo_storage_stats scans ~100k
-- storage objects; 7-17 s under copy load, over the 8 s API limit).
-- The heavy query is now photo_storage_stats_compute(); pg_cron refreshes a
-- one-row cache every 5 minutes, and photo_storage_stats() (what the page
-- calls) returns the cached jsonb plus computed_at. Applied via Supabase MCP.
-- (20261029b, also applied, only rewrote the compute query: single scan of
-- listing-photos, prefix join for site-photos.)
create table if not exists public.storage_stats_cache (
  id int primary key default 1 check (id = 1),
  stats jsonb not null,
  computed_at timestamptz not null default now()
);
alter table public.storage_stats_cache enable row level security;
alter function public.photo_storage_stats() rename to photo_storage_stats_compute;
revoke all on function public.photo_storage_stats_compute() from public, anon, authenticated;
create or replace function public.refresh_photo_storage_stats()
returns void language plpgsql security definer set search_path to 'public', 'storage' as $$
begin
  perform set_config('statement_timeout', '300s', true);
  insert into public.storage_stats_cache (id, stats, computed_at)
  values (1, public.photo_storage_stats_compute(), now())
  on conflict (id) do update set stats = excluded.stats, computed_at = excluded.computed_at;
end $$;
revoke all on function public.refresh_photo_storage_stats() from public, anon, authenticated;
create or replace function public.photo_storage_stats()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select stats || jsonb_build_object('computed_at', computed_at) from public.storage_stats_cache where id = 1),
    '{}'::jsonb
  );
$$;
select cron.unschedule('storage-stats') where exists (select 1 from cron.job where jobname = 'storage-stats');
select cron.schedule('storage-stats', '*/5 * * * *', $$ select public.refresh_photo_storage_stats(); $$);
