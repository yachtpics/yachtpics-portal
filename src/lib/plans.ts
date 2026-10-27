// Client-safe plans config — price IDs are not secret
export const PLANS = [
  {
    id: "starter",
    /** Active-listing range this tier is priced for (listingAllowance.ts). null = no upper limit. */
    minListings: 1,
    maxListings: 5 as number | null,
    name: "Starter",
    description: "Up to 5 active boats. The full Portal for a focused book.",
    price: 29,
    priceId: "price_1TQXoyK5G1w3hzIsVwbb9wau",
  },
  {
    id: "growth",
    /** Active-listing range this tier is priced for (listingAllowance.ts). null = no upper limit. */
    minListings: 6,
    maxListings: 10 as number | null,
    name: "Growth",
    description: "6 to 10 active boats. The full Portal, room to grow.",
    price: 49,
    priceId: "price_1TQXqgK5G1w3hzIsuxv4WI6B",
  },
  {
    id: "pro",
    /** Active-listing range this tier is priced for (listingAllowance.ts). null = no upper limit. */
    minListings: 11,
    maxListings: 20 as number | null,
    name: "Pro",
    description: "11 to 20 active boats. For a busy book.",
    price: 79,
    priceId: "price_1TQCZ4K5G1w3hzIs4bxdTVnk",
  },
  {
    id: "elite",
    /** Active-listing range this tier is priced for (listingAllowance.ts). null = no upper limit. */
    minListings: 21,
    maxListings: null as number | null,
    name: "Elite",
    description: "21 or more boats, with your own website included.",
    price: 149,
    priceId: "price_1Te6f1K5G1w3hzIsGm6Wnola",
  },
];

// Per-location plan for a whole brokerage office. Billed to the brokerage
// (not an individual broker) and unlocks every broker at that location.
export const OFFICE_PLAN = {
  id: "office",
  name: "Office",
  description: "Per location — up to 8 brokers + their assistants",
  price: 249,
  brokerCap: 8,
  priceId: "price_1TkUDuK5G1w3hzIsSBIAigXP",
};

// Reel Service (Oct 23, 2026 evening): $179 per listing per month, up to 4
// reels, paid by card in the Portal at the moment of ordering (Stripe
// Checkout, recurring monthly — see src/lib/reelServiceStripe.ts). Includes
// Starter-level Portal access while active for a broker with no paid plan.
export const REEL_SERVICE_PRICE = 179;
export const REEL_SERVICE_REELS_PER_BOAT = 4;
/** The $29 plan a broker's Portal access rolls to when their Reel Service ends. */
export const REEL_SERVICE_FALLBACK_PLAN_PRICE = 29;
/**
 * The Oct 23 morning Zoho billing path (monthly summary panel, per-broker
 * price override) is retired: brokers pay through Stripe. The code is kept
 * but hidden while this is false.
 */
export const REEL_SERVICE_ZOHO_BILLING = false;

// Broker Website (owner decision, Oct 26 2026): every tier comes in two
// versions — Portal, or Portal + Website. The website is a SECOND LINE ITEM
// ($50/month, Stripe lookup_key website_monthly_50 — src/lib/websiteAddon.ts)
// on the broker's own plan subscription, not a separate subscription. Elite
// includes it. Office-plan coverage alone doesn't. A comp (admin) also works.
export const WEBSITE_PRICE = 50;
/** Plan names (PLANS[].name) whose price includes the website. */
export const WEBSITE_INCLUDED_PLANS: string[] = ["Elite"];

/** True when this plan (by name) already includes the website. */
export function planIncludesWebsite(planName: string | null | undefined): boolean {
  return !!planName && WEBSITE_INCLUDED_PLANS.includes(planName);
}

/**
 * Monthly total for a plan WITH the website, for display: Starter 79,
 * Growth 99, Pro 129; Elite 149 (included — same as the plan alone).
 */
export function planPriceWithWebsite(plan: { name: string; price: number }): number {
  return planIncludesWebsite(plan.name) ? plan.price : plan.price + WEBSITE_PRICE;
}

/** True when this Stripe price id is one of the PLANS or the Office plan. */
export function isPlanPriceId(priceId: string | null | undefined): boolean {
  return !!priceId && (PLANS.some((p) => p.priceId === priceId) || OFFICE_PLAN.priceId === priceId);
}

/**
 * Look up the plan a Stripe price ID belongs to, including the Office plan.
 * Returns null for an unknown or missing price — e.g. a comped account, or
 * a price created in Stripe that hasn't been added here yet.
 */
export function planForPriceId(
  priceId: string | null | undefined
): { name: string; price: number } | null {
  if (!priceId) return null;
  const plan = PLANS.find((p) => p.priceId === priceId);
  if (plan) return { name: plan.name, price: plan.price };
  if (OFFICE_PLAN.priceId === priceId) {
    return { name: OFFICE_PLAN.name, price: OFFICE_PLAN.price };
  }
  return null;
}
