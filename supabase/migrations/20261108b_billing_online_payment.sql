-- Nov 8, 2026 — Billing phase 3: online payment (Pay online on /inv).
-- Run after 20261108_billing_reminders.sql.
--
-- Additive and re-runnable. Same rules as 20261107: RLS grants reads only
-- (each login its own row); every write goes through /api/admin/books/*,
-- /api/inv/[token]/* or the Stripe webhook with the service role.
--
--  1. billing_payment_processors — one row per login: which processor takes
--     that login's online payments. Charlie (owner) → the Portal's own Stripe
--     account ('stripe_platform'), on. Everyone else → their own PayPal
--     business account ('paypal'), off until they enter credentials in
--     Settings. The PayPal secret is stored AES-256-GCM encrypted by the app
--     (key = Vercel env BILLING_SECRETS_KEY); the database never sees it in
--     the clear, and the authenticated role can't read the column at all.
--  2. billing_invoices.stripe_checkout_session_id / paypal_order_id — the
--     last checkout started from the invoice page.
--  3. billing_payments: method already allows card / bank / paypal and
--     source stripe / paypal (20261107), and the unique index on
--     (source, external_id) — what makes a replayed webhook or a reloaded
--     PayPal return page a no-op — already exists. Both are re-asserted below
--     so this file stands on its own.
set local lock_timeout = '5s';

-- ─── 1. Per-login processor ───────────────────────────────────────────────
create table if not exists public.billing_payment_processors (
  profile_id uuid primary key references public.billing_staff(profile_id) on delete cascade,
  processor text not null check (processor in ('stripe_platform', 'paypal')),
  paypal_client_id text,
  paypal_secret_enc text,                       -- "v1:iv:tag:ciphertext" (base64), app-encrypted
  paypal_env text not null default 'live' check (paypal_env in ('live', 'sandbox')),
  paypal_webhook_id text,                       -- reserved for PayPal webhooks (not built yet)
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.billing_payment_processors (profile_id, processor, enabled)
select s.profile_id,
       case when s.is_owner then 'stripe_platform' else 'paypal' end,
       s.is_owner
  from public.billing_staff s
on conflict (profile_id) do nothing;

-- ─── 2. Checkout ids on the invoice ───────────────────────────────────────
alter table public.billing_invoices add column if not exists stripe_checkout_session_id text;
alter table public.billing_invoices add column if not exists paypal_order_id text;

-- ─── 3. Payments: online methods + replay key (no-ops on a 20261107 DB) ──
alter table public.billing_payments drop constraint if exists billing_payments_method_check;
alter table public.billing_payments add constraint billing_payments_method_check
  check (method in ('check', 'zelle', 'venmo', 'cash', 'card', 'bank', 'paypal', 'other'));
create unique index if not exists billing_payments_external_idx
  on public.billing_payments (source, external_id) where external_id is not null;

-- ─── RLS: own row, read only; the secret column is never readable ────────
alter table public.billing_payment_processors enable row level security;

drop policy if exists billing_payment_processors_read on public.billing_payment_processors;
create policy billing_payment_processors_read on public.billing_payment_processors for select to authenticated
  using (profile_id = (select auth.uid()) and (select public.billing_is_staff()));

revoke all on table public.billing_payment_processors from anon, authenticated;
grant select (profile_id, processor, paypal_client_id, paypal_env, enabled, updated_at)
  on public.billing_payment_processors to authenticated;
