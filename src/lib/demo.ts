/**
 * The read-only DEMO account (Nov 10, 2026) — shared, browser- and edge-safe.
 *
 * One Supabase auth user whose `app_metadata` carries `{ "demo": true }`.
 * app_metadata can only be written with the service role (a signed-in user
 * can't change it), and it rides inside every access token Supabase issues
 * for that user, so THE marker everything keys on is that JWT claim — never a
 * cookie of our own, never a profile column, never anything the browser can
 * set.
 *
 * Who checks it:
 *   1. src/middleware.ts — refuses non-GET /api requests (403) unless on
 *      DEMO_POST_ALLOWLIST below.
 *   2. migration 20261110_demo_link.sql — RESTRICTIVE RLS policies on every
 *      public table + storage.objects: no insert / update / delete with the claim.
 *   3. demoGuard() / isDemoUser() in EVERY service-role write route a
 *      signed-in broker can reach (Stripe, email, uploads, deletes, edits,
 *      invites, social, AI…) — see src/lib/demoServer.ts. Layer 1 can be
 *      raced; this layer is the one that must be complete.
 *
 * The /demo/{token} route (src/app/demo/[token]/route.ts) is the only way in.
 */

export const DEMO_READ_ONLY_MESSAGE = "The demo is read-only.";

/** Response header the middleware puts on a demo 403, so the page can toast it. */
export const DEMO_BLOCK_HEADER = "x-demo-readonly";

/** The demo account's identity (re-asserted by the demo_seed job on every run). */
export const DEMO_EMAIL = "demo@yachtpics.com";
export const DEMO_FIRST_NAME = "Charlie";
export const DEMO_LAST_NAME = "Clark";
export const DEMO_COMPANY = "YachtPics";
/** Where "Request access →" goes — the same place /see's button links. */
export const DEMO_REQUEST_ACCESS_PATH = "/auth/signup";
/** Signs the demo out of this browser, then goes to DEMO_REQUEST_ACCESS_PATH. */
export const DEMO_EXIT_PATH = "/demo/exit";

/** True when a (verified, server-fetched) Supabase user carries the demo claim. */
export function isDemoUser(user: { app_metadata?: Record<string, unknown> | null } | null | undefined): boolean {
  return !!user && !!user.app_metadata && user.app_metadata.demo === true;
}

/**
 * The demo claim from an access token's PAYLOAD, without verifying the
 * signature. Sound ONLY for blocking: a forged token that hides the claim
 * still fails getUser() in the route it reaches (Supabase Auth checks the
 * signature), so hiding it buys nothing. Never use this to GRANT anything.
 * Edge-safe (atob + TextDecoder only). Malformed → false.
 */
export function accessTokenHasDemoClaim(token: string | null | undefined): boolean {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "===".slice((b64.length + 3) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { app_metadata?: { demo?: unknown } };
    return !!payload && !!payload.app_metadata && payload.app_metadata.demo === true;
  } catch {
    return false;
  }
}

/**
 * POST (or other non-GET) /api endpoints a demo session MAY call: each only
 * signs URLs or reads. Everything else that isn't GET/HEAD/OPTIONS is refused
 * for the demo by the middleware. Patterns are matched against the whole
 * pathname. Keep this list short and justify every line.
 */
export const DEMO_POST_ALLOWLIST: { pattern: RegExp; why: string }[] = [
  // Listing page photo grid: one access check, signs 600 px tiles. (May kick
  // derivative generation for the demo's OWN photos — cached copies only.)
  { pattern: /^\/api\/thumbs$/, why: "signs thumbnail URLs for the grid" },
  // Lightbox / Full-size downloads of R2 originals: signs, scoped by the caller's RLS read.
  { pattern: /^\/api\/photos\/originals$/, why: "signs original-photo URLs (caller's RLS decides)" },
  // Photos button / Download all at Web & MLS / Social: signs (may make a
  // missing download-size file for the demo's OWN photo — a cached copy).
  { pattern: /^\/api\/listings\/[0-9a-f-]{36}\/photos\/download-urls$/i, why: "signs sized download URLs" },
  // Listing page / Reel Maker video players: signs video links.
  { pattern: /^\/api\/videos\/signed-urls$/, why: "signs video URLs" },
  // The demo's own public slideshow (/s/{slug}) loads its photos through this.
  { pattern: /^\/api\/s\/[^/]+\/urls$/, why: "public slideshow photo signing (no session used)" },
];

export function demoPostAllowed(pathname: string): boolean {
  return DEMO_POST_ALLOWLIST.some((a) => a.pattern.test(pathname));
}
