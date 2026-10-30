import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { originalPathInScope, presignR2Original, signOriginalPaths } from "@/lib/photoStore";
import { downloadSizeExt, downloadSizePath, hasDownloadSize, webServesOriginal, type DownloadSizeName, type DownloadSizesRecord } from "@/lib/photoDerivativePaths";

export const runtime = "nodejs";
// 60 s: an R2 photo whose Web / Social file isn't made yet is made here (sharp).
export const maxDuration = 60;
/** Time this request may spend making missing Web / Social files; the rest come back as `pending`. */
const MAKE_BUDGET_MS = 35_000;

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
 *   → { urls: { [photoId]: signedUrl }, failed: photoId[], pending?: photoId[], ext?: { [photoId]: "jpg" | "png" } }
 *
 * Oct 28 — originals on R2: Supabase can't resize them, so their Web & MLS /
 * Social files are PRE-MADE with sharp (same long edge and quality as the
 * transform below) and stored in R2 beside the original (`_dl/`, recorded in
 * photos.download_sizes). The link is a presigned R2 GET of that file. One
 * that isn't made yet is made here on demand (stored, then served); any not
 * reached within MAKE_BUDGET_MS come back as `pending` and the page asks
 * again. `ext` is the made file's extension (jpg, or png for PNG originals).
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
      .select("id, storage_path, storage_backend, download_sizes, listing_id, original_bytes")
      .eq("listing_id", listingId)
      .in("id", ids);
    const rows = (photos ?? []).filter((p) => !!p.storage_path) as {
      id: string; storage_path: string; storage_backend: string | null; download_sizes: unknown; listing_id: string;
      original_bytes: number | null;
    }[];

    // Bytes of what each size serves, where known (sizes the zip plans parts
    // with, and the "Full resolution is 1.4 GB" notice). A Supabase transform
    // has no recorded size: estimated from the original (≈ 25% / 8%).
    const bytesOf = (r: (typeof rows)[number], s: DownloadSize): number | null => {
      const orig = r.original_bytes && r.original_bytes > 0 ? Number(r.original_bytes) : null;
      if (s === "full") return orig;
      const rec = r.download_sizes as DownloadSizesRecord | null;
      const current = !!rec && rec.path === r.storage_path;
      if (s === "web" && current && rec!.web_original) return orig;
      if (current && typeof rec![s] === "number" && (rec![s] as number) > 0) return rec![s] as number;
      return orig ? Math.round(orig * (s === "web" ? 0.25 : 0.08)) : null;
    };

    // { estimate: true }: totals per size, nothing signed.
    if (body?.estimate === true) {
      const totals = { full: 0, web: 0, social: 0 };
      for (const r of rows) {
        (["full", "web", "social"] as const).forEach((s) => { totals[s] += bytesOf(r, s) ?? 0; });
      }
      return NextResponse.json({ totals, count: rows.length });
    }
    const bytes: Record<string, number> = {};
    rows.forEach((r) => {
      const isMade = size !== "full" && r.storage_backend === "r2";
      const b = size === "full" || isMade ? bytesOf(r, size) : null; // transforms: unknown exactly
      if (b) bytes[r.id] = b;
    });

    const urls: Record<string, string> = {};
    const ext: Record<string, "jpg" | "png"> = {};
    const pending: string[] = [];
    const edge = SIZES[size];
    if (edge === null) {
      const signed = await signOriginalPaths(svc, rows.map((r) => r.storage_path), TTL);
      const byPath = new Map<string, string>();
      signed.forEach((d) => { if (d.signedUrl) byPath.set(d.path, d.signedUrl); });
      rows.forEach((r) => { const u = byPath.get(r.storage_path); if (u) urls[r.id] = u; });
    } else {
      // R2 originals: the pre-made file (made now if missing, within budget).
      const name = size as DownloadSizeName;
      const r2Rows = rows.filter((r) => r.storage_backend === "r2" && originalPathInScope(r.storage_path, r));
      const started = Date.now();
      // Web & MLS of an original no bigger than 2048 px (YachtPics' 2000 px
      // deliveries): the original itself, named exactly as the Web & MLS
      // download is today (the page adds " (2048px)" and the original's extension).
      const isWebOriginal = (r: { storage_path: string; download_sizes: unknown }) => name === "web" && webServesOriginal(r);
      for (const r of r2Rows) {
        if (isWebOriginal(r)) {
          try { urls[r.id] = await presignR2Original(r.storage_path, TTL); } catch { /* failed below */ }
          continue;
        }
        let ready = hasDownloadSize(r, name);
        if (!ready) {
          if (Date.now() - started > MAKE_BUDGET_MS) {
            pending.push(r.id);
            continue;
          }
          try {
            const { storeDownloadSizes } = await import("@/lib/photoSharp");
            const rec = await storeDownloadSizes(svc, r);
            if (rec && name === "web" && rec.web_original) {
              try { urls[r.id] = await presignR2Original(r.storage_path, TTL); } catch { /* failed below */ }
              continue;
            }
            ready = !!rec && typeof rec[name] === "number";
          } catch (e) {
            console.warn(`download size ${name} for ${r.id}: ${e instanceof Error ? e.message : e}`);
          }
        }
        if (!ready) continue;
        try {
          urls[r.id] = await presignR2Original(downloadSizePath(r, name), TTL);
          ext[r.id] = downloadSizeExt(r.storage_path);
        } catch { /* failed below */ }
      }
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

    const failed = ids.filter((pid) => !urls[pid] && !pending.includes(pid));
    return NextResponse.json({
      urls,
      failed,
      ...(pending.length ? { pending } : {}),
      ...(Object.keys(ext).length ? { ext } : {}),
      bytes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
