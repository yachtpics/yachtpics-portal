-- Sept 23, 2026 — the category dropdown on the admin listing page.
--
-- /admin/listings/[id] builds its category dropdown from every category ever
-- used, across all listings. It did that by selecting the `category` of EVERY
-- photo row and de-duplicating in Node: a payload that grows with the whole
-- photo library, on every open of that page — and, past PostgREST's row cap
-- (1,000 by default), silently missing whatever categories only appear later.
--
-- This returns the distinct values instead: a handful of rows.
--
-- SECURITY INVOKER (the default, stated for clarity) so it sees exactly what
-- the old query saw under the caller's RLS — no wider. Read-only, additive,
-- safe to re-run.
--
-- Applied live Sept 23, 2026. The page still falls back to the old query if
-- the function is ever missing.

create or replace function public.distinct_photo_categories()
returns table (category text)
language sql stable security invoker
set search_path = public
as $$
  select distinct p.category
  from photos p
  where p.category is not null
  order by 1;
$$;

revoke all on function public.distinct_photo_categories() from public, anon;
grant execute on function public.distinct_photo_categories() to authenticated;
