-- Oct 29, 2026 — the FK from listings.slideshow_prepared_by to profiles gave
-- listings a second relationship to profiles, so every PostgREST embed like
-- listings -> profiles(...) became ambiguous ("Listing not found" on the
-- photos-ready email). Plain uuid column now. Applied via Supabase MCP.
alter table public.listings drop constraint if exists listings_slideshow_prepared_by_fkey;
notify pgrst, 'reload schema';
