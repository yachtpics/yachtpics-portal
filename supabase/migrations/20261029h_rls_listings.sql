-- APPLIED Oct 29, 2026 (pasted in the SQL Editor; verified old-vs-new equivalent). —
-- RLS speed-up: listings policies, initplan pattern (same names, commands,
-- roles and meaning).
set local lock_timeout = '5s';

drop policy if exists "Assistants manage linked broker listings" on public.listings;
create policy "Assistants manage linked broker listings" on public.listings for all to public
  using (broker_id in (select public.rls_assisted_broker_ids()));

drop policy if exists "Brokers manage own listings" on public.listings;
create policy "Brokers manage own listings" on public.listings for all to public
  using ((broker_id = (select auth.uid())) or (select public.is_admin()));

drop policy if exists "Brokers view shared brokerage listings" on public.listings;
create policy "Brokers view shared brokerage listings" on public.listings for select to authenticated
  using ((is_shared = true) and broker_id in (select public.rls_shared_broker_ids()));

drop policy if exists "Co-brokers update listing" on public.listings;
create policy "Co-brokers update listing" on public.listings for update to authenticated
  using (id in (select public.rls_co_listing_ids()));

drop policy if exists "Co-brokers view listing" on public.listings;
create policy "Co-brokers view listing" on public.listings for select to authenticated
  using (id in (select public.rls_co_listing_ids()));
