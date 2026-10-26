import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { serviceClient, getSlideshowRows } from "@/lib/publicSlideshow";
import { websiteEntitlement } from "@/lib/websiteAddon";
import { signDerivatives } from "@/lib/photoDerivatives";
import { OG_TRANSFORM, FULL_TRANSFORM, signOneTransformed, signPhotosAtSize } from "@/lib/publicPhotoUrls";
import {
  SITE_COLUMNS,
  isMissingSchema,
  lengthLabel,
  normaliseSiteRow,
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
// The public page
// ─────────────────────────────────────────────────────────────────────────────

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
  href: string | null;
  hasVideo: boolean;
  /** "March 2026" for sold boats. */
  soldLabel: string | null;
  lengthFt: number | null;
  builder: string | null;
  priceValue: number | null;
};

export type PublicBrokerSite = {
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
  hero: string | null;
  og: string | null;
  portrait: string | null;
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
  slideshow_slug: string | null;
  slideshow_published: boolean | null;
  hero_photo_id: string | null;
  photo_order_manual: boolean | null;
  created_at: string | null;
  sold_at: string | null;
  showcase_opt_out?: boolean | null;
};

const LISTING_COLS =
  "id, vessel_name, year, length_ft, make, model, asking_price, location, slideshow_slug, slideshow_published, hero_photo_id, photo_order_manual, created_at, sold_at, showcase_opt_out";

const PORTAL_GOLD = "#c39e4e";

export function safeAccent(v: string | null | undefined): string {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : PORTAL_GOLD;
}

function boatName(l: ListingRow): string {
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

function soldMonth(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" });
}

/** Load the site row by slug with the service role. Null when missing / not migrated. */
export const getSiteBySlug = cache(async (slug: string): Promise<BrokerSiteRow | null> => {
  try {
    const { data, error } = await serviceClient().from("broker_sites").select(SITE_COLUMNS).eq("slug", slug).maybeSingle();
    if (error || !data) return null;
    return normaliseSiteRow(data as unknown as Record<string, unknown>);
  } catch {
    return null;
  }
});

/**
 * Everything the public page renders, or null when the page must not show
 * (no such site, unpublished, not entitled — no Portal access, or neither
 * Elite, the website line on their plan nor a comp — or the tables aren't there yet).
 */
export const getPublicBrokerSite = cache(async (slug: string): Promise<PublicBrokerSite | null> => {
  const site = await getSiteBySlug(slug);
  if (!site || !site.published) return null;
  const svc = serviceClient();

  // Live only with Portal access AND (Elite, the website line on their plan, or a comp) —
  // websiteEntitlement in src/lib/websiteAddon.ts (owner decision, Oct 26).
  try {
    const ent = await websiteEntitlement(svc, site.broker_id);
    if (!ent.live) return null;
  } catch {
    return null;
  }

  const [{ data: profile }, { data: details }, liveRes, soldRes] = await Promise.all([
    svc.from("profiles").select("first_name, last_name, phone, display_email").eq("id", site.broker_id).maybeSingle(),
    svc.from("broker_details").select("*").eq("id", site.broker_id).maybeSingle(),
    svc
      .from("listings")
      .select(LISTING_COLS)
      .eq("broker_id", site.broker_id)
      .eq("status", "active")
      .eq("slideshow_published", true)
      .is("sold_at", null)
      .order("created_at", { ascending: false })
      .limit(60),
    svc
      .from("listings")
      .select(LISTING_COLS)
      .eq("broker_id", site.broker_id)
      .not("sold_at", "is", null)
      .order("sold_at", { ascending: false })
      .limit(12),
  ]);
  if (liveRes.error && isMissingSchema(liveRes.error)) return null;

  // Pocket listings ("Keep this a pocket listing") stay off the public site.
  const live = ((liveRes.data ?? []) as ListingRow[]).filter((l) => l.showcase_opt_out !== true && l.slideshow_slug);
  const sold = site.sections.sold ? ((soldRes.data ?? []) as ListingRow[]).filter((l) => l.showcase_opt_out !== true) : [];

  // Covers: the same first photo the buyer slideshow opens on.
  const all = live.concat(sold);
  const rows = await Promise.all(
    all.map((l) => getSlideshowRows(l.id, l.photo_order_manual === true, l.hero_photo_id).catch(() => ({ photos: [], videos: [] })))
  );
  const coverById = new Map<string, { id: string; storage_path: string; derivatives_at: string | null }>();
  const videoById = new Map<string, boolean>();
  all.forEach((l, i) => {
    const c = rows[i].photos[0];
    if (c) coverById.set(l.id, { id: c.id, storage_path: c.storage_path, derivatives_at: c.derivatives_at });
    videoById.set(l.id, rows[i].videos.length > 0);
  });
  const coverUrls = await signPhotosAtSize(svc, Array.from(coverById.values()), "thumb", SITE_TTL).catch(() => ({} as Record<string, string>));

  const toCard = (l: ListingRow, isSold: boolean): SiteCard => {
    const cover = coverById.get(l.id);
    const name = boatName(l);
    const builderModel = [l.make, l.model].filter(Boolean).join(" ");
    const specs = [lengthLabel(l.length_ft), l.year ? String(l.year) : null, builderModel || null].filter(Boolean).join(" · ");
    const lengthFt = Number(l.length_ft);
    const priceValue = Number(l.asking_price);
    return {
      id: l.id,
      name,
      specs,
      label: boatLabel(l),
      price: !isSold && site.show_prices ? priceLabel(l.asking_price) : null,
      location: (l.location ?? "").trim() || null,
      photo: cover ? coverUrls[cover.id] ?? null : null,
      alt: name,
      href: l.slideshow_published && l.slideshow_slug ? `/s/${l.slideshow_slug}` : null,
      hasVideo: videoById.get(l.id) === true,
      soldLabel: isSold ? soldMonth(l.sold_at) : null,
      lengthFt: Number.isFinite(lengthFt) && lengthFt > 0 ? lengthFt : null,
      builder: (l.make ?? "").trim() || null,
      priceValue: Number.isFinite(priceValue) && priceValue > 0 ? priceValue : null,
    };
  };

  // Hero: the broker's chosen photo (only if it belongs to one of their
  // listings), else the cover of the first live listing.
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
  if (!heroPhoto && live.length > 0) heroPhoto = coverById.get(live[0].id) ?? null;

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
    hero,
    og,
    portrait: portraitUrl(svc, site.portrait_path),
    yachts: live.map((l) => toCard(l, false)),
    sold: sold.map((l) => toCard(l, true)),
  };
});
