-- Oct 26, 2026 — Broker Websites: the broker's own section order.
--
-- section_order: JSON array of the movable sections in the order the broker
-- dragged them to — any of "proof", "yachts", "sold", "about",
-- "testimonials", "sell". The hero is always first; Contact and the footer
-- always last. null = the layout's default order. The app validates on save
-- (known keys only, each once, missing keys appended in default order) and
-- on read, so a stale or partial array can never break a page.
--
-- Additive; safe to run more than once.

alter table public.broker_sites add column if not exists section_order jsonb;
