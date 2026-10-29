-- Oct 29, 2026 — Admin-prepared slideshows ("Slideshow ready" campaign).
--
-- /admin/announce/slideshow-ready can create the buyer slideshow for a
-- listing on the broker's behalf, with exactly the same change the broker's
-- own Create Slideshow makes (slideshow_slug + slideshow_published). These
-- two columns record that YachtPics did it, and when, so admin-prepared
-- slideshows can be told apart from broker-created ones. Null = the broker
-- (or nobody) created it.
--
-- Additive; safe to run more than once.

alter table public.listings
  add column if not exists slideshow_prepared_by uuid,
  add column if not exists slideshow_prepared_at timestamptz;
