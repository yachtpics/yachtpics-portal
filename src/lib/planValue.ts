/**
 * Why a Portal plan is worth it — the ONE source for that message (Oct 27).
 * Every broker-facing place that meets the subscription (Billing, gates,
 * trial banner and emails, login, /see, Help) draws from here so the story
 * never drifts. Client-safe; plain strings (HTML-free) so emails can use them.
 *
 * Voice: premium, understated, specific. No exclamation marks, no hype words.
 */
import { PLANS, WEBSITE_PRICE } from "@/lib/plans";

/** The cheapest plan, for "from $29 a month". */
export const PLAN_FROM_PRICE = Math.min.apply(null, PLANS.map((p) => p.price));

/** The second half on its own, for places that already say the photos are free. */
export const PLAN_PUTS_TO_WORK = "A plan puts them to work.";
export const PLAN_ONE_LINER = `Your photos are free. ${PLAN_PUTS_TO_WORK}`;
export const PLAN_FROM_LINE = `From $${PLAN_FROM_PRICE} a month.`;

/** In this order. `label` is short; `detail` is one line. */
export const PLAN_BENEFITS: { key: string; label: string; detail: string }[] = [
  { key: "slideshows", label: "Buyer slideshows", detail: "Branded to you, with video, sent to clients from the Portal." },
  { key: "reports", label: "Seller Reports", detail: "What buyers look at on every listing, ready to send the owner." },
  { key: "reels", label: "Unlimited reels", detail: "A dozen looks, with original music you can post anywhere." },
  { key: "dockcards", label: "Boat-show dock cards", detail: "A printed card with a QR code, and a count of every scan." },
  { key: "own", label: "Your own listings", detail: "Upload your own photos for boats we didn't shoot." },
];

/** Optional extra line where there's room. */
export const PLAN_WEBSITE_EXTRA = `Your own website — +$${WEBSITE_PRICE} a month, included with Elite.`;

/** The second sentence of every lock / gate prompt (then a "See plans" link to Billing). */
export const PLAN_GATE_LINE = `Included with every plan, from $${PLAN_FROM_PRICE} a month.`;
export const PLAN_GATE_LINK = "See plans";
export const BILLING_PATH = "/dashboard/billing";

/**
 * Assistant wording for a plan gate (Nov 11). An assistant works inside a
 * broker's listings, and every gate there follows THAT broker's plan — so an
 * assistant never sees "See plans", a price or a Billing link (Billing isn't
 * theirs; /dashboard/billing tells them so). Every assistant-facing no-plan
 * line comes from here. The broker is named, or "this broker" / "they" if the
 * name couldn't be loaded — never a gendered pronoun.
 */
export type AssistantPlanCopy = {
  /** "Jim Nobel doesn't have a plan." */
  headline: string;
  /** "Needs Jim Nobel's plan" — short, for tiles, tooltips and disabled buttons. */
  needs: string;
  /** "Off until Jim Nobel has a plan." — a whole sentence. */
  offUntil: string;
  /** "until Jim Nobel has a plan" — to end a sentence of your own. */
  untilPlan: string;
  /** "Jim chooses one" / "they choose one" — ends the slideshow notice. */
  choosesOne: string;
};

export function assistantPlanCopy(broker: { first?: string | null; last?: string | null } | null | undefined): AssistantPlanCopy {
  const first = (broker?.first ?? "").trim();
  const full = [first, (broker?.last ?? "").trim()].filter(Boolean).join(" ");
  return {
    headline: `${full || "This broker"} doesn’t have a plan.`,
    needs: `Needs ${full ? `${full}’s` : "the broker’s"} plan`,
    offUntil: `Off until ${full || "this broker"} has a plan.`,
    untilPlan: `until ${full || "this broker"} has a plan`,
    choosesOne: first ? `${first} chooses one` : "they choose one",
  };
}

/** "buyer slideshows, Seller Reports, unlimited reels, boat-show dock cards and your own listings" */
export const PLAN_BENEFITS_SENTENCE = (() => {
  const l = PLAN_BENEFITS.map((b) => (b.key === "reports" ? b.label : b.label.charAt(0).toLowerCase() + b.label.slice(1)));
  return `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}`;
})();

/** One line per benefit: "Buyer slideshows — Branded to you, …" */
export function benefitLines(): string[] {
  return PLAN_BENEFITS.map((b) => `${b.label} — ${b.detail}`);
}
