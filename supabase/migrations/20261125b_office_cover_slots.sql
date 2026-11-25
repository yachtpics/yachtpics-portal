-- Nov 25, 2026 (later) — Office cover slots: a paying company admin's plan
-- covers only as many office boats as the plan's range allows. NOT APPLIED.
--
-- Owner decision (Charlie, Nov 25): the admin's plan covers the first N boats
-- of the office she starts using the Portal's paid tools on (Starter 5,
-- Growth 10, Pro 20, Elite unlimited — PLANS[].maxListings), first come first
-- served. Her own active unsold boats use slots first. A slot frees up when
-- the boat is sold / archived / deleted, or when its owner gets their own
-- plan, an Office plan or Reel Service cover. Rule and copy:
-- src/lib/officeCoverSlots.ts (switch: OFFICE_ADMIN_PLAN_COVERS_OFFICE in
-- src/lib/brokerAccess.ts).
--
-- Until this file is applied the code falls back to the Nov 25 (68a46e1)
-- behaviour: every boat in the office is unlocked by the paying admin.
--
-- 1. public.office_cover_slots — one row per boat that holds (or held) a slot.
--    listing_id is the primary key: a boat needs only one slot. A live slot
--    has released_at null. Re-taking a released boat reuses its row.
-- 2. RLS on, READ only for: the admin whose slot it is, the listing's owner /
--    their assistants / office admins of the owner's brokerage
--    (rls_assisted_listing_ids, rls_own_listing_ids) and YachtPics admins.
--    No insert/update/delete policy: all writes go through the server with
--    the service role.
-- 3. public.office_cover_slot_take(...) — takes a slot race-safely. A plain
--    (SECURITY INVOKER) function, executable by service_role only: the
--    server calls it after checking who is acting (src/lib/officeCoverSlots.ts
--    takeCoverSlot). A per-admin transaction advisory lock serialises takes
--    for that admin, so two boats can never both get the last slot: it counts
--    the admin's own active unsold boats + her live slots on active unsold
--    boats, refuses when that reaches the limit, then inserts (or re-opens a
--    released row). The server releases stale rows (owner now has a plan,
--    boat sold/archived) before calling it.
-- 3b. A trigger on listings releases the slot when the boat is sold,
--    archived (any status but active) or moves to another owner.
-- 4. Demo read-only policies (CLAUDE.md: after a migration that creates a
--    table or enables RLS) — section 4 at the end.
--
-- Re-runnable.
set local lock_timeout = '5s';

-- ─── 1. Table ───────────────────────────────────────────────────────────────
create table if not exists public.office_cover_slots (
  listing_id     uuid primary key references public.listings(id) on delete cascade,
  admin_id       uuid not null references public.profiles(id) on delete cascade,
  brokerage_id   uuid not null references public.brokerages(id) on delete cascade,
  -- The listing's owner when the slot was taken (for "these boats of yours").
  owner_id       uuid references public.profiles(id) on delete cascade,
  -- Who used the tool: the admin, her assistant, or a YachtPics admin.
  taken_by       uuid references public.profiles(id) on delete set null,
  taken_at       timestamptz not null default now(),
  released_at    timestamptz,
  release_reason text check (release_reason is null or char_length(release_reason) <= 80)
);

create index if not exists office_cover_slots_admin_live_idx
  on public.office_cover_slots (admin_id, taken_at) where released_at is null;
create index if not exists office_cover_slots_owner_live_idx
  on public.office_cover_slots (owner_id) where released_at is null;

-- ─── 2. RLS: read-only for the people who can see the boat or own the slot ──
alter table public.office_cover_slots enable row level security;

drop policy if exists "Cover slots readable by admin, owner team, YachtPics" on public.office_cover_slots;
create policy "Cover slots readable by admin, owner team, YachtPics" on public.office_cover_slots
  for select to authenticated
  using (
    admin_id = (select auth.uid())
    or listing_id in (select public.rls_own_listing_ids())
    or listing_id in (select public.rls_assisted_listing_ids())
    or (select public.is_admin())
  );
-- No insert / update / delete policies: service role only.

-- ─── 3. Race-safe take ──────────────────────────────────────────────────────
-- Returns 'taken' (this call took it), 'held' (the boat already holds a live
-- slot — nothing changed) or 'full' (the admin's plan has no free slot).
-- p_limit null = unlimited (Elite).
create or replace function public.office_cover_slot_take(
  p_listing_id   uuid,
  p_admin_id     uuid,
  p_brokerage_id uuid,
  p_owner_id     uuid,
  p_taken_by     uuid,
  p_limit        integer
) returns text
language plpgsql
set search_path = public
as $fn$
declare
  existing  public.office_cover_slots%rowtype;
  in_use    integer;
  n         integer;
begin
  -- One take at a time per admin (released at the end of the transaction).
  perform pg_advisory_xact_lock(hashtext('office_cover_slots:' || p_admin_id::text));

  select * into existing from public.office_cover_slots where listing_id = p_listing_id for update;
  if found and existing.released_at is null then
    return 'held';
  end if;

  if p_limit is not null then
    select
      (select count(*) from public.listings l
         where l.broker_id = p_admin_id and l.status = 'active' and l.sold_at is null)
      +
      (select count(*) from public.office_cover_slots s
         join public.listings l on l.id = s.listing_id
         where s.admin_id = p_admin_id and s.released_at is null
           and l.status = 'active' and l.sold_at is null)
    into in_use;
    if in_use >= p_limit then
      return 'full';
    end if;
  end if;

  insert into public.office_cover_slots as s
    (listing_id, admin_id, brokerage_id, owner_id, taken_by, taken_at, released_at, release_reason)
  values
    (p_listing_id, p_admin_id, p_brokerage_id, p_owner_id, p_taken_by, now(), null, null)
  on conflict (listing_id) do update
    set admin_id = excluded.admin_id,
        brokerage_id = excluded.brokerage_id,
        owner_id = excluded.owner_id,
        taken_by = excluded.taken_by,
        taken_at = now(),
        released_at = null,
        release_reason = null
    where s.released_at is not null;
  get diagnostics n = row_count;
  -- n = 0: another admin's take of this same boat won the race a moment ago.
  return case when n > 0 then 'taken' else 'held' end;
end;
$fn$;

revoke all on function public.office_cover_slot_take(uuid, uuid, uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.office_cover_slot_take(uuid, uuid, uuid, uuid, uuid, integer) to service_role;

-- ─── 3b. Release a boat's slot when it is sold, archived or changes owner ──
-- Status changes happen in several places (Edit Listing, the admin listing
-- page from the browser, the website "mark sold" action), so the release
-- lives here rather than in each of them. SECURITY DEFINER because a broker's
-- own browser update must be able to release the row (the table has no
-- write policy); it never tests current_user. Re-activating a boat does NOT
-- re-take a slot: the admin's next use of a tool on it does.
create or replace function public.office_cover_slots_release_on_listing_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.status is distinct from 'active' or new.sold_at is not null or new.broker_id is distinct from old.broker_id then
    update public.office_cover_slots
       set released_at = now(),
           release_reason = case
             when new.broker_id is distinct from old.broker_id then 'owner changed'
             when new.sold_at is not null or new.status = 'sold' then 'sold'
             else 'not active' end
     where listing_id = new.id and released_at is null;
  end if;
  return new;
end;
$fn$;

revoke all on function public.office_cover_slots_release_on_listing_change() from public, anon, authenticated;

drop trigger if exists office_cover_slots_release_on_listing_change on public.listings;
create trigger office_cover_slots_release_on_listing_change
  after update of status, sold_at, broker_id on public.listings
  for each row
  when (old.status is distinct from new.status or old.sold_at is distinct from new.sold_at or old.broker_id is distinct from new.broker_id)
  execute function public.office_cover_slots_release_on_listing_change();

-- ─── 4. Demo read-only policies on the new table (CLAUDE.md) ────────────────
-- Same as running:  select public.demo_apply_readonly_policies();
-- Check afterwards, expect no rows:  select * from public.demo_readonly_gaps();
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
