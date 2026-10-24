-- Oct 24, 2026 (b) — paid Reel Service boats run on their PAID month.
--
-- Owner decision: a boat paid through Stripe is planned per paid period
-- [current_period_start, current_period_end), not per calendar month: up to
-- 4 reels per paid period, due at period start + 0, 7, 14 and 21 days.
-- Comped boats keep the calendar month (due_at null).
--
--   reel_service_listings.current_period_start  start of the paid period (from Stripe)
--   reel_service_jobs.service_period_start       the paid period a job belongs to
--                                                (null = calendar-month job)
--   reel_service_jobs.due_at                     target date (null = calendar-month job)
--
-- Paid jobs still carry `period` = the calendar month (Eastern) their paid
-- period starts in, so the board, the render station and the
-- (listing, period, slot) unique key keep working; a second paid period that
-- starts in the same calendar month takes the next free slots.
--
-- Needs 20261024_reel_service_stripe.sql first. Additive; safe to run twice.

alter table public.reel_service_listings
  add column if not exists current_period_start timestamptz;

alter table public.reel_service_jobs
  add column if not exists service_period_start timestamptz,
  add column if not exists due_at timestamptz;

create index if not exists reel_service_jobs_listing_service_period_idx
  on public.reel_service_jobs(listing_id, service_period_start);

create index if not exists reel_service_jobs_status_due_idx
  on public.reel_service_jobs(status, due_at);
