-- Oct 29, 2026 — distinct_photo_categories(): a "loose index scan" instead of
-- reading every photo. APPLIED.
--
-- The admin listing page's category dropdown called this on every load; it
-- read all ~28k photo rows (1.5 s cold). Now it hops through the index
-- photos(category, listing_id) one distinct category at a time (~100 probes).
-- Same result set, still SECURITY INVOKER (RLS decides what a caller sees).
--
-- Index (APPLIED separately, outside a transaction):
--   create index concurrently if not exists photos_category_listing_idx
--     on public.photos (category, listing_id) where category is not null;
set local lock_timeout = '5s';
create or replace function public.distinct_photo_categories()
returns table(category text)
language sql
stable
set search_path to 'public'
as $$
  with recursive c(category) as (
    (select p.category from photos p where p.category is not null order by p.category limit 1)
    union all
    select (select p.category from photos p where p.category > c.category order by p.category limit 1)
    from c
    where c.category is not null
  )
  select c.category from c where c.category is not null;
$$;
