/**
 * Prefilled title and description for "Upload to YouTube" (Nov 27, 2026).
 * Pure functions — no I/O — checked by scripts/youtube_upload_check.ts.
 *
 * Rules (Charlie): only fields that exist, never invent. The title is the
 * boat line (year, builder, model, length) plus the vessel name in quotes.
 * The description is that line, then "Offered by {broker}, {brokerage}"
 * (only the parts that exist), a blank line, and the YachtPics credit.
 * Never a location, a price, the broker's own listing description, a phone
 * number or an email. The admin can edit both before uploading.
 */
import { YOUTUBE_DESCRIPTION_MAX, YOUTUBE_TITLE_MAX } from "./config";

export type YouTubeListingFacts = {
  vessel_name?: string | null;
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
  length_ft?: number | string | null;
};

export type YouTubeBrokerFacts = {
  first_name?: string | null;
  last_name?: string | null;
  brokerage_name?: string | null;
};

export const YACHTPICS_CREDIT = "Photos and video by YachtPics · yachtpics.com";

/** YouTube refuses "<" and ">" in titles and descriptions. */
function clean(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lengthText(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  const rounded = Math.round(n * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}'`;
}

function yearText(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 1800 && n <= 2200 ? String(Math.round(n)) : "";
}

/** "2021 Everglades 365CC 36'" — only the parts that exist. */
export function boatLine(l: YouTubeListingFacts): string {
  const make = clean(l.make);
  const model = clean(l.model);
  // A model typed as "Everglades 365CC" shouldn't read "Everglades Everglades 365CC".
  const makeShown = make && !(model && model.toLowerCase().indexOf(make.toLowerCase()) === 0) ? make : "";
  return [yearText(l.year), makeShown, model, lengthText(l.length_ft)].filter(Boolean).join(" ");
}

/** Cut to `max` characters, at a word boundary when that keeps most of it. */
export function trimTo(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space >= max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s—\-–,·]+$/, "");
}

/** `2021 Everglades 365CC — "Everglade"`, trimmed to 100 characters. */
export function youtubeTitle(l: YouTubeListingFacts): string {
  const line = boatLine(l);
  const name = clean(l.vessel_name).replace(/^"+|"+$/g, "");
  const quoted = name ? `"${name}"` : "";
  const full = line && quoted ? `${line} — ${quoted}` : line || quoted || "Listing video";
  if (full.length <= YOUTUBE_TITLE_MAX) return full;
  // Too long: keep the vessel name whole if the boat line can give way.
  if (line && quoted && quoted.length + 3 < YOUTUBE_TITLE_MAX - 10) {
    const room = YOUTUBE_TITLE_MAX - quoted.length - 3;
    return `${trimTo(line, room)} — ${quoted}`;
  }
  return trimTo(full, YOUTUBE_TITLE_MAX);
}

/** "Offered by Kelly Sprigg, SYC Yachts" — or null when neither part exists. */
export function offeredByLine(b: YouTubeBrokerFacts | null | undefined): string | null {
  if (!b) return null;
  const name = clean([b.first_name, b.last_name].filter(Boolean).join(" "));
  const brokerage = clean(b.brokerage_name);
  const parts = [name, brokerage].filter(Boolean);
  return parts.length ? `Offered by ${parts.join(", ")}` : null;
}

export function youtubeDescription(l: YouTubeListingFacts, b: YouTubeBrokerFacts | null | undefined): string {
  const lines: string[] = [];
  const first = youtubeTitle(l);
  if (first !== "Listing video") lines.push(first);
  const offered = offeredByLine(b);
  if (offered) lines.push(offered);
  if (lines.length) lines.push("");
  lines.push(YACHTPICS_CREDIT);
  return trimTo(lines.join("\n"), YOUTUBE_DESCRIPTION_MAX);
}

/** What the server accepts from the dialog: cleaned and capped. */
export function sanitizeTitle(raw: unknown): string {
  return trimTo(clean(typeof raw === "string" ? raw : ""), YOUTUBE_TITLE_MAX);
}

export function sanitizeDescription(raw: unknown): string {
  const s = String(typeof raw === "string" ? raw : "")
    .replace(/[<>]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return s.length > YOUTUBE_DESCRIPTION_MAX ? s.slice(0, YOUTUBE_DESCRIPTION_MAX) : s;
}
