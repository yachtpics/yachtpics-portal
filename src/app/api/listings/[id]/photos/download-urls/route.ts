import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { signOriginalPaths } from "@/lib/photoStore";
import { originalContentType } from "@/lib/photoStoreShared";

export const runtime = "nodejs";
export const maxDuration = 30;

const BUCKET = "listing-photos";
const TTL = 60 * 60;
const MAX_IDS = 1000;

/**
 * Download sizes. "full" is the untouched original; the others are Supabase
 * image transforms — long edge capped (width AND height = N with `contain`, so
 * a vertical comes out N tall, not N wide), original format kept so a .jpg is
 * still a JPEG (without `format: "origin"` Supabase may hand back WebP).
 * Transforms cap at 2500px, so both resized sizes are well inside the limit.
 */
const SIZES = {
  full: null,
  web: 2048,
  social: 1080,
} as const;
type DownloadSize = keyof typeof SIZES;

/**
 * POST /api/listings/[id]/photos/download-urls  { photoIds: string[], size }
 *   → { urls: { [photoId]: signedUrl }, failed: photoId[], resize?: { [photoId]: { edge, type } } }
 *
 * Oct 28 — originals on R2: Supabase can't resize them, so for a Web / Social
 * download of an R2 original the link is the ORIGINAL and `resize` tells the
 * page to scale it down itself (long edge `edge`, re-encoded as `type`, the
 * original's own format) — same file the broker got before, made in the
 * browser instead of by Supabase. R2 has no egress charge.
 *
 * The broker listing page asks for these at download time (never reusing
 * page-load links, which expire), for one photo, a selection or the whole
 * listing. Signing a transform is just a token here — the resize itself
 * happens when the browser fetches the link, which is why the page fetches
 * resized photos a few at a time (Supabase answers 429 to a burst).
 *
 * Access mirrors log-download: the listing rule with co-brokers and brokerage
 * admins, falling back to the caller's own RLS read so a colleague's shared
 * (is_shared) listing still downloads.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const listingId = params.id;
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body?.photoIds)
      ? Array.from(new Set<string>(body.photoIds.filter((x: unknown) => typeof x === "string"))).slice(0, MAX_IDS)
      : [];
    const size: DownloadSize = body?.size === "web" || body?.size === "social" ? body.size : "full";
    if (!listingId || ids.length === 0) {
      return NextResponse.json({ error: "Missing listing or photos." }, { status: 400 });
    }

    const serverSupabase = await createServerClient();
    const { data: { user } } = await serverSupabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const access = await assertListingAccess(svc, listingId, user.id, {
      includeCoBroker: true,
      includeBrokerageAdmin: true,
    });
    if (access instanceof NextResponse) {
      if (access.status !== 403) return access;
      const { data: visible } = await serverSupabase
        .from("listings")
        .select("id")
        .eq("id", listingId)
        .maybeSingle();
      if (!visible) return access;
    }

    // Only this listing's photos — ids from anywhere else are simply ignored.
    const { data: photos } = await svc
      .from("photos")
      .select("id, storage_path, storage_backend")
      .eq("listing_id", listingId)
      .in("id", ids);
    const rows = (photos ?? []).filter((p) => !!p.storage_path) as { id: string; storage_path: string; storage_backend: string | null }[];

    const urls: Record<string, string> = {};
    const resize: Record<string, { edge: number; type: string }> = {};
    const edge = SIZES[size];
    // Originals — every full download, and resized downloads of R2 originals.
    const originalsFor = edge === null ? rows : rows.filter((r) => r.storage_backend === "r2");
    if (originalsFor.length) {
      const signed = await signOriginalPaths(svc, originalsFor.map((r) => r.storage_path), TTL);
      const byPath = new Map<string, string>();
      signed.forEach((d) => { if (d.signedUrl) byPath.set(d.path, d.signedUrl); });
      originalsFor.forEach((r) => {
        const u = byPath.get(r.storage_path);
        if (!u) return;
        urls[r.id] = u;
        if (edge !== null) {
          const t = originalContentType(r.storage_path, "image/jpeg");
          resize[r.id] = { edge, type: t === "image/png" ? "image/png" : "image/jpeg" };
        }
      });
    }
    if (edge !== null) {
      const supaRows = rows.filter((r) => r.storage_backend !== "r2");
      // Supabase signs transforms one url at a time.
      const CHUNK = 50;
      for (let i = 0; i < supaRows.length; i += CHUNK) {
        await Promise.all(
          supaRows.slice(i, i + CHUNK).map(async (r) => {
            const { data } = await svc.storage.from(BUCKET).createSignedUrl(r.storage_path, TTL, {
              transform: { width: edge, height: edge, resize: "contain", quality: 85, format: "origin" },
            });
            if (data?.signedUrl) urls[r.id] = data.signedUrl;
          })
        );
      }
    }

    const failed = ids.filter((pid) => !urls[pid]);
    return NextResponse.json({ urls, failed, ...(Object.keys(resize).length ? { resize } : {}) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
