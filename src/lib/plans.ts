// Client-safe plans config — price IDs are not secret
export const PLANS = [
  {
    id: "starter",
    name: "Starter",
    description: "1–5 active listings",
    price: 29,
    priceId: "price_1TQCVIK5G1w3hzIshZWGPHIV", // TODO: replace with $29 Stripe price ID
  },
  {
    id: "growth",
    name: "Growth",
    description: "6–10 active listings",
    price: 49,
    priceId: "price_1TQCXtK5G1w3hzIsoeOZyqd0", // TODO: replace with $49 Stripe price ID
  },
  {
    id: "pro",
    name: "Pro",
    description: "11–20 active listings",
    price: 79,
    priceId: "price_1TQCZ4K5G1w3hzIs4bxdTVnk", // TODO: replace with $79 Stripe price ID
  },
  {
    id: "elite",
    name: "Elite",
    description: "21+ active listings",
    price: 99,
    priceId: "price_1TQCZzK5G1w3hzIsVgTmBvRR", // TODO: replace with $99 Stripe price ID
  },
];
