import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { isDemoUser } from "@/lib/demo";
import { rateLimited } from "@/lib/simpleRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /demo/{token} — opens the read-only sample broker account (Nov 10, 2026).
 *
 * No sign-in. The token is a long random string handed out by YachtPics;
 * only its sha256 is stored (`demo_links.token_hash`, migration
 * 20261110_demo_link.sql, service role only). The raw token is never stored
 * or logged — nothing below logs the URL, and the page sets
 * Referrer-Policy: no-referrer so it doesn't leak onward.
 *
 * Steps: link-preview bot / prefetch? stop (no database touched) → shape
 * check (43–200 chars of [A-Za-z0-9_-], i.e. at least 32 random bytes
 * base64url) → sha256 → look the hash up (service role) → constant-time
 * compare → not revoked, not expired → the demo user, looked up BY ID from
 * demo_accounts and required to carry app_metadata.demo === true and the
 * email demo_accounts recorded → (if someone else is signed in here, stop:
 * we never replace a real session) → a fresh random password on the demo
 * user (never logged or returned — so no password from an earlier session
 * outlives the link) → count the use (atomic, best effort) → mint a session
 * server-side (admin generateLink magiclink → hashed_token → verifyOtp on a
 * cookie-writing SSR client; the pair is retried once) → 303 to /dashboard.
 *
 * The token is in the URL, so it IS in Vercel's request logs: keep link
 * expiries short (docs/where-we-are.md).
 *
 * Every failure is the same 404 "This demo link isn't active." — whether the
 * token never existed, was revoked, expired, or the demo isn't set up (the
 * migration not applied, demo_seed not run). Nothing says which.
 */

const TOKEN_RE = /^[A-Za-z0-9_-]{43,200}$/;

/**
 * Link-preview bots and security scanners (Slack, iMessage/WhatsApp, Outlook
 * Safe Links…) GET a pasted link to build a preview. They must not mint a
 * session (their cookies would hold a live demo login) — they get the same
 * 404 as a dead link. A missing User-Agent is treated the same way (every
 * browser sends one). Not a security boundary on its own — a click-through
 * interstitial (POST) is on the "before public" list in docs/where-we-are.md.
 */
const BOT_UA_RE = /slackbot|twitterbot|facebookexternalhit|facebookcatalog|meta-externalagent|discordbot|whatsapp|telegrambot|linkedinbot|skypeuripreview|google-inspectiontool|googlebot|bingpreview|bingbot|applebot|embedly|redditbot|pinterest|vkshare|iframely|outbrain|bot\b|bot\/|crawler|crawl|spider|preview|scanner|headless/i;

function isPreviewOrPrefetch(req: NextRequest): boolean {
  const ua = req.headers.get("user-agent") ?? "";
  if (!ua.trim() || BOT_UA_RE.test(ua)) return true;
  const purpose = [req.headers.get("purpose"), req.headers.get("sec-purpose"), req.headers.get("x-purpose"), req.headers.get("x-moz")]
    .map((v) => (v ?? "").toLowerCase())
    .join(" ");
  return /prefetch|prerender|preview/.test(purpose);
}

const COMMON_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};

function page(title: string, body: string, status: number): NextResponse {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#050b14;color:#e8edf3;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}main{max-width:26rem;padding:2rem;text-align:center}h1{font-size:1.25rem;font-weight:600;margin:0 0 .5rem}p{color:#9aa7b6;margin:0 0 1.25rem}a{color:#c39e4e}</style></head>
<body><main><h1>${title}</h1>${body}</main></body></html>`;
  return new NextResponse(html, { status, headers: { ...COMMON_HEADERS, "Content-Type": "text/html; charset=utf-8" } });
}

function inactive(): NextResponse {
  return page("This demo link isn't active.", `<p>Ask YachtPics for a new one.</p><p><a href="https://portal.yachtpics.com/see">See what the Portal does →</a></p>`, 404);
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

function clientIp(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    // Link previews / prefetches: the generic 404, before anything else.
    if (isPreviewOrPrefetch(req)) return inactive();

    // Tokens are long random strings, so guessing is hopeless; this just
    // keeps a script from hammering the lookup. Per server instance.
    if (rateLimited(`demo-link:${clientIp(req)}`, 20, 10 * 60_000)) return inactive();

    const token = typeof params?.token === "string" ? params.token : "";
    if (!TOKEN_RE.test(token)) return inactive();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anon || !serviceKey) return inactive();
    const svc = createServiceClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // ── the link ──────────────────────────────────────────────────────────
    const hash = sha256Hex(token);
    const { data: link, error: linkErr } = await svc
      .from("demo_links")
      .select("id, token_hash, expires_at, revoked_at")
      .eq("token_hash", hash)
      .maybeSingle();
    if (linkErr || !link) return inactive();
    if (!sameHex(String(link.token_hash), hash)) return inactive();
    if (link.revoked_at) return inactive();
    if (!link.expires_at || Date.parse(String(link.expires_at)) <= Date.now()) return inactive();

    // ── the demo user, by id ──────────────────────────────────────────────
    const { data: accounts, error: accErr } = await svc
      .from("demo_accounts")
      .select("user_id, email, listing_id")
      .order("created_at", { ascending: true })
      .limit(1);
    const account = !accErr && accounts && accounts[0] ? (accounts[0] as { user_id: string; email: string | null; listing_id: string | null }) : null;
    if (!account?.user_id || !account.email || !account.listing_id) return inactive();
    const { data: got, error: userErr } = await svc.auth.admin.getUserById(account.user_id);
    const demoUser = got?.user ?? null;
    if (userErr || !demoUser || !isDemoUser(demoUser)) return inactive();
    // The login email must still be the one demo_seed set: if it was changed
    // (Supabase Auth's own email change, outside our routes), refuse rather
    // than mint a session for an address someone else may now control.
    if ((demoUser.email ?? "").toLowerCase() !== account.email.toLowerCase()) {
      console.warn("[demo] demo user's email no longer matches demo_accounts — refusing; re-run demo_seed.");
      return inactive();
    }

    // ── who is signed in here already ─────────────────────────────────────
    const pending: { name: string; value: string; options: CookieOptions }[] = [];
    const ssr = createServerClient(url, anon, {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach((c) => pending.push(c));
        },
      },
    });
    const { data: current } = await ssr.auth.getUser();
    if (current?.user && !isDemoUser(current.user)) {
      return page(
        "You're signed in — sign out to open the demo.",
        `<p>This browser is signed in to a YachtPics account. The demo would replace that session, so it won't open here.</p><p><a href="/dashboard">Back to your dashboard →</a></p>`,
        409
      );
    }

    // ── a fresh password nobody knows (H2) ────────────────────────────────
    // 48 random bytes, never stored, logged or returned. Anyone who somehow
    // learned an earlier one (e.g. set it from inside a demo session through
    // Supabase Auth directly) loses it the next time a link is opened.
    const { error: pwErr } = await svc.auth.admin.updateUserById(account.user_id, { password: randomBytes(48).toString("base64url") });
    if (pwErr) return inactive();

    // ── count the use (atomic, best effort; never blocks the demo) ────────
    // demo_link_touch() is one `use_count = use_count + 1` UPDATE, so two
    // opens at once can't lose a count — and a failure here is ignored.
    await svc.rpc("demo_link_touch", { p_id: link.id }).then(() => {}, () => {});

    // ── mint the session ──────────────────────────────────────────────────
    // generateLink does NOT send an email; it returns the token Supabase
    // would have mailed. verifyOtp on the SSR client then writes the normal
    // sb-…-auth-token cookies (collected in `pending`, set on the redirect).
    // A verifyOtp failure (e.g. a transient Auth error) gets one fresh
    // generateLink → verifyOtp retry.
    const mint = async (): Promise<boolean> => {
      const { data: gen, error: genErr } = await svc.auth.admin.generateLink({ type: "magiclink", email: account.email as string });
      const tokenHash = gen?.properties?.hashed_token;
      if (genErr || !tokenHash || gen?.user?.id !== account.user_id) return false;
      const { data: verified, error: verifyErr } = await ssr.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
      return !verifyErr && !!verified?.session && verified.user?.id === account.user_id && isDemoUser(verified.user);
    };
    let minted = await mint();
    if (!minted) {
      pending.length = 0;
      minted = await mint();
    }
    if (!minted) return inactive();

    const res = NextResponse.redirect(new URL("/dashboard", req.url), 303);
    Object.keys(COMMON_HEADERS).forEach((k) => res.headers.set(k, COMMON_HEADERS[k]));
    pending.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
    return res;
  } catch {
    // Never echo the error (or the token) anywhere.
    return inactive();
  }
}
