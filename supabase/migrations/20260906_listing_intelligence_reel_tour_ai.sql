-- Sept 6, 2026 — APPLIED to the live project via the Supabase MCP on this date.
-- Kept here for the record. Additive only: tracked sends, per-photo engagement
-- events, tour link / deck plan on listings, and category provenance on photos.

alter table public.client_sends
  add column if not exists token text unique default encode(extensions.gen_random_bytes(8), 'hex'),
  add column if not exists client_name text,
  add column if not exists open_count int not null default 0,
  add column if not exists last_opened_at timestamptz;
update public.client_sends set token = encode(extensions.gen_random_bytes(8), 'hex') where token is null;
create index if not exists client_sends_token_idx on public.client_sends(token);

alter table public.slideshow_views
  add column if not exists send_id uuid references public.client_sends(id) on delete set null,
  add column if not exists session_id text,
  add column if not exists duration_s int,
  add column if not exists photos_seen int;
create index if not exists slideshow_views_session_idx on public.slideshow_views(listing_id, session_id);

create table if not exists public.slideshow_events (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings(id) on delete cascade,
  slug        text,
  session_id  text,
  send_id     uuid references public.client_sends(id) on delete set null,
  photo_id    uuid references public.photos(id) on delete cascade,
  video_id    uuid references public.videos(id) on delete cascade,
  kind        text not null check (kind in ('dwell', 'favorite', 'unfavorite', 'video_play', 'tour_click', 'deck_plan_view', 'details_view')),
  value       int,
  created_at  timestamptz not null default now()
);
create index if not exists slideshow_events_listing_idx on public.slideshow_events(listing_id, created_at desc);
create index if not exists slideshow_events_photo_idx on public.slideshow_events(photo_id) where photo_id is not null;
alter table public.slideshow_events enable row level security;
create policy "Brokers can view events for own listings"
  on public.slideshow_events for select
  using (listing_id in (select id from public.listings where broker_id = auth.uid()));

alter table public.listings
  add column if not exists tour_url text,
  add column if not exists deck_plan_path text;

alter table public.photos
  add column if not exists category_source text
  check (category_source is null or category_source in ('manual', 'filename', 'ai'));
