-- YachtPics share link (Nov 1): a second public URL for a listing's slideshow,
-- /yp/{yp_share_token}, that stays live whatever the broker's plan. Only
-- YachtPics issues it (yachtpics.com boat pages, our reel captions); admins
-- can switch it off per listing. Additive only; no foreign keys.

alter table public.listings
  add column if not exists yp_share_enabled boolean not null default true,
  add column if not exists yp_share_token text not null
    default substr(md5(random()::text || clock_timestamp()::text), 1, 10);

create unique index if not exists listings_yp_share_token_key on public.listings (yp_share_token);

-- Brokers can update their own listing rows (RLS), so guard the two columns:
-- only an admin (or the service role) may switch the link or change its token.
create or replace function public.protect_listing_yp_share()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    return new; -- trusted server (service role)
  end if;
  if (new.yp_share_enabled is distinct from old.yp_share_enabled
      or new.yp_share_token is distinct from old.yp_share_token)
     and not public.is_admin() then
    raise exception 'Only YachtPics can change the YachtPics share link.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_listing_yp_share on public.listings;
create trigger trg_protect_listing_yp_share
  before update on public.listings
  for each row execute function public.protect_listing_yp_share();
