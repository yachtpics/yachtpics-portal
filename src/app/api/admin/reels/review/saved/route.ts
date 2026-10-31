import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { missingTable } from "@/lib/reviewReelServer";
import { isYmd } from "@/lib/reviewReel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_READY = "Saving In Review reels needs the review_reels table — run supabase/migrations/20261031_review_reels.sql.";
const COLS = "id, title, period_from, period_to, preset, settings, items, boat_count, caption, rendered_at, updated_at";

/**
 * Saved In Review reels (admin) — the period, the boats and the photo chosen
 * for each, the order and the settings, so a reel can be opened and rendered
 * again. Nothing about the MP4 itself is stored.
 *
 *   GET                         → { reels: SavedReviewReel[] } (newest first)
 *   POST { id?, title, period_from, period_to, preset, settings, items, boat_count, caption, rendered? }
 *                               → { id }   (insert, or update when id is given)
 *   DELETE ?id=…                → { ok: true }
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { data, error } = await auth.admin.from("review_reels").select(COLS).order("updated_at", { ascending: false }).limit(100);
  if (error) {
    if (missingTable(error)) return NextResponse.json({ reels: [], notReady: NOT_READY });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ reels: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  if (!isYmd(b.period_from) || !isYmd(b.period_to)) return NextResponse.json({ error: "Missing period" }, { status: 400 });
  if (!Array.isArray(b.items) || b.items.length > 2000) return NextResponse.json({ error: "Invalid boats" }, { status: 400 });
  const items = (b.items as unknown[])
    .filter((x): x is { listingId: string; photoId: string; included?: unknown } =>
      !!x && typeof (x as { listingId?: unknown }).listingId === "string" && typeof (x as { photoId?: unknown }).photoId === "string")
    .map((x) => ({ listingId: x.listingId, photoId: x.photoId, included: x.included !== false }));
  const row = {
    title: String(b.title ?? "").slice(0, 200) || "In review",
    period_from: b.period_from,
    period_to: b.period_to,
    preset: typeof b.preset === "string" ? b.preset.slice(0, 40) : null,
    settings: b.settings && typeof b.settings === "object" ? b.settings : {},
    items,
    boat_count: Math.max(0, Math.min(5000, Number(b.boat_count) || 0)),
    caption: typeof b.caption === "string" ? b.caption.slice(0, 2000) : null,
    updated_at: new Date().toISOString(),
    ...(b.rendered === true ? { rendered_at: new Date().toISOString() } : {}),
  };
  const id = typeof b.id === "string" && /^[0-9a-f-]{36}$/i.test(b.id) ? b.id : null;
  const q = id
    ? auth.admin.from("review_reels").update(row).eq("id", id).select("id").maybeSingle()
    : auth.admin.from("review_reels").insert({ ...row, created_by: auth.userId }).select("id").single();
  const { data, error } = await q;
  if (error) {
    if (missingTable(error)) return NextResponse.json({ error: NOT_READY }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "That saved reel is gone." }, { status: 404 });
  return NextResponse.json({ id: data.id });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const { error } = await auth.admin.from("review_reels").delete().eq("id", id);
  if (error) {
    if (missingTable(error)) return NextResponse.json({ error: NOT_READY }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
