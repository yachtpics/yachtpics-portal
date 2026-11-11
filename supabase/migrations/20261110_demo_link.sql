-- Nov 10, 2026 — Read-only DEMO link: a sample broker account at /demo/{token}.
-- Run after 20261109b_billing_invoice_edits.sql. NOT applied automatically.
--
-- Additive and re-runnable (no drops). The marker for the demo account is the
-- JWT claim app_metadata.demo = true (only the service role can set
-- app_metadata, and it rides in every access token Supabase issues for that
-- user). This file adds:
--
--  1. demo_links    — the private links. Only sha256(token) is stored (hex),
--                     never the token. RLS on, NO policies, and no grants to
--                     anon / authenticated: service role only (the
--                     /demo/[token] route).
--  2. demo_accounts — which auth user is the demo and which listing is its
--                     sample copy. Written only by the demo_seed / demo_reset
--                     jobs; read by /demo/[token] (look the user up BY ID) and
--                     by the business counts that leave the demo out.
--                     Service role only, like demo_links.
--  3. Read-only layer 2 — for EVERY table in schema public that has RLS on,
--     three RESTRICTIVE policies for the `authenticated` role:
--         demo_readonly_insert  (with check)
--         demo_readonly_update  (using + with check)
--         demo_readonly_delete  (using)
--     each `coalesce((select auth.jwt()) -> 'app_metadata' ->> 'demo', 'false') <> 'true'`.
--     Restrictive policies only ever take access AWAY: for every other user
--     the expression is true and nothing changes. The same three go on
--     storage.objects (uploads / overwrites / deletes in every bucket).
--     Policies that already exist are left alone (re-runnable, no drop).
--     The loop lives in public.demo_apply_readonly_policies() so it can be
--     re-run after a later migration adds a table:
--         select public.demo_apply_readonly_policies();
--     Each table gets its own sub-block: a table we can't lock or don't own
--     is skipped with a WARNING instead of aborting the run.
--     public.demo_readonly_gaps() lists any RLS-enabled public table (and
--     storage.objects) still missing one of the three — run it after any
--     later migration:  select * from public.demo_readonly_gaps();
--  4. public.demo_revoke_sessions() — deletes every auth session (and its
--     refresh tokens) of every demo_accounts user, so a demo session can't
--     outlive its link. Called by the demo_seed / demo_reset jobs; run it
--     by hand when revoking a link. Service role only.
--  5. public.demo_link_touch(id) — the /demo/[token] route's atomic
--     "use_count = use_count + 1". Service role only.
--  6. NOTICES (read them in the SQL editor's output): public tables WITHOUT
--     RLS (a hole for every signed-in user, not only the demo — listed, not
--     changed), and SECURITY DEFINER functions in public that `authenticated`
--     may execute (they bypass RLS, so a demo session calling one that writes
--     would get past layer 2 — check each one listed).
--
-- Token: 32 random bytes, base64url (43 characters; the route refuses
-- anything shorter). The token travels in the URL, so it shows up in
-- Vercel's request logs — keep expiries short. Token hashing uses the
-- built-in sha256(bytea) (PostgreSQL 11+), so no extension is needed:
--   insert into public.demo_links (token_hash, label, expires_at)
--   values (encode(sha256(convert_to('<token>', 'utf8')), 'hex'), 'Capture browser', now() + interval '7 days');
-- Revoke a link (BOTH lines — the second signs out sessions it already made):
--   update public.demo_links set revoked_at = now() where label = 'Capture browser';
--   select public.demo_revoke_sessions();
set local lock_timeout = '5s';

-- ─── 1. demo_links ──────────────────────────────────────────────────────────
create table if not exists public.demo_links (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  label        text,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  use_count    integer not null default 0
);
alter table public.demo_links enable row level security;
revoke all on table public.demo_links from anon, authenticated;

-- ─── 2. demo_accounts ───────────────────────────────────────────────────────
create table if not exists public.demo_accounts (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  email             text,
  listing_id        uuid references public.listings(id) on delete set null,
  source_listing_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.demo_accounts enable row level security;
revoke all on table public.demo_accounts from anon, authenticated;

-- ─── 3. Restrictive "no writes with the demo claim" policies ────────────────
create or replace function public.demo_apply_readonly_policies()
returns integer
language plpgsql
set search_path = public, pg_catalog
as $fn$
declare
  t record;
  cmd text;
  made integer := 0;
  tmade integer;
  expr constant text := $e$coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'demo'), 'false') <> 'true'$e$;
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
    -- One sub-block per table: if this table can't be locked in time or
    -- isn't ours, its (partial) policies roll back, a WARNING says so, and
    -- the run carries on with the next table.
    tmade := 0;
    begin
      foreach cmd in array array['insert', 'update', 'delete'] loop
        if not exists (
          select 1 from pg_policies p
           where p.schemaname = t.schema_name and p.tablename = t.table_name and p.policyname = 'demo_readonly_' || cmd
        ) then
          execute format(
            'create policy %I on %I.%I as restrictive for %s to authenticated %s',
            'demo_readonly_' || cmd, t.schema_name, t.table_name, cmd,
            case cmd
              when 'insert' then format('with check (%s)', expr)
              when 'update' then format('using (%s) with check (%s)', expr, expr)
              else format('using (%s)', expr)
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

  -- storage.objects: uploads, overwrites (upsert) and deletes in every bucket.
  tmade := 0;
  begin
    foreach cmd in array array['insert', 'update', 'delete'] loop
      if not exists (
        select 1 from pg_policies p
         where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = 'demo_readonly_' || cmd
      ) then
        execute format(
          'create policy %I on storage.objects as restrictive for %s to authenticated %s',
          'demo_readonly_' || cmd, cmd,
          case cmd
            when 'insert' then format('with check (%s)', expr)
            when 'update' then format('using (%s) with check (%s)', expr, expr)
            else format('using (%s)', expr)
          end
        );
        tmade := tmade + 1;
      end if;
    end loop;
    made := made + tmade;
  exception when insufficient_privilege or lock_not_available then
    raise warning 'demo: could not add the read-only policies to storage.objects (%). Add them from Dashboard → Storage → Policies, or run this file as the postgres role.', sqlerrm;
  end;

  return made;
end;
$fn$;

revoke all on function public.demo_apply_readonly_policies() from public, anon, authenticated;

-- Which RLS-enabled public tables (and storage.objects) still lack one of the
-- three read-only policies. Empty = layer 2 is complete.
create or replace function public.demo_readonly_gaps()
returns table (table_name text, missing text)
language sql
stable
set search_path = public, pg_catalog
as $fn$
  with targets as (
    select n.nspname::text as sch, c.relname::text as rel
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where (n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity)
        or (n.nspname = 'storage' and c.relname = 'objects')
  ),
  cmds as (
    select unnest(array['insert', 'update', 'delete']) as cmd
  )
  select t.sch || '.' || t.rel,
         string_agg('demo_readonly_' || c.cmd, ', ' order by c.cmd)
    from targets t
   cross join cmds c
   where not exists (
     select 1 from pg_policies p
      where p.schemaname = t.sch and p.tablename = t.rel and p.policyname = 'demo_readonly_' || c.cmd
   )
   group by t.sch, t.rel
   order by 1;
$fn$;

revoke all on function public.demo_readonly_gaps() from public, anon, authenticated;
grant execute on function public.demo_readonly_gaps() to service_role;

-- ─── 4. Sign the demo out everywhere ────────────────────────────────────────
-- Deleting an auth.sessions row cascades to its refresh tokens
-- (auth.refresh_tokens.session_id … on delete cascade); refresh tokens with
-- no session (older GoTrue rows) are deleted explicitly first. Access tokens
-- already handed out live until they expire (≤ the JWT expiry, 1 h default).
-- No demo_accounts row → nothing deleted, returns 0.
create or replace function public.demo_revoke_sessions()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  n integer := 0;
begin
  if to_regclass('public.demo_accounts') is null then
    return 0;
  end if;
  if not exists (select 1 from public.demo_accounts) then
    return 0;
  end if;
  delete from auth.refresh_tokens rt
   where rt.user_id in (select d.user_id::text from public.demo_accounts d);
  delete from auth.sessions s
   where s.user_id in (select d.user_id from public.demo_accounts d);
  get diagnostics n = row_count;
  return n;
end;
$fn$;

alter function public.demo_revoke_sessions() owner to postgres;
revoke all on function public.demo_revoke_sessions() from public, anon, authenticated;
grant execute on function public.demo_revoke_sessions() to service_role;

-- ─── 5. Count a link's use, atomically ──────────────────────────────────────
create or replace function public.demo_link_touch(p_id uuid)
returns void
language sql
set search_path = public, pg_catalog
as $fn$
  update public.demo_links
     set use_count = use_count + 1,
         last_used_at = now()
   where id = p_id;
$fn$;

revoke all on function public.demo_link_touch(uuid) from public, anon, authenticated;
grant execute on function public.demo_link_touch(uuid) to service_role;

do $$
declare
  n integer;
begin
  n := public.demo_apply_readonly_policies();
  raise notice 'demo: % read-only polic(ies) added (0 = already there).', n;
end $$;

-- ─── 6. Report: tables without RLS; SECURITY DEFINER functions open to users ─
do $$
declare
  r record;
  found_any boolean := false;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
     order by c.relname
  loop
    found_any := true;
    raise notice 'demo: public.% has RLS OFF — any signed-in user (demo included) can reach it through the API if it is granted. Not changed here.', r.relname;
  end loop;
  if not found_any then raise notice 'demo: every public table has RLS on.'; end if;

  found_any := false;
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args,
           (p.prosrc ~* '\m(insert|update|delete|truncate)\M') as writes
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     order by p.proname
  loop
    found_any := true;
    raise notice 'demo: SECURITY DEFINER public.%(%) is executable by authenticated%', r.proname, r.args,
      case when r.writes then ' — its body WRITES: check it can''t be used by the demo (add a demo-claim guard or revoke).' else ' (read-only body).' end;
  end loop;
  if not found_any then raise notice 'demo: no SECURITY DEFINER function in public is executable by authenticated.'; end if;
end $$;
