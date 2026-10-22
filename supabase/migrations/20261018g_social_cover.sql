-- Oct 18, 2026 (g) — A chosen cover frame for listing reels posted to
-- Facebook / Instagram from the Reel Maker (admin only).
--
-- Left alone, Facebook and Instagram pick the reel's cover themselves, and
-- they often land on a fade or a blurry pan. The admin now picks a frame in
-- the post dialog; the browser uploads it as a JPEG next to the MP4 in the
-- PRIVATE R2 video bucket (social-uploads/{listing_id}/{uuid}.jpg — the server
-- picks the key) and the post remembers that key here. At posting time:
--   Facebook  — the bytes are sent to /{video_id}/thumbnails (is_preferred)
--               after the reel is published or scheduled.
--   Instagram — a short-lived signed link goes in the container's cover_url.
--
-- A cover that Meta won't take never fails the post: the reel still goes out
-- with Meta's own pick, and cover_note says why.
--
-- Additive only; safe to run twice. Reel Service rows leave both columns null.

alter table public.social_posts add column if not exists cover_path text;
alter table public.social_posts add column if not exists cover_note text;

comment on column public.social_posts.cover_path is
  'listing_reel posts: key of the chosen cover JPEG in the private R2 video bucket (social-uploads/{listing}/...). Null = Meta picks the cover.';
comment on column public.social_posts.cover_note is
  '''set'' once Meta accepted the chosen cover, or a short failure message. A failed cover never fails the post.';
