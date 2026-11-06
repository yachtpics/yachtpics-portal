-- Nov 6, 2026 — Billing (Portal) phase 1: brands, staff books, shared client
-- list, item catalog, tax rate, Zoho import functions. NOT APPLIED.
--
-- Replaces Zoho Invoice for YachtPics and YPDesigns (both YachtPics
-- Enterprises LLC). Phase 1 has no invoices/payments; the tables below are
-- shaped so Phase 2 can add billing_invoices / billing_invoice_lines /
-- billing_payments with `owner_id uuid` (= billing_staff.profile_id) and RLS
-- `owner_id = (select auth.uid())`, using the helper functions here.
--
-- Rules: additive and re-runnable. No foreign key to profiles or listings
-- (it breaks PostgREST embeds) — profile ids are plain uuid columns with
-- indexes. All writes go through /api/admin/books/* with the service role;
-- RLS here only grants READS to billing staff, never writes.
set local lock_timeout = '5s';

-- ─── Brands ────────────────────────────────────────────────────────────────
create table if not exists public.billing_brands (
  key text primary key check (key in ('yachtpics', 'ypdesigns')),
  display_name text not null,
  legal_name text not null default 'YachtPics Enterprises LLC',
  logo_url text,
  accent_color text,
  address text,
  phone text,
  email text,
  website text,
  invoice_prefix text not null,
  footer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Staff (who keeps a book) ──────────────────────────────────────────────
-- `admin` is one shared role; this says which admins bill, which brands they
-- bill under, and their card-fee rate. Books are fully separate per login.
create table if not exists public.billing_staff (
  profile_id uuid primary key,                -- = profiles.id (no FK, see top)
  display_name text not null,
  is_owner boolean not null default false,
  card_fee_rate numeric(6,4) not null default 0.035 check (card_fee_rate >= 0 and card_fee_rate < 0.2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_staff_brands (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.billing_staff(profile_id) on delete cascade,
  brand text not null references public.billing_brands(key) on delete cascade,
  from_name text,
  reply_to_email text,
  phone text,                                   -- overrides the brand phone on this login's invoices
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, brand)
);
create index if not exists billing_staff_brands_brand_idx on public.billing_staff_brands (brand);

-- ─── Shared client list ────────────────────────────────────────────────────
create table if not exists public.billing_clients (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  company_name text,
  first_name text,
  last_name text,
  email text,
  phone text,
  mobile text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  broker_profile_id uuid,                       -- Portal profile matched by email (no FK)
  zoho_contact_id text unique,
  zoho_merged_ids text[] not null default '{}', -- other Zoho ids folded into this one
  zoho_open_balance numeric(12,2),              -- informational: these finish in Zoho
  zoho_created_on date,
  zoho_synced_at timestamptz,
  local_edited_at timestamptz,                  -- set by the Portal on edit; a re-pull then keeps local fields
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index if not exists billing_clients_broker_idx on public.billing_clients (broker_profile_id);
create index if not exists billing_clients_email_idx on public.billing_clients (lower(email));
create index if not exists billing_clients_name_idx on public.billing_clients (lower(display_name));

-- "Keep both" on the Possible duplicates panel. client_a < client_b.
create table if not exists public.billing_client_dupe_dismissals (
  client_a uuid not null references public.billing_clients(id) on delete cascade,
  client_b uuid not null references public.billing_clients(id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (client_a, client_b),
  check (client_a < client_b)
);
create index if not exists billing_client_dupe_dismissals_b_idx on public.billing_client_dupe_dismissals (client_b);

-- ─── Tax ───────────────────────────────────────────────────────────────────
create table if not exists public.billing_tax_rates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  rate numeric(6,4) not null check (rate >= 0 and rate < 1),
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Item catalog ──────────────────────────────────────────────────────────
-- Catalog edits never touch past invoices: Phase 2 copies name, description,
-- rate, unit, kind and tax onto each invoice line when it's added.
create table if not exists public.billing_items (
  id uuid primary key default gen_random_uuid(),
  brand text not null check (brand in ('yachtpics', 'ypdesigns', 'both')),
  name text not null,
  description text,
  rate numeric(12,4) not null default 0,        -- may be negative (deposits, discounts)
  unit text not null default 'each' check (unit in ('each', 'ft')),
  kind text not null default 'standard' check (kind in ('standard', 'card_fee', 'reimbursement', 'discount', 'deposit')),
  taxable boolean not null default false,
  tax_exempt_reason text check (tax_exempt_reason in ('Digital Download', 'Tax Exempt')),
  brand_confirmed boolean not null default false,
  active boolean not null default true,         -- retire instead of delete
  sort_order integer not null default 0,
  zoho_item_id text unique,
  zoho_synced_at timestamptz,
  local_edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index if not exists billing_items_brand_idx on public.billing_items (brand, active);
comment on column public.billing_items.rate is
  'For kind=card_fee the rate is NOT used: the fee comes from billing_staff.card_fee_rate of the login raising the invoice.';

-- ─── Helper functions (RLS now; owner_id policies in Phase 2) ──────────────
create or replace function public.billing_is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from billing_staff where profile_id = auth.uid() and active)
$$;

create or replace function public.billing_is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from billing_staff where profile_id = auth.uid() and active and is_owner)
$$;

create or replace function public.billing_staff_brands_for(uid uuid)
returns setof text language sql stable security definer set search_path = public as $$
  select sb.brand from billing_staff_brands sb
  join billing_staff s on s.profile_id = sb.profile_id
  where sb.profile_id = uid and s.active
$$;

create or replace function public.billing_my_brands()
returns setof text language sql stable security definer set search_path = public as $$
  select billing_staff_brands_for(auth.uid())
$$;

revoke all on function public.billing_is_staff() from public, anon;
revoke all on function public.billing_is_owner() from public, anon;
revoke all on function public.billing_staff_brands_for(uuid) from public, anon;
revoke all on function public.billing_my_brands() from public, anon;
grant execute on function public.billing_is_staff() to authenticated, service_role;
grant execute on function public.billing_is_owner() to authenticated, service_role;
grant execute on function public.billing_staff_brands_for(uuid) to authenticated, service_role;
grant execute on function public.billing_my_brands() to authenticated, service_role;

-- ─── RLS: reads for billing staff only; no write policies (service role) ───
alter table public.billing_brands enable row level security;
alter table public.billing_staff enable row level security;
alter table public.billing_staff_brands enable row level security;
alter table public.billing_clients enable row level security;
alter table public.billing_client_dupe_dismissals enable row level security;
alter table public.billing_tax_rates enable row level security;
alter table public.billing_items enable row level security;

drop policy if exists billing_brands_read on public.billing_brands;
create policy billing_brands_read on public.billing_brands for select to authenticated
  using (key in (select public.billing_my_brands()));

drop policy if exists billing_staff_read on public.billing_staff;
create policy billing_staff_read on public.billing_staff for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.billing_is_owner()));

drop policy if exists billing_staff_brands_read on public.billing_staff_brands;
create policy billing_staff_brands_read on public.billing_staff_brands for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.billing_is_owner()));

drop policy if exists billing_clients_read on public.billing_clients;
create policy billing_clients_read on public.billing_clients for select to authenticated
  using ((select public.billing_is_staff()));

drop policy if exists billing_client_dupe_dismissals_read on public.billing_client_dupe_dismissals;
create policy billing_client_dupe_dismissals_read on public.billing_client_dupe_dismissals for select to authenticated
  using ((select public.billing_is_staff()));

drop policy if exists billing_tax_rates_read on public.billing_tax_rates;
create policy billing_tax_rates_read on public.billing_tax_rates for select to authenticated
  using ((select public.billing_is_staff()));

drop policy if exists billing_items_read on public.billing_items;
create policy billing_items_read on public.billing_items for select to authenticated
  using ((select public.billing_is_staff()) and (brand = 'both' or brand in (select public.billing_my_brands())));

-- ─── Broker link: match a client's email to a Portal login ─────────────────
create or replace function public.billing_relink_brokers(only_client uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update billing_clients c
     set broker_profile_id = m.pid
    from (
      select c2.id,
             (select p.id from auth.users u join profiles p on p.id = u.id
               where c2.email is not null and lower(u.email) = lower(trim(c2.email)) and p.role <> 'admin'
               order by p.created_at limit 1) as pid
        from billing_clients c2
       where only_client is null or c2.id = only_client
    ) m
   where m.id = c.id and c.broker_profile_id is distinct from m.pid;
  get diagnostics n = row_count;
  return n;
end $$;

-- ─── Zoho import (used by seed.sql AND the Settings "Re-pull" upload) ──────
-- Re-run rule: a row that came from Zoho is refreshed from Zoho only while it
-- has never been edited in the Portal (local_edited_at is null). An item's
-- brand is never changed by a re-pull once brand_confirmed. A client's Zoho
-- open balance always refreshes. Zoho ids merged into another client (exact
-- duplicates, or merged on the Clients page) are skipped, so a re-pull never
-- brings a merged record back.
create or replace function public.billing_import_items(payload jsonb, actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  with src as (
    select x.*, t.ord
      from jsonb_array_elements(payload) with ordinality as t(j, ord),
           jsonb_to_record(t.j) as x(zoho_item_id text, name text, description text, rate numeric,
                                     unit text, kind text, taxable boolean, tax_exempt_reason text, brand text)
     where x.zoho_item_id is not null and coalesce(x.name, '') <> ''
  ), up as (
    insert into billing_items as bi
      (zoho_item_id, name, description, rate, unit, kind, taxable, tax_exempt_reason, brand,
       brand_confirmed, active, sort_order, created_by, updated_by, zoho_synced_at)
    select zoho_item_id, name, nullif(description, ''), coalesce(rate, 0), coalesce(unit, 'each'),
           coalesce(kind, 'standard'), coalesce(taxable, false), tax_exempt_reason, brand,
           false, true, (ord * 10)::int, actor, actor, now()
      from src
    on conflict (zoho_item_id) do update set
      name = excluded.name,
      description = excluded.description,
      rate = excluded.rate,
      unit = excluded.unit,
      kind = excluded.kind,
      taxable = excluded.taxable,
      tax_exempt_reason = excluded.tax_exempt_reason,
      brand = case when bi.brand_confirmed then bi.brand else excluded.brand end,
      zoho_synced_at = now(),
      updated_at = now()
    where bi.local_edited_at is null
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'received', (select count(*) from src),
    'inserted', (select count(*) from up where inserted),
    'updated', (select count(*) from up where not inserted),
    'kept_local', (select count(*) from src) - (select count(*) from up)
  ) into result;
  return result;
end $$;

create or replace function public.billing_import_clients(payload jsonb, actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; linked integer;
begin
  with src as (
    select x.*
      from jsonb_to_recordset(payload) as x(zoho_contact_id text, display_name text, company_name text,
             first_name text, last_name text, email text, phone text, mobile text, status text,
             zoho_open_balance numeric, zoho_created_on date, zoho_merged_ids text[])
     where x.zoho_contact_id is not null and coalesce(x.display_name, '') <> ''
  ), fresh as (
    select s.* from src s
     where not exists (select 1 from billing_clients c where s.zoho_contact_id = any (c.zoho_merged_ids))
  ), up as (
    insert into billing_clients as c
      (zoho_contact_id, display_name, company_name, first_name, last_name, email, phone, mobile, status,
       zoho_open_balance, zoho_created_on, zoho_merged_ids, created_by, updated_by, zoho_synced_at)
    select zoho_contact_id, display_name, nullif(company_name, ''), nullif(first_name, ''), nullif(last_name, ''),
           nullif(lower(trim(email)), ''), nullif(phone, ''), nullif(mobile, ''),
           case when status = 'inactive' then 'inactive' else 'active' end,
           zoho_open_balance, zoho_created_on, coalesce(zoho_merged_ids, '{}'), actor, actor, now()
      from fresh
    on conflict (zoho_contact_id) do update set
      display_name = case when c.local_edited_at is null then excluded.display_name else c.display_name end,
      company_name = case when c.local_edited_at is null then excluded.company_name else c.company_name end,
      first_name   = case when c.local_edited_at is null then excluded.first_name   else c.first_name end,
      last_name    = case when c.local_edited_at is null then excluded.last_name    else c.last_name end,
      email        = case when c.local_edited_at is null then excluded.email        else c.email end,
      phone        = case when c.local_edited_at is null then excluded.phone        else c.phone end,
      mobile       = case when c.local_edited_at is null then excluded.mobile       else c.mobile end,
      status       = case when c.local_edited_at is null then excluded.status       else c.status end,
      zoho_open_balance = excluded.zoho_open_balance,
      zoho_created_on = coalesce(c.zoho_created_on, excluded.zoho_created_on),
      zoho_merged_ids = array(select distinct unnest(c.zoho_merged_ids || excluded.zoho_merged_ids)),
      zoho_synced_at = now(),
      updated_at = now()
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'received', (select count(*) from src),
    'skipped_merged', (select count(*) from src) - (select count(*) from fresh),
    'inserted', (select count(*) from up where inserted),
    'updated', (select count(*) from up where not inserted)
  ) into result;

  linked := billing_relink_brokers(null);
  return result || jsonb_build_object('broker_links_changed', linked);
end $$;

revoke all on function public.billing_relink_brokers(uuid) from public, anon, authenticated;
revoke all on function public.billing_import_items(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.billing_import_clients(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.billing_relink_brokers(uuid) to service_role;
grant execute on function public.billing_import_items(jsonb, uuid) to service_role;
grant execute on function public.billing_import_clients(jsonb, uuid) to service_role;

-- ─── Seed: brands, staff, tax rate (do nothing if already there, so Settings
--     edits survive a re-run) ───────────────────────────────────────────────
insert into public.billing_brands (key, display_name, legal_name, logo_url, accent_color, address, phone, email, website, invoice_prefix, footer_note)
values
  ('yachtpics', 'YachtPics', 'YachtPics Enterprises LLC', '/brand/yachtpics-logo-white.png', '#c39e4e',
   '309 Lake Circle, Apt 102, North Palm Beach, FL 33408', '561-602-9710', 'charlie@yachtpics.com', 'yachtpics.com', 'YP', 'Thank you for your business.'),
  ('ypdesigns', 'YPDesigns', 'YachtPics Enterprises LLC', null, null,
   '309 Lake Circle, Apt 102, North Palm Beach, FL 33408', '561-602-9710', 'charlie@ypdesigns.co', 'ypdesigns.co', 'YPD', 'Thank you for your business.')
on conflict (key) do nothing;

insert into public.billing_staff (profile_id, display_name, is_owner, card_fee_rate)
values
  ('e9afc949-ee75-4c30-9465-95a8abe9fac7', 'Charlie Clark', true, 0.03),
  ('6884eada-ba61-4076-8d00-6cc2cfd1879a', 'Samantha', false, 0.035)
on conflict (profile_id) do nothing;

insert into public.billing_staff_brands (profile_id, brand, from_name, reply_to_email, phone)
values
  ('e9afc949-ee75-4c30-9465-95a8abe9fac7', 'yachtpics', 'Charlie Clark · YachtPics', 'charlie@yachtpics.com', '561-602-9710'),
  ('e9afc949-ee75-4c30-9465-95a8abe9fac7', 'ypdesigns', 'Charlie Clark · YPDesigns', 'charlie@ypdesigns.co', '561-602-9710'),
  ('6884eada-ba61-4076-8d00-6cc2cfd1879a', 'yachtpics', 'Samantha · YachtPics', 'samantha@yachtpics.com', '561-252-1488')
on conflict (profile_id, brand) do nothing;

insert into public.billing_tax_rates (name, rate, is_default)
values ('Sales tax — Palm Beach County', 0.065, true)
on conflict (name) do nothing;
