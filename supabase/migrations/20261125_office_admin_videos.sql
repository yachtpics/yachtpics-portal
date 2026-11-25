-- Nov 25, 2026 — Office admins can see, add and change videos on listings in
-- their own office, exactly like that broker's assistant. NOT APPLIED.
--
-- Why: owner decision (Charlie, Nov 25) — "an office admin must be able to
-- change listings in their own office just like an assistant". Listings and
-- photos already allow it in RLS: their assistant policies use
-- rls_assisted_listing_ids() / rls_assisted_broker_ids(), which include the
-- brokerage clause (caller is_brokerage_admin, has a brokerage_id, and it is
-- the listing owner's brokerage_id). The VIDEOS assistant policies were kept
-- on the narrower rls_direct_assisted_listing_ids() (direct broker_assistants
-- links only) when they were rewritten on Oct 29 (20261029g_rls_videos.sql).
-- So today an office admin opening a colleague's listing sees NO videos (the
-- page reads videos under the user's own session), and an upload reaches
-- Cloudflare but the browser's insert of the videos row is refused by RLS.
--
-- What this adds: three PERMISSIVE policies on public.videos, for the
-- `authenticated` role, using rls_assisted_listing_ids() — the same set the
-- photos assistant policies use (direct assistant links UNION office-admin
-- brokerages). Same commands an assistant has on videos: SELECT, INSERT,
-- UPDATE. No DELETE policy (assistants have none either; video deletes go
-- through /api/videos/delete with the service role).
--
-- Nothing else changes: the existing assistant/broker/co-broker/admin policies
-- are untouched. Additive; re-runnable (drop if exists + create). Needs
-- 20261029e_rls_helpers.sql (applied Oct 29).
--
-- Demo: no table is created and RLS is not newly enabled, so no
-- demo_apply_readonly_policies() step is needed. The demo_readonly_* policies
-- on videos are RESTRICTIVE, so they still apply on top of these (a demo
-- session can't write through them; the filming account's triggers still
-- limit it to its own listings). Check afterwards, expect no rows:
--   select * from public.demo_readonly_gaps();
set local lock_timeout = '5s';

drop policy if exists "Office admins read office videos" on public.videos;
create policy "Office admins read office videos" on public.videos for select to authenticated
  using (listing_id in (select public.rls_assisted_listing_ids()));

drop policy if exists "Office admins insert office videos" on public.videos;
create policy "Office admins insert office videos" on public.videos for insert to authenticated
  with check (listing_id in (select public.rls_assisted_listing_ids()));

drop policy if exists "Office admins update office videos" on public.videos;
create policy "Office admins update office videos" on public.videos for update to authenticated
  using (listing_id in (select public.rls_assisted_listing_ids()))
  with check (listing_id in (select public.rls_assisted_listing_ids()));

-- Verify (expect the three names):
--   select policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'videos' and policyname like 'Office admins%';
