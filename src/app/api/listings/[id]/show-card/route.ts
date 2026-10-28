import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildDockCardPdf, imageKind, pdfSafe, type DockCardImage, type DockCardSize } from "@/lib/dockCardPdf";
import { dockCardUrl, getCurrentShows, showDatesLabel, type BoatShow } from "@/lib/boatShows";
import { lookupPhotoPaths, resizedOriginalBytes } from "@/lib/photoStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/listings/[id]/show-card?show=flibs26&size=5x7|letter
 *
 * A print-ready dock card PDF for a boat at a show (src/lib/dockCardPdf.ts).
 * Access: anyone who can read the listing (RLS read under their session).
 * Needs a published slideshow — the QR opens it:
 *   https://portal.yachtpics.com/s/{slug}?from={show}#video
 * Cover = the listing's chosen cover (else first visible photo), fetched
 * server-side as a ≤2000 px JPEG/PNG transform of the original (the stored
 * 2000 px copies are WebP, which PDFs can't carry).
 */

const FETCH_TIMEOUT_MS = 12_000;

async function fetchBytes(url: string, accept?: string): Promise<Uint8Array | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: accept ? { Accept: accept } : undefined, cache: "no-store" });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function asImage(bytes: Uint8Array | null): DockCardImage | null {
  if (!bytes) return null;
  const kind = imageKind(bytes);
  return kind ? { bytes, kind } : null;
}

async function coverPhoto(svc: SupabaseClient, listingId: string): Promise<DockCardImage | null> {
  const { data } = await svc.rpc("listing_hero_photos", { p_listing_ids: [listingId] });
  const path = ((data ?? []) as { storage_path: string }[])[0]?.storage_path;
  if (!path) return null;
  // Original on R2 (Oct 28): a 2000 px JPEG/PNG made server side from it
  // (resizedOriginalBytes — the full-size file is never the fallback).
  const row = (await lookupPhotoPaths(svc, [path])).get(path);
  if (row?.storage_backend === "r2") {
    const bytes = await resizedOriginalBytes(svc, path, 2000, 85);
    return bytes ? asImage(bytes) : null;
  }
  const bucket = svc.storage.from("listing-photos");
  // Resized, upright (transforms honour EXIF), and in the original's format —
  // asking for JPEG/PNG keeps Supabase from answering in WebP.
  const { data: signed } = await bucket.createSignedUrl(path, 120, {
    transform: { width: 2000, height: 2000, resize: "contain", quality: 85 },
  });
  if (signed?.signedUrl) {
    const img = asImage(await fetchBytes(signed.signedUrl, "image/jpeg,image/png;q=0.9"));
    if (img) return img;
  }
  // Fallback: the original file (still JPEG/PNG only).
  const { data: blob } = await bucket.download(path);
  if (!blob || blob.size > 25 * 1024 * 1024) return null;
  return asImage(new Uint8Array(await blob.arrayBuffer()));
}

/** Broker logos are public files in our own Supabase storage; fetch nothing else. */
async function brokerLogo(url: string | null): Promise<DockCardImage | null> {
  if (!url) return null;
  try {
    const u = new URL(url);
    const ours = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host;
    if (u.protocol !== "https:" || u.host !== ours) return null;
  } catch {
    return null;
  }
  return asImage(await fetchBytes(url, "image/png,image/jpeg;q=0.9"));
}

function fileName(vessel: string, show: string, size: DockCardSize): string {
  const base = `${vessel} - ${show} dock card${size === "letter" ? " (letter)" : ""}`;
  return base.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim() || "dock-card";
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // Readers only: the listings RLS decides.
  const { data: listing } = await supabase
    .from("listings")
    .select("id, vessel_name, year, length_ft, make, model, broker_id, slideshow_slug, slideshow_published")
    .eq("id", params.id)
    .maybeSingle();
  if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  if (!listing.slideshow_published || !listing.slideshow_slug) {
    return NextResponse.json({ error: "Publish the slideshow first." }, { status: 409 });
  }

  const size: DockCardSize = req.nextUrl.searchParams.get("size") === "letter" ? "letter" : "5x7";
  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Which show: ?show=, else the current show this boat is marked for, else
  // the first current show.
  const wanted = req.nextUrl.searchParams.get("show");
  let show: BoatShow | null = null;
  if (wanted && /^[a-z0-9_-]{1,40}$/i.test(wanted)) {
    const { data } = await svc
      .from("boat_shows")
      .select("key, name, short_name, starts_on, ends_on, city, is_active")
      .eq("key", wanted)
      .maybeSingle();
    show = (data as BoatShow | null) ?? null;
  } else {
    const current = await getCurrentShows(svc);
    if (current.length) {
      const { data: marked } = await svc
        .from("listing_show_entries")
        .select("show_key")
        .eq("listing_id", listing.id)
        .in("show_key", current.map((s) => s.key));
      const markedKeys = new Set((marked ?? []).map((r) => r.show_key as string));
      show = current.find((s) => markedKeys.has(s.key)) ?? current[0];
    }
  }
  if (!show) return NextResponse.json({ error: "No boat show to make a card for." }, { status: 400 });

  const [{ data: entry }, { data: profile }, { data: details }, photo] = await Promise.all([
    svc.from("listing_show_entries").select("location").eq("listing_id", listing.id).eq("show_key", show.key).maybeSingle(),
    svc.from("profiles").select("first_name, last_name, phone, display_email").eq("id", listing.broker_id).maybeSingle(),
    svc.from("broker_details").select("brokerage_name, logo_url, brand_accent, brand_ground").eq("id", listing.broker_id).maybeSingle(),
    coverPhoto(svc, listing.id),
  ]);
  const logo = await brokerLogo((details?.logo_url as string | null) ?? null);

  const brokerName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || null;
  const specLine = [
    listing.year,
    listing.length_ft ? `${Number(listing.length_ft)}'` : null,
    [listing.make, listing.model].filter(Boolean).join(" ") || null,
  ].filter(Boolean).join("  ·  ");

  let pdf: Uint8Array;
  try {
    pdf = await buildDockCardPdf({
      size,
      photo,
      vesselName: listing.vessel_name ?? "",
      specLine,
      location: (entry?.location as string | null) ?? null,
      brokerName,
      brokerage: (details?.brokerage_name as string | null) ?? null,
      phone: (profile?.phone as string | null) ?? null,
      email: (profile?.display_email as string | null) ?? null,
      logo,
      qrUrl: dockCardUrl(listing.slideshow_slug, show.key),
      showName: show.name,
      showShort: show.short_name,
      showDates: showDatesLabel(show),
      brandAccent: (details?.brand_accent as string | null) ?? null,
      brandGround: (details?.brand_ground as string | null) ?? null,
    });
  } catch {
    return NextResponse.json({ error: "Couldn't make the dock card. Please try again." }, { status: 500 });
  }

  const name = fileName(pdfSafe(listing.vessel_name) || "Vessel", show.short_name, size);
  const ascii = name.replace(/[^\x20-\x7e]/g, "");
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${ascii}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}.pdf`,
      "Cache-Control": "private, no-store",
    },
  });
}
