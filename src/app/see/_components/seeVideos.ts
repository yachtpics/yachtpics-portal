/**
 * The Portal marketing videos shown on /see — one place to update them.
 *
 * Files live in public/see/videos/ (served at /see/videos/…) and posters in
 * public/see/posters/ with the same name and .jpg. To replace a video, drop
 * the new web copy in under the same file name (or change the name here),
 * make a new poster, and update `walkDuration` / `duration` to the new
 * length as the player shows it (whole seconds, rounded down).
 */

export const SEE_VIDEO_DIR = "/see/videos";
export const SEE_POSTER_DIR = "/see/posters";

/** Posters are 720 × 1280 JPEGs (9:16). */
export const POSTER_WIDTH = 720;
export const POSTER_HEIGHT = 1280;

export function videoSrc(file: string): string {
  return `${SEE_VIDEO_DIR}/${file}`;
}

/** Poster for a video file: same name, .jpg, in the posters folder. */
export function posterSrc(file: string): string {
  return `${SEE_POSTER_DIR}/${file.replace(/\.mp4$/i, "")}.jpg`;
}

export type SeeTour = {
  file: string;
  /** m:ss */
  duration: string;
};

export const SEE_TOUR: SeeTour = {
  file: "overview.mp4",
  duration: "1:53",
};

export type SeeTool = {
  key: string;
  name: string;
  line: string;
  /** The ~15-second quick look, played first. */
  teaseFile: string;
  /** The full walkthrough. */
  walkFile: string;
  /** Length of the walkthrough, m:ss, shown on its button. */
  walkDuration: string;
};

export const SEE_TOOLS: SeeTool[] = [
  { key: "delivery", name: "Photo delivery", line: "Every photo, delivered.", teaseFile: "delivery-tease.mp4", walkFile: "delivery-walk.mp4", walkDuration: "0:43" },
  { key: "slideshow", name: "Buyer slideshow", line: "Send the boat, not a folder.", teaseFile: "slideshow-tease.mp4", walkFile: "slideshow-walk.mp4", walkDuration: "1:06" },
  { key: "specsheet", name: "Spec sheet", line: "A branded spec sheet.", teaseFile: "specsheet-tease.mp4", walkFile: "specsheet-walk.mp4", walkDuration: "0:48" },
  { key: "reel", name: "Listing reel", line: "A reel in about a minute.", teaseFile: "reel-tease.mp4", walkFile: "reel-walk.mp4", walkDuration: "1:22" },
  { key: "social", name: "Social post", line: "Just listed. Posted in a minute.", teaseFile: "social-tease.mp4", walkFile: "social-walk.mp4", walkDuration: "0:53" },
  { key: "report", name: "Seller Report", line: "Show your seller the work.", teaseFile: "report-tease.mp4", walkFile: "report-walk.mp4", walkDuration: "0:52" },
  { key: "own", name: "Your own photos", line: "Already have photos? Bring them.", teaseFile: "own-tease.mp4", walkFile: "own-walk.mp4", walkDuration: "1:06" },
];

/**
 * Play-metrics key for a video file: the file name without ".mp4"
 * ("overview", "reel-tease", "reel-walk"). Stored in
 * marketing_video_events.video and checked by /api/see/event.
 */
export function videoKey(file: string): string {
  return file.replace(/\.mp4$/i, "");
}

export type SeeVideoRow = {
  key: string;
  /** "Portal tour", "Listing reel — quick look", "Listing reel — full walkthrough". */
  label: string;
  kind: "tour" | "tease" | "walk";
  /** For a quick look: the key of its walkthrough (whose button clicks are stored under it). */
  walkKey?: string;
};

/** Every video in page order: the tour, then each tool's quick look and walkthrough. */
export function seeVideoRows(): SeeVideoRow[] {
  const rows: SeeVideoRow[] = [{ key: videoKey(SEE_TOUR.file), label: "Portal tour", kind: "tour" }];
  SEE_TOOLS.forEach((t) => {
    const walkKey = videoKey(t.walkFile);
    rows.push({ key: videoKey(t.teaseFile), label: `${t.name} — quick look`, kind: "tease", walkKey });
    rows.push({ key: walkKey, label: `${t.name} — full walkthrough`, kind: "walk" });
  });
  return rows;
}

/** The allow-list of video keys the event route accepts. */
export function seeVideoKeys(): string[] {
  return seeVideoRows().map((r) => r.key);
}
