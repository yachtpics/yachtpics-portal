-- Nov 16, 2026 — protect the yachtpics.com website-text columns.
-- Run AFTER 20261116_site_description.sql. Additive and re-runnable.
--
-- Why: brokers (and their assistants) can UPDATE their own listing rows
-- straight from the browser — RLS "Brokers manage own listings" /
-- "Assistants manage linked broker listings" are FOR ALL, and the broker
-- listing page really does write listings from the browser (hero_fit,
-- slideshow_published). The PATCH /api/listings/[id] allow-list never
-- accepts these four columns, but that only covers the API, not a direct
-- write with the broker's own session.
--
-- What it does: a BEFORE INSERT OR UPDATE trigger on public.listings that
-- refuses to set or change
--     site_description, site_description_draft,
--     site_description_drafted_at, site_location_suggestion
-- unless the caller is the service role / a database owner role (every
-- Portal server route and job — auth.uid() is null there) or a Portal admin
-- (public.is_admin()). Anything else that the broker writes on the row is
-- untouched; an update that sends these columns UNCHANGED (e.g. a whole row
-- written back) passes. Same pattern as protect_listing_yp_share
-- (20261101b) and protect_profile_privileges (20261018c).
--
-- Reading: these columns stay readable by the broker through the existing
-- SELECT policies on their own row. That's acceptable — the text is what
-- goes on the public website anyway; nothing here is secret.
--
-- No new table and no RLS change, so demo_apply_readonly_policies() is not
-- needed. Check after running:
--   select tgname from pg_trigger
--    where tgrelid = 'public.listings'::regclass and tgname = 'trg_protect_listing_site_text';

create or replace function public.protect_listing_site_text()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Trusted server: the service-role key (no signed-in user, so no
  -- auth.uid()) or a direct database session (SQL editor, migrations).
  -- NOTE: don't test current_user here — inside a SECURITY DEFINER function
  -- it is the function's owner (postgres), so it would let everyone through.
  if auth.uid() is null
     or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
     or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.site_description is not null
       or new.site_description_draft is not null
       or new.site_description_drafted_at is not null
       or new.site_location_suggestion is not null then
      raise exception 'Only YachtPics can set the yachtpics.com page text.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.site_description is distinct from old.site_description
     or new.site_description_draft is distinct from old.site_description_draft
     or new.site_description_drafted_at is distinct from old.site_description_drafted_at
     or new.site_location_suggestion is distinct from old.site_location_suggestion then
    raise exception 'Only YachtPics can change the yachtpics.com page text.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_listing_site_text() from public, anon, authenticated;

drop trigger if exists trg_protect_listing_site_text on public.listings;
create trigger trg_protect_listing_site_text
  before insert or update on public.listings
  for each row execute function public.protect_listing_site_text();
