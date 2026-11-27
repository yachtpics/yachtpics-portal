-- Nov 27, 2026 — Upload a listing video to YouTube from the Portal (admin only).
--
-- *** NOT APPLIED *** — run in the Supabase SQL Editor when Charlie is ready
-- (docs/youtube-setup.md). Until it is, the feature is off: every YouTube
-- route answers "not set up" and nothing else in the Portal changes.
--
--   youtube_channels — one row per connected YouTube channel (one Google
--                      sign-in = one channel). The refresh and access tokens
--                      are AES-256-GCM sealed by the app
--                      (src/lib/youtube/crypto.ts, same format as the Meta
--                      Page tokens in social_connections.page_token_enc).
--   youtube_uploads  — one row per upload: listing, video, channel, what was
--                      sent, progress, the result. The `youtube_upload` job
--                      (src/lib/jobs/youtubeUpload.ts) reads and writes it.
--
-- Both tables: RLS ON with NO policies, and every grant to anon /
-- authenticated revoked — only the service role (server routes and the job)
-- can read or write them. Not even an admin's browser session can see a
-- token or an upload session URL.
--
-- Re-runnable: create … if not exists, add column if not exists, indexes if
-- not exists. Additive only.

set local lock_timeout = '5s';

-- ─── 1. youtube_channels ────────────────────────────────────────────────────
create table if not exists public.youtube_channels (
  id                      uuid primary key default gen_random_uuid(),
  channel_id              text not null unique,
  title                   text,
  handle                  text,
  thumbnail_url           text,
  refresh_token_enc       text not null,
  access_token_enc        text,
  access_token_expires_at timestamptz,
  needs_reconnect         boolean not null default false,
  connected_by            uuid references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table public.youtube_channels enable row level security;
revoke all on table public.youtube_channels from anon, authenticated;

-- ─── 2. youtube_uploads ─────────────────────────────────────────────────────
create table if not exists public.youtube_uploads (
  id                    uuid primary key default gen_random_uuid(),
  listing_id            uuid references public.listings(id) on delete set null,
  video_id              uuid references public.videos(id) on delete set null,
  channel_id            uuid references public.youtube_channels(id) on delete set null,
  job_id                uuid,
  title                 text not null,
  description           text not null default '',
  privacy               text not null default 'public',
  set_listing_link      boolean not null default false,
  replace_listing_link  boolean not null default false,
  status                text not null default 'queued',
  bytes_sent            bigint not null default 0,
  bytes_total           bigint,
  content_type          text,
  upload_session_url    text,
  session_restarts      integer not null default 0,
  consecutive_failures  integer not null default 0,
  youtube_video_id      text,
  youtube_url           text,
  listing_link_written  boolean not null default false,
  error                 text,
  started_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  started_at            timestamptz,
  uploaded_at           timestamptz,
  finished_at           timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'youtube_uploads_status_check') then
    alter table public.youtube_uploads add constraint youtube_uploads_status_check
      check (status in ('queued', 'uploading', 'processing', 'done', 'failed', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'youtube_uploads_privacy_check') then
    alter table public.youtube_uploads add constraint youtube_uploads_privacy_check
      check (privacy in ('public', 'unlisted', 'private'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'youtube_uploads_text_lengths') then
    alter table public.youtube_uploads add constraint youtube_uploads_text_lengths
      check (char_length(title) between 1 and 100 and char_length(description) <= 5000);
  end if;
end $$;

create index if not exists youtube_uploads_listing_idx on public.youtube_uploads (listing_id);
create index if not exists youtube_uploads_status_idx on public.youtube_uploads (status);
-- One active upload per video at a time (the route also checks; this catches a double click).
create unique index if not exists youtube_uploads_one_active_per_video
  on public.youtube_uploads (video_id)
  where status in ('queued', 'uploading', 'processing') and video_id is not null;

alter table public.youtube_uploads enable row level security;
revoke all on table public.youtube_uploads from anon, authenticated;

-- ─── 3. Demo read-only policies (CLAUDE.md) ─────────────────────────────────
-- demo_apply_readonly_policies() adds three RESTRICTIVE policies
-- (demo_readonly_insert / _update / _delete, "to authenticated") to every
-- RLS-enabled public table. Restrictive policies only ever take rights away:
-- with no permissive policy on these two tables, every non-service role is
-- still refused everything, demo or not — the demo account can't read them.
-- They aren't in demo_rw_tables(), so the filming account gets no exemption.
-- Running it keeps demo_readonly_gaps() empty, which is what CLAUDE.md asks.
select public.demo_apply_readonly_policies();
-- Check afterwards — expect no rows:
-- select * from public.demo_readonly_gaps();
