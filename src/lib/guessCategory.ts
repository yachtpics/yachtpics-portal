import { PHOTO_CATEGORIES } from "./photoCategories";

// Aliases for common alternate naming conventions in filenames.
// These are TRUE synonyms only — a word that reliably means one area. Ambiguous
// guesses were deliberately removed (e.g. "exterior"/"profile"/"aft"/"bridge"),
// because mapping an ambiguous word to one specific area silently mislabels
// photos; anything the categories don't recognize should fall to "Other"
// instead, which is the honest result.
const ALIASES: Record<string, string> = {
  front:       "Bow",
  interior:    "Salon",
  living:      "Salon",
  mainsalon:   "Salon",
  kitchen:     "Galley",
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
  // Unambiguous in a yacht context: a "running" or "underway" shot is the boat
  // moving. There's no other area these could mean.
  running:     "Profiles Running",
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
function matchesCategory(name: string, cat: string): boolean {
  const words = cat
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w === "stateroom" ? "(?:stateroom)?" : escapeRegExp(w)));
  // Leading \b still guards the front, so "head" can't match inside "overhead".
  // The trailing guard is (?![a-z]) rather than \b so a frame number glued
  // straight onto the word still matches — cameras produce "Profiles01.jpg" and
  // "AftDeck12.jpg" constantly, and a trailing \b rejected every one of them.
  // Letters are still refused, so "head" won't match "header".
  return new RegExp(`\\b${words.join("\\s*")}(?![a-z])`).test(name);
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
