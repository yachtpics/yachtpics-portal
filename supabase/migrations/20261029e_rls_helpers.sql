-- Oct 29, 2026 — RLS speed-up, part 1: helper functions for the initplan
-- pattern. APPLIED.
--
-- The hot tables' policies called per-row functions (assistant_has_access,
-- broker_sees_shared, is_co_broker, same_brokerage) and per-row auth.uid() /
-- is_admin(), so a broker's photos select evaluated them for every photo in
-- the table (listing_hero_photos averaged 2.5 s). These set-returning helpers
-- compute "which brokers / listings can I reach" ONCE per statement; policies
-- use them as `col in (select rls_x())` (a hashed subplan), plus
-- `(select auth.uid())` / `(select is_admin())`.
--
-- Each helper is exactly the logic of the function / EXISTS it replaces
-- (SECURITY DEFINER with a fixed search_path, like the originals), scoped to
-- auth.uid(). The old functions stay (storage policies and code use them);
-- is_admin and assistant_has_access are marked STABLE (they only read).
set local lock_timeout = '5s';

alter function public.is_admin() stable;
alter function public.assistant_has_access(uuid) stable;

-- assistant_has_access(b) = b is a broker I assist, or (as a brokerage admin)
-- any member of my brokerage (myself included, as in the original).
create or replace function public.rls_assisted_broker_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select broker_id from broker_assistants where assistant_id = auth.uid()
  union
  select tb.id
  from profiles me
  join profiles tb on tb.brokerage_id = me.brokerage_id
  where me.id = auth.uid() and me.is_brokerage_admin = true and me.brokerage_id is not null
$$;

-- Direct assistant links only (the videos policies use this narrower rule).
create or replace function public.rls_direct_assisted_broker_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select broker_id from broker_assistants where assistant_id = auth.uid()
$$;

-- broker_sees_shared(b): other brokers of my brokerage, when I'm a broker.
create or replace function public.rls_shared_broker_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select tb.id
  from profiles me
  join profiles tb on tb.brokerage_id = me.brokerage_id
  where me.id = auth.uid() and me.id <> tb.id and me.role = 'broker' and me.brokerage_id is not null
$$;

-- same_brokerage(t): other members of my brokerage.
create or replace function public.rls_brokerage_member_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select them.id
  from profiles me
  join profiles them on them.brokerage_id = me.brokerage_id
  where me.id = auth.uid() and me.id <> them.id and me.brokerage_id is not null
$$;

create or replace function public.rls_own_listing_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from listings where broker_id = auth.uid()
$$;

create or replace function public.rls_assisted_listing_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from listings where broker_id in (select public.rls_assisted_broker_ids())
$$;

create or replace function public.rls_direct_assisted_listing_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select l.id from listings l join broker_assistants ba on ba.broker_id = l.broker_id where ba.assistant_id = auth.uid()
$$;

create or replace function public.rls_shared_listing_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from listings where is_shared = true and broker_id in (select public.rls_shared_broker_ids())
$$;

-- is_co_broker(listing): listings I'm a co-broker on.
create or replace function public.rls_co_listing_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select listing_id from listing_co_brokers where broker_id = auth.uid()
$$;

revoke all on function
  public.rls_assisted_broker_ids(), public.rls_direct_assisted_broker_ids(), public.rls_shared_broker_ids(),
  public.rls_brokerage_member_ids(), public.rls_own_listing_ids(), public.rls_assisted_listing_ids(),
  public.rls_direct_assisted_listing_ids(), public.rls_shared_listing_ids(), public.rls_co_listing_ids()
  from public;
grant execute on function
  public.rls_assisted_broker_ids(), public.rls_direct_assisted_broker_ids(), public.rls_shared_broker_ids(),
  public.rls_brokerage_member_ids(), public.rls_own_listing_ids(), public.rls_assisted_listing_ids(),
  public.rls_direct_assisted_listing_ids(), public.rls_shared_listing_ids(), public.rls_co_listing_ids()
  to anon, authenticated, service_role;
