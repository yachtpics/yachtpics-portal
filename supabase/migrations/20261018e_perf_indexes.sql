-- Oct 18, 2026 — applied via SQL. Speed pass 1: foreign-key indexes.
-- photos(listing_id) had no index: every listing/slideshow/thumbs request
-- scanned all ~24k photo rows (~380 ms). Now an index scan (<1 ms).
create index if not exists photos_listing_order_idx on public.photos (listing_id, display_order);
create index if not exists videos_listing_idx on public.videos (listing_id);
create index if not exists listings_broker_idx on public.listings (broker_id);
