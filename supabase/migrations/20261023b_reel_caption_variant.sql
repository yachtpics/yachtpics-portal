-- Oct 23, 2026 — "Rewrite" for Reel Service captions.
--
--   caption_variant      — the templated caption variant last written by a
--                          rewrite (used when AI isn't configured or fails),
--                          so the next rewrite takes the next one.
--   caption_rewrites     — how many times the caption has been rewritten
--                          (brokers are capped at 30 per reel).
--   caption_rewritten_at — when it was last rewritten (one a minute).
--
-- The app works before this is applied (rewrites just aren't counted).
-- Additive only; safe to run twice.

alter table public.reel_service_jobs
  add column if not exists caption_variant integer,
  add column if not exists caption_rewrites integer not null default 0,
  add column if not exists caption_rewritten_at timestamptz;
