-- Lock down the listing-videos storage bucket the same way listing-photos was
-- (20261005). Before this, ANY signed-in user could read, upload to, or delete
-- ANY video in the bucket. New uploads go to R2; this bucket now only holds
-- legacy videos, read via signed URLs.
--
-- Path layout: {broker_or_uploader_id}/{listing_id}/{file} — segment 2 is the
-- listing, read by public.storage_listing_id(name).
-- The listings subquery runs under the caller's RLS, so "can see the listing"
-- covers own, assistant, co-broker and office-shared listings.

drop policy if exists "Authenticated users can view videos"   on storage.objects;
drop policy if exists "Authenticated users can upload videos" on storage.objects;
drop policy if exists "Authenticated users can delete videos" on storage.objects;

create policy "listing-videos read: entitled listing"
on storage.objects for select to authenticated
using (
  bucket_id = 'listing-videos'
  and (
    (select public.is_admin())
    or exists (
      select 1 from public.listings l
      where l.id = public.storage_listing_id(storage.objects.name)
    )
  )
);

create policy "listing-videos insert: listing editors"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'listing-videos'
  and (
    (select public.is_admin())
    or exists (
      select 1 from public.listings l
      where l.id = public.storage_listing_id(storage.objects.name)
        and (
          l.broker_id = (select auth.uid())
          or public.assistant_has_access(l.broker_id)
          or public.is_co_broker(l.id)
        )
    )
  )
);

create policy "listing-videos delete: admin or listing editors"
on storage.objects for delete to authenticated
using (
  bucket_id = 'listing-videos'
  and (
    (select public.is_admin())
    or exists (
      select 1 from public.listings l
      where l.id = public.storage_listing_id(storage.objects.name)
        and (
          l.broker_id = (select auth.uid())
          or public.assistant_has_access(l.broker_id)
          or public.is_co_broker(l.id)
        )
    )
  )
);

-- Defence in depth: the shared-inventory rules on the photos/videos tables
-- already depend on listings RLS (which requires is_shared), but say it
-- explicitly so a future listings-policy change can't open them up.
drop policy if exists "Brokers view shared inventory photos" on public.photos;
create policy "Brokers view shared inventory photos" on public.photos for select
using (exists (select 1 from public.listings l
               where l.id = photos.listing_id and l.is_shared = true and public.broker_sees_shared(l.broker_id)));

drop policy if exists "Brokers view shared inventory videos" on public.videos;
create policy "Brokers view shared inventory videos" on public.videos for select
using (exists (select 1 from public.listings l
               where l.id = videos.listing_id and l.is_shared = true and public.broker_sees_shared(l.broker_id)));
