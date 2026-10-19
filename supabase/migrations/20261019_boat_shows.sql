-- Oct 19, 2026 — Boat show kit, phase 1 (FLIBS 2026).
--
--   boat_shows            — the shows YachtPics prepares dock cards for. Seeded
--                           with FLIBS 2026 (Oct 28 – Nov 1, Fort Lauderdale).
--                           Readable by anyone (a public show page comes later);
--                           written only by the service role / SQL.
--   listing_show_entries  — "this boat is at this show, at this dock / slip".
--                           One row per listing per show.
--   slideshow_events.source — where a buyer-slideshow session came from
--                           (e.g. 'flibs26' for a dock-card QR scan), so every
--                           event in that session is attributable.
--                           slideshow_views already has a source column.
--
-- Additive only; safe to run twice. NOT applied by Claude — Charlie applies it.

-- ── boat_shows ──────────────────────────────────────────────────────────────
create table if not exists public.boat_shows (
  key text primary key,
  name text not null,
  short_name text not null,
  starts_on date not null,
  ends_on date not null,
  city text,
  is_active boolean not null default true
);

insert into public.boat_shows (key, name, short_name, starts_on, ends_on, city)
values ('flibs26', 'Fort Lauderdale International Boat Show', 'FLIBS 2026', '2026-10-28', '2026-11-01', 'Fort Lauderdale')
on conflict (key) do nothing;

alter table public.boat_shows enable row level security;

drop policy if exists "boat_shows readable" on public.boat_shows;
create policy "boat_shows readable" on public.boat_shows
  for select to anon, authenticated using (true);

revoke all on public.boat_shows from anon, authenticated;
grant select on public.boat_shows to anon, authenticated;

-- ── listing_show_entries ───────────────────────────────────────────────────
create table if not exists public.listing_show_entries (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  show_key text not null references public.boat_shows(key),
  location text,
  note text,
  marked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id, show_key)
);

create index if not exists listing_show_entries_show_idx on public.listing_show_entries(show_key);

alter table public.listing_show_entries enable row level security;

-- Read: anyone who can read the listing — the same people the listings SELECT
-- policies let in: the owner, their assistants (assistant_has_access also
-- covers brokerage admins of the owner's brokerage), co-brokers, brokers in the
-- same brokerage when the listing is shared, and portal admins.
drop policy if exists "listing_show_entries read" on public.listing_show_entries;
create policy "listing_show_entries read" on public.listing_show_entries
  for select to authenticated
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_show_entries.listing_id
        and (
          l.broker_id = (select auth.uid())
          or public.assistant_has_access(l.broker_id)
          or public.is_co_broker(l.id)
          or (l.is_shared = true and public.broker_sees_shared(l.broker_id))
          or public.is_admin()
        )
    )
  );

-- Write: listing editors — the owner, their assistants (incl. brokerage
-- admins, via assistant_has_access) and portal admins. The app writes through
-- /api/listings/[id]/show with the service role after the same check; these
-- policies keep a direct browser write to the same people.
drop policy if exists "listing_show_entries insert" on public.listing_show_entries;
create policy "listing_show_entries insert" on public.listing_show_entries
  for insert to authenticated
  with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_show_entries.listing_id
        and (
          l.broker_id = (select auth.uid())
          or public.assistant_has_access(l.broker_id)
          or public.is_admin()
        )
    )
  );

drop policy if exists "listing_show_entries update" on public.listing_show_entries;
create policy "listing_show_entries update" on public.listing_show_entries
  for update to authenticated
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_show_entries.listing_id
        and (
          l.broker_id = (select auth.uid())
          or public.assistant_has_access(l.broker_id)
          or public.is_admin()
        )
    )
  )
  with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_show_entries.listing_id
        and (
          l.broker_id = (select auth.uid())
          or public.assistant_has_access(l.broker_id)
          or public.is_admin()
        )
    )
  );

drop policy if exists "listing_show_entries delete" on public.listing_show_entries;
create policy "listing_show_entries delete" on public.listing_show_entries
  for delete to authenticated
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_show_entries.listing_id
        and (
          l.broker_id = (select auth.uid())
          or public.assistant_has_access(l.broker_id)
          or public.is_admin()
        )
    )
  );

revoke all on public.listing_show_entries from anon;
grant select, insert, update, delete on public.listing_show_entries to authenticated;

-- ── QR-scan attribution on buyer-slideshow events ──────────────────────────
alter table public.slideshow_events add column if not exists source text;

create index if not exists slideshow_events_listing_source_idx
  on public.slideshow_events(listing_id, source)
  where source is not null;

-- The "Scanned at FLIBS 2026: N" line counts slideshow_views rows by source
-- (that column already exists); same partial index there so it stays cheap.
create index if not exists slideshow_views_listing_source_idx
  on public.slideshow_views(listing_id, source)
  where source is not null and source <> 'link';
