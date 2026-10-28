-- Oct 28, 2026 (later) — photos.thumb_at: when the 600 px derivative of an
-- R2 original was made. Uploads to R2 wait only for the 600 (so the tile
-- shows at once); the 2000 copy and the Web / Social download files follow in
-- a background job, which then sets derivatives_at as before. Tiles use the
-- 600 when derivatives_at is null but thumb_at is set. Additive; safe to run twice.
set local lock_timeout = '5s';
alter table public.photos add column if not exists thumb_at timestamptz;
