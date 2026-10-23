-- Oct 23, 2026 — Reel Service per boat. The service is priced per boat
-- ($149 per boat per month for up to 4 reels, billed outside the app in Zoho
-- Invoice), so admins choose WHICH of an enrolled broker's boats are in it.
--
--   reel_service_listings — one row per boat ever enrolled. ended_at set =
--                           off the service (sold, or the broker dropped it);
--                           re-enrolling clears it and bumps enrolled_at.
--   reel_service_subscriptions.price_per_listing_cents — that broker's
--                           per-boat monthly price (default $149; admins can
--                           override for a special deal). For the billing
--                           summary only — nothing is charged in the app.
--
-- Backward compatible: the planner treats an enabled broker with NO rows here
-- as "all active boats" (the Oct 4 behaviour), so nothing running stops.
-- All writes go through admin API routes with the service role.
-- Brokers can read their own rows (Your reels lists the enrolled boats).
-- Additive only; safe to run twice.

create table if not exists public.reel_service_listings (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  broker_id uuid not null references public.profiles(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  ended_at timestamptz null,
  note text
);

create index if not exists reel_service_listings_broker_idx on public.reel_service_listings(broker_id);

alter table public.reel_service_listings enable row level security;

drop policy if exists "reel_service_listings admin all" on public.reel_service_listings;
create policy "reel_service_listings admin all" on public.reel_service_listings
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "reel_service_listings broker reads own" on public.reel_service_listings;
create policy "reel_service_listings broker reads own" on public.reel_service_listings
  for select using (broker_id = auth.uid());

alter table public.reel_service_subscriptions
  add column if not exists price_per_listing_cents integer not null default 14900;
