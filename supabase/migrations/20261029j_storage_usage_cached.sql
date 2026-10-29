-- Oct 29, 2026 — Supabase warned about Disk IO budget. storage_usage() scanned
-- all of storage.objects (~250 MB) on every Admin home load (~1,000 calls).
-- Now it reads a cached copy refreshed with the photo stats by pg_cron every
-- 6 hours (17 past). Applied via Supabase MCP.
alter table public.storage_stats_cache add column if not exists usage jsonb;
alter function public.storage_usage() rename to storage_usage_compute;
revoke all on function public.storage_usage_compute() from public, anon, authenticated;
create or replace function public.refresh_photo_storage_stats()
returns void language plpgsql security definer set search_path to 'public', 'storage' as $$
begin
  perform set_config('statement_timeout', '300s', true);
  insert into public.storage_stats_cache (id, stats, usage, computed_at)
  values (1, public.photo_storage_stats_compute(),
          (select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) from public.storage_usage_compute() u),
          now())
  on conflict (id) do update set stats = excluded.stats, usage = excluded.usage, computed_at = excluded.computed_at;
end $$;
revoke all on function public.refresh_photo_storage_stats() from public, anon, authenticated;
create or replace function public.storage_usage()
returns table(bucket_id text, files bigint, bytes bigint)
language sql stable security definer set search_path to 'public' as $$
  select (e->>'bucket_id')::text, (e->>'files')::bigint, (e->>'bytes')::bigint
  from public.storage_stats_cache c, jsonb_array_elements(coalesce(c.usage, '[]'::jsonb)) e
  where c.id = 1;
$$;
grant execute on function public.storage_usage() to service_role;
select cron.alter_job((select jobid from cron.job where jobname='storage-stats'), schedule := '17 */6 * * *');
