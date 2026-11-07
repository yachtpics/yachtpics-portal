-- Nov 8, 2026 — Billing: contact persons per client (like Zoho's "contact persons").
-- Run after 20261108b_billing_online_payment.sql.
--
-- Why: at some brokerages the broker is named on the invoice but someone else
-- pays it (Worth Avenue Yachts: broker on the invoice, billing contact gets
-- it; Valhalla: broker on the invoice, two other people get it). The Send
-- dialog now picks recipients from these contacts.
--
-- Additive and re-runnable. RLS grants reads to billing staff only; every
-- write goes through /api/admin/books/* with the service role.
--
--  1. billing_client_contacts — people at a client. One primary per client
--     (it mirrors billing_clients.email / phone / mobile). send_by_default =
--     "Gets invoices" (pre-ticked in the Send dialog).
--  2. Backfill: every client with an email gets ONE primary contact (only
--     when it has no contacts yet — safe to re-run).
--  3. Triggers keep the primary contact in step with the client row: a new
--     client with an email gets its primary contact; a change to the
--     client's email / phone / mobile (Portal edit or Zoho re-pull) is copied
--     onto the primary contact.
--  4. billing_set_primary_contact(contact) — makes one contact primary and
--     copies its email / phone / mobile onto the client, atomically.
--  5. billing_invoices.sent_to_all — every recipient of the last send.
--     sent_to stays = the first recipient (older code reads it).
set local lock_timeout = '5s';

-- ─── 1. Contacts ──────────────────────────────────────────────────────────
create table if not exists public.billing_client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.billing_clients(id) on delete cascade,
  first_name text,
  last_name text,
  email text,
  phone text,
  mobile text,
  role text,                                     -- free label: "Accounts payable", "Assistant"
  is_primary boolean not null default false,
  send_by_default boolean not null default false, -- "Gets invoices"
  zoho_contact_person_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists billing_client_contacts_client_idx on public.billing_client_contacts (client_id);
create index if not exists billing_client_contacts_email_idx on public.billing_client_contacts (lower(email));
-- At most one primary per client.
create unique index if not exists billing_client_contacts_one_primary
  on public.billing_client_contacts (client_id) where is_primary;

-- ─── 2. Backfill one primary contact per client with an email ─────────────
insert into public.billing_client_contacts (client_id, first_name, last_name, email, phone, mobile, is_primary, send_by_default)
select c.id, c.first_name, c.last_name, lower(trim(c.email)), c.phone, c.mobile, true, true
  from public.billing_clients c
 where c.email is not null and trim(c.email) <> ''
   and not exists (select 1 from public.billing_client_contacts x where x.client_id = c.id);

-- ─── 3. Keep the primary contact in step with the client row ──────────────
create or replace function public.billing_clients_sync_primary_contact()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.email is not null and trim(new.email) <> ''
       and not exists (select 1 from billing_client_contacts x where x.client_id = new.id) then
      insert into billing_client_contacts (client_id, first_name, last_name, email, phone, mobile, is_primary, send_by_default)
      values (new.id, new.first_name, new.last_name, lower(trim(new.email)), new.phone, new.mobile, true, true);
    end if;
    return new;
  end if;

  if (new.email, new.phone, new.mobile) is distinct from (old.email, old.phone, old.mobile) then
    update billing_client_contacts x
       set email = new.email, phone = new.phone, mobile = new.mobile, updated_at = now()
     where x.client_id = new.id and x.is_primary
       and (x.email, x.phone, x.mobile) is distinct from (new.email, new.phone, new.mobile);
    if new.email is not null and trim(new.email) <> ''
       and not exists (select 1 from billing_client_contacts x where x.client_id = new.id) then
      insert into billing_client_contacts (client_id, first_name, last_name, email, phone, mobile, is_primary, send_by_default)
      values (new.id, new.first_name, new.last_name, lower(trim(new.email)), new.phone, new.mobile, true, true);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists billing_clients_primary_contact_ins on public.billing_clients;
create trigger billing_clients_primary_contact_ins
  after insert on public.billing_clients
  for each row execute function public.billing_clients_sync_primary_contact();

drop trigger if exists billing_clients_primary_contact_upd on public.billing_clients;
create trigger billing_clients_primary_contact_upd
  after update of email, phone, mobile on public.billing_clients
  for each row execute function public.billing_clients_sync_primary_contact();

revoke all on function public.billing_clients_sync_primary_contact() from public, anon, authenticated;

-- ─── 4. Make a contact primary (and mirror it onto the client) ────────────
create or replace function public.billing_set_primary_contact(p_contact uuid, actor uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare k billing_client_contacts%rowtype;
begin
  select * into k from billing_client_contacts where id = p_contact for update;
  if not found then return false; end if;
  update billing_client_contacts set is_primary = false, updated_at = now()
   where client_id = k.client_id and is_primary and id <> k.id;
  update billing_client_contacts set is_primary = true, updated_at = now() where id = k.id;
  update billing_clients
     set email = k.email, phone = k.phone, mobile = k.mobile,
         updated_at = now(), updated_by = coalesce(actor, updated_by), local_edited_at = now()
   where id = k.client_id;
  return true;
end $$;

revoke all on function public.billing_set_primary_contact(uuid, uuid) from public, anon, authenticated;
grant execute on function public.billing_set_primary_contact(uuid, uuid) to service_role;

-- ─── 5. Every recipient of the last send ──────────────────────────────────
alter table public.billing_invoices add column if not exists sent_to_all text[];

-- ─── RLS: reads only; no write policies ───────────────────────────────────
alter table public.billing_client_contacts enable row level security;

drop policy if exists billing_client_contacts_read on public.billing_client_contacts;
create policy billing_client_contacts_read on public.billing_client_contacts for select to authenticated
  using ((select public.billing_is_staff()));
