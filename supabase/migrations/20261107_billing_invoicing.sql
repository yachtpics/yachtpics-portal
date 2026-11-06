-- Nov 7, 2026 — Billing (Portal) phase 2: invoices, lines, manual payments,
-- invoice numbers, per-login invoice settings, dark logos. NOT APPLIED.
-- Run after 20261106_billing_foundation.sql.
--
-- Rules as phase 1: additive and re-runnable; no FK to profiles or listings
-- (owner_id / listing_id are plain uuids with indexes); RLS grants reads of a
-- login's OWN book only (Charlie does not see Samantha's invoices and vice
-- versa); every write goes through /api/admin/books/* with the service role.
--
-- Phase 3 plugs in here: Stripe / PayPal write rows into billing_payments
-- with source 'stripe' | 'paypal' and external_id, then call
-- billing_recalc_invoice(invoice_id).
set local lock_timeout = '5s';

-- ─── Logos: the dark-on-transparent versions print on white paper ─────────
update public.billing_brands set logo_url = '/brand/yachtpics-logo-dark.png', updated_at = now()
 where key = 'yachtpics' and (logo_url is null or logo_url = '/brand/yachtpics-logo-white.png');
update public.billing_brands set logo_url = '/brand/ypdesigns-logo-dark.png', updated_at = now()
 where key = 'ypdesigns' and logo_url is null;

-- ─── Per-login invoice settings ────────────────────────────────────────────
alter table public.billing_staff_brands add column if not exists invoice_prefix text;        -- null → brand prefix
alter table public.billing_staff_brands add column if not exists address text;               -- null → brand address
alter table public.billing_staff_brands add column if not exists payment_instructions text;  -- the PDF's "How to pay" box

alter table public.billing_staff add column if not exists default_terms_days integer not null default 15;
alter table public.billing_staff add column if not exists default_note text;

-- Samantha's numbers must never collide with Charlie's YP series.
update public.billing_staff_brands set invoice_prefix = 'YPS', updated_at = now()
 where profile_id = '6884eada-ba61-4076-8d00-6cc2cfd1879a' and brand = 'yachtpics' and invoice_prefix is null;
update public.billing_staff_brands
   set payment_instructions = 'Zelle: charlie@yachtpics.com · Venmo: @yachtpics · Checks payable to YachtPics Enterprises LLC',
       updated_at = now()
 where profile_id = 'e9afc949-ee75-4c30-9465-95a8abe9fac7' and payment_instructions is null;

-- ─── Invoice numbers: one counter per login per brand ──────────────────────
create table if not exists public.billing_invoice_counters (
  owner_id uuid not null,
  brand text not null references public.billing_brands(key),
  next_number integer not null default 1001 check (next_number > 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, brand)
);

-- ─── Invoices ──────────────────────────────────────────────────────────────
create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,                       -- = billing_staff.profile_id (no FK)
  brand text not null references public.billing_brands(key),
  number text unique,                           -- assigned at first send; drafts have none
  status text not null default 'draft' check (status in ('draft', 'sent', 'partial', 'paid', 'void')),
  client_id uuid references public.billing_clients(id) on delete restrict,
  listing_id uuid,                              -- listings.id (no FK)
  boat_name text,
  boat_length_ft numeric(8,2),
  issue_date date not null default current_date,
  due_date date,
  terms_days integer,
  subtotal numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  tax_rate numeric(6,4) not null default 0,
  tax_total numeric(12,2) not null default 0,
  card_fee_rate numeric(6,4) not null default 0,
  card_fee_total numeric(12,2) not null default 0,
  card_fee_waived numeric(12,2) not null default 0,  -- fee not collected because paid another way
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  balance_due numeric(12,2) not null default 0,
  note text,
  internal_note text,
  sent_to text,
  public_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  sent_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer not null default 0,
  paid_at timestamptz,
  voided_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists billing_invoices_owner_status_idx on public.billing_invoices (owner_id, status);
create index if not exists billing_invoices_owner_issue_idx on public.billing_invoices (owner_id, issue_date);
create index if not exists billing_invoices_client_idx on public.billing_invoices (client_id);
create index if not exists billing_invoices_listing_idx on public.billing_invoices (listing_id);

-- Lines are snapshots: editing the catalog never changes them.
create table if not exists public.billing_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.billing_invoices(id) on delete cascade,
  position integer not null default 0,
  item_id uuid,                                 -- informational (catalog item it came from)
  kind text not null default 'standard' check (kind in ('standard', 'card_fee', 'reimbursement', 'discount', 'deposit', 'custom')),
  name text not null,
  description text,
  quantity numeric(12,3) not null default 1,
  unit text not null default 'each' check (unit in ('each', 'ft')),
  unit_price numeric(12,4) not null default 0,
  discount_type text check (discount_type in ('amount', 'percent')),
  discount_value numeric(12,4),
  taxable boolean not null default false,
  line_subtotal numeric(12,2) not null default 0,
  line_discount numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists billing_invoice_lines_invoice_idx on public.billing_invoice_lines (invoice_id, position);

create table if not exists public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.billing_invoices(id) on delete cascade,
  owner_id uuid not null,
  method text not null check (method in ('check', 'zelle', 'venmo', 'cash', 'card', 'bank', 'paypal', 'other')),
  amount numeric(12,2) not null check (amount <> 0),
  paid_on date not null default current_date,
  reference text,
  note text,
  source text not null default 'manual' check (source in ('manual', 'stripe', 'paypal')),
  external_id text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists billing_payments_invoice_idx on public.billing_payments (invoice_id);
create index if not exists billing_payments_owner_paid_idx on public.billing_payments (owner_id, paid_on);
create unique index if not exists billing_payments_external_idx on public.billing_payments (source, external_id) where external_id is not null;

-- ─── Next invoice number (row lock = no two invoices share a number) ──────
create or replace function public.billing_next_invoice_number(p_owner uuid, p_brand text)
returns text language plpgsql security definer set search_path = public as $$
declare n integer; prefix text;
begin
  select coalesce(nullif(trim(sb.invoice_prefix), ''), b.invoice_prefix) into prefix
    from billing_brands b
    left join billing_staff_brands sb on sb.brand = b.key and sb.profile_id = p_owner
   where b.key = p_brand;
  if prefix is null then raise exception 'Unknown brand %', p_brand; end if;

  insert into billing_invoice_counters (owner_id, brand) values (p_owner, p_brand)
  on conflict (owner_id, brand) do nothing;

  loop
    update billing_invoice_counters
       set next_number = next_number + 1, updated_at = now()
     where owner_id = p_owner and brand = p_brand
    returning next_number - 1 into n;
    -- Skip a number already used (e.g. the counter was set back by hand).
    exit when not exists (select 1 from billing_invoices where number = prefix || '-' || lpad(n::text, 4, '0'));
  end loop;
  return prefix || '-' || lpad(n::text, 4, '0');
end $$;

-- ─── Totals: the one place invoice money is worked out ────────────────────
-- Line: subtotal = qty × unit price; discount = amount, or percent of the
-- subtotal; total = subtotal − discount. Discount-kind lines always subtract.
-- Invoice: subtotal (non-discount lines) − discounts + tax (taxable lines ×
-- rate) + card fee (rate × (subtotal − discounts + tax), recomputed while a
-- card_fee line is present). Paid when payments cover the total less the
-- card fee (paying by cash/check/Zelle/Venmo waives the fee → card_fee_waived).
create or replace function public.billing_recalc_invoice(inv uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r billing_invoices%rowtype;
  v_sub numeric := 0; v_disc numeric := 0; v_taxbase numeric := 0; v_tax numeric := 0;
  v_fee numeric := 0; v_total numeric := 0; v_paid numeric := 0; v_waived numeric := 0;
  v_status text;
begin
  select * into r from billing_invoices where id = inv for update;
  if not found then return; end if;

  update billing_invoice_lines l set
    line_subtotal = case when l.kind = 'discount' then -abs(round(l.quantity * l.unit_price, 2))
                         else round(l.quantity * l.unit_price, 2) end,
    line_discount = case
      when l.kind in ('discount', 'card_fee') or l.discount_type is null or coalesce(l.discount_value, 0) = 0 then 0
      when l.discount_type = 'percent' then round(round(l.quantity * l.unit_price, 2) * least(greatest(l.discount_value, 0), 100) / 100, 2)
      else round(least(abs(l.discount_value), abs(round(l.quantity * l.unit_price, 2))) * sign(round(l.quantity * l.unit_price, 2)), 2)
    end
  where l.invoice_id = inv and l.kind <> 'card_fee';
  update billing_invoice_lines set line_total = line_subtotal - line_discount
   where invoice_id = inv and kind <> 'card_fee';

  select coalesce(sum(case when kind <> 'discount' then line_subtotal else 0 end), 0),
         coalesce(sum(case when kind = 'discount' then -line_subtotal else line_discount end), 0),
         coalesce(sum(case when taxable then line_total else 0 end), 0)
    into v_sub, v_disc, v_taxbase
    from billing_invoice_lines where invoice_id = inv and kind <> 'card_fee';

  v_tax := round(greatest(v_taxbase, 0) * r.tax_rate, 2);

  if exists (select 1 from billing_invoice_lines where invoice_id = inv and kind = 'card_fee') then
    v_fee := round(greatest(v_sub - v_disc + v_tax, 0) * r.card_fee_rate, 2);
    update billing_invoice_lines set
      quantity = 1, unit = 'each', unit_price = v_fee, taxable = false, discount_type = null, discount_value = null,
      line_subtotal = v_fee, line_discount = 0, line_total = v_fee
     where invoice_id = inv and kind = 'card_fee';
  end if;

  v_total := v_sub - v_disc + v_tax + v_fee;
  select coalesce(sum(amount), 0) into v_paid from billing_payments where invoice_id = inv;

  v_status := r.status;
  if r.status in ('sent', 'partial', 'paid') then
    if v_paid > 0 and v_paid >= v_total - v_fee - 0.005 then
      v_status := 'paid';
      v_waived := least(greatest(v_total - v_paid, 0), v_fee);
    elsif v_paid > 0 then
      v_status := 'partial';
    else
      v_status := 'sent';
    end if;
  end if;

  update billing_invoices set
    subtotal = v_sub,
    discount_total = v_disc,
    tax_total = v_tax,
    card_fee_total = v_fee,
    card_fee_waived = v_waived,
    total = v_total,
    amount_paid = v_paid,
    balance_due = v_total - v_paid - v_waived,
    status = v_status,
    paid_at = case when v_status = 'paid' then coalesce(r.paid_at, now()) else null end,
    updated_at = now()
  where id = inv;
end $$;

-- Public invoice page: count a view (called by /inv/[token] with the service role).
create or replace function public.billing_record_invoice_view(p_token text)
returns void language sql security definer set search_path = public as $$
  update billing_invoices
     set view_count = view_count + 1,
         first_viewed_at = coalesce(first_viewed_at, now()),
         last_viewed_at = now()
   where public_token = p_token and status <> 'draft'
$$;

revoke all on function public.billing_next_invoice_number(uuid, text) from public, anon, authenticated;
revoke all on function public.billing_recalc_invoice(uuid) from public, anon, authenticated;
revoke all on function public.billing_record_invoice_view(text) from public, anon, authenticated;
grant execute on function public.billing_next_invoice_number(uuid, text) to service_role;
grant execute on function public.billing_recalc_invoice(uuid) to service_role;
grant execute on function public.billing_record_invoice_view(text) to service_role;

-- ─── RLS: each login reads its own book; no write policies ────────────────
alter table public.billing_invoice_counters enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.billing_invoice_lines enable row level security;
alter table public.billing_payments enable row level security;

drop policy if exists billing_invoice_counters_read on public.billing_invoice_counters;
create policy billing_invoice_counters_read on public.billing_invoice_counters for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.billing_is_staff()));

drop policy if exists billing_invoices_read on public.billing_invoices;
create policy billing_invoices_read on public.billing_invoices for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.billing_is_staff()));

drop policy if exists billing_invoice_lines_read on public.billing_invoice_lines;
create policy billing_invoice_lines_read on public.billing_invoice_lines for select to authenticated
  using (invoice_id in (select id from public.billing_invoices where owner_id = (select auth.uid())) and (select public.billing_is_staff()));

drop policy if exists billing_payments_read on public.billing_payments;
create policy billing_payments_read on public.billing_payments for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.billing_is_staff()));
