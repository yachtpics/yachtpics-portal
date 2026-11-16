-- Nov 16, 2026 — Website-only text for the yachtpics.com boat page.
-- Run after 20261114_marketing_video_events.sql. Additive and re-runnable.
--
-- listings.description stays the BROKER's text (Edit Listing, slideshow, spec
-- sheet). The public yachtpics.com page gets its own text, written by
-- YachtPics, so a broker's description never goes public by accident and a
-- YachtPics draft never shows up in a broker's own materials.
--
--   site_description            what the website page uses (intro + Google
--                               description). Empty → the generated sentence.
--   site_description_draft      an AI draft waiting for the owner to approve,
--                               edit or skip. Never published.
--   site_description_drafted_at when that draft was made.
--   site_location_suggestion    a location read from the photos' embedded
--                               metadata, waiting for the owner to accept.
--
-- No new table and no RLS change, so the demo policy step is not needed.

alter table public.listings add column if not exists site_description text;
alter table public.listings add column if not exists site_description_draft text;
alter table public.listings add column if not exists site_description_drafted_at timestamptz;
alter table public.listings add column if not exists site_location_suggestion text;

comment on column public.listings.site_description is
  'Text for the yachtpics.com boat page (intro + meta description). Written by YachtPics, separate from the broker''s description.';
comment on column public.listings.site_description_draft is
  'AI draft of site_description awaiting owner review. Never published.';
comment on column public.listings.site_location_suggestion is
  'Location read from photo metadata, awaiting owner review. Never published.';
