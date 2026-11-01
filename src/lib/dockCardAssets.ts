import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDockCardPdf, imageKind, pdfSafe, type DockCardImage, type DockCardSize } from "@/lib/dockCardPdf";
import { lookupPhotoPaths, readOriginal, resizedOriginalBytes } from "@/lib/photoStore";
import { ypShareUrl, type YpShareRow } from "@/lib/ypShare";

/**
 * Dock card assets + the everyday ("evergreen") card — SERVER ONLY.
 *
 * coverPhoto / brokerLogo are shared by the show card route
 * (/api/listings/[id]/show-card) and the everyday card
 * (/api/listings/[id]/dock-card, and the photos-ready email's attachment).
 *
 * The everyday card (Nov 1) is a dock card not tied to a show: same layout
 * (src/lib/dockCardPdf.ts, no show line), and its QR opens the YachtPics
 * always-live link /yp/{token}?via=card#video (src/lib/ypShare.ts) — so it
 * works whether or not the broker has a plan, and every scan is recorded
 * with source "yp_card" ("Dock card" under YachtPics in the Seller Report;
 * counted as a dock-card scan in the monthly email). Show cards keep their
 * own /s/{slug}?from={show} link and counting.
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

export function asImage(bytes: Uint8Array | null): DockCardImage | null {
  if (!bytes) return null;
  const kind = imageKind(bytes);
  return kind ? { bytes, kind } : null;
}

/**
 * The listing's cover (chosen hero, else first visible photo) as JPEG/PNG for
 * the PDF. `edge` / `quality`: 2000 / 85 for print downloads; the email
 * attachment asks for less to keep the file small.
 */
export async function coverPhoto(svc: SupabaseClient, listingId: string, edge = 2000, quality = 85): Promise<DockCardImage | null> {
  const { data } = await svc.rpc("listing_hero_photos", { p_listing_ids: [listingId] });
  const path = ((data ?? []) as { storage_path: string }[])[0]?.storage_path;
  if (!path) return null;
  // Original on R2 (Oct 28): a 2000 px JPEG/PNG made here with sharp from
  // the original (upright, q85 — as the transform below). If sharp can't
  // decode it (e.g. HEIC), the staged Supabase resize; the full-size file is
  // never the fallback.
  const row = (await lookupPhotoPaths(svc, [path])).get(path);
  if (row?.storage_backend === "r2") {
    try {
      const { bytes } = await readOriginal(svc, row);
      const { makeJpegOrPng } = await import("@/lib/photoSharp");
      const out = await makeJpegOrPng(bytes, edge, path.toLowerCase().endsWith(".png"), quality);
      const img = asImage(new Uint8Array(out));
      if (img) return img;
    } catch {
      /* staged fallback below */
    }
    const bytes = await resizedOriginalBytes(svc, path, edge, quality);
    return bytes ? asImage(bytes) : null;
  }
  const bucket = svc.storage.from("listing-photos");
  // Resized, upright (transforms honour EXIF), and in the original's format —
  // asking for JPEG/PNG keeps Supabase from answering in WebP.
  const { data: signed } = await bucket.createSignedUrl(path, 120, {
    transform: { width: edge, height: edge, resize: "contain", quality },
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
export async function brokerLogo(url: string | null): Promise<DockCardImage | null> {
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

/** "2019  ·  65'  ·  Viking 65 Convertible" — as the show card writes it. */
export function dockCardSpecLine(l: { year: number | null; length_ft: number | string | null; make: string | null; model: string | null }): string {
  return [
    l.year,
    l.length_ft ? `${Number(l.length_ft)}'` : null,
    [l.make, l.model].filter(Boolean).join(" ") || null,
  ].filter(Boolean).join("  ·  ");
}

export function dockCardFileName(vessel: string | null, label: string, size: DockCardSize): string {
  const base = `${pdfSafe(vessel) || "Vessel"} - ${label}${size === "letter" ? " (letter)" : ""}`;
  return base.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim() || "dock-card";
}

/** PDF response headers (ASCII + UTF-8 file names). */
export function pdfHeaders(name: string, disposition: "inline" | "attachment" = "inline"): Record<string, string> {
  const ascii = name.replace(/[^\x20-\x7e]/g, "");
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `${disposition}; filename="${ascii}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}.pdf`,
    "Cache-Control": "private, no-store",
  };
}

const EVERYDAY_COLS =
  "id, vessel_name, year, length_ft, make, model, location, broker_id, slideshow_slug, slideshow_published, yp_share_enabled, yp_share_token";

export type EverydayCardResult =
  | { ok: true; pdf: Uint8Array; fileName: string; qrUrl: string }
  | { ok: false; status: number; error: string };

/**
 * The everyday dock card for one listing. The CALLER checks access (the route
 * reads the listing under the user's session first; the email is admin-only).
 * 409 "Publish the slideshow first." unless the YachtPics link is live
 * (published + yp_share_enabled).
 */
export async function buildEverydayDockCard(
  svc: SupabaseClient,
  listingId: string,
  size: DockCardSize,
  opts: { photoEdge?: number; photoQuality?: number; /** A cover already in hand (skips the fetch). */ photo?: DockCardImage | null } = {}
): Promise<EverydayCardResult> {
  const { data: row, error } = await svc.from("listings").select(EVERYDAY_COLS).eq("id", listingId).maybeSingle();
  if (error) return { ok: false, status: 500, error: "Couldn't read the listing." };
  if (!row) return { ok: false, status: 404, error: "Listing not found." };
  const listing = row as YpShareRow & {
    id: string; vessel_name: string | null; year: number | null; length_ft: number | null; make: string | null; model: string | null;
    location: string | null; broker_id: string;
  };
  const link = ypShareUrl(listing, "card");
  if (!link) return { ok: false, status: 409, error: "Publish the slideshow first." };
  const qrUrl = `${link}#video`;

  const [{ data: profile }, { data: details }, photo] = await Promise.all([
    svc.from("profiles").select("first_name, last_name, phone, display_email").eq("id", listing.broker_id).maybeSingle(),
    svc.from("broker_details").select("brokerage_name, logo_url, brand_accent, brand_ground").eq("id", listing.broker_id).maybeSingle(),
    opts.photo !== undefined ? Promise.resolve(opts.photo) : coverPhoto(svc, listing.id, opts.photoEdge ?? 2000, opts.photoQuality ?? 85),
  ]);
  const logo = await brokerLogo((details?.logo_url as string | null) ?? null);
  const brokerage = (details?.brokerage_name as string | null) ?? null;
  const brokerName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || null;

  // The band's third line: where she lies; without one, who offers her — so
  // the card never reads as a line short.
  const location = pdfSafe(listing.location) || (brokerage ? `Offered by ${brokerage}` : brokerName ? `Offered by ${brokerName}` : null);

  try {
    const pdf = await buildDockCardPdf({
      size,
      photo,
      vesselName: listing.vessel_name ?? "",
      specLine: dockCardSpecLine(listing),
      location,
      brokerName,
      brokerage,
      phone: (profile?.phone as string | null) ?? null,
      email: (profile?.display_email as string | null) ?? null,
      logo,
      qrUrl,
      brandAccent: (details?.brand_accent as string | null) ?? null,
      brandGround: (details?.brand_ground as string | null) ?? null,
    });
    return { ok: true, pdf, fileName: dockCardFileName(listing.vessel_name, "dock card", size), qrUrl };
  } catch {
    return { ok: false, status: 500, error: "Couldn't make the dock card. Please try again." };
  }
}
