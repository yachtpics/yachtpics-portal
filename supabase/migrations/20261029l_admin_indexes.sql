-- Oct 29, 2026 — indexes for the admin pages. APPLIED with CREATE INDEX
-- CONCURRENTLY (outside a transaction).
--   assistant_activity() counts client_sends per assistant (sent_by) and
--   photos per uploader (photos_uploaded_by_idx, 20261029e2).
create index concurrently if not exists client_sends_sent_by_idx on public.client_sends (sent_by);
