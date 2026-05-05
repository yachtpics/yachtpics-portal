-- Run this in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Videos table
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists videos (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references listings(id) on delete cascade,
  storage_path text not null,
  filename     text,
  display_order int not null default 0,
  uploaded_by  uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

-- RLS
alter table videos enable row level security;

-- Brokers can read their own listing's videos
create policy "Broker reads own listing videos"
  on videos for select
  using (
    exists (
      select 1 from listings
      where listings.id = videos.listing_id
        and listings.broker_id = auth.uid()
    )
  );

-- Brokers can insert videos on their own listings
create policy "Broker inserts own listing videos"
  on videos for insert
  with check (
    exists (
      select 1 from listings
      where listings.id = videos.listing_id
        and listings.broker_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. AFTER running this SQL, go to Storage in the Supabase dashboard and:
--    a. Create a new bucket called:  listing-videos
--    b. Set it to Private (not public)
--    c. In bucket settings, set the file size limit to 2048 MB (2 GB)
--       to accommodate edited MP4s
--    d. Under Policies for listing-videos, add:
--       - SELECT: authenticated users only
--       - INSERT: authenticated users only
-- ─────────────────────────────────────────────────────────────────────────────
