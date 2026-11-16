-- Nov 16, 2026 — SECURITY FIX: protect_profile_privileges never blocked anything.
-- Run after 20261116b_protect_site_text.sql. Re-runnable.
--
-- The trigger (20261018c) is meant to stop a signed-in user changing their own
-- profiles.role / is_brokerage_admin / brokerage_id (RLS "Users update own
-- profile" lets them update their own row). Its escape hatch was
--     current_user in ('postgres','service_role','supabase_admin')
-- but the function is SECURITY DEFINER and owned by postgres, and inside a
-- SECURITY DEFINER function current_user IS the owner. So the check was always
-- true and every change was let through: any signed-in broker could have set
-- their own role to 'admin' from the browser.
--
-- Checked Nov 16 before this fix: exactly two admins exist (the owners), so
-- there is no sign it was ever used.
--
-- Now the only callers allowed to change those three columns are:
--   * the service role (server routes), by its JWT claim;
--   * a direct database session with no API user at all (SQL editor,
--     migrations): no auth.uid() and no API role;
--   * a Portal admin (is_admin()).
-- Everyone else is refused, as originally intended.

create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  api_role text := coalesce(auth.role(), '');
begin
  if (new.role is distinct from old.role)
     or (new.is_brokerage_admin is distinct from old.is_brokerage_admin)
     or (new.brokerage_id is distinct from old.brokerage_id) then
    if api_role = 'service_role' then
      return new;
    end if;
    -- No API user and no API role: a direct database session, not a browser.
    if auth.uid() is null and api_role not in ('anon', 'authenticated') then
      return new;
    end if;
    if public.is_admin() then
      return new;
    end if;
    raise exception 'Not allowed to change role, brokerage or brokerage-admin status'
      using errcode = '42501';
  end if;
  return new;
end; $function$;
