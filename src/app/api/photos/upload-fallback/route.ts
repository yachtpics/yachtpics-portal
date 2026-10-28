import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/photos/upload-fallback  { path, listingId?, galleryId?, step, status?, message?, size?, type?, attempts? }
 *   → { ok }
 *
 * Diagnostics only (Oct 28): when a browser upload meant for R2 falls back to
 * Supabase (src/lib/photoStoreClient.ts uploadOriginal), the page reports why
 * here and it lands in the Vercel runtime logs as one `[upload-fallback]`
 * line — which step failed (target / put), the HTTP status, R2's error text.
 * Nothing is stored. Signed-in users only; fields are trimmed.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const str = (v: unknown, n = 200) => (typeof v === "string" ? v.slice(0, n) : v == null ? null : String(v).slice(0, n));
  console.error(
    "[upload-fallback]",
    JSON.stringify({
      user: user.id,
      path: str(b?.path, 300),
      listingId: str(b?.listingId, 64),
      galleryId: str(b?.galleryId, 64),
      step: str(b?.step, 20),
      status: typeof b?.status === "number" ? b.status : null,
      message: str(b?.message, 500),
      size: typeof b?.size === "number" ? b.size : null,
      type: str(b?.type, 80),
      attempts: typeof b?.attempts === "number" ? b.attempts : null,
      ua: str(req.headers.get("user-agent"), 160),
    })
  );
  return NextResponse.json({ ok: true });
}
