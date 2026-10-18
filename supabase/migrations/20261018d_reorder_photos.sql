-- Save a listing's photo order in one request instead of one UPDATE per photo.
-- display_order is 0-based in the app (position in the array), so ord - 1.
-- security invoker: runs as the caller, so the photos RLS policies still decide
-- which rows may be updated.
create or replace function public.reorder_photos(p_listing_id uuid, p_photo_ids uuid[])
returns void
language sql
security invoker
set search_path = public
as $$
  update public.photos p
     set display_order = x.ord - 1
    from unnest(p_photo_ids) with ordinality as x(id, ord)
   where p.id = x.id
     and p.listing_id = p_listing_id;
$$;

revoke all on function public.reorder_photos(uuid, uuid[]) from public;
grant execute on function public.reorder_photos(uuid, uuid[]) to authenticated;
