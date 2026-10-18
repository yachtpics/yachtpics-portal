/**
 * A deliberately small in-memory rate limiter: "no more than N calls per
 * window for this key". It lives in one server instance's memory, so on Vercel
 * each warm instance counts separately — fine for its job, which is stopping a
 * runaway tab (or a script) from hammering a public route, not billing-grade
 * accounting.
 */
const hits = new Map<string, number[]>();

export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  // Keep the map from growing without bound on a long-lived instance.
  if (hits.size > 5000) {
    Array.from(hits.keys()).forEach((k) => {
      const ts = (hits.get(k) ?? []).filter((t) => now - t < windowMs);
      if (ts.length === 0) hits.delete(k);
      else hits.set(k, ts);
    });
  }
  return false;
}
