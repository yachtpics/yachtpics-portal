-- NOT APPLIED YET (the apply was held for a confirmation). Oct 29, 2026 —
-- RLS speed-up: photos policies, initplan pattern. Same names, commands, roles
-- and meaning; drop + create in one transaction (no window without a policy).
-- Needs 20261029e_rls_helpers.sql (applied).
set local lock_timeout = '5s';

drop policy if exists "Admins manage all photos" on public.photos;
create policy "Admins manage all photos" on public.photos for all to public
  using ((select public.is_admin()));

drop policy if exists "Assistants delete linked broker photos" on public.photos;
create policy "Assistants delete linked broker photos" on public.photos for delete to public
  using (listing_id in (select public.rls_assisted_listing_ids()));

drop policy if exists "Assistants insert linked broker photos" on public.photos;
create policy "Assistants insert linked broker photos" on public.photos for insert to public
  with check (listing_id in (select public.rls_assisted_listing_ids()));

drop policy if exists "Assistants update linked broker photos" on public.photos;
create policy "Assistants update linked broker photos" on public.photos for update to public
  using (listing_id in (select public.rls_assisted_listing_ids()));

drop policy if exists "Assistants view/update linked broker photos" on public.photos;
create policy "Assistants view/update linked broker photos" on public.photos for select to public
  using (listing_id in (select public.rls_assisted_listing_ids()));

drop policy if exists "Brokers can delete own listing photos" on public.photos;
create policy "Brokers can delete own listing photos" on public.photos for delete to public
  using (listing_id in (select public.rls_own_listing_ids()));

drop policy if exists "Brokers insert own listing photos" on public.photos;
create policy "Brokers insert own listing photos" on public.photos for insert to public
  with check (listing_id in (select public.rls_own_listing_ids()));

drop policy if exists "Brokers update photo visibility/order" on public.photos;
create policy "Brokers update photo visibility/order" on public.photos for update to public
  using (listing_id in (select public.rls_own_listing_ids()));

drop policy if exists "Brokers view own listing photos" on public.photos;
create policy "Brokers view own listing photos" on public.photos for select to public
  using ((listing_id in (select public.rls_own_listing_ids())) or (select public.is_admin()));

drop policy if exists "Brokers view shared inventory photos" on public.photos;
create policy "Brokers view shared inventory photos" on public.photos for select to public
  using (listing_id in (select public.rls_shared_listing_ids()));

drop policy if exists "Co-brokers insert photos" on public.photos;
create policy "Co-brokers insert photos" on public.photos for insert to authenticated
  with check (listing_id in (select public.rls_co_listing_ids()));

drop policy if exists "Co-brokers update photos" on public.photos;
create policy "Co-brokers update photos" on public.photos for update to authenticated
  using (listing_id in (select public.rls_co_listing_ids()));

drop policy if exists "Co-brokers view photos" on public.photos;
create policy "Co-brokers view photos" on public.photos for select to authenticated
  using (listing_id in (select public.rls_co_listing_ids()));
