-- Sept 29, 2026 — Reel allowance: two included reels per listing.
--
-- From Oct 1 ET a listing whose broker isn't subscribed comes with two reels,
-- free and clean. A reel "counts" when it is taken off the page (download,
-- send to phone, save to camera roll, add to listing). /api/reels/claim writes
-- one 'claim' row per distinct render, and counts them to decide.
--
-- Also adds 'save_to_camera_roll' as a kind: the Reel page has been sending it
-- since the camera-roll button shipped, and the old check was quietly refusing
-- every one of those rows.
--
-- Additive only; safe to run twice.

alter table public.reel_events add column if not exists render_id text;

alter table public.reel_events drop constraint if exists reel_events_kind_check;
alter table public.reel_events add constraint reel_events_kind_check check (kind in (
  'render',
  'download',
  'send_to_phone',
  'copy_caption',
  'added_to_listing',
  'save_to_camera_roll',  -- share sheet → Save Video (iOS)
  'claim'                 -- one of a listing's included reels was used
));

-- The claim route counts claims per listing.
create index if not exists reel_events_listing_kind_idx on public.reel_events(listing_id, kind);

-- One claim per render per listing: the same film taken twice (download, then
-- send to phone) is one reel, and two tabs racing can't double-file it.
create unique index if not exists reel_events_claim_render_uniq
  on public.reel_events(listing_id, render_id)
  where kind = 'claim' and render_id is not null;
