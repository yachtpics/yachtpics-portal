-- Oct 26, 2026 — Website billing on broker_sites (the website is a line item
-- on the broker's Portal PLAN subscription).
--
-- Owner decision: every tier comes in two versions — Portal, or Portal +
-- Website (+$50/month: Starter $79, Growth $99, Pro $129); Elite ($149)
-- includes the website. The website is a SECOND ITEM ($50 price, lookup_key
-- website_monthly_50) on the same Stripe subscription as the plan — not a
-- separate subscription. A broker's site (/b/{slug}) is live when the broker
-- has Portal access AND (Elite, OR the plan subscription carries the website
-- item / was paid through website_ends_at, OR an admin comp). Office-plan
-- coverage alone doesn't include it. Rule: src/lib/websiteAddon.ts
-- (websiteEntitlement); the Stripe webhook keeps these columns in step with
-- the plan subscription.
--
--   website_item_id         the website subscription item on the plan
--                           subscription (null = not on the plan)
--   stripe_subscription_id  the plan subscription the item belongs to
--   billing_status          none | active | past_due | canceled | comped —
--                           mirrors the PLAN subscription (active/trialing →
--                           active, past_due → past_due, unpaid/canceled →
--                           canceled); 'comped' = admin comp
--   current_period_end      the plan subscription's current period end
--   website_ends_at         set when the broker removes the website: the item
--                           is taken off the subscription at once with no
--                           proration (nothing renews), and the site stays
--                           live until this time (the end of the month
--                           already paid for). Cleared when re-added.
--
-- Additive only; safe to run more than once. Requires 20261026_broker_sites.sql.

alter table public.broker_sites add column if not exists website_item_id text;
alter table public.broker_sites add column if not exists stripe_subscription_id text;
alter table public.broker_sites add column if not exists billing_status text not null default 'none';
alter table public.broker_sites add column if not exists current_period_end timestamptz;
alter table public.broker_sites add column if not exists website_ends_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'broker_sites_billing_status_check') then
    alter table public.broker_sites add constraint broker_sites_billing_status_check
      check (billing_status in ('none', 'active', 'past_due', 'canceled', 'comped'));
  end if;
end $$;

-- Billing columns are written only by the server (service role: Stripe
-- webhook, the add/remove routes, admin comp). Brokers and assistants keep
-- updating their own row's content through the existing policies, but not
-- these columns.
revoke update on public.broker_sites from authenticated;
grant update (slug, published, headline, specialty, hero_photo_id, portrait_path, stats, credentials,
              testimonials, show_prices, whatsapp, sections, updated_at)
  on public.broker_sites to authenticated;
