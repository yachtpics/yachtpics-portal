-- Add Stripe billing columns to subscriptions table
-- Run this in Supabase SQL Editor

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id text,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS plan text DEFAULT 'free';

-- Index for fast customer lookups from webhook
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_customer_id_idx
  ON subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- Allow service role (used by webhook) to upsert subscriptions
-- (service role bypasses RLS, so no policy needed for webhook)
-- Ensure brokers can read their own subscription
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Brokers can view own subscription" ON subscriptions;
CREATE POLICY "Brokers can view own subscription"
  ON subscriptions FOR SELECT
  USING (broker_id = auth.uid());
