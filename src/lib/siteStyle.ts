/**
 * Broker Websites — layouts and colours (Oct 26). Client-safe.
 *
 * Curated, so a site can't be made ugly: three layouts, six palettes, and an
 * optional accent (the broker's brand colour or a custom pick) that replaces
 * only the palette's accent. A broker's colour is never rejected — its
 * lightness is nudged until button text on it reads at 4.5:1 and it stands
 * at ~3:1 against the page.
 *
 * Applied as CSS custom properties on the site root (siteCssVars) and used by
 * every site component as Tailwind arbitrary values: bg-[var(--site-bg)] …
 */

export const SITE_LAYOUTS = ["classic", "editorial", "showroom"] as const;
export type SiteLayout = (typeof SITE_LAYOUTS)[number];

export const LAYOUT_LABELS: Record<SiteLayout, { name: string; blurb: string }> = {
  classic: { name: "Classic", blurb: "Full-width photo, light pages, yachts in a grid." },
  editorial: { name: "Editorial", blurb: "Magazine feel: split cover, large rows, pull quotes." },
  showroom: { name: "Showroom", blurb: "Cinematic and image-led: your boats full screen." },
};

export type Palette = {
  key: string;
  name: string;
  dark: boolean;
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  /** Hairlines (rgba). */
  rule: string;
  accent: string;
  bandBg: string;
  bandInk: string;
  field: string;
  fieldBorder: string;
};

export const PALETTES: Palette[] = [
  { key: "harbor", name: "Harbor", dark: false, bg: "#ffffff", surface: "#f5f6f8", ink: "#050b14", muted: "#5b6470", rule: "rgba(5,11,20,0.10)", accent: "#c39e4e", bandBg: "#050b14", bandInk: "#ffffff", field: "#ffffff", fieldBorder: "rgba(5,11,20,0.18)" },
  { key: "ivory", name: "Ivory", dark: false, bg: "#fbf8f2", surface: "#f2ece1", ink: "#2a2826", muted: "#6b655c", rule: "rgba(42,40,38,0.12)", accent: "#bfa06a", bandBg: "#2a2826", bandInk: "#fbf8f2", field: "#fffdf9", fieldBorder: "rgba(42,40,38,0.20)" },
  { key: "slate", name: "Slate", dark: false, bg: "#f6f7f9", surface: "#eaedf1", ink: "#1f2a37", muted: "#556173", rule: "rgba(31,42,55,0.12)", accent: "#41709c", bandBg: "#1f2a37", bandInk: "#f6f7f9", field: "#ffffff", fieldBorder: "rgba(31,42,55,0.20)" },
  { key: "teak", name: "Teak", dark: false, bg: "#faf6ef", surface: "#f0e7d8", ink: "#2e2118", muted: "#6e5d4f", rule: "rgba(46,33,24,0.12)", accent: "#9a5b2e", bandBg: "#2e2118", bandInk: "#faf6ef", field: "#fffcf7", fieldBorder: "rgba(46,33,24,0.20)" },
  { key: "midnight", name: "Midnight", dark: true, bg: "#0b1019", surface: "#121a27", ink: "#f3efe6", muted: "#a4abb7", rule: "rgba(255,255,255,0.12)", accent: "#c9a55a", bandBg: "#05080e", bandInk: "#f3efe6", field: "#121a27", fieldBorder: "rgba(255,255,255,0.20)" },
  { key: "coastal", name: "Coastal", dark: false, bg: "#ffffff", surface: "#eff5f4", ink: "#0f1d24", muted: "#546870", rule: "rgba(15,29,36,0.10)", accent: "#3b8a82", bandBg: "#0f1d24", bandInk: "#ffffff", field: "#ffffff", fieldBorder: "rgba(15,29,36,0.18)" },
];

export const PALETTE_KEYS = PALETTES.map((p) => p.key);
export const DEFAULT_PALETTE = "harbor";
/** The palette a layout suggests when the broker hasn't picked one (Showroom → Midnight). */
export const LAYOUT_DEFAULT_PALETTE: Record<SiteLayout, string> = { classic: "harbor", editorial: "ivory", showroom: "midnight" };

export function paletteByKey(key: string | null | undefined): Palette {
  return PALETTES.find((p) => p.key === key) ?? PALETTES[0];
}

export function isLayout(v: unknown): v is SiteLayout {
  return typeof v === "string" && (SITE_LAYOUTS as readonly string[]).includes(v);
}

export function cleanHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(t)) return t.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(t)) return ("#" + t.slice(1).split("").map((c) => c + c).join("")).toLowerCase();
  return null;
}

// ── Colour maths ─────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function rgbToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  if (s === 0) return rgbToHex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return rgbToHex(f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255);
}

const DARK_TEXT = "#050b14";
const LIGHT_TEXT = "#ffffff";

/** Black or white — whichever reads better on this colour. */
export function inkOn(hex: string): string {
  return contrast(hex, DARK_TEXT) >= contrast(hex, LIGHT_TEXT) ? DARK_TEXT : LIGHT_TEXT;
}

/**
 * Make an accent legible on a page: button text (black or white) at ≥ 4.5:1
 * and the accent itself at ≥ 3:1 against the page. Keeps the hue and
 * saturation; moves lightness the smallest amount that satisfies both (the
 * original if it already does). Returns the colour and whether it changed.
 */
export function legibleAccent(hex: string, bg: string): { accent: string; onAccent: string; adjusted: boolean } {
  const ok = (c: string) => Math.max(contrast(c, DARK_TEXT), contrast(c, LIGHT_TEXT)) >= 4.5 && contrast(c, bg) >= 3;
  if (ok(hex)) return { accent: hex, onAccent: inkOn(hex), adjusted: false };
  const [h, s, l] = rgbToHsl(hex);
  for (let step = 1; step <= 100; step++) {
    const d = step / 100;
    for (const cand of [l - d, l + d]) {
      if (cand < 0 || cand > 1) continue;
      const c = hslToHex(h, s, cand);
      if (ok(c)) return { accent: c, onAccent: inkOn(c), adjusted: true };
    }
  }
  // Unreachable in practice (pure black/white pass one side); fall back safely.
  const fallback = luminance(bg) > 0.5 ? "#1f2a37" : "#e9dfc6";
  return { accent: fallback, onAccent: inkOn(fallback), adjusted: true };
}

/** A version of the accent readable as small text on the page (≥ 4.5:1). */
function accentAsText(hex: string, bg: string): string {
  if (contrast(hex, bg) >= 4.5) return hex;
  const [h, s, l] = rgbToHsl(hex);
  const darker = luminance(bg) > 0.5;
  for (let step = 1; step <= 100; step++) {
    const c = hslToHex(h, s, Math.max(0, Math.min(1, darker ? l - step / 100 : l + step / 100)));
    if (contrast(c, bg) >= 4.5) return c;
  }
  return darker ? DARK_TEXT : LIGHT_TEXT;
}

// ── Resolution ───────────────────────────────────────────────────────────────

export type SiteStyleInput = {
  layout?: string | null;
  palette?: string | null;
  accent?: string | null;
  ground?: string | null;
};

export type ResolvedSiteStyle = {
  layout: SiteLayout;
  palette: Palette;
  dark: boolean;
  accent: string;
  onAccent: string;
  /** The broker's colour was nudged for legibility. */
  accentAdjusted: boolean;
  vars: Record<string, string>;
};

export function resolveSiteStyle(input: SiteStyleInput): ResolvedSiteStyle {
  const layout: SiteLayout = isLayout(input.layout) ? input.layout : "classic";
  const palette = paletteByKey(input.palette);
  // A custom page ground is only honoured when it keeps the palette's light/dark character.
  const ground = cleanHex(input.ground);
  const groundOk = !!ground && (palette.dark ? luminance(ground) < 0.03 : luminance(ground) > 0.82);
  const bg = groundOk ? ground! : palette.bg;
  // The curated accents are designed for their palette (a filled button with
  // the better of black/white text); a broker's own colour is made legible.
  const custom = cleanHex(input.accent);
  const { accent, onAccent, adjusted } = custom
    ? legibleAccent(custom, bg)
    : { accent: palette.accent, onAccent: inkOn(palette.accent), adjusted: false };
  const vars: Record<string, string> = {
    "--site-bg": bg,
    "--site-surface": palette.surface,
    "--site-ink": palette.ink,
    "--site-muted": palette.muted,
    "--site-rule": palette.rule,
    "--site-accent": accent,
    "--site-on-accent": onAccent,
    "--site-accent-text": accentAsText(accent, bg),
    "--site-band-bg": palette.bandBg,
    "--site-band-ink": palette.bandInk,
    "--site-field": palette.field,
    "--site-field-border": palette.fieldBorder,
    "--site-header-bg": `color-mix(in srgb, ${bg} 94%, transparent)`,
  };
  return { layout, palette, dark: palette.dark, accent, onAccent, accentAdjusted: adjusted, vars };
}
