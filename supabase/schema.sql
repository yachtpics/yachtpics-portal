-- ============================================================
-- YachtPics Portal — Full Database Schema (idempotent)
-- Safe to run multiple times
-- ============================================================

-- ── 1. PROFILES ─────────────────────────────────────────────
create table if not exists profiles (
  id            uuid references auth.users on delete cascade primary key,
  role          text not null default 'broker' check (role in ('admin', 'broker', 'assistant')),
  first_name    text,
  last_name     text,
  display_email text,
  phone         text,
  avatar_url    text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ── 2. BROKER DETAILS ───────────────────────────────────────
create table if not exists broker_details (
  id                  uuid references profiles(id) on delete cascade primary key,
  brokerage_name      text,
  brokerage_address   text,
  brokerage_city      text,
  brokerage_state     text,
  brokerage_zip       text,
  brokerage_website   text,
  brokerage_logo_url  text,
  license_number      text,
  bio                 text,
  updated_at          timestamptz default now()
);

-- ── 3. BROKER ↔ ASSISTANT LINKS ─────────────────────────────
create table if not exists broker_assistants (
  id            uuid default gen_random_uuid() primary key,
  broker_id     uuid references profiles(id) on delete cascade,
  assistant_id  uuid references profiles(id) on delete cascade,
  created_at    timestamptz default now(),
  unique(broker_id, assistant_id)
);

-- ── 4. LISTINGS ─────────────────────────────────────────────
create table if not exists listings (
  id              uuid default gen_random_uuid() primary key,
  broker_id       uuid references profiles(id) on delete cascade,
  vessel_name     text,
  vessel_type     text,
  year            int,
  length_ft       numeric,
  make            text,
  model           text,
  asking_price    numeric,
  location        text,
  description     text,
  listing_pdf_url text,
  status          text default 'active' check (status in ('active', 'archived', 'sold')),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── 5. PHOTOS ───────────────────────────────────────────────
create table if not exists photos (
  id            uuid default gen_random_uuid() primary key,
  listing_id    uuid references listings(id) on delete cascade,
  storage_path  text not null,
  filename      text,
  category      text,
  display_order int default 0,
  is_visible    boolean default true,
  uploaded_by   uuid references profiles(id),
  created_at    timestamptz default now()
);

-- ── 6. SHOOTS / INVOICES ────────────────────────────────────
create table if not exists shoots (
  id              uuid default gen_random_uuid() primary key,
  broker_id       uuid references profiles(id),
  listing_id      uuid references listings(id),
  shoot_date      date,
  location        text,
  amount_cents    int,
  payment_method  text check (payment_method in ('stripe', 'zelle', 'venmo', 'check', 'pending')),
  payment_status  text default 'pending' check (payment_status in ('pending', 'paid', 'cancelled')),
  invoice_number  text unique,
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── 7. SUBSCRIPTIONS ────────────────────────────────────────
create table if not exists subscriptions (
  id                      uuid default gen_random_uuid() primary key,
  broker_id               uuid references profiles(id) on delete cascade unique,
  plan                    text default 'free' check (plan in ('free', 'pro', 'enterprise')),
  status                  text default 'trialing' check (status in ('trialing', 'active', 'cancelled', 'past_due')),
  trial_ends_at           timestamptz default (now() + interval '30 days'),
  current_period_end      timestamptz,
  stripe_customer_id      text,
  stripe_subscription_id  text,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

-- ============================================================
-- TRIGGER: auto-create profile rows on signup
-- ============================================================
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, role, display_email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'broker'),
    new.email
  )
  on conflict (id) do nothing;

  if coalesce(new.raw_user_meta_data->>'role', 'broker') = 'broker' then
    insert into broker_details (id) values (new.id) on conflict do nothing;
    insert into subscriptions (broker_id) values (new.id) on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY — enable on all tables
-- ============================================================
alter table profiles          enable row level security;
alter table broker_details    enable row level security;
alter table broker_assistants enable row level security;
alter table listings          enable row level security;
alter table photos            enable row level security;
alter table shoots            enable row level security;
alter table subscriptions     enable row level security;

-- ── Helper functions ─────────────────────────────────────────
create or replace function is_admin()
returns boolean language sql security definer as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function assistant_has_access(broker uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from broker_assistants
    where assistant_id = auth.uid() and broker_id = broker
  );
$$;

-- ── profiles policies ────────────────────────────────────────
drop policy if exists "Users read own profile" on profiles;
create policy "Users read own profile"
  on profiles for select using (id = auth.uid() or is_admin());

drop policy if exists "Users update own profile" on profiles;
create policy "Users update own profile"
  on profiles for update using (id = auth.uid());

drop policy if exists "Admins insert profiles" on profiles;
create policy "Admins insert profiles"
  on profiles for insert with check (is_admin());

drop policy if exists "Assistants read linked brokers" on profiles;
create policy "Assistants read linked brokers"
  on profiles for select using (
    exists (
      select 1 from broker_assistants
      where assistant_id = auth.uid() and broker_id = profiles.id
    )
  );

drop policy if exists "Brokers read linked assistants" on profiles;
create policy "Brokers read linked assistants"
  on profiles for select using (
    exists (
      select 1 from broker_assistants
      where broker_id = auth.uid() and assistant_id = profiles.id
    )
  );

-- ── broker_details policies ──────────────────────────────────
drop policy if exists "Brokers read/update own details" on broker_details;
create policy "Brokers read/update own details"
  on broker_details for all using (id = auth.uid() or is_admin());

drop policy if exists "Assistants read broker details" on broker_details;
create policy "Assistants read broker details"
  on broker_details for select using (assistant_has_access(id));

-- ── broker_assistants policies ───────────────────────────────
drop policy if exists "Brokers manage their assistants" on broker_assistants;
create policy "Brokers manage their assistants"
  on broker_assistants for all using (broker_id = auth.uid() or is_admin());

drop policy if exists "Assistants view their links" on broker_assistants;
create policy "Assistants view their links"
  on broker_assistants for select using (assistant_id = auth.uid());

-- ── listings policies ────────────────────────────────────────
drop policy if exists "Brokers manage own listings" on listings;
create policy "Brokers manage own listings"
  on listings for all using (broker_id = auth.uid() or is_admin());

drop policy if exists "Assistants manage linked broker listings" on listings;
create policy "Assistants manage linked broker listings"
  on listings for all using (assistant_has_access(broker_id));

-- ── photos policies ──────────────────────────────────────────
drop policy if exists "Brokers view own listing photos" on photos;
create policy "Brokers view own listing photos"
  on photos for select using (
    exists (select 1 from listings where listings.id = photos.listing_id and listings.broker_id = auth.uid())
    or is_admin()
  );

drop policy if exists "Admins manage all photos" on photos;
create policy "Admins manage all photos"
  on photos for all using (is_admin());

drop policy if exists "Brokers update photo visibility/order" on photos;
create policy "Brokers update photo visibility/order"
  on photos for update using (
    exists (select 1 from listings where listings.id = photos.listing_id and listings.broker_id = auth.uid())
  );

drop policy if exists "Assistants view/update linked broker photos" on photos;
create policy "Assistants view/update linked broker photos"
  on photos for select using (
    exists (
      select 1 from listings
      where listings.id = photos.listing_id
      and assistant_has_access(listings.broker_id)
    )
  );

-- ── shoots policies ──────────────────────────────────────────
drop policy if exists "Admins manage all shoots" on shoots;
create policy "Admins manage all shoots"
  on shoots for all using (is_admin());

drop policy if exists "Brokers view own shoots" on shoots;
create policy "Brokers view own shoots"
  on shoots for select using (broker_id = auth.uid());

-- ── subscriptions policies ───────────────────────────────────
drop policy if exists "Admins manage subscriptions" on subscriptions;
create policy "Admins manage subscriptions"
  on subscriptions for all using (is_admin());

drop policy if exists "Brokers view own subscription" on subscriptions;
create policy "Brokers view own subscription"
  on subscriptions for select using (broker_id = auth.uid());

-- ============================================================
-- Storage bucket for photos
-- ============================================================
insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', false)
on conflict do nothing;

drop policy if exists "Admins upload photos" on storage.objects;
create policy "Admins upload photos"
  on storage.objects for insert
  with check (bucket_id = 'listing-photos' and is_admin());

drop policy if exists "Brokers download own photos" on storage.objects;
create policy "Brokers download own photos"
  on storage.objects for select
  using (bucket_id = 'listing-photos' and auth.role() = 'authenticated');
