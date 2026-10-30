import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/photos/download-fallback
 *   { step, errorName?, message?, mode?, listingId?, size?, bytes?, done?, total? } → { ok }
 *
 * Diagnostics only (Oct 30): when a "Download all" zip fails, or the
 * Save-dialog stream falls back to plain downloads (src/lib/zipDownload.ts
 * reportZipIssue), the page reports it here and it lands in the Vercel
 * runtime logs as one `[download-fallback]` line. Nothing is stored, so only
 * admins (via Vercel) can read it. Public download pages (/d, /g) report too,
 * without a user; no PII beyond the user id. Fields are trimmed.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text().catch(() => "");
  if (raw.length > 4000) return NextResponse.json({ ok: false }, { status: 413 });
  let b: Record<string, unknown> = {};
  try { b = JSON.parse(raw) ?? {}; } catch { /* empty */ }
  let userId: string | null = null;
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch { /* signed out */ }
  const str = (v: unknown, n = 200) => (typeof v === "string" ? v.slice(0, n) : v == null ? null : String(v).slice(0, n));
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  console.error(
    "[download-fallback]",
    JSON.stringify({
      user: userId,
      listingId: str(b.listingId, 64),
      size: str(b.size, 20),
      mode: str(b.mode, 20),
      step: str(b.step, 30),
      errorName: str(b.errorName, 60),
      message: str(b.message, 500),
      bytes: num(b.bytes),
      done: num(b.done),
      total: num(b.total),
      ua: str(req.headers.get("user-agent"), 200),
    })
  );
  return NextResponse.json({ ok: true });
}
