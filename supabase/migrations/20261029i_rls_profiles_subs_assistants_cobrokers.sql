-- APPLIED Oct 29, 2026 (pasted in the SQL Editor; verified old-vs-new equivalent). —
-- RLS speed-up: profiles, subscriptions, broker_assistants, listing_co_brokers
-- policies, initplan pattern (same names, commands, roles and meaning).
set local lock_timeout = '5s';

-- profiles
drop policy if exists "Admins insert profiles" on public.profiles;
create policy "Admins insert profiles" on public.profiles for insert to public with check ((select public.is_admin()));
drop policy if exists "Assistants read linked brokers" on public.profiles;
create policy "Assistants read linked brokers" on public.profiles for select to public
  using (id in (select public.rls_direct_assisted_broker_ids()));
drop policy if exists "Brokerage members read each other" on public.profiles;
create policy "Brokerage members read each other" on public.profiles for select to authenticated
  using (id in (select public.rls_brokerage_member_ids()));
drop policy if exists "Brokers read linked assistants" on public.profiles;
create policy "Brokers read linked assistants" on public.profiles for select to public
  using (exists (select 1 from public.broker_assistants ba where ba.broker_id = (select auth.uid()) and ba.assistant_id = profiles.id));
drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles for select to public
  using ((id = (select auth.uid())) or (select public.is_admin()));
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update to public using (id = (select auth.uid()));

-- subscriptions
drop policy if exists "Admins manage subscriptions" on public.subscriptions;
create policy "Admins manage subscriptions" on public.subscriptions for all to public using ((select public.is_admin()));
drop policy if exists "Brokers view own subscription" on public.subscriptions;
create policy "Brokers view own subscription" on public.subscriptions for select to public using (broker_id = (select auth.uid()));

-- broker_assistants
drop policy if exists "Assistants view their links" on public.broker_assistants;
create policy "Assistants view their links" on public.broker_assistants for select to public using (assistant_id = (select auth.uid()));
drop policy if exists "Brokers manage their assistants" on public.broker_assistants;
create policy "Brokers manage their assistants" on public.broker_assistants for all to public
  using ((broker_id = (select auth.uid())) or (select public.is_admin()));

-- listing_co_brokers
drop policy if exists "Admins manage co-brokers" on public.listing_co_brokers;
create policy "Admins manage co-brokers" on public.listing_co_brokers for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "Co-brokers see own rows" on public.listing_co_brokers;
create policy "Co-brokers see own rows" on public.listing_co_brokers for select to authenticated using (broker_id = (select auth.uid()));
