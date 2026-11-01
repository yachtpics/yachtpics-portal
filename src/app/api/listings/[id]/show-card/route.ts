import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { buildDockCardPdf, pdfSafe, type DockCardSize } from "@/lib/dockCardPdf";
import { dockCardUrl, getCurrentShows, showDatesLabel, type BoatShow } from "@/lib/boatShows";
import { brokerLogo, coverPhoto } from "@/lib/dockCardAssets";

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
 * 2000 px copies are WebP, which PDFs can't carry). Cover / logo helpers:
 * src/lib/dockCardAssets.ts (shared with the everyday card, /dock-card).
 */

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
