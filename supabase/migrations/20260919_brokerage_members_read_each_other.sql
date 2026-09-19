-- Sept 19, 2026 — colleagues can see who owns a listing.
--
-- A brokerage admin already sees every listing in their brokerage (the
-- brokerage clause inside assistant_has_access(), on a FOR ALL policy), and
-- ordinary brokers see the ones marked is_shared. But `profiles` only let you
-- read your own row, so those listings rendered with a BLANK broker name —
-- Valhalla's admin saw 26 boats and could attribute 3 of them. Charlie: the
-- owner of a brokerage should see all its listings, and whose they are.
--
-- One SELECT policy, scoped to members of the same brokerage. SECURITY DEFINER
-- because the check reads profiles: inline, it would recurse into the very
-- policy it implements. `me.id <> them.id` keeps "own row" on the existing
-- policy rather than double-covering it. Row-level, so a colleague sees the
-- whole row (name, email, phone) — normal inside one company; if that ever
-- needs narrowing, it is a view or column grant, not a policy tweak.
--
-- APPLIED to the live project on Sept 19 via the MCP. Additive; safe to re-run.

create or replace function public.same_brokerage(target uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from profiles me
    join profiles them on them.id = target
    where me.id = auth.uid()
      and me.id <> them.id
      and me.brokerage_id is not null
      and me.brokerage_id = them.brokerage_id
  );
$$;

drop policy if exists "Brokerage members read each other" on public.profiles;
create policy "Brokerage members read each other"
  on public.profiles for select
  to authenticated
  using (same_brokerage(id));
