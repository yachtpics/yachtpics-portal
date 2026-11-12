-- Nov 12, 2026 — Private FILMING account: a WRITABLE variant of the demo.
-- Run after 20261110_demo_link.sql. NOT applied automatically.
--
-- Additive and re-runnable: no DROP of tables, columns, policies or data. A
-- second demo user (app_metadata { demo: true, demo_rw: true },
-- demo_accounts.writable = true) may run the listing workflow — create its
-- own listings, upload / manage photos, videos and documents, publish a
-- slideshow, save reels — and nothing else. Because it is still a demo
-- account, every existing "leave the demo out" rule applies to it unchanged.
--
-- This file adds:
--
--  1. demo_accounts.writable (default false) + "at most one writable row".
--  2. demo_links.account_user_id — which demo account a link opens (null =
--     the read-only demo, i.e. every link minted before today). A trigger
--     caps links for the WRITABLE account at 72 hours from creation and pins
--     created_at (it can't be back- or forward-dated to stretch the window).
--  3. public.demo_rw_tables() — the ONLY tables the filming account may write
--     through its own session: listings, photos, videos, documents. (Read the
--     code paths: photos rows + listing hero / order / slideshow publish /
--     hero_fit are client writes; video rows, stills, in_slideshow / order /
--     reel title are client writes; documents rows are client writes. Listing
--     create / edit, deletes, uploads presign, labels and reels go through
--     service-role routes guarded in code.)
--  4. demo_apply_readonly_policies() — REPLACED, same name and result. Still
--     creates the three RESTRICTIVE demo_readonly_* policies on every public
--     table with RLS on (+ storage.objects) where missing. NEW: on the
--     demo_rw_tables() the expression also lets a demo_rw session through;
--     on storage.objects a demo_rw session may write only in the
--     listing-photos / listing-documents buckets, only under its own
--     `{auth.uid()}/` folder, and inserts are capped by
--     demo_rw_storage_quota_ok(). Existing policies whose expression doesn't
--     match are corrected with ALTER POLICY (no drop). Ordinary RLS (own rows
--     only) still applies on top. Every other table stays read-only for BOTH
--     demo kinds.
--  5. demo_readonly_gaps() — REPLACED: also lists a policy missing the
--     filming exemption (on an RW table / storage), carrying one it shouldn't
--     (any other table), or the storage insert missing the quota.
--  6. Backstop triggers keyed on demo_accounts.writable:
--       listings — the filming account's listings are ALWAYS private:
--         showcase_opt_out = true (+ by / at), in_showcase = false,
--         publish_to_site = false, site_hidden = true, is_shared = false,
--         whatever the client or a route sent; deck_plan_path must be its own
--         file; at most 25 listings; through its own session it can only
--         insert / change / delete listings it owns. A demo_rw claim on any
--         login that isn't the writable row is refused (defence in depth —
--         only the service role can set app_metadata).
--       photos / videos / documents — through its own session only rows of
--         listings it owns; a filming listing's storage_path / thumbnail_path
--         must sit in `{broker}/{listing}/`; caps: 300 photos and 5 GB of
--         declared original_bytes across the account, 30 videos, 50 documents.
--  7. demo_revoke_sessions_for(user_id) — sign ONE demo account out (the
--     jobs use it so re-seeding one account doesn't end the other's session).
--     demo_revoke_sessions() (all demo accounts) is unchanged.
--
-- After running:   select public.demo_apply_readonly_policies();
--                  select * from public.demo_readonly_gaps();   -- empty = good
set local lock_timeout = '5s';

-- ─── 1. demo_accounts.writable ──────────────────────────────────────────────
alter table public.demo_accounts add column if not exists writable boolean not null default false;
create unique index if not exists demo_accounts_one_writable on public.demo_accounts (writable) where writable;

-- ─── 2. demo_links.account_user_id + the 72-hour rule ───────────────────────
alter table public.demo_links
  add column if not exists account_user_id uuid references public.demo_accounts(user_id) on delete cascade;
create index if not exists demo_links_account_user_id_idx on public.demo_links (account_user_id);

create or replace function public.demo_links_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
begin
  -- created_at is the server's, always: it anchors the 72-hour window.
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  if new.account_user_id is not null
     and exists (select 1 from public.demo_accounts d where d.user_id = new.account_user_id and d.writable)
     and new.expires_at > new.created_at + interval '72 hours' then
    raise exception 'A filming-account link may live at most 72 hours (expires_at <= created_at + 72 h).'
      using errcode = '23514';
  end if;
  return new;
end;
$fn$;
alter function public.demo_links_check() owner to postgres;
revoke all on function public.demo_links_check() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'demo_links_check' and tgrelid = 'public.demo_links'::regclass and not tgisinternal
  ) then
    create trigger demo_links_check
      before insert or update on public.demo_links
      for each row execute function public.demo_links_check();
  end if;
end $$;

-- ─── 3. Which tables the filming account may write (own session) ────────────
create or replace function public.demo_rw_tables()
returns text[]
language sql
immutable
set search_path = public, pg_catalog
as $fn$
  select array['listings', 'photos', 'videos', 'documents']::text[];
$fn$;
revoke all on function public.demo_rw_tables() from public, anon, authenticated;
grant execute on function public.demo_rw_tables() to service_role;

-- Helpers for the triggers (service role / definer only).
create or replace function public.demo_rw_any()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select exists (select 1 from public.demo_accounts d where d.writable);
$fn$;
alter function public.demo_rw_any() owner to postgres;
revoke all on function public.demo_rw_any() from public, anon, authenticated;

create or replace function public.demo_rw_is_writable(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select p_user is not null
     and exists (select 1 from public.demo_accounts d where d.user_id = p_user and d.writable);
$fn$;
alter function public.demo_rw_is_writable(uuid) owner to postgres;
revoke all on function public.demo_rw_is_writable(uuid) from public, anon, authenticated;

-- Storage cap for a demo_rw session's direct uploads (listing-photos /
-- listing-documents, own folder): fewer than 2,500 objects and under 5 GB of
-- stored bytes. Called ONLY from the storage.objects insert policy, and only
-- after the policy has established the session is demo_rw (CASE order), so
-- nobody else pays for it. Returns a boolean about the caller's own folder.
create or replace function public.demo_rw_storage_quota_ok()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select coalesce((
    select count(*) < 2500
       and coalesce(sum(nullif(o.metadata ->> 'size', '')::bigint), 0) < 5368709120
      from storage.objects o
     where o.bucket_id in ('listing-photos', 'listing-documents')
       and o.name like ((select auth.uid())::text || '/%')
  ), false);
$fn$;
alter function public.demo_rw_storage_quota_ok() owner to postgres;
revoke all on function public.demo_rw_storage_quota_ok() from public, anon;
grant execute on function public.demo_rw_storage_quota_ok() to authenticated, service_role;

-- ─── 4. Layer 2, with the filming exemption ─────────────────────────────────
create or replace function public.demo_apply_readonly_policies()
returns integer
language plpgsql
set search_path = public, pg_catalog
as $fn$
declare
  t record;
  v_cmd text;
  made integer := 0;
  tmade integer;
  is_rw boolean;
  want text;
  body text;
  needs_fix boolean;
  rw_tables text[] := public.demo_rw_tables();
  -- Not a demo session at all (everyone else): unchanged from 20261110.
  demo_off constant text := $e$coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'demo'), 'false') <> 'true'$e$;
  -- The writable demo (filming account).
  rw_on constant text := $e$coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'demo_rw'), 'false') = 'true'$e$;
  storage_scope constant text := $e$bucket_id = any (array['listing-photos'::text, 'listing-documents'::text]) and (storage.foldername(name))[1] = ((select auth.uid())::text)$e$;
begin
  for t in
    select n.nspname as schema_name, c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relrowsecurity
     order by c.relname
  loop
    tmade := 0;
    is_rw := t.table_name = any (rw_tables);
    want := case when is_rw then format('(%s) or (%s)', demo_off, rw_on) else demo_off end;
    begin
      foreach v_cmd in array array['insert', 'update', 'delete'] loop
        select coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') into body
          from pg_policies p
         where p.schemaname = t.schema_name and p.tablename = t.table_name and p.policyname = 'demo_readonly_' || v_cmd;
        if not found then
          execute format(
            'create policy %I on %I.%I as restrictive for %s to authenticated %s',
            'demo_readonly_' || v_cmd, t.schema_name, t.table_name, v_cmd,
            case v_cmd
              when 'insert' then format('with check (%s)', want)
              when 'update' then format('using (%s) with check (%s)', want, want)
              else format('using (%s)', want)
            end
          );
          tmade := tmade + 1;
        elsif (strpos(body, 'demo_rw') > 0) <> is_rw then
          -- Joined / left the RW list since it was made: correct it in place.
          execute format(
            'alter policy %I on %I.%I %s',
            'demo_readonly_' || v_cmd, t.schema_name, t.table_name,
            case v_cmd
              when 'insert' then format('with check (%s)', want)
              when 'update' then format('using (%s) with check (%s)', want, want)
              else format('using (%s)', want)
            end
          );
          tmade := tmade + 1;
        end if;
      end loop;
      made := made + tmade;
    exception when insufficient_privilege or lock_not_available then
      raise warning 'demo: public.% skipped — % (%). Re-run select public.demo_apply_readonly_policies(); later.', t.table_name, sqlerrm, sqlstate;
    end;
  end loop;

  -- storage.objects: read-only for the read-only demo; the filming account
  -- may write only listing-photos / listing-documents under its own folder,
  -- and new objects are capped (demo_rw_storage_quota_ok). CASE fixes the
  -- order: non-demo sessions never reach the quota function.
  tmade := 0;
  begin
    foreach v_cmd in array array['insert', 'update', 'delete'] loop
      want := format(
        'case when %s then true when (%s) and %s then %s else false end',
        demo_off, rw_on, storage_scope,
        case when v_cmd = 'insert' then 'public.demo_rw_storage_quota_ok()' else 'true' end
      );
      select coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') into body
        from pg_policies p
       where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = 'demo_readonly_' || v_cmd;
      if not found then
        execute format(
          'create policy %I on storage.objects as restrictive for %s to authenticated %s',
          'demo_readonly_' || v_cmd, v_cmd,
          case v_cmd
            when 'insert' then format('with check (%s)', want)
            when 'update' then format('using (%s) with check (%s)', want, want)
            else format('using (%s)', want)
          end
        );
        tmade := tmade + 1;
      else
        needs_fix := strpos(body, 'demo_rw') = 0
          or (v_cmd = 'insert' and strpos(body, 'demo_rw_storage_quota_ok') = 0);
        if needs_fix then
          execute format(
            'alter policy %I on storage.objects %s',
            'demo_readonly_' || v_cmd,
            case v_cmd
              when 'insert' then format('with check (%s)', want)
              when 'update' then format('using (%s) with check (%s)', want, want)
              else format('using (%s)', want)
            end
          );
          tmade := tmade + 1;
        end if;
      end if;
    end loop;
    made := made + tmade;
  exception when insufficient_privilege or lock_not_available then
    raise warning 'demo: could not add / update the demo policies on storage.objects (%). Run this as the postgres role, or re-run select public.demo_apply_readonly_policies(); later.', sqlerrm;
  end;

  return made;
end;
$fn$;

revoke all on function public.demo_apply_readonly_policies() from public, anon, authenticated;

-- ─── 5. Gaps, including the filming exemption ───────────────────────────────
create or replace function public.demo_readonly_gaps()
returns table (table_name text, missing text)
language sql
stable
set search_path = public, pg_catalog
as $fn$
  with targets as (
    select n.nspname::text as sch, c.relname::text as rel,
           case when n.nspname = 'storage' then true else c.relname::text = any (public.demo_rw_tables()) end as rw
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where (n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity)
        or (n.nspname = 'storage' and c.relname = 'objects')
  ),
  cmds as (
    select unnest(array['insert', 'update', 'delete']) as cmd
  ),
  pol as (
    select p.schemaname::text as sch, p.tablename::text as rel, p.policyname::text as pname,
           coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') as body
      from pg_policies p
     where p.policyname in ('demo_readonly_insert', 'demo_readonly_update', 'demo_readonly_delete')
  ),
  issues as (
    select t.sch || '.' || t.rel as tbl,
           case
             when p.pname is null then 'demo_readonly_' || c.cmd
             when t.rw and strpos(p.body, 'demo_rw') = 0 then 'demo_readonly_' || c.cmd || ' (no filming exemption)'
             when not t.rw and strpos(p.body, 'demo_rw') > 0 then 'demo_readonly_' || c.cmd || ' (filming exemption it should not have)'
             else 'demo_readonly_' || c.cmd || ' (no filming storage quota)'
           end as issue
      from targets t
     cross join cmds c
      left join pol p on p.sch = t.sch and p.rel = t.rel and p.pname = 'demo_readonly_' || c.cmd
     where p.pname is null
        or (t.rw and strpos(p.body, 'demo_rw') = 0)
        or (not t.rw and strpos(p.body, 'demo_rw') > 0)
        or (t.sch = 'storage' and c.cmd = 'insert' and strpos(p.body, 'demo_rw_storage_quota_ok') = 0)
  )
  select tbl, string_agg(issue, ', ' order by issue)
    from issues
   group by tbl
   order by 1;
$fn$;

revoke all on function public.demo_readonly_gaps() from public, anon, authenticated;
grant execute on function public.demo_readonly_gaps() to service_role;

-- ─── 6a. Listings: the filming account's listings are always private ────────
create or replace function public.demo_rw_listing_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  actor uuid := auth.uid();
  cur jsonb;
  patch jsonb;
  dp text;
begin
  if not public.demo_rw_any() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- A demo_rw claim is only honoured for the writable demo_accounts row.
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'demo_rw'), 'false') = 'true'
     and not (actor is not null and public.demo_rw_is_writable(actor)) then
    raise exception 'This account is read-only.' using errcode = '42501';
  end if;

  -- Through its own session the filming account touches only its own listings.
  if actor is not null and public.demo_rw_is_writable(actor) then
    if tg_op in ('UPDATE', 'DELETE') then
      if old.broker_id is distinct from actor then
        raise exception 'The filming account can only change its own listings.' using errcode = '42501';
      end if;
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      if new.broker_id is distinct from actor then
        raise exception 'The filming account can only change its own listings.' using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  if not public.demo_rw_is_writable(new.broker_id) then return new; end if;

  if tg_op = 'INSERT' then
    if (select count(*) from public.listings l where l.broker_id = new.broker_id) >= 25 then
      raise exception 'The filming account is full (25 listings) — reset it to start again.' using errcode = '54000';
    end if;
  end if;

  -- Force private, whatever was sent. Only columns this database has.
  cur := to_jsonb(new);
  patch := jsonb_build_object(
    'showcase_opt_out', true,
    'in_showcase', false,
    'publish_to_site', false,
    'site_hidden', true,
    'is_shared', false
  );
  if (cur ->> 'showcase_opt_out_by') is null then
    patch := patch || jsonb_build_object('showcase_opt_out_by', new.broker_id);
  end if;
  if (cur ->> 'showcase_opt_out_at') is null then
    patch := patch || jsonb_build_object('showcase_opt_out_at', now());
  end if;
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into patch
    from jsonb_each(patch) e
   where cur ? e.key;
  new := jsonb_populate_record(new, patch);

  -- A deck plan must be the account's own file.
  dp := cur ->> 'deck_plan_path';
  if dp is not null and dp <> '' and (strpos(dp, new.broker_id::text || '/') <> 1 or strpos(dp, '..') > 0) then
    raise exception 'The filming account''s deck plan must be its own file.' using errcode = '42501';
  end if;
  return new;
end;
$fn$;
alter function public.demo_rw_listing_guard() owner to postgres;
revoke all on function public.demo_rw_listing_guard() from public, anon, authenticated;

-- "zz_" so it runs after every other BEFORE trigger on listings (they fire
-- in name order) and its forced values are the final ones.
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'zz_demo_rw_listing_guard' and tgrelid = 'public.listings'::regclass and not tgisinternal
  ) then
    create trigger zz_demo_rw_listing_guard
      before insert or update or delete on public.listings
      for each row execute function public.demo_rw_listing_guard();
  end if;
end $$;

-- ─── 6b. Photos / videos / documents: own listings, own folder, caps ────────
create or replace function public.demo_rw_media_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  actor uuid := auth.uid();
  actor_rw boolean;
  rec jsonb;
  old_rec jsonb;
  lid uuid;
  owner_id uuid;
  prefix text;
  p text;
  n bigint;
  bytes numeric;
begin
  if not public.demo_rw_any() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then rec := to_jsonb(old); else rec := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then old_rec := to_jsonb(old); end if;
  lid := nullif(rec ->> 'listing_id', '')::uuid;
  actor_rw := actor is not null and public.demo_rw_is_writable(actor);
  -- A demo_rw claim is only honoured for the writable demo_accounts row.
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'demo_rw'), 'false') = 'true' and not actor_rw then
    raise exception 'This account is read-only.' using errcode = '42501';
  end if;

  if lid is null then
    -- Gallery media (admin-managed): never the filming account.
    if actor_rw then
      raise exception 'The filming account can only change its own listings.' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select l.broker_id into owner_id from public.listings l where l.id = lid;

  if owner_id is null then
    -- The listing is already gone (a cascade from deleting it — the listing
    -- trigger checked that delete) or never existed (the FK refuses it).
    if tg_op = 'DELETE' then return old; end if;
    if actor_rw then
      raise exception 'The filming account can only change its own listings.' using errcode = '42501';
    end if;
    return new;
  end if;

  if actor_rw then
    if owner_id is distinct from actor then
      raise exception 'The filming account can only change its own listings.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (old_rec ->> 'listing_id') is distinct from (rec ->> 'listing_id') then
      raise exception 'The filming account can''t move media between listings.' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  if not public.demo_rw_is_writable(owner_id) then return new; end if;

  -- A filming listing's files live in {broker}/{listing}/ — never a pointer
  -- at anyone else's file.
  prefix := owner_id::text || '/' || lid::text || '/';
  foreach p in array array[rec ->> 'storage_path', rec ->> 'thumbnail_path'] loop
    if p is not null and p <> '' and (strpos(p, prefix) <> 1 or strpos(p, '..') > 0) then
      raise exception 'The filming account''s files must stay in its own listing folder.' using errcode = '42501';
    end if;
  end loop;

  if tg_op = 'INSERT' then
    if tg_table_name = 'photos' then
      select count(*), coalesce(sum(coalesce(ph.original_bytes, 0)), 0) into n, bytes
        from public.photos ph
        join public.listings l on l.id = ph.listing_id
       where l.broker_id = owner_id;
      if n >= 300 then
        raise exception 'The filming account is full (300 photos) — reset it to start again.' using errcode = '54000';
      end if;
      if bytes + coalesce(nullif(rec ->> 'original_bytes', '')::numeric, 0) > 5368709120 then
        raise exception 'The filming account is full (5 GB) — reset it to start again.' using errcode = '54000';
      end if;
    elsif tg_table_name = 'videos' then
      select count(*) into n
        from public.videos v
        join public.listings l on l.id = v.listing_id
       where l.broker_id = owner_id;
      if n >= 30 then
        raise exception 'The filming account is full (30 videos) — reset it to start again.' using errcode = '54000';
      end if;
    elsif tg_table_name = 'documents' then
      select count(*) into n
        from public.documents d
        join public.listings l on l.id = d.listing_id
       where l.broker_id = owner_id;
      if n >= 50 then
        raise exception 'The filming account is full (50 documents) — reset it to start again.' using errcode = '54000';
      end if;
    end if;
  end if;
  return new;
end;
$fn$;
alter function public.demo_rw_media_guard() owner to postgres;
revoke all on function public.demo_rw_media_guard() from public, anon, authenticated;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['photos', 'videos', 'documents'] loop
    if to_regclass('public.' || tbl) is null then
      raise warning 'demo: public.% not found — no filming guard added to it.', tbl;
      continue;
    end if;
    if not exists (
      select 1 from pg_trigger
       where tgname = 'zz_demo_rw_media_guard' and tgrelid = ('public.' || tbl)::regclass and not tgisinternal
    ) then
      execute format(
        'create trigger zz_demo_rw_media_guard before insert or update or delete on public.%I for each row execute function public.demo_rw_media_guard()',
        tbl
      );
    end if;
  end loop;
end $$;

-- ─── 7. Sign ONE demo account out ───────────────────────────────────────────
create or replace function public.demo_revoke_sessions_for(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  n integer := 0;
begin
  if p_user_id is null or not exists (select 1 from public.demo_accounts d where d.user_id = p_user_id) then
    return 0;
  end if;
  delete from auth.refresh_tokens rt where rt.user_id = p_user_id::text;
  delete from auth.sessions s where s.user_id = p_user_id;
  get diagnostics n = row_count;
  return n;
end;
$fn$;
alter function public.demo_revoke_sessions_for(uuid) owner to postgres;
revoke all on function public.demo_revoke_sessions_for(uuid) from public, anon, authenticated;
grant execute on function public.demo_revoke_sessions_for(uuid) to service_role;

-- ─── Apply ──────────────────────────────────────────────────────────────────
do $$
declare
  n integer;
  r record;
  any_gap boolean := false;
begin
  n := public.demo_apply_readonly_policies();
  raise notice 'demo: % polic(ies) added or corrected (filming exemption on: %).', n, array_to_string(public.demo_rw_tables(), ', ');
  for r in select * from public.demo_readonly_gaps() loop
    any_gap := true;
    raise notice 'demo: still missing on %: %', r.table_name, r.missing;
  end loop;
  if not any_gap then raise notice 'demo: layer 2 complete (demo_readonly_gaps() is empty).'; end if;
end $$;
