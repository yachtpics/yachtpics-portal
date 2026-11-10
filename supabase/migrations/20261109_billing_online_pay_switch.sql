-- Nov 9, 2026 — Billing: "Online payment" switch per client + per-invoice override.
-- Run after 20261108c_billing_client_contacts.sql.
--
-- Additive and re-runnable. Same rules as 20261107: RLS grants reads only
-- (billing_clients / billing_invoices keep their table-level read policies,
-- so the new columns are readable with no extra grant); every write goes
-- through /api/admin/books/* with the service role.
--
--  1. billing_clients.online_pay — false = pays by check only: new invoices
--     for this client never offer Pay online. Every client starts ON.
--  2. billing_invoices.online_pay — copied from the client when a draft is
--     created, its client changes, or it's duplicated; can be overridden per
--     invoice (also after send, not on paid / void). False → onlinePayState()
--     is 'hidden': no Pay button on /inv, no pay route, no PDF link.
set local lock_timeout = '5s';

-- ─── 1. Per-client switch ─────────────────────────────────────────────────
alter table public.billing_clients add column if not exists online_pay boolean not null default true;

-- ─── 2. Per-invoice override ──────────────────────────────────────────────
alter table public.billing_invoices add column if not exists online_pay boolean not null default true;
