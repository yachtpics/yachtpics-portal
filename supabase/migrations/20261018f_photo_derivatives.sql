-- Pre-generated photo derivatives ("thumbs project").
-- APPLIED Oct 18 2026 via SQL (already live in prod) — this file is the record.
-- Safe to re-run.
--
-- photos.derivatives_at:
--   null                         → the stored 600 / 2000 px WebP copies don't exist yet
--   a real timestamp             → both exist at {dir}/_d/{photoId}-{v}-{600|2000}.webp
--                                  (naming: src/lib/photoDerivativePaths.ts)
--   1970-01-01 00:00:00+00       → tried; this original can't be resized (missing file,
--                                  unreadable format, too large) — pages keep the old path
--
-- The partial index serves the backfill ("newest photos still without
-- derivatives") and the admin "remaining" count.
--
-- Storage: derivatives live in the same private bucket (listing-photos) with
-- {listingId} as path segment 2, so the existing storage RLS
-- (public.storage_listing_id(name)) covers them; no new policies. They are
-- written only by the service role.

alter table public.photos
  add column if not exists derivatives_at timestamptz;

create index if not exists photos_derivatives_missing_idx
  on public.photos (created_at)
  where derivatives_at is null;
