-- Oct 31 — Admin "In Review" reels (/admin/reels/review). Additive only.
--
-- One row per saved In Review reel: the period, the boats in play order with
-- the photo chosen for each (items: [{listingId, photoId, included}]), and the
-- render settings (format, seconds per boat, transition, framing, music,
-- opening-card lines) — enough to open it again and re-render. The MP4 itself
-- is never stored (it is made in the browser and downloaded / sent to a phone).
--
-- Read and written only by the admin API routes with the service role; RLS is
-- on with no policies, so nobody else can reach it.
create table if not exists public.review_reels (
  id uuid primary key default gen_random_uuid(),
  created_by uuid,  -- no FK: a second listings/profiles-style relationship would make PostgREST embeds ambiguous (see 20261029d)
  title text not null default 'In review',
  period_from date not null,
  period_to date not null,
  preset text,
  settings jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  boat_count integer not null default 0,
  caption text,
  rendered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists review_reels_updated_idx on public.review_reels (updated_at desc);

alter table public.review_reels enable row level security;
