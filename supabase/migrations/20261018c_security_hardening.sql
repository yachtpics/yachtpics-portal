-- Security hardening
-- Applied Oct 18, 2026 via SQL — safe to re-run.
-- This file records what is already live in prod; it is idempotent.

-- ---------------------------------------------------------------------------
-- 1. Stop users promoting themselves: block changes to role /
--    is_brokerage_admin / brokerage_id on profiles unless the caller is the
--    service role / a superuser role, or a portal admin.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (new.role is distinct from old.role)
     or (new.is_brokerage_admin is distinct from old.is_brokerage_admin)
     or (new.brokerage_id is distinct from old.brokerage_id) then
    if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
       or current_user in ('postgres','service_role','supabase_admin') then
      return new;
    end if;
    if public.is_admin() then
      return new;
    end if;
    raise exception 'Not allowed to change role, brokerage or brokerage-admin status';
  end if;
  return new;
end; $function$;

drop trigger if exists protect_profile_privileges on public.profiles;
create trigger protect_profile_privileges
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();

revoke execute on function public.protect_profile_privileges() from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 2. Sign-up can no longer pick an arbitrary role via user metadata: anything
--    other than broker / assistant / client falls back to broker.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare user_role text;
begin
  user_role := coalesce(new.raw_user_meta_data->>'role', 'broker');
  if user_role not in ('broker','assistant','client') then user_role := 'broker'; end if;
  insert into public.profiles (id, role, display_email) values (new.id, user_role, new.email) on conflict (id) do nothing;
  if user_role = 'broker' then
    insert into public.broker_details (id) values (new.id) on conflict do nothing;
    insert into public.subscriptions (broker_id, status, trial_ends_at) values (new.id, 'trialing', null) on conflict (broker_id) do nothing;
  end if;
  return new;
exception when others then
  raise warning 'handle_new_user failed for %: %', new.email, sqlerrm;
  return new;
end; $function$;

-- ---------------------------------------------------------------------------
-- 3. Anonymous visitors get nothing on profiles.
-- ---------------------------------------------------------------------------
revoke all on public.profiles from anon;

-- ---------------------------------------------------------------------------
-- 4. Pin search_path on SECURITY DEFINER helpers, and take EXECUTE away from
--    anon on functions it has no business calling.
-- ---------------------------------------------------------------------------
alter function public.accessible_broker_ids()      set search_path = public;
alter function public.assistant_has_access(uuid)   set search_path = public;
alter function public.broker_sees_shared(uuid)     set search_path = public;
alter function public.is_admin()                   set search_path = public;
alter function public.is_co_broker(uuid)           set search_path = public;
alter function public.protect_listing_ownership()  set search_path = public;

revoke execute on function public.accessible_broker_ids()          from anon;
revoke execute on function public.assistant_activity()             from anon;
revoke execute on function public.handle_new_user()                from anon;
revoke execute on function public.protect_listing_ownership()      from anon;
revoke execute on function public.listing_hero_photos(uuid[])      from anon;

-- Follow-up (same day): "revoke from anon" alone is not enough because PUBLIC
-- still held EXECUTE. Revoke from public and re-grant only where the app needs it.
revoke execute on function public.accessible_broker_ids() from public, anon;
grant execute on function public.accessible_broker_ids() to authenticated, service_role;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin, service_role;
revoke execute on function public.protect_listing_ownership() from public, anon, authenticated;
revoke execute on function public.listing_hero_photos(uuid[]) from public, anon;
grant execute on function public.listing_hero_photos(uuid[]) to authenticated, service_role;
revoke execute on function public.assistant_activity() from public;
grant execute on function public.assistant_activity() to authenticated, service_role;
