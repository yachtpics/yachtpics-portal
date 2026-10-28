-- Oct 28, 2026 (later) — pre-made download sizes for originals on R2.
--
-- photos.download_sizes  {"path": <storage_path they were made from>,
--                         "web": <bytes>, "social": <bytes>} — the Web & MLS
--                         (2048 px) and Social (1080 px) files, made with sharp
--                         and stored in R2 at photos/listing-photos/{dir}/_dl/
--                         {photoId}-{v}-{web|social}.{jpg|png}. Only for R2
--                         originals; null = not made (made on demand).
-- photo_storage_stats() gains r2_download_count / r2_download_bytes.
--
-- Additive only; safe to run twice.
set local lock_timeout = '5s';

alter table public.photos add column if not exists download_sizes jsonb;

create or replace function public.photo_storage_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, storage
as $$
  with o as (
    select name, coalesce((metadata->>'size')::bigint, 0) as sz
    from storage.objects
    where bucket_id = 'listing-photos' and name not like '%/\_d/%' escape '\' and name not like '\_tmp/%' escape '\'
  ),
  ph as (
    select p.storage_backend, p.storage_path, p.original_bytes, p.supabase_removed_at, o.sz as sb_size
    from public.photos p left join o on o.name = p.storage_path
  ),
  orphans as (
    select o.sz from o
    where not exists (select 1 from public.photos p where p.storage_path = o.name)
      and not exists (select 1 from public.videos v where v.thumbnail_path = o.name)
      and not exists (select 1 from public.listings l where l.deck_plan_path = o.name)
  ),
  site as (
    select s.name, coalesce((s.metadata->>'size')::bigint, 0) as sz,
           exists (
             select 1 from public.listings l
             where l.site_photos_backend = 'r2' and l.site_page is not null and l.site_slug is not null
               and s.name like l.site_page || '/' || l.site_slug || '/%'
           ) as switched
    from storage.objects s where s.bucket_id = 'site-photos'
  )
  select jsonb_build_object(
    'supabase_count', (select count(*) from ph where storage_backend = 'supabase'),
    'supabase_bytes', (select coalesce(sum(sb_size), 0) from ph where storage_backend = 'supabase'),
    'supabase_missing', (select count(*) from ph where storage_backend = 'supabase' and sb_size is null),
    'r2_count', (select count(*) from ph where storage_backend = 'r2'),
    'r2_bytes', (select coalesce(sum(coalesce(original_bytes, sb_size, 0)), 0) from ph where storage_backend = 'r2'),
    'r2_download_count', (select count(*) from public.photos where storage_backend = 'r2' and download_sizes is not null),
    'r2_download_bytes', (select coalesce(sum(coalesce((download_sizes->>'web')::bigint, 0) + coalesce((download_sizes->>'social')::bigint, 0)), 0)
                          from public.photos where storage_backend = 'r2' and download_sizes is not null),
    'r2_with_supabase_copy_count', (select count(*) from ph where storage_backend = 'r2' and sb_size is not null),
    'r2_with_supabase_copy_bytes', (select coalesce(sum(sb_size), 0) from ph where storage_backend = 'r2' and sb_size is not null),
    'orphan_count', (select count(*) from orphans),
    'orphan_bytes', (select coalesce(sum(sz), 0) from orphans),
    'derivative_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'listing-photos' and name like '%/\_d/%' escape '\'),
    'site_count', (select count(*) from site),
    'site_bytes', (select coalesce(sum(sz), 0) from site),
    'site_switched_count', (select count(*) from site where switched),
    'site_switched_bytes', (select coalesce(sum(sz), 0) from site where switched)
  );
$$;

revoke all on function public.photo_storage_stats() from public, anon, authenticated;
grant execute on function public.photo_storage_stats() to service_role;
