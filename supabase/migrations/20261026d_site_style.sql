-- Oct 26, 2026 — Broker Websites: layout + colours chosen by the broker.
--
--   layout   classic | editorial | showroom (same content, different composition)
--   palette  one of the curated palettes in src/lib/siteStyle.ts
--            (harbor, ivory, slate, teak, midnight, coastal); unknown → harbor
--   accent   hex (#rrggbb) overriding only the palette's accent — the broker's
--            brand colour or a custom pick; null = the palette's own accent.
--            The site nudges its lightness for legibility, never rejects it.
--   ground   hex page background override; null = the palette's. Reserved:
--            the editor doesn't offer it yet, and the site only honours one
--            that keeps the palette's light/dark character.
--
-- Additive; safe to run more than once. Requires 20261026_broker_sites.sql and
-- 20261026b_website_addon.sql (which introduced the column-level grant).

alter table public.broker_sites add column if not exists layout text not null default 'classic';
alter table public.broker_sites add column if not exists palette text not null default 'harbor';
alter table public.broker_sites add column if not exists accent text;
alter table public.broker_sites add column if not exists ground text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'broker_sites_layout_check') then
    alter table public.broker_sites add constraint broker_sites_layout_check
      check (layout in ('classic', 'editorial', 'showroom'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'broker_sites_accent_hex') then
    alter table public.broker_sites add constraint broker_sites_accent_hex
      check (accent is null or accent ~ '^#[0-9a-fA-F]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'broker_sites_ground_hex') then
    alter table public.broker_sites add constraint broker_sites_ground_hex
      check (ground is null or ground ~ '^#[0-9a-fA-F]{6}$');
  end if;
end $$;

-- Brokers / assistants may edit these like the other content columns
-- (billing columns stay server-only — see 20261026b).
revoke update on public.broker_sites from authenticated;
grant update (slug, published, headline, specialty, hero_photo_id, portrait_path, stats, credentials,
              testimonials, show_prices, whatsapp, sections, updated_at,
              layout, palette, accent, ground)
  on public.broker_sites to authenticated;
