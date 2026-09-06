import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * POST /api/slideshow/event
 *
 * The public slideshow reports what a viewer actually did — which photos they
 * lingered on, what they favorited, whether they opened the tour or played the
 * video — plus a running summary of the session (seconds on the page, photos
 * seen). This is what turns an anonymous "1 view" into something the broker
 * can act on, and what the Seller Report is built from.
 *
 * Anonymous by design: no cookies, no fingerprinting. The session id is a
 * random string the browser keeps for one visit; a tracked Send-to-Client
 * token (if present) is what ties a session to a named recipient.
 *
 * Body: { listingId, slug, sessionId?, sendToken?,
 *         events?: [{ kind, photoId?, videoId?, value? }],
 *         session?: { durationS?, photosSeen? } }
 *
 * Never fails loudly — the viewer must never be interrupted by analytics.
 */

const KINDS = new Set(["dwell", "favorite", "unfavorite", "video_play", "tour_click", "deck_plan_view", "details_view"]);
const MAX_EVENTS = 60;

function clean(v: unknown, max: number, re: RegExp) {
  return typeof v === "string" ? v.slice(0, max).replace(re, "") || null : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const listingId = clean(body.listingId, 40, /[^a-f0-9-]/gi);
    const slug = clean(body.slug, 80, /[^a-z0-9_-]/gi);
    const sessionId = clean(body.sessionId, 48, /[^a-z0-9_-]/gi);
    const token = clean(body.sendToken, 40, /[^a-z0-9]/gi);
    if (!listingId) return NextResponse.json({ ok: true });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Only accept events for a listing whose slideshow is actually public.
    const { data: listing } = await supabase
      .from("listings")
      .select("id, slideshow_slug, slideshow_published")
      .eq("id", listingId)
      .maybeSingle();
    if (!listing || !listing.slideshow_published || (slug && listing.slideshow_slug !== slug)) {
      return NextResponse.json({ ok: true });
    }

    let sendId: string | null = null;
    if (token) {
      const { data: send } = await supabase
        .from("client_sends")
        .select("id")
        .eq("token", token)
        .eq("listing_id", listingId)
        .maybeSingle();
      sendId = send?.id ?? null;
    }

    const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
    const rows = events
      .map((e: any) => {
        const kind = typeof e?.kind === "string" ? e.kind : "";
        if (!KINDS.has(kind)) return null;
        const photoId = clean(e.photoId, 40, /[^a-f0-9-]/gi);
        const videoId = clean(e.videoId, 40, /[^a-f0-9-]/gi);
        const value = Number.isFinite(Number(e.value)) ? Math.max(0, Math.min(3600, Math.round(Number(e.value)))) : null;
        return {
          listing_id: listingId,
          slug,
          session_id: sessionId,
          send_id: sendId,
          photo_id: photoId,
          video_id: videoId,
          kind,
          value,
        };
      })
      .filter(Boolean);

    if (rows.length) await supabase.from("slideshow_events").insert(rows);

    // Session summary — update the view row this session opened with.
    const sess = body.session;
    if (sessionId && sess && typeof sess === "object") {
      const durationS = Number.isFinite(Number(sess.durationS)) ? Math.max(0, Math.min(6 * 3600, Math.round(Number(sess.durationS)))) : null;
      const photosSeen = Number.isFinite(Number(sess.photosSeen)) ? Math.max(0, Math.min(5000, Math.round(Number(sess.photosSeen)))) : null;
      if (durationS !== null || photosSeen !== null) {
        const { data: view } = await supabase
          .from("slideshow_views")
          .select("id, duration_s, photos_seen")
          .eq("listing_id", listingId)
          .eq("session_id", sessionId)
          .order("viewed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (view) {
          await supabase.from("slideshow_views").update({
            duration_s: durationS !== null ? Math.max(durationS, view.duration_s ?? 0) : view.duration_s,
            photos_seen: photosSeen !== null ? Math.max(photosSeen, view.photos_seen ?? 0) : view.photos_seen,
          }).eq("id", view.id);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
