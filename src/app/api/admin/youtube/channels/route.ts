import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { listChannels, youtubeReadiness } from "@/lib/youtube/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/youtube/channels → { configured, ready, reason?, channels }
 * Admin only. Before the env vars / migration: configured or ready false and
 * no channels — never an error.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const r = await youtubeReadiness(auth.admin);
  if (!r.ready) return NextResponse.json({ configured: r.configured, ready: false, reason: r.reason, channels: [] });
  const list = await listChannels(auth.admin);
  if (list.error) {
    if (list.missing) return NextResponse.json({ configured: true, ready: false, reason: "migration", channels: [] });
    return NextResponse.json({ error: list.error }, { status: 500 });
  }
  return NextResponse.json({ configured: true, ready: true, channels: list.channels });
}

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
