-- NOT APPLIED YET (the apply was held for a confirmation). Oct 29, 2026 —
-- RLS speed-up: videos policies, initplan pattern (same names, commands, roles
-- and meaning). The assistant policies keep their narrower rule: direct
-- assistant links only (rls_direct_assisted_listing_ids).
set local lock_timeout = '5s';

drop policy if exists "Admins can delete any video" on public.videos;
create policy "Admins can delete any video" on public.videos for delete to authenticated using ((select public.is_admin()));
drop policy if exists "Admins can insert any video" on public.videos;
create policy "Admins can insert any video" on public.videos for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "Admins can read all videos" on public.videos;
create policy "Admins can read all videos" on public.videos for select to authenticated using ((select public.is_admin()));
drop policy if exists "Admins can update any video" on public.videos;
create policy "Admins can update any video" on public.videos for update to public
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Assistants can insert linked broker videos" on public.videos;
create policy "Assistants can insert linked broker videos" on public.videos for insert to authenticated
  with check (listing_id in (select public.rls_direct_assisted_listing_ids()));
drop policy if exists "Assistants can read linked broker videos" on public.videos;
create policy "Assistants can read linked broker videos" on public.videos for select to authenticated
  using (listing_id in (select public.rls_direct_assisted_listing_ids()));
drop policy if exists "Assistants can update linked broker videos" on public.videos;
create policy "Assistants can update linked broker videos" on public.videos for update to public
  using (listing_id in (select public.rls_direct_assisted_listing_ids()))
  with check (listing_id in (select public.rls_direct_assisted_listing_ids()));

drop policy if exists "Broker can insert own listing videos" on public.videos;
create policy "Broker can insert own listing videos" on public.videos for insert to public
  with check (listing_id in (select public.rls_own_listing_ids()));
drop policy if exists "Broker can read own listing videos" on public.videos;
create policy "Broker can read own listing videos" on public.videos for select to public
  using (listing_id in (select public.rls_own_listing_ids()));
drop policy if exists "Broker can update own listing videos" on public.videos;
create policy "Broker can update own listing videos" on public.videos for update to public
  using (listing_id in (select public.rls_own_listing_ids()))
  with check (listing_id in (select public.rls_own_listing_ids()));

drop policy if exists "Brokers view shared inventory videos" on public.videos;
create policy "Brokers view shared inventory videos" on public.videos for select to public
  using (listing_id in (select public.rls_shared_listing_ids()));

drop policy if exists "Co-brokers insert videos" on public.videos;
create policy "Co-brokers insert videos" on public.videos for insert to authenticated with check (listing_id in (select public.rls_co_listing_ids()));
drop policy if exists "Co-brokers update videos" on public.videos;
create policy "Co-brokers update videos" on public.videos for update to authenticated using (listing_id in (select public.rls_co_listing_ids()));
drop policy if exists "Co-brokers view videos" on public.videos;
create policy "Co-brokers view videos" on public.videos for select to authenticated using (listing_id in (select public.rls_co_listing_ids()));
