/**
 * Charlie's shooting/viewing order for a boat — the sequence he's used on the
 * Juicebox slideshows for years, which is why they all read the same.
 *
 * This is NOT the same list as PHOTO_CATEGORIES: that one is alphabetical
 * because it's a picker. This one is the narrative order — outside and up top
 * first, then down through the machinery, then forward through the living
 * spaces, ending on the master.
 *
 * Categories he named explicitly are the spine; the rest are slotted next to
 * their nearest sibling. Anything not listed here sorts to the end (just before
 * "Other"), so a new category never silently lands in the middle of the story.
 */
export const CANONICAL_PHOTO_ORDER: string[] = [
  // Exterior + upper decks
  "Profiles",
  "Profiles Running",
  // Aerials sit with the exterior beauty shots rather than off on their own —
  // a buyer scrolling wants the boat from the air right after the profiles.
  "Aerial",
  "Tower",
  "Flybridge",
  "Enclosed Flybridge",
  "Enclosed Flybridge Aft Deck",
  "Command Deck",
  "Skylounge",
  "Skylounge Aft Deck",
  "Skylounge Day Head",
  "Sun Deck",
  "Bow",
  "Foredeck",
  "Stern",
  "Port",
  "Starboard",
  "Swim Platform",
  "Beach Club",
  "Cockpit",
  "Aft Deck",

  // Machinery — early, per Charlie's order
  "Engine Room",
  "Engines",
  "Engine",
  "Generator Room",
  "Mechanical Room",
  "Electrical Room",
  "Lazarette",

  // Living spaces
  "Salon",
  "Day Head",
  "Galley",
  "Dinette",
  "Dining",
  "Pantry",
  "Foyer",
  "Main Deck Foyer",
  "Pilothouse",
  "Helm",
  "Console",
  "Navigation Station",
  "Companionway",
  "Lower Companionway",
  "Lower Foyer",
  "Port Passageway",
  "Starboard Passageway",
  "Cabin",
  "Aft Cabin",

  // Guest accommodation — each stateroom followed by its own head
  "Forward Cabin",
  "Forward Stateroom",
  "Forward Stateroom Head",
  "Guest Stateroom",
  "Guest Stateroom Head",
  "Port Guest Stateroom",
  "Port Guest Stateroom Head",
  "Starboard Guest Stateroom",
  "Starboard Guest Stateroom Head",
  "Fwd Port Guest Stateroom",
  "Fwd Port Guest Stateroom Head",
  "Fwd Starboard Guest Stateroom",
  "Fwd Starboard Guest Stateroom Head",
  "Mid Port Guest Stateroom",
  "Mid Port Guest Stateroom Head",
  "Mid Starboard Guest Stateroom",
  "Mid Starboard Guest Stateroom Head",
  "Aft Port Guest Stateroom",
  "Aft Port Guest Stateroom Head",
  "Aft Starboard Guest Stateroom",
  "Aft Starboard Guest Stateroom Head",
  "VIP Stateroom",
  "VIP Stateroom Head",
  "On Deck Master Stateroom",
  "On Deck Master Stateroom Head",
  "Master Stateroom",
  "Master Stateroom Head",
  "Head",

  // Crew + service
  "Laundry",
  "Crew",
  "Crew Stateroom",
  "Crew Stateroom Head",
  "Captain's Stateroom",
  "Captain's Stateroom Head",

  // Always last — the uncategorised bucket never interrupts the story.
  "Other",
];

const RANK = new Map(CANONICAL_PHOTO_ORDER.map((c, i) => [c.toLowerCase(), i]));
// Unlisted categories land after everything known but before "Other".
const UNKNOWN_RANK = CANONICAL_PHOTO_ORDER.length - 1.5;

export function categoryRank(category: string | null | undefined): number {
  if (!category) return UNKNOWN_RANK;
  const hit = RANK.get(category.trim().toLowerCase());
  return hit === undefined ? UNKNOWN_RANK : hit;
}

export type OrderablePhoto = {
  id: string;
  category?: string | null;
  display_order?: number | null;
};

/**
 * Order a boat's photos.
 *
 * `manual` = the listing has been hand-sorted, so Charlie's drag order wins
 * outright and we don't touch it. Otherwise we fall back to the canonical
 * category order, keeping the existing display_order *within* each category so
 * any partial hand-sorting still counts for something.
 *
 * The hero (starred) photo always opens the show — it's a deliberate pick.
 */
export function orderPhotos<T extends OrderablePhoto>(
  photos: T[],
  opts: { manual: boolean; heroId?: string | null }
): T[] {
  const out = [...photos];

  if (opts.manual) {
    out.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
  } else {
    out.sort((a, b) => {
      const ra = categoryRank(a.category);
      const rb = categoryRank(b.category);
      if (ra !== rb) return ra - rb;
      return (a.display_order ?? 0) - (b.display_order ?? 0);
    });
  }

  if (opts.heroId) {
    const i = out.findIndex((p) => p.id === opts.heroId);
    if (i > 0) out.unshift(out.splice(i, 1)[0]);
  }
  return out;
}
