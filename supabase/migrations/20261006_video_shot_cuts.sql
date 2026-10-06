-- Oct 6, 2026 — Reel Service: the edit points (shots) of each listing video.
--
-- Detected in the admin's browser (Reel Service "Measure videos", or the first
-- Reel Service render of the video) and stored so it's done once per video:
--   { "v": 1, "fps": 5, "durationSec": 276.1, "shots": [[0, 14.6], [14.6, 31.2], ...] }
-- The planner keeps every segment inside one shot (0.3 s clear of each edit).
-- Null = not detected yet. The app works without this column (it detects at
-- render time and keeps the result for the session).
-- Additive only; safe to run twice.

alter table public.videos add column if not exists shot_cuts jsonb;
