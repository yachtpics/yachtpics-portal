-- Oct 28, 2026 — Full-res photo originals move to Cloudflare R2 (dual backend).
--
-- photos.storage_backend   where the ORIGINAL lives: 'supabase' (bucket
--                          listing-photos, as before) or 'r2' (private R2 bucket,
--                          key photos/listing-photos/{storage_path}). The 600 /
--                          2000 px derivatives stay in Supabase either way.
-- photos.original_bytes    size of the original (recorded at upload / copy) so
--                          the admin Storage page can show GB moved.
-- photos.r2_verified_at    when the copy job verified the R2 copy (HEAD size ==
--                          source size). Set for copied rows; null for rows
--                          uploaded straight to R2.
-- photos.r2_copy_error     last copy failure (null when fine).
-- photos.supabase_removed_at  when the gated cleanup removed the Supabase copy.
-- listings.site_photos_backend  where the boat's yachtpics.com page points its
--                          photos: null = Supabase bucket site-photos (as
--                          before), 'r2' = public R2 bucket (media host).
--
-- photo_storage_stats()    counts/bytes for the admin Storage page (reads
--                          storage.objects; service role only).
--
-- Additive only; safe to run twice. Nothing is moved or deleted here.
set local lock_timeout = '5s';

alter table public.photos add column if not exists storage_backend text not null default 'supabase';
alter table public.photos add column if not exists original_bytes bigint;
alter table public.photos add column if not exists r2_verified_at timestamptz;
alter table public.photos add column if not exists r2_copy_error text;
alter table public.photos add column if not exists supabase_removed_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'photos_storage_backend_check') then
    alter table public.photos add constraint photos_storage_backend_check
      check (storage_backend in ('supabase', 'r2'));
  end if;
end $$;

-- Backend lookups by path (signing helpers) and the copy job's queue.
create index if not exists photos_storage_path_idx on public.photos (storage_path);
create index if not exists photos_backend_id_idx on public.photos (storage_backend, id);

alter table public.listings add column if not exists site_photos_backend text;

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
