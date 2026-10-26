-- Oct 26, 2026 — Broker Websites (`broker_sites`, `site_leads`, `listings.sold_at`).
--
-- Every Portal subscriber gets a personal website at portal.yachtpics.com/b/{slug}
-- that fills itself from their listings (live boats whose slideshow is
-- published) and is edited from Dashboard → Website.
--
--   broker_sites  one row per broker: slug, published switch, headline, hero
--                 photo, proof-strip stats, testimonials, section switches.
--   site_leads    showing requests, contact-form inquiries and "what's my boat
--                 worth?" valuations sent from the site.
--   listings.sold_at  set by the broker ("Mark sold") to move a boat into the
--                 site's Recent sales. `status` is NOT touched — other code
--                 filters status = 'active'.
--
-- Public pages and the lead form read/write with the service role; these RLS
-- policies only govern direct reads/writes by signed-in users.
-- Additive only; safe to run more than once. NOT applied automatically.

-- ── listings.sold_at ────────────────────────────────────────────────────────
alter table public.listings add column if not exists sold_at timestamptz;

-- ── broker_sites ────────────────────────────────────────────────────────────
create table if not exists public.broker_sites (
  broker_id     uuid primary key references public.profiles(id) on delete cascade,
  slug          text not null unique
                  check (slug ~ '^[a-z0-9-]{3,60}$'),
  published     boolean not null default false,
  headline      text,
  specialty     text,
  hero_photo_id uuid references public.photos(id) on delete set null,
  portrait_path text,
  stats         jsonb not null default '[]'::jsonb,   -- [{value, label}] ≤ 4
  credentials   text,
  testimonials  jsonb not null default '[]'::jsonb,   -- [{quote, name, place}] ≤ 6
  show_prices   boolean not null default false,
  whatsapp      text,
  sections      jsonb not null default '{"sold":true,"about":true,"testimonials":true,"sell":true}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Shape guards (added separately so a re-run on an existing table is a no-op).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'broker_sites_stats_max4') then
    alter table public.broker_sites add constraint broker_sites_stats_max4
      check (jsonb_typeof(stats) = 'array' and jsonb_array_length(stats) <= 4);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'broker_sites_testimonials_max6') then
    alter table public.broker_sites add constraint broker_sites_testimonials_max6
      check (jsonb_typeof(testimonials) = 'array' and jsonb_array_length(testimonials) <= 6);
  end if;
end $$;

alter table public.broker_sites enable row level security;

drop policy if exists "broker_sites admin all" on public.broker_sites;
create policy "broker_sites admin all" on public.broker_sites
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- The broker, and their assistants (assistant_has_access also covers
-- brokerage admins of the broker's brokerage), read and edit their own row.
drop policy if exists "broker_sites own select" on public.broker_sites;
create policy "broker_sites own select" on public.broker_sites
  for select to authenticated
  using (broker_id = (select auth.uid()) or public.assistant_has_access(broker_id));

drop policy if exists "broker_sites own insert" on public.broker_sites;
create policy "broker_sites own insert" on public.broker_sites
  for insert to authenticated
  with check (broker_id = (select auth.uid()) or public.assistant_has_access(broker_id));

drop policy if exists "broker_sites own update" on public.broker_sites;
create policy "broker_sites own update" on public.broker_sites
  for update to authenticated
  using (broker_id = (select auth.uid()) or public.assistant_has_access(broker_id))
  with check (broker_id = (select auth.uid()) or public.assistant_has_access(broker_id));

-- ── site_leads ──────────────────────────────────────────────────────────────
create table if not exists public.site_leads (
  id            uuid primary key default gen_random_uuid(),
  broker_id     uuid not null references public.profiles(id) on delete cascade,
  listing_id    uuid references public.listings(id) on delete set null,
  kind          text not null check (kind in ('showing', 'contact', 'valuation')),
  name          text,
  email         text,
  phone         text,
  contact_pref  text,
  inquiry_type  text,
  message       text,
  boat          jsonb,          -- valuation: {builder, model, year, length}
  source        text,           -- e.g. 'site'
  ip_hash       text,           -- sha256(ip + secret), never the raw address
  created_at    timestamptz not null default now(),
  handled_at    timestamptz
);

create index if not exists site_leads_broker_created_idx on public.site_leads (broker_id, created_at desc);

alter table public.site_leads enable row level security;

drop policy if exists "site_leads admin all" on public.site_leads;
create policy "site_leads admin all" on public.site_leads
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "site_leads own select" on public.site_leads;
create policy "site_leads own select" on public.site_leads
  for select to authenticated
  using (broker_id = (select auth.uid()) or public.assistant_has_access(broker_id));

-- Brokers/assistants may only mark a lead handled; the app does that through
-- /api/website/leads with the service role after the same check. Column-level
-- protection: this policy allows the row update, and the grant below limits
-- authenticated users to the handled_at column.
drop policy if exists "site_leads own update" on public.site_leads;
create policy "site_leads own update" on public.site_leads
  for update to authenticated
  using (broker_id = (select auth.uid()) or public.assistant_has_access(broker_id))
  with check (broker_id = (select auth.uid()) or public.assistant_has_access(broker_id));

revoke update on public.site_leads from authenticated;
grant update (handled_at) on public.site_leads to authenticated;

-- No insert policy for authenticated/anon: leads are inserted only by the
-- service role (POST /api/b/[slug]/lead).
