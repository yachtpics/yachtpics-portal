/**
 * Keep one-time tokens out of Vercel Analytics (Nov 11 review L3).
 *
 * /auth/… URLs can carry an emailed link's token_hash (and an email address);
 * /demo/{token} carries the demo entry token in the path. For those, drop the
 * query string and hash, and replace the demo token segment with
 * "/demo/[token]". Named demo pages (exit, brian-nopper) keep their path.
 * Everything else is returned unchanged. Pure — no browser APIs beyond URL.
 */
const DEMO_NAMED = ["exit", "brian-nopper"];

export function scrubAnalyticsUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  const path = u.pathname;
  const isAuth = path === "/auth" || path.indexOf("/auth/") === 0;
  const isDemo = path === "/demo" || path.indexOf("/demo/") === 0;
  if (!isAuth && !isDemo) return raw;
  u.search = "";
  u.hash = "";
  if (isDemo) {
    const parts = path.split("/"); // ["", "demo", seg, ...]
    if (parts.length > 2 && parts[2] && DEMO_NAMED.indexOf(parts[2]) < 0) {
      u.pathname = "/demo/[token]";
    }
  }
  return u.toString();
}
