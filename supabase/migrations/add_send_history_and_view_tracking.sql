-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Send history + slideshow view tracking
-- Run this in your Supabase dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. client_sends — one row per portal email sent to a client
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.client_sends (
  id               uuid primary key default gen_random_uuid(),
  listing_id       uuid not null references public.listings(id) on delete cascade,
  broker_id        uuid not null references auth.users(id) on delete cascade,
  client_email     text not null,
  message          text,
  included_slideshow boolean not null default false,
  document_count   int not null default 0,
  sent_at          timestamptz not null default now()
);

-- Index for fast per-listing lookups (the most common query)
create index if not exists client_sends_listing_id_idx
  on public.client_sends(listing_id, sent_at desc);

-- RLS: brokers can only see sends they made
alter table public.client_sends enable row level security;

create policy "Brokers can view own sends"
  on public.client_sends for select
  using (broker_id = auth.uid());

create policy "Brokers can insert own sends"
  on public.client_sends for insert
  with check (broker_id = auth.uid());


-- 2. slideshow_views — one row per unique session view of a public slideshow
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.slideshow_views (
  id               uuid primary key default gen_random_uuid(),
  listing_id       uuid not null references public.listings(id) on delete cascade,
  slideshow_slug   text not null,
  viewed_at        timestamptz not null default now()
);

-- Index for fast per-listing count queries
create index if not exists slideshow_views_listing_id_idx
  on public.slideshow_views(listing_id);

-- RLS: public insert (anonymous viewers), brokers can read their own
alter table public.slideshow_views enable row level security;

-- Allow the API route (service role) to insert — no anon insert needed since
-- we use SUPABASE_SERVICE_ROLE_KEY in the /api/slideshow/view route.
-- Brokers can read view counts for their own listings.
create policy "Brokers can view slideshow views for own listings"
  on public.slideshow_views for select
  using (
    listing_id in (
      select id from public.listings where broker_id = auth.uid()
    )
  );
