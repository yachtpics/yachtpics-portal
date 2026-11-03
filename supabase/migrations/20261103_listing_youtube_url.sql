-- 2026-11-03 — The listing's YouTube video link.
-- Shown on the broker listing page's "Ready for this boat" strip (For your
-- listing tile: Copy link / Copy description line). Edited on Edit Listing
-- (broker and admin share ListingEditForm). Validated in PATCH
-- /api/listings/[id] (must be a youtube.com / youtu.be address). Additive only.
alter table public.listings add column if not exists youtube_url text;
comment on column public.listings.youtube_url is 'YouTube link for the listing video (watch / youtu.be / shorts). Set on Edit Listing; shown on the broker listing page.';
