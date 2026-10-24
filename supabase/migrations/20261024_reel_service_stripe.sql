-- Oct 24, 2026 — Reel Service paid through the Portal (Stripe).
--
-- Owner decision (Oct 23 evening): the Reel Service is $179 per listing per
-- month for up to 4 reels, paid by card at the moment of ordering (Stripe
-- Checkout, recurring monthly, Stripe Tax on). The Zoho path is retired.
-- Each paid boat is its own Stripe subscription, recorded on its
-- reel_service_listings row. Admin enrolment from the broker page stays as a
-- comp / override path (billing_status 'comped').
--
--   stripe_subscription_id  the boat's Stripe subscription (null = comped)
--   stripe_customer_id      the broker's Stripe customer
--   billing_status          active | past_due | paused | canceled | comped
--   current_period_end      end of the paid month (renewal date)
--   cancel_at_period_end    broker pressed Cancel; runs to the period end
--   started_by              'broker' (checkout) | 'admin' (comp)
--
-- ended_at keeps its meaning: set = off the service. The planner plans a boat
-- only when ended_at is null AND billing_status is active, comped or
-- past_due (Stripe still retrying). Paused and canceled boats are skipped.
-- Existing rows become 'comped' (the column default).
--
-- Needs 20261023_reel_service_listings.sql first. Additive; safe to run twice.
-- Writes come only from the service role (webhook + admin routes); the
-- existing RLS policies (admin all, broker reads own) cover the new columns.

alter table public.reel_service_listings
  add column if not exists stripe_subscription_id text unique,
  add column if not exists stripe_customer_id text,
  add column if not exists billing_status text not null default 'comped',
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists started_by text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reel_service_listings_billing_status_check') then
    alter table public.reel_service_listings
      add constraint reel_service_listings_billing_status_check
      check (billing_status in ('active', 'past_due', 'paused', 'canceled', 'comped'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reel_service_listings_started_by_check') then
    alter table public.reel_service_listings
      add constraint reel_service_listings_started_by_check
      check (started_by is null or started_by in ('broker', 'admin'));
  end if;
end $$;

create index if not exists reel_service_listings_stripe_sub_idx
  on public.reel_service_listings(stripe_subscription_id);
