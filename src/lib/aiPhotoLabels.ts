/**
 * The short, plain vocabulary the vision model may label photos with.
 *
 * Why not the full PHOTO_CATEGORIES list: given 90 names, the model answered
 * with more than a photograph can show. In a real test on a 95' motor yacht
 * (48 phone-named photos) only 20 matched the photographer's own area names —
 * every cabin became "Master Stateroom", every bathroom "Master Stateroom
 * Head", flybridge shots "Aft Deck" or "Sun Deck". A picture can't say which
 * cabin it is, so the model only names what is certainly true ("Stateroom",
 * "Head") and the broker picks a specific name from the dropdown if they want.
 *
 * Only the model's answers are limited. Filename guesses (src/lib/guessCategory.ts)
 * and hand-picked categories still use every name in PHOTO_CATEGORIES.
 *
 * Every name here is a standard category (PHOTO_CATEGORIES), listed in the
 * walk-through order (src/lib/photoOrder.ts).
 */
import type { PHOTO_CATEGORIES } from "@/lib/photoCategories";

/** Typed so a name that isn't a standard category fails the typecheck. */
export type AiPhotoLabel = { name: (typeof PHOTO_CATEGORIES)[number]; means: string };

export const AI_PHOTO_LABELS: AiPhotoLabel[] = [
  // Exterior
  { name: "Profiles", means: "the whole boat seen from off the boat (from the water or the dock), at rest" },
  { name: "Profiles Running", means: "the whole boat seen from off the boat, under way (wake, spray, moving)" },
  { name: "Aerial", means: "ONLY a clearly elevated drone viewpoint looking down on the boat; a side-on shot from the water is Profiles or Profiles Running" },
  { name: "Flybridge", means: "the open top deck reached by stairs: upper helm, seating, bar, sunpads, hardtop or radar arch, usually with a high view over the water" },
  { name: "Tower", means: "the tuna tower or T-top tower on a sportfish or center console, or the view from up in it" },
  { name: "Bow", means: "the forward deck area: foredeck, bow seating or sunpads, anchor, pulpit, the front of the boat" },
  { name: "Swim Platform", means: "the low platform at the very stern at water level: swim ladder, transom, tender garage door" },
  { name: "Cockpit", means: "ONLY the open fishing or working cockpit at the stern of a sportfish, express or center console (fighting chair, livewell, rod holders); never a motor yacht's aft deck" },
  { name: "Aft Deck", means: "the outdoor deck at the back of the main deck, just outside the salon doors, often with a table and seating under the overhang of the deck above" },
  // Machinery
  { name: "Engine Room", means: "engines, generators, machinery spaces" },
  { name: "Electrical Panel", means: "a breaker or switch panel filling the frame" },
  // Inside
  { name: "Salon", means: "the main indoor living area: sofas, coffee table, TV (including an upper-deck lounge)" },
  { name: "Dining", means: "an indoor dining table with chairs as the main subject" },
  { name: "Galley", means: "the kitchen" },
  { name: "Helm", means: "a steering station (wheel, throttles, screens) when you cannot be sure whether it is a pilothouse or the flybridge" },
  { name: "Pilothouse", means: "ONLY a clearly enclosed, dedicated wheelhouse room whose purpose is driving the boat" },
  { name: "Electronics", means: "a close-up of navigation screens, radar, autopilot or radios" },
  { name: "Companionway", means: "stairs or a passageway between decks or cabins" },
  { name: "Stateroom", means: "ANY sleeping cabin of any size or position: master, VIP, guest, twin-berth, crew or captain's" },
  { name: "Head", means: "ANY bathroom: toilet, shower, vanity" },
  { name: "Laundry", means: "a washer and dryer" },
];

const BY_LOWER = new Map(AI_PHOTO_LABELS.map((l) => [l.name.toLowerCase(), l.name as string]));

/** The names alone, in walk-through order. */
export function aiPhotoLabelNames(): string[] {
  return AI_PHOTO_LABELS.map((l) => l.name as string);
}

/**
 * Specific names the model might still answer with, mapped down to the plain
 * one that is certainly true. Checked after the exact-match and Head/Stateroom
 * rules in normalizeAiPhotoLabel.
 */
const DOWN_TO: Record<string, string> = {
  "foredeck": "Bow",
  "sun deck": "Flybridge",
  "sunbed": "Flybridge",
  "enclosed flybridge": "Flybridge",
  "enclosed flybridge aft deck": "Flybridge",
  "skylounge aft deck": "Aft Deck",
  "skylounge": "Salon",
  "wheelhouse": "Pilothouse",
  "console": "Helm",
  "navigation station": "Helm",
  "engine": "Engine Room",
  "engines": "Engine Room",
  "port engine room": "Engine Room",
  "starboard engine room": "Engine Room",
  "generator room": "Engine Room",
  "mechanical room": "Engine Room",
  "electrical room": "Electrical Panel",
  "pantry": "Galley",
  "dinette": "Dining",
  "dinette/guest berth": "Dining",
  "lower companionway": "Companionway",
  "port passageway": "Companionway",
  "starboard passageway": "Companionway",
};

/**
 * Turn a model answer into one of the plain labels, or null (= unsure, the
 * photo stays as it was / "Other").
 *  - a plain label (any letter case) → itself
 *  - any "… Head" / "Day Head" → Head
 *  - any "… Stateroom", "… Cabin", "… Berth" → Stateroom
 *  - a handful of other specific names → their plain parent (DOWN_TO)
 *  - "Other", null, anything else → null
 */
export function normalizeAiPhotoLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const k = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!k || k === "other" || k === "null") return null;
  const exact = BY_LOWER.get(k);
  if (exact) return exact;
  const down = DOWN_TO[k];
  if (down) return down;
  if (/\bheads?$/.test(k)) return "Head";
  if (/\b(stateroom|cabin|berth)s?$/.test(k)) return "Stateroom";
  return null;
}
