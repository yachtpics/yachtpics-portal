import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { websiteEntitlement } from "@/lib/websiteAddon";
import { signPhotosAtSize } from "@/lib/publicPhotoUrls";
import { orderPhotos } from "@/lib/photoOrder";
import { resolveActingBroker, serviceClient, portraitUrl } from "@/lib/brokerSiteServer";
import {
  SITE_COLUMNS,
  SITE_LIMITS,
  cleanSections,
  cleanStats,
  cleanTestimonials,
  isMissingSchema,
  lengthLabel,
  normaliseSiteRow,
  normaliseSlug,
  slugProblem,
  suggestSlug,
  type BrokerSiteRow,
} from "@/lib/brokerSite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Broker Websites editor API (Oct 26).
 *
 *   GET  ?brokerId=                 the site row, the broker's boats and their status
 *   GET  ?brokerId=&photos=<listing> 600px thumbnails of one listing (hero picker)
 *   PUT  {fields…}                  save the editor
 *   POST {action:"check_slug", slug}  is this address free?
 *   POST {action:"claim_slug", slug}  create the site (or move it to a new address)
 *   POST {action:"mark_sold", listingId, sold}  set / clear listings.sold_at
 *
 * Caller: the broker, their assistant, a brokerage admin of their brokerage,
 * or a Portal admin acting for ?brokerId= (resolveActingBroker). Everything
 * runs with the service role after that check.
 *
 * Before 20261026_broker_sites.sql is applied every call answers
 * { ready: false } (GET) or 503, and the editor says so.
 */

const NOT_READY = { error: "Website isn't switched on yet.", ready: false };

function revalidateSite(...slugs: (string | null | undefined)[]) {
  slugs.forEach((s) => {
    if (s) {
      try { revalidatePath(`/b/${s}`); } catch { /* not fatal */ }
    }
  });
}

async function readSite(brokerId: string): Promise<{ ready: boolean; site: BrokerSiteRow | null }> {
  const { data, error } = await serviceClient().from("broker_sites").select(SITE_COLUMNS).eq("broker_id", brokerId).maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return { ready: false, site: null };
    throw new Error(error.message);
  }
  return { ready: true, site: data ? normaliseSiteRow(data as unknown as Record<string, unknown>) : null };
}

async function slugTaken(slug: string, brokerId: string): Promise<boolean> {
  const { data } = await serviceClient().from("broker_sites").select("broker_id").eq("slug", slug).maybeSingle();
  return !!data && data.broker_id !== brokerId;
}

export async function GET(req: NextRequest) {
  const who = await resolveActingBroker(req.nextUrl.searchParams.get("brokerId"));
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  const svc = serviceClient();
  const brokerId = who.brokerId;

  // Billing page: just the website billing state.
  if (req.nextUrl.searchParams.get("summary") === "1") {
    const entitlement = await websiteEntitlement(svc, brokerId).catch(() => null);
    return NextResponse.json({ entitlement, canBuy: who.role === "broker" && who.brokerId === who.userId });
  }

  // Hero picker: thumbnails of one of this broker's listings.
  const photosFor = req.nextUrl.searchParams.get("photos");
  if (photosFor) {
    const { data: listing } = await svc.from("listings").select("id, broker_id, photo_order_manual, hero_photo_id").eq("id", photosFor).maybeSingle();
    if (!listing || listing.broker_id !== brokerId) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    const { data: photos } = await svc
      .from("photos")
      .select("id, storage_path, category, filename, display_order, derivatives_at")
      .eq("listing_id", listing.id)
      .eq("is_visible", true)
      .order("display_order")
      .limit(400);
    const ordered = orderPhotos((photos ?? []) as { id: string; storage_path: string; category: string | null; filename: string | null; display_order: number | null; derivatives_at: string | null }[], {
      manual: listing.photo_order_manual === true,
      heroId: listing.hero_photo_id,
    }).slice(0, 120);
    const urls = await signPhotosAtSize(svc, ordered, "thumb", 60 * 60 * 2, { fallbackLimit: 24 });
    return NextResponse.json({
      photos: ordered.map((p) => ({ id: p.id, url: urls[p.id] ?? null, category: p.category })).filter((p) => p.url),
    });
  }

  let site: BrokerSiteRow | null = null;
  let ready = true;
  try {
    ({ ready, site } = await readSite(brokerId));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't load your website." }, { status: 500 });
  }

  const [{ data: profile }, { data: details }, access] = await Promise.all([
    svc.from("profiles").select("first_name, last_name, phone, display_email").eq("id", brokerId).maybeSingle(),
    svc.from("broker_details").select("*").eq("id", brokerId).maybeSingle(),
    websiteEntitlement(svc, brokerId).catch(() => null),
  ]);
  const d = (details ?? {}) as Record<string, string | null>;

  // Boats: every active listing plus anything marked sold.
  let listingRows: Record<string, unknown>[] = [];
  const cols = "id, vessel_name, year, length_ft, make, model, status, slideshow_published, slideshow_slug, showcase_opt_out, created_at, hero_photo_id";
  if (ready) {
    const [activeRes, soldRes] = await Promise.all([
      svc.from("listings").select(cols + ", sold_at").eq("broker_id", brokerId).eq("status", "active").order("created_at", { ascending: false }).limit(200),
      svc.from("listings").select(cols + ", sold_at").eq("broker_id", brokerId).neq("status", "active").not("sold_at", "is", null).order("sold_at", { ascending: false }).limit(50),
    ]);
    listingRows = ((activeRes.data ?? []) as unknown as Record<string, unknown>[]).concat((soldRes.data ?? []) as unknown as Record<string, unknown>[]);
  } else {
    const { data } = await svc.from("listings").select(cols).eq("broker_id", brokerId).eq("status", "active").order("created_at", { ascending: false }).limit(200);
    listingRows = (data ?? []) as unknown as Record<string, unknown>[];
  }

  const listings = listingRows.map((l) => {
    const soldAt = (l.sold_at as string | null) ?? null;
    const published = l.slideshow_published === true && !!l.slideshow_slug;
    const pocket = l.showcase_opt_out === true;
    const name = String(l.vessel_name ?? "").trim() || [l.year, l.make, l.model].filter(Boolean).join(" ") || "Untitled listing";
    const specs = [lengthLabel(l.length_ft as number | null), l.year ? String(l.year) : null, [l.make, l.model].filter(Boolean).join(" ") || null].filter(Boolean).join(" · ");
    const state: "on_site" | "unpublished" | "sold" | "pocket" = soldAt ? "sold" : pocket ? "pocket" : published && l.status === "active" ? "on_site" : "unpublished";
    return { id: String(l.id), name, specs, status: String(l.status ?? ""), soldAt, state, slideshowSlug: published ? String(l.slideshow_slug) : null };
  });

  // The chosen hero's thumbnail, for the editor's preview.
  let heroThumb: string | null = null;
  if (site?.hero_photo_id) {
    const { data: hp } = await svc.from("photos").select("id, storage_path, derivatives_at").eq("id", site.hero_photo_id).maybeSingle();
    if (hp) heroThumb = (await signPhotosAtSize(svc, [hp], "thumb", 60 * 60 * 2).catch(() => ({} as Record<string, string>)))[hp.id] ?? null;
  }

  return NextResponse.json({
    ready,
    heroThumb,
    brokerId,
    role: who.role,
    brokers: who.brokers,
    // Whether the site can be live (owner decision Oct 26: Portal access AND
    // Elite / the website line on their plan / comp), and whether this caller
    // may change the broker's plan (the broker only).
    hasAccess: access ? access.portalAccess : true,
    entitlement: access,
    // Plan changes are the broker's own (like the plan checkout / billing portal).
    canBuy: who.role === "broker" && who.brokerId === who.userId,
    isSelf: who.brokerId === who.userId,
    site,
    suggestedSlug: suggestSlug(profile?.first_name, profile?.last_name),
    broker: {
      name: [profile?.first_name, profile?.last_name].filter(Boolean).join(" "),
      firstName: profile?.first_name ?? "",
      phone: profile?.phone ?? "",
      email: profile?.display_email ?? "",
      bio: d.bio ?? "",
      logoUrl: d.logo_url ?? null,
      brokerageName: d.brokerage_name ?? "",
      license: d.license_number ?? "",
    },
    portraitUrl: site ? portraitUrl(svc, site.portrait_path) : null,
    listings,
  });
}

export async function PUT(req: NextRequest) {
  const who = await resolveActingBroker(req.nextUrl.searchParams.get("brokerId"));
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  const svc = serviceClient();
  const brokerId = who.brokerId;

  let current: BrokerSiteRow | null;
  try {
    const r = await readSite(brokerId);
    if (!r.ready) return NextResponse.json(NOT_READY, { status: 503 });
    current = r.site;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't save." }, { status: 500 });
  }
  if (!current) return NextResponse.json({ error: "Create your website first." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim().slice(0, max);
    return t || null;
  };

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("headline" in body) update.headline = text(body.headline, SITE_LIMITS.headline);
  if ("specialty" in body) update.specialty = text(body.specialty, SITE_LIMITS.specialty);
  if ("credentials" in body) update.credentials = text(body.credentials, SITE_LIMITS.credentials);
  if ("whatsapp" in body) {
    const w = text(body.whatsapp, SITE_LIMITS.whatsapp);
    if (w && w.replace(/\D/g, "").length < 8) return NextResponse.json({ error: "WhatsApp needs the full number with country code, e.g. +1 561 555 0100.", field: "whatsapp" }, { status: 400 });
    update.whatsapp = w;
  }
  if ("stats" in body) update.stats = cleanStats(body.stats);
  if ("testimonials" in body) update.testimonials = cleanTestimonials(body.testimonials);
  if ("sections" in body) update.sections = cleanSections(body.sections);
  if ("show_prices" in body) update.show_prices = body.show_prices === true;
  if ("published" in body) update.published = body.published === true;

  if ("hero_photo_id" in body) {
    const id = body.hero_photo_id;
    if (id === null || id === "") {
      update.hero_photo_id = null;
    } else if (typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) {
      const { data: p } = await svc.from("photos").select("id, listings:listing_id(broker_id)").eq("id", id).maybeSingle();
      const owner = (p as unknown as { listings: { broker_id: string } | null } | null)?.listings?.broker_id;
      if (!p || owner !== brokerId) return NextResponse.json({ error: "That photo isn't one of your listings.", field: "hero" }, { status: 400 });
      update.hero_photo_id = id;
    }
  }

  const { data, error } = await svc.from("broker_sites").update(update).eq("broker_id", brokerId).select(SITE_COLUMNS).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Bio lives on broker_details (the same field the slideshow uses).
  if (typeof body.bio === "string") {
    const bio = body.bio.trim().slice(0, SITE_LIMITS.bio);
    const { error: bioErr } = await svc.from("broker_details").update({ bio: bio || null }).eq("id", brokerId);
    if (bioErr) return NextResponse.json({ error: `Saved, but the bio didn't: ${bioErr.message}`, field: "bio" }, { status: 500 });
  }

  const site = data ? normaliseSiteRow(data as unknown as Record<string, unknown>) : current;
  revalidateSite(site.slug);
  return NextResponse.json({ ok: true, site, portraitUrl: portraitUrl(svc, site.portrait_path) });
}

export async function POST(req: NextRequest) {
  const who = await resolveActingBroker(req.nextUrl.searchParams.get("brokerId"));
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  const svc = serviceClient();
  const brokerId = who.brokerId;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");

  let current: BrokerSiteRow | null;
  try {
    const r = await readSite(brokerId);
    if (!r.ready) return NextResponse.json(NOT_READY, { status: 503 });
    current = r.site;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }

  if (action === "check_slug" || action === "claim_slug") {
    const slug = normaliseSlug(String(body.slug ?? ""));
    const problem = slugProblem(slug);
    if (problem) return NextResponse.json({ available: false, slug, error: problem }, { status: action === "check_slug" ? 200 : 400 });
    if (current?.slug === slug) return NextResponse.json({ available: true, slug, site: current });
    if (await slugTaken(slug, brokerId)) {
      return NextResponse.json({ available: false, slug, error: "That address is taken. Try adding a middle initial or your city." }, { status: action === "check_slug" ? 200 : 409 });
    }
    if (action === "check_slug") return NextResponse.json({ available: true, slug });

    if (current) {
      const { data, error } = await svc
        .from("broker_sites")
        .update({ slug, updated_at: new Date().toISOString() })
        .eq("broker_id", brokerId)
        .select(SITE_COLUMNS)
        .maybeSingle();
      if (error) {
        const taken = /duplicate|unique/i.test(error.message);
        return NextResponse.json({ available: false, slug, error: taken ? "That address is taken." : error.message }, { status: taken ? 409 : 500 });
      }
      revalidateSite(current.slug, slug);
      return NextResponse.json({ ok: true, available: true, slug, site: data ? normaliseSiteRow(data as unknown as Record<string, unknown>) : null });
    }

    const { data, error } = await svc
      .from("broker_sites")
      .insert({ broker_id: brokerId, slug })
      .select(SITE_COLUMNS)
      .maybeSingle();
    if (error) {
      const taken = /duplicate|unique/i.test(error.message);
      return NextResponse.json({ available: false, slug, error: taken ? "That address is taken." : error.message }, { status: taken ? 409 : 500 });
    }
    revalidateSite(slug);
    return NextResponse.json({ ok: true, available: true, slug, site: data ? normaliseSiteRow(data as unknown as Record<string, unknown>) : null });
  }

  if (action === "mark_sold") {
    const listingId = String(body.listingId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(listingId)) return NextResponse.json({ error: "Listing not found." }, { status: 400 });
    const { data: listing } = await svc.from("listings").select("id, broker_id").eq("id", listingId).maybeSingle();
    if (!listing || listing.broker_id !== brokerId) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    const soldAt = body.sold === true ? new Date().toISOString() : null;
    const { error } = await svc.from("listings").update({ sold_at: soldAt }).eq("id", listingId);
    if (error) return NextResponse.json({ error: isMissingSchema(error) ? NOT_READY.error : error.message }, { status: isMissingSchema(error) ? 503 : 500 });
    revalidateSite(current?.slug);
    return NextResponse.json({ ok: true, soldAt });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
