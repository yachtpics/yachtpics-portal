-- Nov 9, 2026 — Billing: edit a sent invoice with a reason + edit history.
-- Run after 20261109_billing_online_pay_switch.sql.
--
-- Additive and re-runnable. Same rules as 20261107: RLS grants reads only
-- (each login its own book); every write goes through /api/admin/books/*
-- with the service role.
--
--  1. billing_invoice_edits — one row per save of a sent / part-paid
--     invoice (owner decision, mirrors Zoho): who, when, the reason typed in
--     the "Edit a sent invoice" pop-up, the total before and after, and a
--     short summary of what changed. The editor sends one edit_id (uuid) with
--     both calls of a save (header PATCH + lines PUT): the first call
--     inserts the row with total_before, the second updates total_after and
--     appends to changes. owner_id = the invoice's owner (RLS), as on
--     billing_payments. Paid / void invoices stay locked; drafts need no
--     reason and write no row.
set local lock_timeout = '5s';

-- ─── 1. Edit history ──────────────────────────────────────────────────────
create table if not exists public.billing_invoice_edits (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.billing_invoices(id) on delete cascade,
  owner_id uuid not null,
  edited_by uuid,
  edited_by_name text,
  edited_at timestamptz not null default now(),
  reason text not null,
  total_before numeric,
  total_after numeric,
  changes text
);
create index if not exists billing_invoice_edits_invoice_idx
  on public.billing_invoice_edits (invoice_id, edited_at desc);

-- ─── RLS: each login reads its own book; no write policies ────────────────
alter table public.billing_invoice_edits enable row level security;

drop policy if exists billing_invoice_edits_read on public.billing_invoice_edits;
create policy billing_invoice_edits_read on public.billing_invoice_edits for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.billing_is_staff()));
