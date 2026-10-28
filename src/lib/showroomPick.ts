/**
 * Showroom Loop (Oct 15) — which photos of a boat go into the office-monitor
 * loop, and the one-line spec under its name. Pure: no network, no DOM.
 *
 * Priority (Charlie's list):
 *    1. the hero photo (listings.hero_photo_id)
 *    2. Profiles Running        3. Aerial        4. Profiles
 *    5. Bow / Stern / Flybridge / Tower / Hard Top / Cockpit / Aft Deck / Swim Platform
 *    6. Salon      7. Galley      8. Master Stateroom
 *    9. Helm / Pilothouse / Skylounge      10. VIP / Guest Stateroom
 *   (11. anything else that isn't excluded — only when the boat is still short)
 * Never: heads, engine / mechanical / electrical rooms, lazarette, crew areas,
 * "Other" or uncategorised photos (the hero excepted — the broker chose it).
 *
 * Picks are spread across categories: round one takes the FIRST photo of each
 * category in priority order; later rounds take one more from each, choosing
 * the frame furthest from the ones already taken in that category. The result
 * is ordered by priority (hero, then the boat from outside, then the rooms),
 * so a boat reads outside-in on the monitor.
 */
import { orderPhotos } from "@/lib/photoOrder";

export type ShowroomPhoto = {
  id: string;
  storage_path: string;
  filename: string | null;
  category: string | null;
  display_order: number | null;
  /** Where the original lives (Oct 28) and whether stored copies exist. */
  storage_backend?: string | null;
  derivatives_at?: string | null;
};

export const SHOWROOM_PICK_MIN = 6;
export const SHOWROOM_PICK_MAX = 10;
export const SHOWROOM_PICK_DEFAULT = 8;

const norm = (c: string | null | undefined) => (c ?? "").trim().toLowerCase();

/** Areas that never go on a showroom monitor. */
export function showroomExcluded(category: string | null | undefined): boolean {
  const c = norm(category);
  if (!c || c === "other") return true;
  if (/\bheads?\b/.test(c)) return true; // Head, Day Head, Master Stateroom Head…
  return /engine|mechanical|electrical|generator|lazarette|crew|laundry|bilge/.test(c);
}

/** Tier 5's areas, in the order they're visited within the tier. */
const DECK_ORDER = ["bow", "stern", "flybridge", "tower", "hard top", "cockpit", "aft deck", "swim platform"];

/** Tiers 2–10 (index 0 = tier 2). Matched against the lower-cased category. */
const TIERS: ((c: string) => boolean)[] = [
  (c) => c.includes("running"),                                   // 2 Profiles Running
  (c) => c.includes("aerial") || c.includes("drone"),              // 3 Aerial
  (c) => c === "profiles" || c === "profile",                       // 4 Profiles
  (c) => DECK_ORDER.some((d) => c.includes(d.replace(" ", "")) || c.includes(d)), // 5 decks
  (c) => c.includes("salon") || c.includes("saloon"),               // 6 Salon
  (c) => c.includes("galley"),                                      // 7 Galley
  (c) => c.includes("master"),                                      // 8 Master Stateroom
  (c) => /helm|pilothouse|sky ?lounge|wheelhouse/.test(c),          // 9 Helm / Pilothouse / Skylounge
  (c) => /\bvip\b|guest/.test(c),                                   // 10 VIP / Guest Stateroom
];
const FALLBACK_TIER = TIERS.length;

/** Which tier a (non-excluded) category belongs to; FALLBACK_TIER when none. */
function tierOf(c: string): number {
  for (let i = 0; i < TIERS.length; i++) if (TIERS[i](c)) return i;
  return FALLBACK_TIER;
}

/** Within tier 5, Bow before Stern before Flybridge… */
function deckRank(c: string): number {
  for (let i = 0; i < DECK_ORDER.length; i++) if (c.includes(DECK_ORDER[i]) || c.includes(DECK_ORDER[i].replace(" ", ""))) return i;
  return DECK_ORDER.length;
}

/**
 * Pick `count` photo ids (clamped to 6–10, fewer when the boat hasn't enough
 * eligible photos). `photos` is every visible photo of the listing.
 */
export function pickShowroomPhotos(
  photos: ShowroomPhoto[],
  opts: { count: number; heroId: string | null; manual: boolean },
): string[] {
  const count = Math.max(SHOWROOM_PICK_MIN, Math.min(SHOWROOM_PICK_MAX, Math.round(opts.count)));
  const ordered = orderPhotos(photos, { manual: opts.manual, heroId: opts.heroId });
  const hero = opts.heroId ? ordered.find((p) => p.id === opts.heroId) ?? null : null;

  // Eligible photos by category, each in listing order; categories in first-seen order.
  const byCat: Record<string, ShowroomPhoto[]> = {};
  const seen: string[] = [];
  ordered.forEach((p) => {
    const c = norm(p.category);
    if (showroomExcluded(c)) return;
    if (!byCat[c]) { byCat[c] = []; seen.push(c); }
    byCat[c].push(p);
  });

  // The category queue: by tier, then (tier 5) deck order, then listing order.
  const rank = (c: string) => tierOf(c) * 1000 + (tierOf(c) === 3 ? deckRank(c) * 50 : 0) + seen.indexOf(c) / 1000;
  const queue = seen.slice().sort((a, b) => rank(a) - rank(b));
  const main = queue.filter((c) => tierOf(c) !== FALLBACK_TIER);
  const extra = queue.filter((c) => tierOf(c) === FALLBACK_TIER);

  const taken: Record<string, number[]> = {}; // category → indices taken
  const picked: { id: string; key: number }[] = [];
  const has = (id: string) => picked.some((x) => x.id === id);
  if (hero) {
    picked.push({ id: hero.id, key: -1 });
    const hc = norm(hero.category);
    const hi = byCat[hc] ? byCat[hc].indexOf(hero) : -1;
    if (hi >= 0) taken[hc] = [hi];
  }

  // Take one more frame from category `c`: the first, then the one furthest from those taken.
  const takeFrom = (c: string): boolean => {
    const list = byCat[c];
    const got = taken[c] ?? [];
    if (got.length >= list.length) return false;
    let best = -1, bestD = -1;
    for (let i = 0; i < list.length; i++) {
      if (got.indexOf(i) >= 0 || has(list[i].id)) continue;
      const d = got.length ? Math.min(...got.map((g) => Math.abs(g - i))) : -i; // none yet → the first
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best < 0) return false;
    taken[c] = got.concat(best);
    picked.push({ id: list[best].id, key: rank(c) * 1000 + best });
    return true;
  };

  const rounds = (cats: string[]) => {
    let progressed = true;
    while (picked.length < count && progressed) {
      progressed = false;
      for (let i = 0; i < cats.length && picked.length < count; i++) {
        // Round one skips a category the hero already stands for.
        if (takeFrom(cats[i])) progressed = true;
      }
    }
  };
  // Round one: the first photo of every category the hero doesn't already cover.
  for (let i = 0; i < main.length && picked.length < count; i++) if (!taken[main[i]]) takeFrom(main[i]);
  rounds(main);
  for (let i = 0; i < extra.length && picked.length < count; i++) if (!taken[extra[i]]) takeFrom(extra[i]);
  rounds(extra);

  return picked.sort((a, b) => a.key - b.key).map((x) => x.id);
}

/** Feet as typed: "60" → 60′, "60.5" → 60.5′. length_ft can arrive as a string. */
function feet(v: string | number | null | undefined): string {
  if (v === null || v === undefined || String(v).trim() === "") return "";
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return "";
  return `${Math.round(n * 10) / 10}′`;
}

/** "2017 · 60′ Pachoud Yachts XF60" — missing parts are left out. */
export function showroomSpecLine(l: { year: number | null; length_ft: string | number | null; make: string | null; model: string | null }): string {
  const make = (l.make ?? "").trim();
  let model = (l.model ?? "").trim();
  // "Viking" + "Viking 54" shouldn't read "Viking Viking 54".
  if (make && model.toLowerCase().startsWith(make.toLowerCase())) model = model.slice(make.length).trim();
  const tail = [feet(l.length_ft), make, model].filter(Boolean).join(" ");
  return [l.year ? String(l.year) : "", tail].filter(Boolean).join(" · ");
}
