-- Nov 14, 2026 — First-party play metrics for the Portal marketing videos
-- (/see, and the tour video on yachtpics.com). Run after
-- 20261112_billing_boat_details.sql. NOT applied automatically.
--
-- Additive and re-runnable (no drops).
--
--  1. marketing_video_events — one row per event a visitor's browser reports:
--     play (first play of a video per page view), q25 / q50 / q75 (first time
--     past that fraction), complete (ended), walk_click ("Watch the full
--     walkthrough"), access_click ("Request access" after/around a video).
--     Written ONLY by POST /api/see/event with the service role. RLS on, NO
--     policies, no grants to anon / authenticated: service role only.
--     Anonymous by design: `visitor` is a random id the browser keeps for one
--     tab session (sessionStorage), no IP address, no full user agent, no
--     cookies. `video` is the file name without .mp4 (seeVideos.ts).
--  2. marketing_video_summary(p_since) — the admin page's numbers in one
--     call (per video, per surface, per device, per day, totals). Service
--     role only.
--  3. Demo layer 2 — the new table gets the read-only demo policies (they
--     only take access away; nobody but the service role writes here anyway).
--
-- After running:   select public.demo_apply_readonly_policies();
--                  select * from public.demo_readonly_gaps();   -- empty = good
-- (the block at the end runs the first and reports the second for you).

set local lock_timeout = '5s';

-- ─── 1. Events ──────────────────────────────────────────────────────────────
create table if not exists public.marketing_video_events (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  surface         text not null check (surface in ('see', 'yachtpics_home', 'yachtpics_portal')),
  video           text not null check (char_length(video) <= 40),
  event           text not null check (event in ('play', 'q25', 'q50', 'q75', 'complete', 'walk_click', 'access_click')),
  visitor         text check (visitor is null or char_length(visitor) <= 40),
  device          text check (device is null or device in ('phone', 'tablet', 'desktop')),
  referrer_host   text check (referrer_host is null or char_length(referrer_host) <= 120),
  seconds_watched integer check (seconds_watched is null or seconds_watched between 0 and 36000)
);

comment on table public.marketing_video_events is
  'Play metrics for the Portal marketing videos (/see, yachtpics.com). Written only by /api/see/event (service role). No IPs, no user agents, no cookies.';

create index if not exists marketing_video_events_created_at_idx
  on public.marketing_video_events (created_at);
create index if not exists marketing_video_events_video_event_created_idx
  on public.marketing_video_events (video, event, created_at);

alter table public.marketing_video_events enable row level security;
-- No policies on purpose: service role only.
revoke all on table public.marketing_video_events from anon, authenticated;

-- ─── 2. Summary for /admin/video-metrics ────────────────────────────────────
-- Days are Eastern-time calendar days. "access_after_watch" counts Request
-- access clicks from a visitor who had pressed play on any video earlier in
-- the same tab session.
create or replace function public.marketing_video_summary(p_since timestamptz)
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $fn$
  with ev as (
    select * from public.marketing_video_events where created_at >= p_since
  ),
  by_video as (
    select video,
           count(*) filter (where event = 'play')                    as plays,
           count(distinct visitor) filter (where event = 'play')     as visitors,
           count(*) filter (where event = 'q50')                     as q50,
           count(*) filter (where event = 'complete')                as completes,
           count(*) filter (where event = 'walk_click')              as walk_clicks,
           count(*) filter (where event = 'access_click')            as access_clicks
      from ev
     group by video
  ),
  by_surface as (
    select surface,
           count(*) filter (where event = 'play')                    as plays,
           count(distinct visitor) filter (where event = 'play')     as visitors
      from ev
     group by surface
  ),
  by_device as (
    select coalesce(device, 'unknown')                               as device,
           count(*) filter (where event = 'play')                    as plays,
           count(distinct visitor) filter (where event = 'play')     as visitors
      from ev
     group by coalesce(device, 'unknown')
  ),
  days as (
    select d::date as day
      from generate_series(
             (p_since at time zone 'America/New_York')::date,
             (now() at time zone 'America/New_York')::date,
             interval '1 day') d
  ),
  by_day as (
    select days.day,
           (select count(*) from ev
             where ev.event = 'play'
               and (ev.created_at at time zone 'America/New_York')::date = days.day) as plays
      from days
  )
  select jsonb_build_object(
    'plays',     (select count(*) from ev where event = 'play'),
    'visitors',  (select count(distinct visitor) from ev where event = 'play'),
    'completes', (select count(*) from ev where event = 'complete'),
    'access_clicks', (select count(*) from ev where event = 'access_click'),
    'access_after_watch', (
      select count(*) from ev a
       where a.event = 'access_click'
         and a.visitor is not null
         and exists (select 1 from ev p
                      where p.event = 'play'
                        and p.visitor = a.visitor
                        and p.created_at <= a.created_at)),
    'by_video',   coalesce((select jsonb_agg(to_jsonb(b)) from by_video b), '[]'::jsonb),
    'by_surface', coalesce((select jsonb_agg(to_jsonb(s)) from by_surface s), '[]'::jsonb),
    'by_device',  coalesce((select jsonb_agg(to_jsonb(d)) from by_device d), '[]'::jsonb),
    'by_day',     coalesce((select jsonb_agg(jsonb_build_object('day', x.day, 'plays', x.plays) order by x.day) from by_day x), '[]'::jsonb)
  );
$fn$;

revoke all on function public.marketing_video_summary(timestamptz) from public, anon, authenticated;
grant execute on function public.marketing_video_summary(timestamptz) to service_role;

-- ─── 3. Apply the demo read-only policies to the new table ──────────────────
do $$
declare
  n integer;
  r record;
  any_gap boolean := false;
begin
  n := public.demo_apply_readonly_policies();
  raise notice 'demo: % polic(ies) added or corrected.', n;
  for r in select * from public.demo_readonly_gaps() loop
    any_gap := true;
    raise notice 'demo: still missing on %: %', r.table_name, r.missing;
  end loop;
  if not any_gap then raise notice 'demo: layer 2 complete (demo_readonly_gaps() is empty).'; end if;
end $$;
