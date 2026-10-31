import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { signReviewPhotos, type SignablePhoto } from "@/lib/reviewReelServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A year's reel renders for a while; the links outlive it comfortably. */
const TTL = 4 * 3600;
const MAX = 1500;

/**
 * POST /api/admin/reels/review/sign  { photoIds: string[] }   (admin)
 *   → { urls: { [photoId]: url } }
 *
 * The render's photos: the stored 2000 px copy of each (one batch signing
 * call), a 2000 px transform for a Supabase original without copies. A photo
 * that can't be signed is simply absent — the renderer shows the ground for
 * it and says so.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const svc = auth.admin;
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.photoIds)
    ? Array.from(new Set((body.photoIds as unknown[]).filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x))))
    : [];
  if (ids.length === 0) return NextResponse.json({ urls: {} });
  if (ids.length > MAX) return NextResponse.json({ error: `At most ${MAX} photos per reel.` }, { status: 400 });

  const rows: SignablePhoto[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await svc.from("photos")
      .select("id, storage_path, derivatives_at, thumb_at, storage_backend")
      .in("id", ids.slice(i, i + 200));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...((data ?? []) as SignablePhoto[]));
  }
  const urls = await signReviewPhotos(svc, rows, 2000, TTL);
  return NextResponse.json({ urls });
}
