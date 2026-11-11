-- Nov 11, 2026 — Billing: every Portal broker is a billing client, linked by
-- billing_clients.broker_profile_id, so a newly added broker can be invoiced
-- right away without being re-typed. Run after 20261110_demo_link.sql.
--
-- Additive and re-runnable. No new table (nothing for
-- demo_apply_readonly_policies to do). Writes only billing_clients (and,
-- through the existing 20261108c trigger, billing_client_contacts).
--
--  1. billing_sync_client_from_profile(p_profile) — service role only. For a
--     profile with role 'broker' (never assistants, clients or admins; never
--     the demo account; never obvious test brokers — same rule as
--     isTestBroker in src/lib/reviewReel.ts), in this order:
--       a. a client already linked to this profile → fill its EMPTY fields
--          only (email, phone, first/last, company; display_name only when
--          it's empty or still the email placeholder). Nothing is ever
--          overwritten.
--       b. else unlinked clients whose email = the broker's login email, or
--          their display_email when no other login uses that address → link
--          them and fill empty fields.
--       c. else ONE unlinked client whose display_name is exactly the
--          broker's "First Last" → link it, but only when it is the only
--          client with that name, the only broker with that name, and its
--          email (if any) doesn't belong to some other Portal login.
--       d. else insert a new client: display_name "First Last" (else the
--          email), first/last, company = broker_details.brokerage_name,
--          email, phone, status active, linked. The 20261108c insert trigger
--          gives it its primary contact; if that trigger isn't installed
--          but the contacts table is, the function adds the contact itself.
--     Returns what it did: 'filled' | 'unchanged' | 'linked_email' |
--     'linked_name' | 'created' | 'skipped_*'.
--  2. Triggers on profiles (insert; update of role / names / display_email /
--     phone) and broker_details (insert; update of brokerage_name). They only
--     act for brokers whose first or last name is set — the invite routes
--     create the login first (handle_new_user: email only) and write the
--     names a moment later, so waiting for the name lets the name match run
--     before a placeholder client is made. They never raise: any problem is
--     a `raise warning` and the broker is saved as usual.
--  3. billing_relink_brokers no longer UNLINKS a client when its email stops
--     matching a login (it used to set broker_profile_id back to null, which
--     would undo the name / display_email links made here on every Zoho
--     re-pull or client email edit). It still links / re-points on an email
--     match, as before.
--  4. One-time backfill for every existing broker (NOTICE lists the counts).
set local lock_timeout = '5s';

-- ─── 1. Sync one broker profile → billing client ──────────────────────────
create or replace function public.billing_sync_client_from_profile(p_profile uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  p          record;
  v_first    text;
  v_last     text;
  v_name     text;
  v_disp     text;     -- profiles.display_email, normalised
  v_login    text;     -- auth.users.email, normalised
  v_email    text;     -- the one we store: display_email, else login email
  v_phone    text;
  v_company  text;
  v_cand     uuid;
  v_new      uuid;
  n          integer;
begin
  if p_profile is null then return 'skipped_null'; end if;

  select pr.id, pr.role, pr.first_name, pr.last_name, pr.display_email, pr.phone, u.email as login_email
    into p
    from profiles pr left join auth.users u on u.id = pr.id
   where pr.id = p_profile;
  if not found then return 'skipped_missing'; end if;
  if p.role is distinct from 'broker' then return 'skipped_not_broker'; end if;
  if exists (select 1 from demo_accounts d where d.user_id = p_profile) then return 'skipped_demo'; end if;

  v_first := nullif(trim(coalesce(p.first_name, '')), '');
  v_last  := nullif(trim(coalesce(p.last_name, '')), '');
  v_name  := nullif(trim(coalesce(v_first, '') || ' ' || coalesce(v_last, '')), '');
  v_disp  := nullif(lower(trim(coalesce(p.display_email, ''))), '');
  v_login := nullif(lower(trim(coalesce(p.login_email, ''))), '');
  v_email := coalesce(v_disp, v_login);
  -- display_email is typed by the broker, so it only counts for MATCHING when
  -- no other login uses it (a shared office address can't link the wrong
  -- person). The login email always counts.
  if v_disp is not null and v_disp is distinct from v_login and (
       exists (select 1 from auth.users u3 where u3.id <> p_profile and lower(u3.email) = v_disp)
    or exists (select 1 from profiles p4 where p4.id <> p_profile and lower(trim(p4.display_email)) = v_disp)) then
    v_disp := null;
  end if;
  v_phone := nullif(trim(coalesce(p.phone, '')), '');

  -- Test brokers (mirrors isTestBroker): no billing client.
  if lower(coalesce(v_name, '')) ~ '\y(test|demo|sample|example)\y'
     or lower(coalesce(v_name, '')) in ('john doe', 'jane doe')
     or coalesce(v_email, '') ~ '\y(test|demo)\y|example\.com' then
    return 'skipped_test';
  end if;
  if v_name is null and v_email is null then return 'skipped_no_name_or_email'; end if;

  select nullif(trim(coalesce(bd.brokerage_name, '')), '') into v_company
    from broker_details bd where bd.id = p_profile;

  -- One sync per broker at a time (two saves racing can't make two clients).
  perform pg_advisory_xact_lock(hashtext('billing_sync_client_from_profile'), hashtext(p_profile::text));

  -- a. Already linked → fill empty fields only.
  if exists (select 1 from billing_clients c where c.broker_profile_id = p_profile) then
    update billing_clients c
       set email        = coalesce(nullif(trim(c.email), ''), v_email),
           phone        = coalesce(nullif(trim(c.phone), ''), v_phone),
           first_name   = coalesce(nullif(trim(c.first_name), ''), v_first),
           last_name    = coalesce(nullif(trim(c.last_name), ''), v_last),
           company_name = coalesce(nullif(trim(c.company_name), ''), v_company),
           display_name = case when v_name is not null
                                 and (trim(c.display_name) = '' or lower(trim(c.display_name)) = lower(trim(coalesce(c.email, ''))))
                               then v_name else c.display_name end,
           updated_at   = now()
     where c.broker_profile_id = p_profile
       and (   (nullif(trim(c.email), '') is null and v_email is not null)
            or (nullif(trim(c.phone), '') is null and v_phone is not null)
            or (nullif(trim(c.first_name), '') is null and v_first is not null)
            or (nullif(trim(c.last_name), '') is null and v_last is not null)
            or (nullif(trim(c.company_name), '') is null and v_company is not null)
            or (v_name is not null and (trim(c.display_name) = '' or lower(trim(c.display_name)) = lower(trim(coalesce(c.email, ''))))
                and c.display_name is distinct from v_name));
    get diagnostics n = row_count;
    return case when n > 0 then 'filled' else 'unchanged' end;
  end if;

  -- b. Email match (display_email or login email), unlinked clients only.
  if v_disp is not null or v_login is not null then
    update billing_clients c
       set broker_profile_id = p_profile,
           phone        = coalesce(nullif(trim(c.phone), ''), v_phone),
           first_name   = coalesce(nullif(trim(c.first_name), ''), v_first),
           last_name    = coalesce(nullif(trim(c.last_name), ''), v_last),
           company_name = coalesce(nullif(trim(c.company_name), ''), v_company),
           updated_at   = now()
     where c.broker_profile_id is null
       and nullif(trim(c.email), '') is not null
       and lower(trim(c.email)) in (coalesce(v_disp, ''), coalesce(v_login, ''));
    get diagnostics n = row_count;
    if n > 0 then return 'linked_email'; end if;
  end if;

  -- c. Exact name match — only when it can't be the wrong person.
  if v_first is not null and v_last is not null then
    select c.id into v_cand
      from billing_clients c
     where lower(trim(c.display_name)) = lower(v_name)
       and c.broker_profile_id is null
       -- its email (if any) isn't some other Portal login's
       and (nullif(trim(c.email), '') is null
            or (    not exists (select 1 from auth.users u2
                                 where u2.id <> p_profile and lower(u2.email) = lower(trim(c.email)))
                and not exists (select 1 from profiles p2
                                 where p2.id <> p_profile and lower(trim(p2.display_email)) = lower(trim(c.email)))))
       -- the only client with this name (linked or not, active or not)
       and (select count(*) from billing_clients c2 where lower(trim(c2.display_name)) = lower(v_name)) = 1
       -- the only broker with this name
       and (select count(*) from profiles p3
             where p3.role = 'broker'
               and lower(trim(coalesce(p3.first_name, '') || ' ' || coalesce(p3.last_name, ''))) = lower(v_name)) = 1;
    if v_cand is not null then
      update billing_clients c
         set broker_profile_id = p_profile,
             email        = coalesce(nullif(trim(c.email), ''), v_email),
             phone        = coalesce(nullif(trim(c.phone), ''), v_phone),
             first_name   = coalesce(nullif(trim(c.first_name), ''), v_first),
             last_name    = coalesce(nullif(trim(c.last_name), ''), v_last),
             company_name = coalesce(nullif(trim(c.company_name), ''), v_company),
             updated_at   = now()
       where c.id = v_cand and c.broker_profile_id is null;
      get diagnostics n = row_count;
      if n > 0 then return 'linked_name'; end if;
    end if;
  end if;

  -- d. New client.
  insert into billing_clients (display_name, company_name, first_name, last_name, email, phone, status, broker_profile_id)
  values (coalesce(v_name, v_email), v_company, v_first, v_last, v_email, v_phone, 'active', p_profile)
  returning id into v_new;

  -- Primary contact: the 20261108c insert trigger makes it. If that trigger
  -- isn't there but the table is, add it here (same values as the trigger).
  if v_email is not null and to_regclass('public.billing_client_contacts') is not null then
    execute 'insert into billing_client_contacts (client_id, first_name, last_name, email, phone, is_primary, send_by_default)
             select $1, $2, $3, $4, $5, true, true
              where not exists (select 1 from billing_client_contacts x where x.client_id = $1)'
      using v_new, v_first, v_last, v_email, v_phone;
  end if;
  return 'created';
end $$;

revoke all on function public.billing_sync_client_from_profile(uuid) from public, anon, authenticated;
grant execute on function public.billing_sync_client_from_profile(uuid) to service_role;

-- ─── 2. Triggers: keep it in step, never block saving a broker ────────────
create or replace function public.billing_profile_sync_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'broker'
     and (nullif(trim(coalesce(new.first_name, '')), '') is not null
          or nullif(trim(coalesce(new.last_name, '')), '') is not null) then
    begin
      perform billing_sync_client_from_profile(new.id);
    exception when others then
      raise warning 'billing_sync_client_from_profile failed for profile %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;

create or replace function public.billing_broker_details_sync_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if nullif(trim(coalesce(new.brokerage_name, '')), '') is not null
     and exists (select 1 from profiles pr
                  where pr.id = new.id and pr.role = 'broker'
                    and (nullif(trim(coalesce(pr.first_name, '')), '') is not null
                         or nullif(trim(coalesce(pr.last_name, '')), '') is not null)) then
    begin
      perform billing_sync_client_from_profile(new.id);
    exception when others then
      raise warning 'billing_sync_client_from_profile failed for broker_details %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;

revoke all on function public.billing_profile_sync_trigger() from public, anon, authenticated;
revoke all on function public.billing_broker_details_sync_trigger() from public, anon, authenticated;

drop trigger if exists billing_profile_sync_ins on public.profiles;
create trigger billing_profile_sync_ins
  after insert on public.profiles
  for each row when (new.role = 'broker')
  execute function public.billing_profile_sync_trigger();

drop trigger if exists billing_profile_sync_upd on public.profiles;
create trigger billing_profile_sync_upd
  after update of role, first_name, last_name, display_email, phone on public.profiles
  for each row when (new.role = 'broker' and (
       old.role is distinct from new.role
    or old.first_name is distinct from new.first_name
    or old.last_name is distinct from new.last_name
    or old.display_email is distinct from new.display_email
    or old.phone is distinct from new.phone))
  execute function public.billing_profile_sync_trigger();

drop trigger if exists billing_broker_details_sync_ins on public.broker_details;
create trigger billing_broker_details_sync_ins
  after insert on public.broker_details
  for each row execute function public.billing_broker_details_sync_trigger();

drop trigger if exists billing_broker_details_sync_upd on public.broker_details;
create trigger billing_broker_details_sync_upd
  after update of brokerage_name on public.broker_details
  for each row when (old.brokerage_name is distinct from new.brokerage_name)
  execute function public.billing_broker_details_sync_trigger();

-- ─── 3. Relink: link / re-point on an email match, never unlink ───────────
create or replace function public.billing_relink_brokers(only_client uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update billing_clients c
     set broker_profile_id = m.pid
    from (
      select c2.id,
             (select p.id from auth.users u join profiles p on p.id = u.id
               where c2.email is not null and lower(u.email) = lower(trim(c2.email)) and p.role <> 'admin'
               order by p.created_at limit 1) as pid
        from billing_clients c2
       where only_client is null or c2.id = only_client
    ) m
   where m.id = c.id and m.pid is not null and c.broker_profile_id is distinct from m.pid;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.billing_relink_brokers(uuid) from public, anon, authenticated;
grant execute on function public.billing_relink_brokers(uuid) to service_role;

-- ─── 4. One-time backfill (safe to re-run: linked brokers only get blanks filled)
do $$
declare
  r record;
  res text;
  counts jsonb := '{}'::jsonb;
begin
  for r in select id from public.profiles where role = 'broker' order by created_at, id loop
    begin
      res := public.billing_sync_client_from_profile(r.id);
    exception when others then
      res := 'error';
      raise warning 'billing backfill failed for profile %: %', r.id, sqlerrm;
    end;
    counts := jsonb_set(counts, array[res], to_jsonb(coalesce((counts ->> res)::int, 0) + 1));
  end loop;
  raise notice 'billing_clients_from_brokers backfill: %', counts;
end $$;
