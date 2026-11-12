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
 *
 * WRITABLE VARIANT — the private FILMING account (Nov 12, 2026). A second
 * demo user whose app_metadata carries `{ "demo": true, "demo_rw": true }`
 * (and `demo_accounts.writable = true`). It is still a demo account, so every
 * "leave the demo out" rule (counts, audiences, showcase, website, emails)
 * applies to it unchanged. Read-only is lifted ONLY for the listing workflow
 * (create / edit own listing, upload / manage photos, videos and documents,
 * slideshow publish, reels), in all three layers:
 *   1. DEMO_RW_ALLOW below (middleware),
 *   2. public.demo_rw_tables() + the demo_rw exemption in
 *      public.demo_apply_readonly_policies() (migration
 *      20261112_demo_rw_filming_account.sql), plus privacy / quota triggers,
 *   3. demoGuard(user, { allowWritableDemo: true }) on exactly the routes in
 *      DEMO_RW_ALLOW — every other route keeps refusing both kinds.
 */

export const DEMO_READ_ONLY_MESSAGE = "The demo is read-only.";

/** Response header the middleware puts on a demo 403, so the page can toast it. */
export const DEMO_BLOCK_HEADER = "x-demo-readonly";

/** The demo account's identity (re-asserted by the demo_seed job on every run). */
export const DEMO_EMAIL = "demo@yachtpics.com";
export const DEMO_FIRST_NAME = "Charlie";
export const DEMO_LAST_NAME = "Clark";
export const DEMO_COMPANY = "YachtPics";
/** The FILMING account's identity (re-asserted by the demo_rw_seed job on every run). */
export const FILMING_EMAIL = "filming@yachtpics.com";
export const FILMING_FIRST_NAME = "Sam";
export const FILMING_LAST_NAME = "Carter";
export const FILMING_COMPANY = "Carter Yacht Sales";
/** The filming account's banner line. */
export const FILMING_BANNER_TEXT = "Filming account — uploads are on. Nothing here is public.";
/** Toast for a refused action on the filming account (same 403 body as the demo's). */
export const FILMING_BLOCKED_MESSAGE = "That's switched off on the filming account.";
/** Filming links may live at most this long (also enforced by a trigger on demo_links). */
export const FILMING_LINK_MAX_HOURS = 72;
/** Upload caps for the filming account (upload routes + the photos trigger). */
export const FILMING_MAX_PHOTOS = 300;
export const FILMING_MAX_BYTES = 5 * 1024 * 1024 * 1024;

/** Where "Request access →" goes — the same place /see's button links. */
export const DEMO_REQUEST_ACCESS_PATH = "/auth/signup";
/** Signs the demo out of this browser, then goes to DEMO_REQUEST_ACCESS_PATH. */
export const DEMO_EXIT_PATH = "/demo/exit";

/** True when a (verified, server-fetched) Supabase user carries the demo claim. */
export function isDemoUser(user: { app_metadata?: Record<string, unknown> | null } | null | undefined): boolean {
  return !!user && !!user.app_metadata && user.app_metadata.demo === true;
}

/**
 * True for the WRITABLE demo (the filming account): the demo claim AND
 * `demo_rw === true`. Server code must only trust this on a user from
 * getUser() (verified), never on a decoded cookie.
 */
export function isWritableDemoUser(user: { app_metadata?: Record<string, unknown> | null } | null | undefined): boolean {
  return isDemoUser(user) && !!user && !!user.app_metadata && user.app_metadata.demo_rw === true;
}

/**
 * The demo claims from an access token's PAYLOAD, without verifying the
 * signature. Malformed → both false. Edge-safe (atob + TextDecoder only).
 */
export function accessTokenDemoClaims(token: string | null | undefined): { demo: boolean; demoRw: boolean } {
  const none = { demo: false, demoRw: false };
  if (!token || typeof token !== "string") return none;
  const parts = token.split(".");
  if (parts.length !== 3) return none;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "===".slice((b64.length + 3) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { app_metadata?: { demo?: unknown; demo_rw?: unknown } };
    const demo = !!payload && !!payload.app_metadata && payload.app_metadata.demo === true;
    return { demo, demoRw: demo && payload.app_metadata!.demo_rw === true };
  } catch {
    return none;
  }
}

/**
 * The demo claim from an access token's PAYLOAD, without verifying the
 * signature. Sound ONLY for blocking: a forged token that hides the claim
 * still fails getUser() in the route it reaches (Supabase Auth checks the
 * signature), so hiding it buys nothing. Never use this to GRANT anything.
 * (The middleware's DEMO_RW_ALLOW pass is not a grant: it only lets a request
 * reach a route that verifies the user itself and applies layers 2 and 3.)
 * Edge-safe (atob + TextDecoder only). Malformed → false.
 */
export function accessTokenHasDemoClaim(token: string | null | undefined): boolean {
  return accessTokenDemoClaims(token).demo;
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

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Extra non-GET /api endpoints the WRITABLE demo (filming account) may call
 * — the listing workflow only (Nov 12, 2026). Each route listed here also
 * passes `{ allowWritableDemo: true }` to demoGuard (layer 3) and refuses a
 * listing the filming account doesn't own; nothing else is opened. Read-only
 * demo sessions never get these. Keep this list short and justify every line.
 *
 * Deliberately NOT here (still refused for the filming account): send to
 * client / any email, share, showcase opt-out, describe + reel-copy (paid AI
 * text), photo-categories (a GLOBAL list shared by every broker), lead status,
 * boat-show marks, Stripe / billing / Reel Service, website, social, push,
 * logo, assistants / team / brokerage, magic links, admin anything.
 */
export const DEMO_RW_ALLOW: { pattern: RegExp; methods: string[]; why: string }[] = [
  // New listing page → creates the listing (server forces it private).
  { pattern: /^\/api\/listings$/, methods: ["POST"], why: "create own listing (forced pocket / off the website)" },
  // Edit listing details (vessel name, specs, status, deck plan path).
  { pattern: new RegExp(`^/api/listings/${UUID}$`, "i"), methods: ["PATCH"], why: "edit own listing details" },
  // Photo uploads: R2 presign / multipart / discard (quota-checked).
  { pattern: /^\/api\/photos\/upload-target$/, methods: ["POST"], why: "photo upload presign (300 photos / 5 GB cap)" },
  // Upload diagnostics (logs one line, stores nothing).
  { pattern: /^\/api\/photos\/upload-fallback$/, methods: ["POST"], why: "upload fallback log line" },
  // Replace a photo's file.
  { pattern: new RegExp(`^/api/listings/${UUID}/photos/${UUID}/replace$`, "i"), methods: ["POST"], why: "replace own photo" },
  // 600 / 2000 px copies after upload.
  { pattern: new RegExp(`^/api/listings/${UUID}/photos/derivatives$`, "i"), methods: ["POST"], why: "thumbnails for own uploads" },
  // Delete photos.
  { pattern: /^\/api\/photos\/delete$/, methods: ["POST"], why: "delete own photos" },
  // AI room labels ("the portal labels the rooms").
  { pattern: /^\/api\/photos\/categorize$/, methods: ["POST"], why: "AI photo labels (own listing; capped by the photo cap)" },
  // Listing videos: single PUT, multipart, title/description, delete.
  { pattern: /^\/api\/videos\/upload-url$/, methods: ["POST"], why: "video upload presign (quota-checked)" },
  { pattern: /^\/api\/videos\/multipart$/, methods: ["POST"], why: "big video upload (quota-checked)" },
  { pattern: /^\/api\/videos\/details$/, methods: ["POST"], why: "video title / description" },
  { pattern: /^\/api\/videos\/delete$/, methods: ["POST"], why: "delete own video" },
  // Listing documents: upload is direct to storage (RLS); delete goes here.
  { pattern: /^\/api\/documents\/delete$/, methods: ["POST"], why: "delete own document" },
  // Reel Maker: allowance claim (comped → nothing recorded), metrics, Send to my phone (no email).
  { pattern: /^\/api\/reels\/claim$/, methods: ["POST"], why: "reel take-actions (download / add to listing)" },
  { pattern: /^\/api\/reel-events$/, methods: ["POST"], why: "reel render metric" },
  { pattern: new RegExp(`^/api/listings/${UUID}/reel-link$`, "i"), methods: ["POST"], why: "Send to my phone QR (email suppressed)" },
  // Download all — logs the broker's own download.
  { pattern: new RegExp(`^/api/listings/${UUID}/log-download$`, "i"), methods: ["POST"], why: "own download log (no email)" },
];

export function demoRwAllowed(pathname: string, method: string): boolean {
  const m = method.toUpperCase();
  return DEMO_RW_ALLOW.some((a) => a.methods.indexOf(m) >= 0 && a.pattern.test(pathname));
}
