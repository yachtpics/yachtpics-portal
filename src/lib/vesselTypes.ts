/**
 * The canonical vessel-type list, offered wherever a listing is created or edited.
 *
 * The four forms (admin new listing, broker new listing, the shared edit form and
 * the admin new-broker page's first-listing block) each used to carry their own
 * inline copy, and they had drifted — a type added to one was missing from the
 * others. Add new types HERE and every form picks them up.
 *
 * Grouped by kinship rather than strictly alphabetised, so related hulls read
 * together in the dropdown. These are free text in the database (listings.vessel_type
 * is plain `text` with no constraint), so removing an entry hides it from the
 * picker but does not invalidate listings already saved with it.
 */
export const VESSEL_TYPES: readonly string[] = [
  "Billfish",
  "Bowrider",
  "Catamaran",
  "Power Catamaran",
  "Sailing Catamaran",
  "Center Console",
  "Convertible",
  "Cruiser",
  "Cuddy Cabin",
  "Day Boat",
  "Day Cruiser",
  "Dinghy",
  "Downeast",
  "Picnic",
  "Dual Console",
  "Enclosed Flybridge",
  "Express",
  "Express Cruiser",
  "Flybridge",
  "Flybridge Motor Yacht",
  "Motor Yacht",
  "Expedition",
  "RIB",
  "Runabout",
  "Sailing Yacht",
  "Sportfish",
  "Sports Cruiser",
  "Tender",
  "Trawler",
  "Walkaround",
  "Other",
];
