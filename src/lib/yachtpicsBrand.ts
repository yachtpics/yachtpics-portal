import type { BrandColors } from "@/lib/reelStyles";

/**
 * YachtPics' own brand, for the media we make about ourselves.
 *
 * Lifted out of the Reel page so the Social Post page can sign a graphic the
 * same way a reel signs a film — one card, one palette, one set of numbers,
 * changed in one place.
 */

export type BrokerCard = {
  name: string;
  brokerage: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoUrl: string | null;
};

/**
 * YachtPics as the "broker" — for our own advertising. An admin flips the
 * switch on any listing's Reel or Social Post page and the end card, colours
 * and call to action become ours. The logo is the white-on-transparent mark in
 * /public/brand; the card carries the site, not a person.
 */
export const YACHTPICS_CARD: BrokerCard = {
  name: "YachtPics",
  brokerage: "Yacht photography · The YachtPics Portal",
  // Filled in at render from the admin's choice — see YACHTPICS_PHONES.
  phone: null,
  email: "hello@yachtpics.com",
  website: "yachtpics.com",
  logoUrl: "/brand/yachtpics-logo-white.png",
};

export const YACHTPICS_COLORS: BrandColors = { accent: "#c39e4e", ground: "#050b14" };

/** Whose number goes on the ad — so each of us gets the calls our own posts earn. */
export const YACHTPICS_PHONES = {
  charlie: { label: "Charlie", phone: "561-602-9710" },
  samantha: { label: "Samantha", phone: "561-252-1488" },
} as const;

export type YpPhone = keyof typeof YACHTPICS_PHONES;
