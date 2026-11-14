import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { isBotUa } from "@/lib/emailTracking";
import { deviceClass } from "@/lib/viewSource";
import { isDemoUser } from "@/lib/demo";
import { seeVideoKeys } from "@/app/see/_components/seeVideos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/see/event — play metrics for the Portal marketing videos (Nov 14).
 *
 * Sent by /see (src/app/see/_components/trackVideo.ts) and by the tour video
 * on yachtpics.com (a pasted inline script, cross-origin, text/plain body
 * via navigator.sendBeacon). Rows go to marketing_video_events (service role
 * only); the numbers show on /admin/video-metrics.
 *
 * Public and unauthenticated by design. The middleware matches /api/* only
 * for the demo read-only gate: a request with no Supabase session passes
 * straight through, and a DEMO session's POST is refused there (403) — which
 * is exactly "don't count the demo".
 *
 * Body (JSON, as application/json or text/plain):
 *   { surface, video, event, visitor?, seconds? }
 * Everything is checked against allow-lists; anything else is dropped.
 * Stored: those fields + device class (phone/tablet/desktop) + the Referer's
 * host. Never stored: IP address, full user agent, cookies.
 *
 * Always answers 204 with no body — a visitor's video must never notice.
 */

const SURFACES = ["see", "yachtpics_home", "yachtpics_portal"];
const EVENTS = ["play", "q25", "q50", "q75", "complete", "walk_click", "access_click"];
const VIDEO_KEYS = seeVideoKeys();
const ALLOWED_ORIGINS = ["https://www.yachtpics.com", "https://yachtpics.com"];
const MAX_BODY = 1024;
const DEDUPE_MS = 30 * 1000;
/** Cap each database call: supabase-js retries a failed read for ~7 s, and a visitor's beacon must not hold a function open that long. */
const DB_TIMEOUT_MS = 1500;
const VISITOR_RE = /^[A-Za-z0-9_-]{6,40}$/;
const AUTH_COOKIE_RE = /^sb-.+-auth-token(\.\d+)?$/;

/** Same-origin (Origin host = this request's host) or one of the allowed sites. */
function originOk(req: NextRequest, origin: string | null): boolean {
  if (!origin) return true; // same-origin GET-style / curl / older browsers
  if (ALLOWED_ORIGINS.indexOf(origin) >= 0) return true;
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin");
  const h: Record<string, string> = { "Cache-Control": "no-store", Vary: "Origin" };
  if (origin && ALLOWED_ORIGINS.indexOf(origin) >= 0) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

function done(req: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

function refererHost(req: NextRequest): string | null {
  const ref = req.headers.get("referer");
  if (!ref) return null;
  try {
    const host = new URL(ref.slice(0, 500)).hostname.toLowerCase();
    return /^[a-z0-9.-]{1,120}$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

/**
 * Signed-in admin or demo account → don't count (the owner's own testing).
 * Only runs when a Supabase auth cookie is present, so anonymous visitors
 * pay nothing for it. Cross-site beacons from yachtpics.com never carry the
 * Portal's (SameSite=Lax) cookies.
 */
async function isStaffOrDemo(req: NextRequest, svc: SupabaseClient): Promise<boolean> {
  if (!req.cookies.getAll().some((c) => AUTH_COOKIE_RE.test(c.name))) return false;
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    if (isDemoUser(user)) return true;
    const { data: profile } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
    return (profile as { role?: string } | null)?.role === "admin";
  } catch {
    return false;
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  try {
    if (!originOk(req, req.headers.get("origin"))) return done(req);
    const len = Number(req.headers.get("content-length") ?? "0");
    if (len > MAX_BODY) return done(req);
    const ua = req.headers.get("user-agent");
    if (!ua || isBotUa(ua)) return done(req);

    const text = await req.text();
    if (!text || text.length > MAX_BODY) return done(req);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return done(req);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return done(req);
    const b = body as Record<string, unknown>;

    const surface = typeof b.surface === "string" ? b.surface : "";
    const video = typeof b.video === "string" ? b.video : "";
    const event = typeof b.event === "string" ? b.event : "";
    if (SURFACES.indexOf(surface) < 0 || VIDEO_KEYS.indexOf(video) < 0 || EVENTS.indexOf(event) < 0) return done(req);
    const visitor = typeof b.visitor === "string" && VISITOR_RE.test(b.visitor) ? b.visitor : null;
    const secNum = Number(b.seconds);
    const seconds = b.seconds !== undefined && b.seconds !== null && Number.isFinite(secNum)
      ? Math.max(0, Math.min(36000, Math.round(secNum)))
      : null;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return done(req);
    const svc = createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    if (await isStaffOrDemo(req, svc)) return done(req);

    // Light abuse guard: the same visitor + video + event within 30 s counts once.
    if (visitor) {
      const { data: recent } = await svc
        .from("marketing_video_events")
        .select("id")
        .eq("visitor", visitor)
        .eq("video", video)
        .eq("event", event)
        .gte("created_at", new Date(Date.now() - DEDUPE_MS).toISOString())
        .limit(1)
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
      if (recent && recent.length) return done(req);
    }

    await svc.from("marketing_video_events").insert({
      surface,
      video,
      event,
      visitor,
      device: deviceClass(ua),
      referrer_host: refererHost(req),
      seconds_watched: seconds,
    }).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    return done(req);
  } catch {
    return done(req);
  }
}
