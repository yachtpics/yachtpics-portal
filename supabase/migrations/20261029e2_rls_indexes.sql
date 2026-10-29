-- Oct 29, 2026 — indexes used by the RLS policies / flagged by the advisor
-- (unindexed foreign keys). APPLIED one statement at a time with
-- CREATE INDEX CONCURRENTLY (outside a transaction — run each line on its own).
create index concurrently if not exists broker_assistants_assistant_idx on public.broker_assistants (assistant_id);
create index concurrently if not exists listing_co_brokers_broker_idx on public.listing_co_brokers (broker_id);
create index concurrently if not exists photos_uploaded_by_idx on public.photos (uploaded_by);
create index concurrently if not exists videos_uploaded_by_idx on public.videos (uploaded_by);
create index concurrently if not exists listings_hero_photo_idx on public.listings (hero_photo_id);
create index concurrently if not exists listing_co_brokers_added_by_idx on public.listing_co_brokers (added_by);
create index concurrently if not exists profiles_invited_by_idx on public.profiles (invited_by);
