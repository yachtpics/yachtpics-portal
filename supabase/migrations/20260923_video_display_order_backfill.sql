-- Sept 23, 2026 — videos.display_order is now the order everywhere.
--
-- Until today every reader sorted videos by created_at and display_order was
-- written on upload but never read. Now the broker and admin listing pages let
-- you drag videos into an order, and every reader (listing pages, /s slideshow,
-- /d delivery, client galleries, send-to-client email, website publish) sorts
-- by display_order ASC NULLS LAST, then created_at.
--
-- 1. Backfill: rows with no display_order get one, numbered by created_at
--    within their listing (or gallery, for gallery-only videos). They are
--    numbered AFTER any rows in the same listing that already have an order,
--    so nothing collides and the visible order is unchanged by this migration
--    (NULLS LAST already put them there). A listing whose videos are all null
--    comes out 0, 1, 2… in upload order — exactly what it showed before.
-- 2. Default 0, so an insert that doesn't pass display_order (gallery uploads,
--    anything older) never produces a null again.
--
-- NOT YET APPLIED — Charlie applies. Safe to re-run: step 1 only touches nulls.

with numbered as (
  select
    v.id,
    coalesce(mx.max_order, -1)
      + row_number() over (
          partition by v.listing_id, v.gallery_id
          order by v.created_at, v.id
        ) as new_order
  from public.videos v
  left join lateral (
    select max(o.display_order) as max_order
    from public.videos o
    where o.display_order is not null
      and o.listing_id is not distinct from v.listing_id
      and o.gallery_id is not distinct from v.gallery_id
  ) mx on true
  where v.display_order is null
)
update public.videos
set display_order = numbered.new_order
from numbered
where public.videos.id = numbered.id;

alter table public.videos alter column display_order set default 0;
