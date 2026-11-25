-- Nov 25, 2026 — "Open and close with our logo" (logo bookends).
-- NOT APPLIED. Additive and re-runnable. Until it is applied the Portal treats
-- the feature as OFF everywhere: the settings cards are hidden, the setting
-- routes answer 409, reels and slideshows are exactly as before.
--
-- What it adds: an office (brokerages) or a solo broker (broker_details) sets
-- an opening logo image, a closing logo image and a background colour. With
-- bookend_on, every reel made for that broker starts and ends on a frame of
-- the logo centred on the colour, and the buyer slideshow opens and closes on
-- it. The office setting, when on, wins for every broker in the brokerage.
--
--   bookend_on         boolean, default false
--   bookend_open_url   public URL in the broker-logos bucket (set by the Portal)
--   bookend_close_url  public URL in the broker-logos bucket (set by the Portal)
--   bookend_ground     '#rrggbb' or null
--
-- The two URL columns are written only by Portal server routes (service role)
-- or an admin: a trigger refuses a signed-in broker setting or changing them
-- straight from the browser (brokers can UPDATE their own broker_details row
-- under RLS). Same pattern as protect_listing_site_text (20261116b). The
-- server also checks every URL points into the public broker-logos bucket
-- before it is ever drawn. bookend_on / bookend_ground stay writable by the
-- row's owner; a hex CHECK limits what can be stored.
--
-- No new table and no RLS enabled, so demo_apply_readonly_policies() is not
-- needed (the restrictive demo policies already cover both tables).

set local lock_timeout = '5s';

alter table public.broker_details
  add column if not exists bookend_on boolean not null default false,
  add column if not exists bookend_open_url text,
  add column if not exists bookend_close_url text,
  add column if not exists bookend_ground text;

alter table public.brokerages
  add column if not exists bookend_on boolean not null default false,
  add column if not exists bookend_open_url text,
  add column if not exists bookend_close_url text,
  add column if not exists bookend_ground text;

alter table public.broker_details drop constraint if exists broker_details_bookend_ground_hex;
alter table public.broker_details
  add constraint broker_details_bookend_ground_hex
  check (bookend_ground is null or bookend_ground ~ '^#[0-9a-fA-F]{6}$');

alter table public.brokerages drop constraint if exists brokerages_bookend_ground_hex;
alter table public.brokerages
  add constraint brokerages_bookend_ground_hex
  check (bookend_ground is null or bookend_ground ~ '^#[0-9a-fA-F]{6}$');

create or replace function public.protect_bookend_urls()
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
    if new.bookend_open_url is not null or new.bookend_close_url is not null then
      raise exception 'The bookend images are set through the Portal.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.bookend_open_url is distinct from old.bookend_open_url
     or new.bookend_close_url is distinct from old.bookend_close_url then
    raise exception 'The bookend images are set through the Portal.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_bookend_urls() from public, anon, authenticated;

drop trigger if exists trg_protect_bookend_urls on public.broker_details;
create trigger trg_protect_bookend_urls
  before insert or update on public.broker_details
  for each row execute function public.protect_bookend_urls();

-- Harmless if brokerage members can't update brokerages at all.
drop trigger if exists trg_protect_bookend_urls on public.brokerages;
create trigger trg_protect_bookend_urls
  before insert or update on public.brokerages
  for each row execute function public.protect_bookend_urls();

-- Check after running (expect 8 column rows and 2 trigger rows):
--   select table_name, column_name from information_schema.columns
--    where table_schema = 'public' and table_name in ('broker_details', 'brokerages')
--      and column_name like 'bookend_%' order by 1, 2;
--   select tgrelid::regclass, tgname from pg_trigger where tgname = 'trg_protect_bookend_urls';
