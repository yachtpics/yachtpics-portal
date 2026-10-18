-- Oct 18, 2026 (b) — Post a listing reel to Facebook / Instagram from the
-- listing's Reel Maker (admin only for now).
--
-- A listing reel is rendered in the browser and has no stored video of its
-- own, so the admin's browser uploads the finished MP4 to the PRIVATE R2
-- video bucket (social-uploads/{listing_id}/{uuid}.mp4 — the server picks the
-- key) and the post remembers that key here. The link Meta fetches is signed
-- from video_path at the moment of posting (and again by the daily cron for a
-- scheduled Instagram post), so no long-lived link is ever stored.
--
--   source_kind = 'listing_reel', source_id = listings.id, video_path = R2 key
--   source_kind = 'reel_service_job' rows are unchanged (video_path stays null;
--   their file is reel_service_jobs.video_path).
--
-- Additive only; safe to run twice. Does not touch 20261018_social_publishing.sql.

alter table public.social_posts add column if not exists video_path text;

comment on column public.social_posts.video_path is
  'listing_reel posts: key of the uploaded MP4 in the private R2 video bucket (social-uploads/...). Null for reel_service_job posts.';

-- A listing reel post without a file could never be sent.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'social_posts_listing_reel_has_video'
      and conrelid = 'public.social_posts'::regclass
  ) then
    alter table public.social_posts
      add constraint social_posts_listing_reel_has_video
      check (source_kind <> 'listing_reel' or video_path is not null);
  end if;
end $$;
