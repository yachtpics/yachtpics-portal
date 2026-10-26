import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { serviceClient, LISTING_COLUMNS, type SlideshowListing } from "@/lib/publicSlideshow";
import { orderPhotos } from "@/lib/photoOrder";
import { websiteEntitlement } from "@/lib/websiteAddon";
import { signDerivatives } from "@/lib/photoDerivatives";
import { OG_TRANSFORM, FULL_TRANSFORM, signOneTransformed, signPhotosAtSize } from "@/lib/publicPhotoUrls";
import {
  SITE_COLUMNS,
  SITE_STYLE_COLUMNS,
  isMissingSchema,
  lengthLabel,
  normaliseSiteRow,
  normaliseSlug,
  priceLabel,
  type BrokerSiteRow,
} from "@/lib/brokerSite";

/**
 * Broker Websites (Oct 26) — SERVER ONLY.
 *
 *  - resolveActingBroker(): who the editor API is acting for (the broker
 *    themself, an assistant for a linked broker, a brokerage admin for a
 *    broker in their brokerage, or a Portal admin for ?brokerId=).
 *  - getPublicBrokerSite(): everything /b/[slug] shows, read with the service
 *    role. The page is rebuilt at most hourly, so photo links live 7 days.
 */

export const SITE_TTL = 60 * 60 * 24 * 7;
export const PORTRAIT_BUCKET = "broker-logos";

export { serviceClient };

/** Public URL of a portrait stored in the (public) broker-logos bucket. */
export function portraitUrl(svc: SupabaseClient, path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return svc.storage.from(PORTRAIT_BUCKET).getPublicUrl(path).data.publicUrl ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Who is the editor acting for?
// ─────────────────────────────────────────────────────────────────────────────

export type ActingBroker =
  | {
      ok: true;
      userId: string;
      role: "broker" | "assistant" | "admin";
      brokerId: string;
      /** Brokers an assistant can switch between (empty for brokers/admins). */
      brokers: { id: string; name: string }[];
    }
  | { ok: false; status: number; error: string };

function fullName(p: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  return [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();
}

export async function resolveActingBroker(requestedBrokerId: string | null | undefined): Promise<ActingBroker> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "Please sign in." };

  const svc = serviceClient();
  const { data: me } = await svc
    .from("profiles")
    .select("role, is_brokerage_admin, brokerage_id")
    .eq("id", user.id)
    .maybeSingle();
  const role = (me?.role ?? "broker") as string;
  const requested = typeof requestedBrokerId === "string" && /^[0-9a-f-]{36}$/i.test(requestedBrokerId) ? requestedBrokerId : null;

  if (role === "admin") {
    const brokerId = requested ?? null;
    if (!brokerId) return { ok: false, status: 400, error: "Open a broker from Admin → Brokers to edit their website." };
    const { data: b } = await svc.from("profiles").select("id, role").eq("id", brokerId).maybeSingle();
    if (!b) return { ok: false, status: 404, error: "Broker not found." };
    return { ok: true, userId: user.id, role: "admin", brokerId, brokers: [] };
  }

  if (role === "assistant") {
    const { data: links } = await svc
      .from("broker_assistants")
      .select("broker_id, profiles:broker_id(first_name, last_name)")
      .eq("assistant_id", user.id);
    const brokers = ((links ?? []) as unknown as { broker_id: string; profiles: { first_name: string | null; last_name: string | null } | null }[])
      .map((l) => ({ id: l.broker_id, name: fullName(l.profiles) || "Broker" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (brokers.length === 0) return { ok: false, status: 403, error: "You aren't linked to a broker yet." };
    const chosen = requested ? brokers.find((b) => b.id === requested) : brokers[0];
    if (!chosen) return { ok: false, status: 403, error: "You don't work for that broker." };
    return { ok: true, userId: user.id, role: "assistant", brokerId: chosen.id, brokers };
  }

  if (role === "broker") {
    if (!requested || requested === user.id) {
      return { ok: true, userId: user.id, role: "broker", brokerId: user.id, brokers: [] };
    }
    // A brokerage admin may act for a broker in their own brokerage (same
    // rule as assistant_has_access in RLS).
    if (me?.is_brokerage_admin === true && me.brokerage_id) {
      const { data: other } = await svc.from("profiles").select("brokerage_id").eq("id", requested).maybeSingle();
      if (other?.brokerage_id && other.brokerage_id === me.brokerage_id) {
        return { ok: true, userId: user.id, role: "broker", brokerId: requested, brokers: [] };
      }
    }
    // Also allow when the broker has linked this broker as an assistant.
    const { data: link } = await svc
      .from("broker_assistants")
      .select("broker_id")
      .eq("broker_id", requested)
      .eq("assistant_id", user.id)
      .maybeSingle();
    if (link) return { ok: true, userId: user.id, role: "broker", brokerId: requested, brokers: [] };
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: false, status: 403, error: "Forbidden" };
}

// ─────────────────────────────────────────────────────────────────────────────
// The public site
// ─────────────────────────────────────────────────────────────────────────────
//
// WHICH BOATS SHOW (owner decision, Oct 26 — no longer tied to a published
// slideshow): every listing of the broker that is status 'active', not sold
// (sold_at null), has at least one visible photo, is not a pocket listing
// (showcase_opt_out) and not switched off by the broker (listings.site_hidden,
// migration 20261026c — a missing column reads as "not hidden"). Recent
// sales: sold_at set, same exclusions. Each boat gets a page at
// /b/{site}/yachts/{boatSlug} showing the buyer slideshow viewer.

export type SiteCard = {
  id: string;
  name: string;
  /** "56′ (17.1 m) · 2019 · Riva Rivale" */
  specs: string;
  /** Short label for a showing request ("56′ Riva Rivale 'Angelamar'"). */
  label: string;
  price: string | null;
  location: string | null;
  photo: string | null;
  alt: string;
  /** The on-site boat page (live boats only). */
  href: string | null;
  hasVideo: boolean;
  /** "March 2026" for sold boats. */
  soldLabel: string | null;
  lengthFt: number | null;
  builder: string | null;
  priceValue: number | null;
};

/** Everything the site chrome (header, nav, About, footer) needs. */
export type SiteBase = {
  site: BrokerSiteRow;
  name: string;
  firstName: string;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  brokerageName: string | null;
  brokerageLogoUrl: string | null;
  brokerageWebsite: string | null;
  license: string | null;
  bio: string | null;
  accent: string;
  portrait: string | null;
};

export type PublicBrokerSite = SiteBase & {
  hero: string | null;
  og: string | null;
  /** Up to 5 live boat covers at slide size (Showroom's crossfading hero). */
  heroSlides: string[];
  yachts: SiteCard[];
  sold: SiteCard[];
};

type ListingRow = {
  id: string;
  vessel_name: string | null;
  year: number | null;
  length_ft: number | string | null;
  make: string | null;
  model: string | null;
  asking_price: number | string | null;
  location: string | null;
  hero_photo_id: string | null;
  photo_order_manual: boolean | null;
  created_at: string | null;
  sold_at: string | null;
  showcase_opt_out?: boolean | null;
  site_hidden?: boolean | null;
};

type SitePhoto = {
  id: string;
  listing_id: string;
  storage_path: string;
  category: string | null;
  filename: string | null;
  display_order: number | null;
  derivatives_at: string | null;
};

export type SiteBoat = {
  row: ListingRow;
  /** URL key under /b/{site}/yachts/ — from the vessel name, unique within the broker. */
  boatSlug: string;
  cover: SitePhoto | null;
  hasVideo: boolean;
  sold: boolean;
};

export type LiveSite = SiteBase & { boats: SiteBoat[] };

const LISTING_COLS =
  "id, vessel_name, year, length_ft, make, model, asking_price, location, hero_photo_id, photo_order_manual, created_at, sold_at, showcase_opt_out";

const PORTAL_GOLD = "#c39e4e";

export function safeAccent(v: string | null | undefined): string {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : PORTAL_GOLD;
}

function boatName(l: { vessel_name: string | null; year: number | null; make: string | null; model: string | null }): string {
  return (l.vessel_name ?? "").trim() || [l.year, l.make, l.model].filter(Boolean).join(" ") || "Yacht";
}

/** "56′ Riva Rivale 'Angelamar'" — for showing-request subjects. */
export function boatLabel(l: { vessel_name: string | null; length_ft: number | string | null; make: string | null; model: string | null }): string {
  const ft = Number(l.length_ft);
  const parts = [Number.isFinite(ft) && ft > 0 ? `${Math.round(ft)}′` : null, l.make, l.model].filter(Boolean).join(" ");
  const name = (l.vessel_name ?? "").trim();
  if (parts && name) return `${parts} '${name}'`;
  return parts || name || "Yacht";
}

/** "56′ (17.1 m) · 2019 · Riva Rivale" */
export function boatSpecs(l: { length_ft: number | string | null; year: number | null; make: string | null; model: string | null }): string {
  const builderModel = [l.make, l.model].filter(Boolean).join(" ");
  return [lengthLabel(l.length_ft), l.year ? String(l.year) : null, builderModel || null].filter(Boolean).join(" · ");
}

function soldMonth(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" });
}

/**
 * URL keys for the boats: the vessel name as a slug ("angelamar"); boats
 * whose names clash (or have none) get "{name}-{first 6 of the id}". The
 * page also accepts the listing id itself.
 */
export function boatSlugs(rows: { id: string; vessel_name: string | null; year: number | null; make: string | null; model: string | null }[]): Map<string, string> {
  const base = new Map<string, string>();
  const count = new Map<string, number>();
  rows.forEach((r) => {
    const b = normaliseSlug(boatName(r)).slice(0, 50) || "yacht";
    base.set(r.id, b);
    count.set(b, (count.get(b) ?? 0) + 1);
  });
  const out = new Map<string, string>();
  rows.forEach((r) => {
    const b = base.get(r.id)!;
    const short = r.id.replace(/-/g, "").slice(0, 6);
    out.set(r.id, (count.get(b) ?? 0) > 1 || b === "yacht" ? `${b}-${short}` : b);
  });
  return out;
}

/**
 * One site row by slug or broker, with the look columns when 20261026d is
 * applied (defaults otherwise). `error` = the table itself isn't there.
 */
export async function readSiteRow(by: "slug" | "broker_id", value: string): Promise<{ row: BrokerSiteRow | null; error: { code?: string; message?: string } | null }> {
  const svc = serviceClient();
  let res = await svc.from("broker_sites").select(`${SITE_COLUMNS}, ${SITE_STYLE_COLUMNS}`).eq(by, value).maybeSingle();
  if (res.error && isMissingSchema(res.error)) res = await svc.from("broker_sites").select(SITE_COLUMNS).eq(by, value).maybeSingle();
  if (res.error) return { row: null, error: res.error };
  return { row: res.data ? normaliseSiteRow(res.data as unknown as Record<string, unknown>) : null, error: null };
}

/** Load the site row by slug with the service role. Null when missing / not migrated. */
export const getSiteBySlug = cache(async (slug: string): Promise<BrokerSiteRow | null> => {
  try {
    return (await readSiteRow("slug", slug)).row;
  } catch {
    return null;
  }
});

/** The broker's candidate listings (live or sold), with site_hidden when the column exists. */
async function selectListings(svc: SupabaseClient, brokerId: string, kind: "live" | "sold"): Promise<ListingRow[]> {
  const run = async (cols: string) => {
    let q = svc.from("listings").select(cols).eq("broker_id", brokerId);
    q = kind === "live"
      ? q.eq("status", "active").is("sold_at", null).order("created_at", { ascending: false }).limit(200)
      : q.not("sold_at", "is", null).order("sold_at", { ascending: false }).limit(24);
    return q;
  };
  let res = await run(`${LISTING_COLS}, site_hidden`);
  if (res.error && isMissingSchema(res.error)) res = await run(LISTING_COLS); // before 20261026c
  if (res.error) return [];
  return ((res.data ?? []) as unknown as ListingRow[]).filter((l) => l.showcase_opt_out !== true && l.site_hidden !== true);
}

/** Visible photos of these listings (paged past the 1,000-row cap). */
async function visiblePhotos(svc: SupabaseClient, ids: string[]): Promise<Map<string, SitePhoto[]>> {
  const out = new Map<string, SitePhoto[]>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await svc
        .from("photos")
        .select("id, listing_id, storage_path, category, filename, display_order, derivatives_at")
        .in("listing_id", chunk)
        .eq("is_visible", true)
        .order("id")
        .range(from, from + 999);
      if (error) break;
      const rows = (data ?? []) as SitePhoto[];
      rows.forEach((p) => {
        const list = out.get(p.listing_id) ?? [];
        list.push(p);
        out.set(p.listing_id, list);
      });
      if (rows.length < 1000) break;
    }
  }
  return out;
}

/** Listings that have at least one video shown in the slideshow. */
async function listingsWithVideo(svc: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await svc.from("videos").select("listing_id").in("listing_id", ids.slice(i, i + 100)).eq("in_slideshow", true);
    ((data ?? []) as { listing_id: string }[]).forEach((v) => out.add(v.listing_id));
  }
  return out;
}

/**
 * The site and its boats, or null when the site must not show: no such slug,
 * unpublished, or not entitled (websiteEntitlement — Portal access AND Elite /
 * the website line on their plan / a comp). No photo signing here; shared by
 * the home page and every boat page (cached per request).
 */
export const getLiveSite = cache(async (slug: string): Promise<LiveSite | null> => {
  const site = await getSiteBySlug(slug);
  if (!site || !site.published) return null;
  const svc = serviceClient();
  try {
    const ent = await websiteEntitlement(svc, site.broker_id);
    if (!ent.live) return null;
  } catch {
    return null;
  }
  return buildLiveSite(site);
});

/**
 * The site WITHOUT the published / entitlement checks — only for a preview
 * the caller has already authorised (the owner, their assistant or an admin;
 * see /b/[slug]/preview).
 */
export async function getSiteForPreview(slug: string): Promise<LiveSite | null> {
  const site = await getSiteBySlug(slug);
  return site ? buildLiveSite(site) : null;
}

async function buildLiveSite(site: BrokerSiteRow): Promise<LiveSite> {
  const svc = serviceClient();

  const [{ data: profile }, { data: details }, live, soldAll] = await Promise.all([
    svc.from("profiles").select("first_name, last_name, phone, display_email").eq("id", site.broker_id).maybeSingle(),
    svc.from("broker_details").select("*").eq("id", site.broker_id).maybeSingle(),
    selectListings(svc, site.broker_id, "live"),
    selectListings(svc, site.broker_id, "sold"),
  ]);
  const sold = site.sections.sold ? soldAll : [];
  const all = live.concat(sold);
  const ids = all.map((l) => l.id);
  const [photos, withVideo] = await Promise.all([visiblePhotos(svc, ids), listingsWithVideo(svc, ids)]);

  // At least one visible photo; the cover is the same first photo the buyer slideshow opens on.
  const shown = all.filter((l) => (photos.get(l.id)?.length ?? 0) > 0);
  const slugs = boatSlugs(shown);
  const soldIds = new Set(sold.map((l) => l.id));
  const boats: SiteBoat[] = shown.map((l) => ({
    row: l,
    boatSlug: slugs.get(l.id)!,
    cover: orderPhotos(photos.get(l.id) ?? [], { manual: l.photo_order_manual === true, heroId: l.hero_photo_id })[0] ?? null,
    hasVideo: withVideo.has(l.id),
    sold: soldIds.has(l.id),
  }));

  const d = (details ?? {}) as Record<string, string | null>;
  const first = (profile?.first_name ?? "").trim();
  const name = [first, (profile?.last_name ?? "").trim()].filter(Boolean).join(" ") || "Yacht Broker";
  return {
    site,
    name,
    firstName: first || name.split(" ")[0],
    phone: (profile?.phone ?? "").trim() || null,
    email: (profile?.display_email ?? "").trim() || null,
    logoUrl: d.logo_url || null,
    brokerageName: (d.brokerage_name ?? "").trim() || null,
    brokerageLogoUrl: d.brokerage_logo_url || null,
    brokerageWebsite: (d.brokerage_website ?? "").trim() || null,
    license: (d.license_number ?? "").trim() || null,
    bio: (d.bio ?? "").trim() || null,
    accent: safeAccent(d.brand_accent),
    portrait: portraitUrl(svc, site.portrait_path),
    boats,
  };
}

/** A live (for-sale) boat on the site by its URL key or listing id. Sold boats have no page. */
export function findSiteBoat(live: LiveSite, key: string): SiteBoat | null {
  const k = decodeURIComponent(key).toLowerCase();
  return live.boats.find((b) => !b.sold && (b.boatSlug === k || b.row.id === k)) ?? null;
}

/**
 * Light check for the boat page's link-refresh route (called several times a
 * visit, so it doesn't load the whole site): the site is live and this
 * listing (by id) passes the site rule. Returns the listing or null.
 */
export async function siteBoatListingById(slug: string, listingId: string): Promise<SlideshowListing | null> {
  if (!/^[0-9a-f-]{36}$/i.test(listingId)) return null;
  const site = await getSiteBySlug(slug);
  if (!site || !site.published) return null;
  const svc = serviceClient();
  try {
    if (!(await websiteEntitlement(svc, site.broker_id)).live) return null;
  } catch {
    return null;
  }
  const run = (cols: string) => svc.from("listings").select(cols).eq("id", listingId).maybeSingle();
  let res = await run(`${LISTING_COLUMNS}, status, sold_at, showcase_opt_out, site_hidden`);
  if (res.error && isMissingSchema(res.error)) res = await run(`${LISTING_COLUMNS}, status, sold_at, showcase_opt_out`);
  const l = res.data as unknown as (SlideshowListing & { status: string | null; sold_at: string | null; showcase_opt_out: boolean | null; site_hidden?: boolean | null }) | null;
  if (!l || l.broker_id !== site.broker_id) return null;
  if (l.status !== "active" || l.sold_at || l.showcase_opt_out === true || l.site_hidden === true) return null;
  return l;
}

/** The full listing row the slideshow viewer needs (same columns as /s). */
export async function getSiteBoatListing(listingId: string): Promise<SlideshowListing | null> {
  const { data } = await serviceClient().from("listings").select(LISTING_COLUMNS).eq("id", listingId).maybeSingle();
  return (data as SlideshowListing | null) ?? null;
}

export function siteCard(live: LiveSite, b: SiteBoat, photoUrl: string | null): SiteCard {
  const l = b.row;
  const name = boatName(l);
  const lengthFt = Number(l.length_ft);
  const priceValue = Number(l.asking_price);
  return {
    id: l.id,
    name,
    specs: boatSpecs(l),
    label: boatLabel(l),
    price: !b.sold && live.site.show_prices ? priceLabel(l.asking_price) : null,
    location: (l.location ?? "").trim() || null,
    photo: photoUrl,
    alt: name,
    href: b.sold ? null : `/b/${live.site.slug}/yachts/${b.boatSlug}`,
    hasVideo: b.hasVideo,
    soldLabel: b.sold ? soldMonth(l.sold_at) : null,
    lengthFt: Number.isFinite(lengthFt) && lengthFt > 0 ? lengthFt : null,
    builder: (l.make ?? "").trim() || null,
    priceValue: Number.isFinite(priceValue) && priceValue > 0 ? priceValue : null,
  };
}

/**
 * Everything the home page renders (getLiveSite + signed covers and hero),
 * or null when the site must not show.
 */
export const getPublicBrokerSite = cache(async (slug: string): Promise<PublicBrokerSite | null> => {
  const live = await getLiveSite(slug);
  return live ? buildPublicSite(live) : null;
});

/** getPublicBrokerSite for an authorised preview (no published / entitlement checks). */
export async function getPreviewBrokerSite(slug: string): Promise<PublicBrokerSite | null> {
  const live = await getSiteForPreview(slug);
  return live ? buildPublicSite(live) : null;
}

async function buildPublicSite(live: LiveSite): Promise<PublicBrokerSite> {
  const svc = serviceClient();
  const { site } = live;

  const covers = live.boats.map((b) => b.cover).filter((c): c is SitePhoto => !!c);
  const coverUrls = await signPhotosAtSize(svc, covers, "thumb", SITE_TTL).catch(() => ({} as Record<string, string>));
  const cards = live.boats.map((b) => ({ b, card: siteCard(live, b, b.cover ? coverUrls[b.cover.id] ?? null : null) }));

  // Hero: the broker's chosen photo (only if it belongs to one of their
  // listings), else the cover of the newest live boat.
  let heroPhoto: { id: string; storage_path: string; derivatives_at: string | null } | null = null;
  if (site.hero_photo_id) {
    const { data: p } = await svc
      .from("photos")
      .select("id, storage_path, derivatives_at, listings:listing_id(broker_id)")
      .eq("id", site.hero_photo_id)
      .maybeSingle();
    const owner = (p as unknown as { listings: { broker_id: string } | null } | null)?.listings?.broker_id;
    if (p && owner === site.broker_id) heroPhoto = { id: p.id, storage_path: p.storage_path, derivatives_at: p.derivatives_at };
  }
  if (!heroPhoto) heroPhoto = live.boats.find((b) => !b.sold && b.cover)?.cover ?? null;

  let hero: string | null = null;
  let og: string | null = null;
  if (heroPhoto) {
    const [{ urls }, ogSigned] = await Promise.all([
      signDerivatives(svc, [heroPhoto], 2000, SITE_TTL).catch(() => ({ urls: {} as Record<string, string>, missing: [] })),
      signOneTransformed(svc, heroPhoto.storage_path, OG_TRANSFORM, SITE_TTL),
    ]);
    hero = urls[heroPhoto.id] ?? (await signOneTransformed(svc, heroPhoto.storage_path, FULL_TRANSFORM, SITE_TTL));
    og = ogSigned;
  }

  // Showroom's hero crossfades through up to 5 boat covers at slide size
  // (one batch for stored derivatives; the per-photo fallback only for the rest).
  const slideCovers = live.boats.filter((b) => !b.sold && b.cover).slice(0, 5).map((b) => b.cover!) as SitePhoto[];
  const slideUrls = slideCovers.length ? await signPhotosAtSize(svc, slideCovers, "full", SITE_TTL).catch(() => ({} as Record<string, string>)) : {};
  const heroSlides = slideCovers.map((c) => slideUrls[c.id]).filter((u): u is string => !!u);

  const { boats: _boats, ...base } = live;
  void _boats;
  return {
    ...base,
    hero,
    og,
    heroSlides,
    yachts: cards.filter((c) => !c.b.sold).map((c) => c.card),
    sold: cards.filter((c) => c.b.sold).map((c) => c.card),
  };
}
