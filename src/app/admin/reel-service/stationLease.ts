/**
 * The render station's lease (localStorage, this browser only): one
 * /admin/reel-service/render tab renders at a time. The holder rewrites it
 * every LEASE_REFRESH_MS; a lease older than LEASE_STALE_MS is free to take.
 * The server-side guard (the `rendering` claim) still stops two browsers
 * rendering the same reel.
 */
export const LEASE_KEY = "reelStationLease";
export const LEASE_REFRESH_MS = 10_000;
export const LEASE_STALE_MS = 30_000;

/** `since`: when that station was opened; `running`: false while it's paused. */
export type StationLease = { id: string; at: number; since?: number; running?: boolean };

export function readLease(): StationLease | null {
  try {
    const raw = window.localStorage.getItem(LEASE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StationLease;
    return v && typeof v.id === "string" && typeof v.at === "number" ? v : null;
  } catch {
    return null;
  }
}

export function writeLease(l: StationLease) {
  try { window.localStorage.setItem(LEASE_KEY, JSON.stringify(l)); } catch { /* private window: no lease, still renders */ }
}

export function clearLease(id: string) {
  try {
    const cur = readLease();
    if (cur && cur.id === id) window.localStorage.removeItem(LEASE_KEY);
  } catch { /* ignore */ }
}

export function leaseFresh(l: StationLease | null, now = Date.now()): l is StationLease {
  return !!l && now - l.at < LEASE_STALE_MS;
}

/** "12 s", "3 min", "2 h". */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m} min` : `${Math.round(m / 60)} h`;
}
