import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { youtubeConfigured } from "@/lib/youtube/config";
import { openYouTubeToken } from "@/lib/youtube/crypto";
import { revokeToken } from "@/lib/youtube/google";
import { isMissingYouTubeSchema } from "@/lib/youtube/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/youtube/channels/[id] — Disconnect. Admin only.
 * Asks Google to forget the permission (best effort), then deletes the row.
 * Uploads keep their history (channel_id becomes null); one still running
 * stops with "The YouTube channel was disconnected." Videos already on
 * YouTube stay there.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: "Unknown channel." }, { status: 400 });

  const { data, error } = await auth.admin
    .from("youtube_channels")
    .select("id, refresh_token_enc, access_token_enc")
    .eq("id", params.id)
    .maybeSingle();
  if (error) {
    if (isMissingYouTubeSchema(error)) return NextResponse.json({ error: "YouTube isn't set up yet." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ ok: true, revoked: false });

  let revoked = false;
  if (youtubeConfigured()) {
    // Revoking the refresh token also ends its access tokens.
    const token = openYouTubeToken(data.refresh_token_enc as string) ?? openYouTubeToken(data.access_token_enc as string | null);
    if (token) revoked = await revokeToken(token);
  }
  const { error: delErr } = await auth.admin.from("youtube_channels").delete().eq("id", params.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, revoked });
}

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
