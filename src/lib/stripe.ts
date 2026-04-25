import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

export const PLANS = [
  {
    id: "starter",
    name: "Starter",
    description: "1–5 active listings",
    price: 49,
    priceId: process.env.STRIPE_PRICE_STARTER!,
  },
  {
    id: "growth",
    name: "Growth",
    description: "6–10 active listings",
    price: 79,
    priceId: process.env.STRIPE_PRICE_GROWTH!,
  },
  {
    id: "pro",
    name: "Pro",
    description: "11–20 active listings",
    price: 129,
    priceId: process.env.STRIPE_PRICE_PRO!,
  },
  {
    id: "elite",
    name: "Elite",
    description: "21+ active listings",
    price: 199,
    priceId: process.env.STRIPE_PRICE_ELITE!,
  },
];
