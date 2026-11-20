-- Video format of each stored listing video (Nov 20, 2026).
--
-- A broker on a new Windows laptop got sound with a black picture: the file
-- was H.265 (HEVC) in an .mp4, which Chrome / Edge on a fresh Windows install
-- often can't decode. ProRes plays in no browser. These columns record what's
-- inside each file, read from its own boxes (src/lib/videoCodec.ts):
--   video_codec       'h264' | 'h265' | 'av1' | 'vp9' | 'prores' | 'other:<fourcc>' | 'unknown'
--   video_width/height  from the video track's sample entry (pixels)
--   codec_checked_at  when it was read; null = not checked yet
-- Written by the upload path (a hint from the uploader's browser) and by the
-- admin job `video_codec_scan` (reads the stored original; service role).
--
-- Creates no table and enables no RLS, so no demo policy step. Re-runnable.

alter table public.videos add column if not exists video_codec text;
alter table public.videos add column if not exists video_width integer;
alter table public.videos add column if not exists video_height integer;
alter table public.videos add column if not exists codec_checked_at timestamptz;

-- The browser writes these straight through RLS, so the database is the
-- server-side check: a short lowercase token only, and sane dimensions.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'videos_video_codec_format' and conrelid = 'public.videos'::regclass) then
    alter table public.videos add constraint videos_video_codec_format
      check (video_codec is null or video_codec ~ '^[a-z0-9:]{2,24}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'videos_video_dims_range' and conrelid = 'public.videos'::regclass) then
    alter table public.videos add constraint videos_video_dims_range
      check ((video_width is null or video_width between 1 and 20000)
         and (video_height is null or video_height between 1 and 20000));
  end if;
end $$;

-- The job walks unchecked videos in id order; the admin card counts by codec.
create index if not exists videos_codec_unchecked_idx on public.videos (id) where codec_checked_at is null;
create index if not exists videos_video_codec_idx on public.videos (video_codec) where video_codec is not null;
