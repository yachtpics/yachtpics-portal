import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { ensureDerivatives, signDerivatives } from "@/lib/photoDerivatives";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Per-call cap — what four lanes can realistically finish inside the deadline. */
const MAX_PER_CALL = 120;

/**
 * POST /api/admin/galleries/[id]/photos/derivatives
 *   → { done, unavailable, failed, remaining, thumbs: { [photoId]: signed 600px url } }
 *
 * Makes the 600px and 2000px WebP copies (src/lib/photoDerivatives.ts) for
 * this gallery's photos that don't have them yet — the gallery twin of
 * /api/listings/[id]/photos/derivatives. Gallery originals live at
 * `galleries/{galleryId}/{file}`, so derivatives land at
 * `galleries/{galleryId}/_d/…` (same naming the daily backfill uses).
 *
 * GalleryDetail calls it in a loop after an upload batch until `remaining`
 * is 0, swapping each finished photo's tile to the returned thumb link. If it
 * never runs, /api/cron/derivatives picks the photos up.
 *
 * `remaining` = this gallery's photos still without derivatives (null) after
 * this call; photos marked unavailable are not counted.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;
  const galleryId = params.id;
  if (!galleryId) return NextResponse.json({ error: "Missing gallery id." }, { status: 400 });

  try {
    const { data: rows, error } = await admin
      .from("photos")
      .select("id")
      .eq("gallery_id", galleryId)
      .is("derivatives_at", null)
      .order("display_order")
      .limit(MAX_PER_CALL);
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((r) => r.id as string);

    const r = ids.length
      ? await ensureDerivatives(ids, { svc: admin, concurrency: 4, deadline: Date.now() + 48_000 })
      : { done: [] as string[], unavailable: [] as string[], failed: [] as { id: string; reason: string }[] };

    let thumbs: Record<string, string> = {};
    if (r.done.length) {
      const { data: made } = await admin
        .from("photos")
        .select("id, storage_path, derivatives_at")
        .in("id", r.done);
      thumbs = (await signDerivatives(admin, made ?? [], 600, 3600)).urls;
    }

    const { count } = await admin
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("gallery_id", galleryId)
      .is("derivatives_at", null);

    return NextResponse.json({
      done: r.done.length,
      unavailable: r.unavailable.length,
      failed: r.failed.length,
      remaining: count ?? 0,
      thumbs,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
