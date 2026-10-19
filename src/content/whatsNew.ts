/**
 * The single "What's new" line above the sign-in form. Keep it to one item,
 * one short sentence, no exclamation marks. `href` is optional.
 */
export type WhatsNewItem = { label: string; text: string; href?: string };

export const WHATS_NEW: WhatsNewItem[] = [
  { label: "New", text: "Download sizes for web, MLS and social, and a one-click photo replace." },
];
