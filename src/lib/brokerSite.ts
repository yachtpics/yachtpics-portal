/**
 * Broker Websites (Oct 26) — shapes, limits and validation shared by the
 * public page (/b/[slug]), the editor API (/api/website) and the dashboard
 * editor. Client-safe: no server imports here. Server loaders live in
 * src/lib/brokerSiteServer.ts.
 */

export const SITE_STATS_MAX = 4;
export const SITE_TESTIMONIALS_MAX = 6;

/** Field length caps (characters). Generous, but bounded. */
export const SITE_LIMITS = {
  headline: 140,
  specialty: 140,
  credentials: 200,
  whatsapp: 32,
  statValue: 24,
  statLabel: 48,
  quote: 600,
  quoteName: 80,
  quotePlace: 80,
  bio: 3000,
} as const;

export type SiteStat = { value: string; label: string };
export type SiteTestimonial = { quote: string; name: string; place: string };
export type SiteSections = { sold: boolean; about: boolean; testimonials: boolean; sell: boolean };

export const DEFAULT_SECTIONS: SiteSections = { sold: true, about: true, testimonials: true, sell: true };

export type BrokerSiteRow = {
  broker_id: string;
  slug: string;
  published: boolean;
  headline: string | null;
  specialty: string | null;
  hero_photo_id: string | null;
  portrait_path: string | null;
  stats: SiteStat[];
  credentials: string | null;
  testimonials: SiteTestimonial[];
  show_prices: boolean;
  whatsapp: string | null;
  sections: SiteSections;
  created_at?: string;
  updated_at?: string;
};

export const SITE_COLUMNS =
  "broker_id, slug, published, headline, specialty, hero_photo_id, portrait_path, stats, credentials, testimonials, show_prices, whatsapp, sections, created_at, updated_at";

/** Lowercase a–z, 0–9 and hyphens, 3–60 characters, no leading/trailing hyphen. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58})[a-z0-9]$/;

/** Words a broker can't take as their address. */
const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "auth", "b", "billing", "dashboard", "demo", "help", "login", "logout",
  "portal", "see", "signup", "support", "www", "yachtpics", "rs", "s", "g", "d", "settings",
]);

/** Turn anything typed into a candidate slug ("Brian O'Nopper" → "brian-onopper"). */
export function normaliseSlug(raw: string): string {
  return String(raw ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/g, "");
}

/** Null when the slug is usable, else a short reason for the editor. */
export function slugProblem(slug: string): string | null {
  if (slug.length < 3) return "Use at least 3 characters.";
  if (slug.length > 60) return "Use 60 characters or fewer.";
  if (!SLUG_RE.test(slug)) return "Use lowercase letters, numbers and hyphens only.";
  if (RESERVED_SLUGS.has(slug)) return "That address is reserved. Try adding your last name.";
  return null;
}

export function suggestSlug(first: string | null | undefined, last: string | null | undefined): string {
  const s = normaliseSlug([first, last].filter(Boolean).join(" "));
  return s.length >= 3 ? s : "";
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+$/g, "").replace(/^\s+/g, "").slice(0, max) : "";
}

/** Clean stats from the editor: trimmed, both parts present, ≤ 4. */
export function cleanStats(v: unknown): SiteStat[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((s) => ({
      value: str((s as SiteStat)?.value, SITE_LIMITS.statValue),
      label: str((s as SiteStat)?.label, SITE_LIMITS.statLabel),
    }))
    .filter((s) => s.value && s.label)
    .slice(0, SITE_STATS_MAX);
}

/** Clean testimonials: a quote and a name are required, place optional, ≤ 6. */
export function cleanTestimonials(v: unknown): SiteTestimonial[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((t) => ({
      quote: str((t as SiteTestimonial)?.quote, SITE_LIMITS.quote),
      name: str((t as SiteTestimonial)?.name, SITE_LIMITS.quoteName),
      place: str((t as SiteTestimonial)?.place, SITE_LIMITS.quotePlace),
    }))
    .filter((t) => t.quote && t.name)
    .slice(0, SITE_TESTIMONIALS_MAX);
}

export function cleanSections(v: unknown): SiteSections {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof SiteSections, unknown>>;
  const pick = (k: keyof SiteSections) => (typeof o[k] === "boolean" ? (o[k] as boolean) : DEFAULT_SECTIONS[k]);
  return { sold: pick("sold"), about: pick("about"), testimonials: pick("testimonials"), sell: pick("sell") };
}

/** Normalise a stored row (jsonb columns can hold anything). */
export function normaliseSiteRow(row: Record<string, unknown>): BrokerSiteRow {
  return {
    broker_id: String(row.broker_id),
    slug: String(row.slug ?? ""),
    published: row.published === true,
    headline: (row.headline as string | null) ?? null,
    specialty: (row.specialty as string | null) ?? null,
    hero_photo_id: (row.hero_photo_id as string | null) ?? null,
    portrait_path: (row.portrait_path as string | null) ?? null,
    stats: cleanStats(row.stats),
    credentials: (row.credentials as string | null) ?? null,
    testimonials: cleanTestimonials(row.testimonials),
    show_prices: row.show_prices === true,
    whatsapp: (row.whatsapp as string | null) ?? null,
    sections: cleanSections(row.sections),
    created_at: (row.created_at as string | undefined) ?? undefined,
    updated_at: (row.updated_at as string | undefined) ?? undefined,
  };
}

/** Digits only, for wa.me links ("+1 (561) 602-9710" → "15616029710"). Null if too short. */
export function whatsappDigits(raw: string | null | undefined): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** tel:/sms: friendly number ("+15616029710"); null if there's nothing dialable. */
export function dialable(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const plus = s.startsWith("+");
  const d = s.replace(/\D/g, "");
  if (d.length < 7) return null;
  return (plus ? "+" : "") + d;
}

/** True when a Supabase error means the table/column isn't there yet (migration not applied). */
export function isMissingSchema(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  const msg = (err.message ?? "").toLowerCase();
  return (
    code === "42P01" || code === "42703" || code === "PGRST205" || code === "PGRST204" ||
    /does not exist|could not find the table|schema cache|column .* not found/.test(msg)
  );
}

/** "56′ (17.1 m)" from feet. */
export function lengthLabel(ft: number | string | null | undefined): string | null {
  const n = Number(ft);
  if (!Number.isFinite(n) || n <= 0) return null;
  const feet = Math.round(n * 10) / 10;
  const m = Math.round(n * 0.3048 * 10) / 10;
  return `${feet % 1 === 0 ? feet.toFixed(0) : feet}′ (${m} m)`;
}

/** "$1,250,000" or null. */
export function priceLabel(v: number | string | null | undefined): string | null {
  const n = Number(v);
  if (v == null || v === "" || !Number.isFinite(n) || n <= 0) return null;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export const LEAD_KINDS = ["showing", "contact", "valuation"] as const;
export type LeadKind = (typeof LEAD_KINDS)[number];
export const INQUIRY_TYPES = ["Buying", "Selling", "A specific yacht", "Other"] as const;
export const CONTACT_PREFS = ["Call", "Text", "Email"] as const;
