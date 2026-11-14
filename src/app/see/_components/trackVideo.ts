/**
 * Play metrics for the /see videos (Nov 14) — tiny, first-party, anonymous.
 *
 * Events go to POST /api/see/event (stored in marketing_video_events, shown
 * on /admin/video-metrics). The visitor id is a random string kept in
 * sessionStorage for this tab (in memory if storage is blocked) — no cookies.
 * Sent with navigator.sendBeacon (fetch keepalive as a fallback); nothing
 * here can throw into, block or slow the player.
 *
 * Opt-out: localStorage "yp_no_track" = "1" (the toggle on the admin Video
 * metrics page) and this browser sends nothing.
 */

export type SeeVideoEvent = "play" | "q25" | "q50" | "q75" | "complete" | "walk_click" | "access_click";

const ENDPOINT = "/api/see/event";
const VISITOR_KEY = "yp_see_visitor";
export const NO_TRACK_KEY = "yp_no_track";

let memVisitor: string | null = null;

function newId(): string {
  let s = "v";
  for (let i = 0; i < 4; i++) s += Math.random().toString(36).slice(2, 8);
  return s.slice(0, 24);
}

function visitorId(): string {
  try {
    const got = window.sessionStorage.getItem(VISITOR_KEY);
    if (got) return got;
    const id = memVisitor ?? newId();
    window.sessionStorage.setItem(VISITOR_KEY, id);
    memVisitor = id;
    return id;
  } catch {
    if (!memVisitor) memVisitor = newId();
    return memVisitor;
  }
}

function optedOut(): boolean {
  try {
    return window.localStorage.getItem(NO_TRACK_KEY) === "1";
  } catch {
    return false;
  }
}

/** Fire-and-forget. Never throws. */
export function sendSeeEvent(video: string, event: SeeVideoEvent, seconds?: number | null): void {
  try {
    if (typeof window === "undefined" || optedOut()) return;
    const body = JSON.stringify({
      surface: "see",
      video,
      event,
      visitor: visitorId(),
      seconds: typeof seconds === "number" && isFinite(seconds) ? Math.round(seconds) : undefined,
    });
    if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body)) return;
    fetch(ENDPOINT, { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(() => { /* ignore */ });
  } catch {
    /* metrics must never break the page */
  }
}

const QUARTERS: { at: number; event: SeeVideoEvent }[] = [
  { at: 0.25, event: "q25" },
  { at: 0.5, event: "q50" },
  { at: 0.75, event: "q75" },
];

/**
 * Listen to a <video> and report play / q25 / q50 / q75 / complete, each at
 * most once per video key per page view. `getKey` names what is playing now
 * (the lightbox swaps sources on one element). Returns a cleanup function.
 */
export function attachVideoTracking(video: HTMLVideoElement, getKey: () => string | null): () => void {
  const sent: Record<string, true> = {};
  function once(key: string, event: SeeVideoEvent, seconds?: number | null) {
    const id = key + ":" + event;
    if (sent[id]) return;
    sent[id] = true;
    sendSeeEvent(key, event, seconds);
  }
  function onPlay() {
    try {
      const key = getKey();
      if (key) once(key, "play");
    } catch { /* ignore */ }
  }
  function onTime() {
    try {
      const key = getKey();
      const d = video.duration;
      if (!key || !d || !isFinite(d) || d <= 0) return;
      const f = video.currentTime / d;
      for (let i = 0; i < QUARTERS.length; i++) {
        if (f >= QUARTERS[i].at) once(key, QUARTERS[i].event, video.currentTime);
      }
    } catch { /* ignore */ }
  }
  function onEnded() {
    try {
      const key = getKey();
      if (key) once(key, "complete", isFinite(video.duration) ? video.duration : null);
    } catch { /* ignore */ }
  }
  video.addEventListener("play", onPlay);
  video.addEventListener("timeupdate", onTime);
  video.addEventListener("ended", onEnded);
  return () => {
    video.removeEventListener("play", onPlay);
    video.removeEventListener("timeupdate", onTime);
    video.removeEventListener("ended", onEnded);
  };
}
