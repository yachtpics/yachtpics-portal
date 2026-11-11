import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { originalPathInScope, presignR2Original, signOriginalPaths } from "@/lib/photoStore";
import { downloadSizeExt, downloadSizePath, downloadSizeFailedRecently, downloadSizesErrorRecord, hasDownloadSize, webServesOriginal, type DownloadSizeName, type DownloadSizesRecord } from "@/lib/photoDerivativePaths";

export const runtime = "nodejs";
// 60 s: an R2 photo whose Web / Social file isn't made yet is made here (sharp).
export const maxDuration = 60;
/** No new Web / Social file is started after this long into the request; the rest come back as `pending`. */
const MAKE_BUDGET_MS = 25_000;
/** One file's make may take this long before the photo's original is served instead. */
const MAKE_TIMEOUT_MS = 20_000;
/** Every make is cut off by this point of the request — the answer leaves well inside maxDuration. */
const HARD_STOP_MS = 48_000;

/** `p`, or a rejection after `ms` (p keeps running; its result is ignored). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([p, t]).finally(() => { if (timer) clearTimeout(timer); });
}

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
 *   → { urls: { [photoId]: signedUrl }, failed: photoId[], pending?: photoId[], ext?: { [photoId]: "jpg" | "png" },
 *       original?: photoId[], bytes }
 *
 * Oct 28 — originals on R2: Supabase can't resize them, so their Web & MLS /
 * Social files are PRE-MADE with sharp (same long edge and quality as the
 * transform below) and stored in R2 beside the original (`_dl/`, recorded in
 * photos.download_sizes). The link is a presigned R2 GET of that file. One
 * that isn't made yet is made here on demand (stored, then served); any not
 * reached within MAKE_BUDGET_MS come back as `pending` and the page asks
 * again. `ext` is the made file's extension (jpg, or png for PNG originals).
 *
 * Nov 11 — a photo whose file can't be made (sharp and the staged transform
 * both fail; or the make runs past MAKE_TIMEOUT_MS) gets its ORIGINAL, listed
 * in `original` so the page names it as the original. The failure is stamped
 * on photos.download_sizes (`error`, `error_at`) and not tried again for 24 h.
 * Ready links are signed before any make starts, and no make outlives
 * HARD_STOP_MS, so the answer is never lost to the 60 s limit.
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
  const requestStarted = Date.now();
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
    /** Served as the ORIGINAL because the sized file doesn't exist and can't be made now. */
    const original: string[] = [];
    const edge = SIZES[size];
    if (edge === null) {
      const signed = await signOriginalPaths(svc, rows.map((r) => r.storage_path), TTL);
      const byPath = new Map<string, string>();
      signed.forEach((d) => { if (d.signedUrl) byPath.set(d.path, d.signedUrl); });
      rows.forEach((r) => { const u = byPath.get(r.storage_path); if (u) urls[r.id] = u; });
    } else {
      // Nov 11 (41 Bahama): ready links first, so a photo whose sized copy
      // can't be made never costs the others theirs; then whatever time is
      // left makes missing files. A photo that can't have its file gets its
      // ORIGINAL (listed in `original`) rather than nothing.
      const name = size as DownloadSizeName;
      const r2Rows = rows.filter((r) => r.storage_backend === "r2" && originalPathInScope(r.storage_path, r));
      type Row = (typeof rows)[number];
      const serveOriginal = async (r: Row) => {
        try {
          urls[r.id] = await presignR2Original(r.storage_path, TTL);
          original.push(r.id);
          delete ext[r.id];
          const ob = r.original_bytes && r.original_bytes > 0 ? Number(r.original_bytes) : 0;
          if (ob) bytes[r.id] = ob; else delete bytes[r.id];
        } catch { /* failed below */ }
      };
      const serveMade = async (r: Row) => {
        try {
          urls[r.id] = await presignR2Original(downloadSizePath(r, name), TTL);
          ext[r.id] = downloadSizeExt(r.storage_path);
        } catch { /* failed below */ }
      };
      // Web & MLS of an original no bigger than 2048 px (YachtPics' 2000 px
      // deliveries): the original itself, named exactly as the Web & MLS
      // download is today (the page adds " (2048px)" and the original's extension).
      const isWebOriginal = (r: { storage_path: string; download_sizes: unknown }) => name === "web" && webServesOriginal(r);

      // 1 — ready: sign now (local presigning, no network).
      const toMake: Row[] = [];
      for (const r of r2Rows) {
        if (isWebOriginal(r)) {
          try { urls[r.id] = await presignR2Original(r.storage_path, TTL); } catch { /* failed below */ }
        } else if (hasDownloadSize(r, name)) {
          await serveMade(r);
        } else if (downloadSizeFailedRecently(r)) {
          // Failed within 24 h: don't try again on every download.
          await serveOriginal(r);
        } else {
          toMake.push(r);
        }
      }

      // 2 — originals on Supabase: transform links (one signature each).
      const supaRows = rows.filter((r) => r.storage_backend !== "r2");
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

      // 3 — missing files: made one at a time while the budget lasts, each
      // with its own time limit, so the answer always leaves well inside
      // maxDuration. Not reached: `pending` (asked again) — except a photo
      // that already failed once, which gets its original straight away.
      if (toMake.length) {
        const { storeDownloadSizes } = await import("@/lib/photoSharp");
        for (const r of toMake) {
          const hadError = !!(r.download_sizes as DownloadSizesRecord | null)?.error &&
            (r.download_sizes as DownloadSizesRecord).path === r.storage_path;
          const elapsed = Date.now() - requestStarted;
          if (elapsed > MAKE_BUDGET_MS) {
            if (hadError) await serveOriginal(r);
            else pending.push(r.id);
            continue;
          }
          const limit = Math.max(1000, Math.min(MAKE_TIMEOUT_MS, HARD_STOP_MS - elapsed));
          let rec: DownloadSizesRecord | null = null;
          let problem: unknown = null;
          try {
            rec = await withTimeout(storeDownloadSizes(svc, r), limit);
          } catch (e) {
            problem = e;
          }
          if (rec && name === "web" && rec.web_original) {
            try { urls[r.id] = await presignR2Original(r.storage_path, TTL); } catch { /* failed below */ }
            continue;
          }
          if (rec && typeof rec[name] === "number") {
            await serveMade(r);
            continue;
          }
          const msg = problem instanceof Error ? problem.message : String(problem ?? "not made");
          console.warn(`download size ${name} for ${r.id}: ${msg} — serving the original`);
          // Stamp the failure (only if no good record landed meanwhile), so
          // the next 24 h of downloads serve the original without trying.
          await svc
            .from("photos")
            .update({ download_sizes: downloadSizesErrorRecord(r.storage_path, problem instanceof Error ? `Error: ${problem.message}` : problem ?? "not made") })
            .eq("id", r.id)
            .eq("storage_path", r.storage_path)
            .is("download_sizes->>social", null)
            .then(() => {}, () => {});
          await serveOriginal(r);
        }
      }
    }

    const failed = ids.filter((pid) => !urls[pid] && !pending.includes(pid));
    return NextResponse.json({
      urls,
      failed,
      ...(pending.length ? { pending } : {}),
      ...(Object.keys(ext).length ? { ext } : {}),
      ...(original.length ? { original } : {}),
      bytes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
