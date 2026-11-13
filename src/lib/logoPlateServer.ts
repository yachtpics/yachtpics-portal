import sharp from "sharp";
import { LOGO_ANALYSIS_MAX, LOGO_PLATE_COLOR, analyseLogoContrast, isDarkBackground, logoPlateBox } from "@/lib/logoContrast";

/**
 * Server side of the logo plate (src/lib/logoContrast.ts) — for pages that
 * render the broker's logo as HTML on a dark background (spec sheet, seller
 * report, broker website on a dark look). Analysed at request time so the
 * first paint and the PRINT/PDF output are already right (no flash, no
 * stored flag).
 *
 * Only logos in our own Supabase storage are fetched. Strict timeout, small
 * in-memory cache keyed by the URL (its ?t= stamp changes on every upload)
 * and background. Any failure → "no plate" (drawn as today).
 */

const TIMEOUT_MS = 2500;
const MAX_BYTES = 4 * 1024 * 1024;
const CACHE_MAX = 300;

export type LogoPlateInfo = { needsPlate: boolean; aspect: number | null };

const cache = new Map<string, LogoPlateInfo>();

function ownStorageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const ours = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host;
    return u.protocol === "https:" && u.host === ours;
  } catch {
    return false;
  }
}

export async function logoPlateInfo(url: string | null | undefined, bgHex: string): Promise<LogoPlateInfo> {
  const none: LogoPlateInfo = { needsPlate: false, aspect: null };
  if (!url || !isDarkBackground(bgHex) || !ownStorageUrl(url)) return none;
  const key = `${bgHex.toLowerCase()}|${url}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let result = none;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return none; // not cached: may be a passing error
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return none;
    const { data, info } = await sharp(buf)
      .resize(LOGO_ANALYSIS_MAX, LOGO_ANALYSIS_MAX, { fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const r = analyseLogoContrast(data, info.width, info.height, bgHex);
    result = { needsPlate: r.needsPlate, aspect: info.height > 0 ? info.width / info.height : null };
  } catch {
    return none; // timeout, bad image — draw as today, try again next request
  } finally {
    clearTimeout(timer);
  }
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next();
    if (!first.done) cache.delete(first.value);
  }
  cache.set(key, result);
  return result;
}

/**
 * Inline style for the plate wrapped around an <img> rendered at `logoH` px
 * tall (HTML pages). No print-color-adjust: it prints (or not) exactly like
 * the dark bar it sits on, per the browser's "background graphics" setting.
 */
export function logoPlateStyle(logoH: number): Record<string, string | number> {
  const box = logoPlateBox(1, logoH);
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: LOGO_PLATE_COLOR,
    padding: Math.round(box.pad),
    borderRadius: Math.round(box.radius),
    lineHeight: 0,
  };
}
