import { PHOTO_CATEGORIES } from "./photoCategories";

// Aliases for common alternate naming conventions in filenames.
// These are TRUE synonyms only — a word that reliably means one area. Ambiguous
// guesses were deliberately removed (e.g. "exterior"/"profile"/"aft"/"bridge"),
// because mapping an ambiguous word to one specific area silently mislabels
// photos; anything the categories don't recognize should fall to "Other"
// instead, which is the honest result.
const ALIASES: Record<string, string> = {
  front:       "Bow",
  sunpad:      "Sunbed",
  sunpads:     "Sunbed",
  sunlounge:   "Sunbed",
  interior:    "Salon",
  living:      "Salon",
  mainsalon:   "Salon",
  kitchen:     "Galley",
  master:      "Master Stateroom",
  guest:       "Guest Stateroom",
  bath:        "Head",
  bathroom:    "Head",
  toilet:      "Head",
  // No bare "engine" alias: "Engine" is now a category in its own right, and
  // categories are matched before aliases — so an alias here would be dead code
  // that reads as if it still applied.
  bilge:       "Engine Room",
  swim:        "Swim Platform",
  platform:    "Swim Platform",
  hardtop:     "Hard Top",
  wheel:       "Helm",
  steering:    "Helm",
  // Unambiguous in a yacht context: a "running" or "underway" shot is the boat
  // moving. There's no other area these could mean.
  running:     "Profiles Running",
  // Drone footage is almost never named "aerial" — it comes off the card as
  // DJI_..., or the photographer types "drone" or "overhead".
  drone:       "Aerial",
  aerial:      "Aerial",
  overhead:    "Aerial",
  dji:         "Aerial",
  underway:    "Profiles Running",
  cruising:    "Profiles Running",
  // NOTE: no bare "deck" → Cockpit alias. A deck can be many areas (sun deck,
  // sky lounge aft deck, command deck…); mapping a lone "deck" to Cockpit
  // silently mislabels anything not yet a category. Unknown decks fall to
  // "Other" instead, which is the honest result.
};

function isWholeWord(name: string, term: string): boolean {
  return (
    name === term ||
    name.startsWith(term + " ") ||
    name.endsWith(" " + term) ||
    name.includes(" " + term + " ")
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Matches a category as a whole phrase, tolerating the two things filenames
// routinely do to category names:
//   1. Concatenate the words ("aftdeck" for "Aft Deck", "skylounge" for
//      "Skylounge") — handled by allowing zero-or-more spaces between words.
//   2. Drop the word "stateroom" ("master" for "Master Stateroom", "on deck
//      master head" for "On Deck Master Stateroom Head") — so "stateroom" is
//      matched as optional.
// The outer \b guards stay, so "head" still won't match inside "overhead", and
// longest-category-first ordering keeps the specific names winning.
type CategoryMatch = { index: number; exact: boolean };

function matchesCategory(name: string, cat: string): CategoryMatch | null {
  const words = cat.toLowerCase().split(/\s+/);
  const build = (optionalStateroom: boolean) =>
    new RegExp(
      `\\b${words
        .map((w) => (optionalStateroom && w === "stateroom" ? "(?:stateroom)?" : escapeRegExp(w)))
        .join("\\s*")}(?![a-z])`
    );
  // Leading \b still guards the front, so "head" can't match inside "overhead".
  // The trailing guard is (?![a-z]) rather than \b so a frame number glued
  // straight onto the word still matches — cameras produce "Profiles01.jpg" and
  // "AftDeck12.jpg" constantly, and a trailing \b rejected every one of them.
  // Letters are still refused, so "head" won't match "header".
  const exact = build(false).exec(name);
  if (exact) return { index: exact.index, exact: true };
  if (!words.includes("stateroom")) return null;
  const loose = build(true).exec(name);
  return loose ? { index: loose.index, exact: false } : null;
}

/**
 * Guess a photo category from its filename.
 *
 * - Strips the file extension and normalizes separators (_, -, .) to spaces
 * - Matches category names as whole words/phrases only, so "head" won't
 *   match inside "overhead"
 * - Checks longer/more-specific categories first, so "Master Stateroom Head"
 *   wins over "Head" when both would otherwise match
 * - Falls back to common filename aliases before returning "Other"
 */
export function guessCategory(filename: string): string {
  const name = filename
    .toLowerCase()
    .replace(/\.[^.]+$/, "")      // remove extension
    .replace(/[_\-\.]+/g, " ")   // separators → spaces
    .trim();

  // Every category that matches, then the best one:
  //   1. the match that starts earliest in the name ("crew head" is about the
  //      crew area, not a head — the first word says what the photo is of);
  //   2. at the same start, a name written out in full beats one that only
  //      matched because "stateroom" was treated as optional — so "crew"
  //      stays "Crew" rather than becoming "Crew Stateroom";
  //   3. then the longer, more specific name ("Skylounge Aft Deck" over
  //      "Aft Deck"; "Crew Stateroom Head" over "Crew Stateroom").
  let best: { cat: string; m: CategoryMatch } | null = null;
  for (const cat of PHOTO_CATEGORIES) {
    const m = matchesCategory(name, cat);
    if (!m) continue;
    if (
      !best ||
      m.index < best.m.index ||
      (m.index === best.m.index && m.exact && !best.m.exact) ||
      (m.index === best.m.index && m.exact === best.m.exact && cat.length > best.cat.length)
    ) {
      best = { cat, m };
    }
  }
  if (best) return best.cat;

  // Fall back to aliases (whole-word match on each alias key)
  for (const [alias, cat] of Object.entries(ALIASES)) {
    if (isWholeWord(name, alias)) return cat;
  }

  return "Other";
}
