import { PHOTO_CATEGORIES } from "./photoCategories";

// Aliases for common alternate naming conventions in filenames
const ALIASES: Record<string, string> = {
  exterior:    "Starboard",
  profile:     "Port",
  front:       "Bow",
  aft:         "Stern",
  back:        "Stern",
  bridge:      "Flybridge",
  fly:         "Flybridge",
  interior:    "Salon",
  living:      "Salon",
  mainsalon:   "Salon",
  kitchen:     "Galley",
  dining:      "Galley",
  master:      "Master Stateroom",
  guest:       "Guest Stateroom",
  bath:        "Head",
  bathroom:    "Head",
  toilet:      "Head",
  engine:      "Engine Room",
  bilge:       "Engine Room",
  swim:        "Swim Platform",
  platform:    "Swim Platform",
  wheel:       "Helm",
  steering:    "Helm",
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

// Matches a category as a whole phrase, but tolerates a MISSING space between
// the category's own words — filenames routinely concatenate them
// ("aftdeck" for "Aft Deck"). The outer \b guards
// stay, so "head" still won't match inside "overhead".
function matchesCategory(name: string, cat: string): boolean {
  const words = cat.toLowerCase().split(/\s+/).map(escapeRegExp);
  return new RegExp(`\\b${words.join("\\s*")}\\b`).test(name);
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

  // Sort longest categories first so specific names beat short ones
  // ("Skylounge Aft Deck" wins over "Aft Deck").
  const sorted = [...PHOTO_CATEGORIES].sort((a, b) => b.length - a.length);
  for (const cat of sorted) {
    if (matchesCategory(name, cat)) return cat;
  }

  // Fall back to aliases (whole-word match on each alias key)
  for (const [alias, cat] of Object.entries(ALIASES)) {
    if (isWholeWord(name, alias)) return cat;
  }

  return "Other";
}
