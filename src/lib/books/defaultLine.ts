/**
 * DEFAULT LINE FOR A NEW YACHTPICS INVOICE
 *
 * When a boat is picked on an empty YachtPics draft, the invoice editor adds
 * one catalog item automatically, chosen from the boat's vessel type
 * (listings.vessel_type) and length. The rules, checked in this order:
 *
 *   1. Vessel type contains "center console":
 *        under 40 ft      -> the item named "Boats under 40 feet center console..."
 *        40 ft and over   -> the item named "Large center console..."
 *   2. Vessel type contains "express", "sportfish" or "sport fish",
 *      and the boat is under 40 ft:
 *        -> the item named "Boats under 40 feet - express sportfish..."
 *   3. Everything else (and the fallback when rule 1 or 2's item is missing):
 *        under 100 ft     -> "Photography under 100'..."
 *        100 ft and over  -> "Photography - over 100'..."
 *
 * Notes:
 *   - Vessel type matching ignores upper/lower case and looks for the words
 *     anywhere ("Express Cruiser" counts as express).
 *   - Item names are matched on how they START, ignoring case, so a catalog
 *     item can have extra words after the part shown above.
 *   - Only active items for YachtPics (brand "yachtpics" or "both") count.
 *     If rule 1 or 2 picks an item that is missing or inactive, rule 3 is
 *     used instead. If rule 3's item is missing too, nothing is added.
 *   - No length (blank or 0) -> nothing is added.
 *   - Flat-rate items get quantity 1; per-foot items get the boat's length
 *     (that part is handled by the invoice editor).
 *
 * To change a rule: edit the RULES list or the fallback below.
 */
import type { BillingItem } from "./types";

type Rule = {
  /** Lowercase words; the rule applies if the vessel type contains any of them. */
  typeContains: string[];
  /** Item name pattern for the boat's length, or null when the rule doesn't apply at that length. */
  itemFor: (lengthFt: number) => RegExp | null;
};

const RULES: Rule[] = [
  {
    typeContains: ["center console"],
    itemFor: (ft) => (ft < 40 ? /^boats under 40 feet center console/i : /^large center console/i),
  },
  {
    typeContains: ["express", "sportfish", "sport fish"],
    itemFor: (ft) => (ft < 40 ? /^boats under 40 feet - express sportfish/i : null),
  },
];

/** Rule 3 — the general photography line by length. */
const fallbackFor = (ft: number): RegExp =>
  ft < 100 ? /^photography under 100['’]/i : /^photography - over 100['’]/i;

const findItem = (items: BillingItem[], re: RegExp): BillingItem | null => {
  const hit = items.filter(
    (i) => i.active && (i.brand === "yachtpics" || i.brand === "both") && i.kind !== "card_fee" && re.test(i.name.trim()),
  )[0];
  return hit ?? null;
};

export function pickDefaultItem(items: BillingItem[], vesselType: string | null, lengthFt: number | null): BillingItem | null {
  const ft = Number(lengthFt) || 0;
  if (ft <= 0) return null;
  const type = (vesselType ?? "").toLowerCase();
  if (type) {
    for (let r = 0; r < RULES.length; r++) {
      const rule = RULES[r];
      if (!rule.typeContains.some((w) => type.indexOf(w) !== -1)) continue;
      const re = rule.itemFor(ft);
      if (!re) continue;
      const hit = findItem(items, re);
      if (hit) return hit;
      break; // matched rule's item missing/inactive → fall through to the general line
    }
  }
  return findItem(items, fallbackFor(ft));
}
