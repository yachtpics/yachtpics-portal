// Client-safe plans config — price IDs are not secret
export const PLANS = [
  {
    id: "starter",
    name: "Starter",
    description: "1–5 active listings",
    price: 29,
    priceId: "price_1TQXoyK5G1w3hzIsVwbb9wau",
  },
  {
    id: "growth",
    name: "Growth",
    description: "6–10 active listings",
    price: 49,
    priceId: "price_1TQXqgK5G1w3hzIsuxv4WI6B",
  },
  {
    id: "pro",
    name: "Pro",
    description: "11–20 active listings",
    price: 79,
    priceId: "price_1TQCZ4K5G1w3hzIs4bxdTVnk",
  },
  {
    id: "elite",
    name: "Elite",
    description: "21+ active listings",
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
