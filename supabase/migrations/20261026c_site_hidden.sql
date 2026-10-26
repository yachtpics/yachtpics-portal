-- Oct 26, 2026 — Broker Websites: per-boat "Show on my website" switch.
--
-- Owner decision: a broker's site (/b/{slug}) now shows EVERY listing that is
-- active, not sold (sold_at null), has at least one visible photo and is not
-- a pocket listing (showcase_opt_out) — whether or not its buyer slideshow is
-- published — unless the broker switches it off here. Recent sales use the
-- same exclusions. site_hidden = true → the boat is left off the site.
--
-- Set from Dashboard → Website → Your boats (/api/website, action
-- "set_hidden"). The app treats a missing column as "not hidden".
-- Additive only; safe to run more than once.

alter table public.listings add column if not exists site_hidden boolean not null default false;
