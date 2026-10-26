import { Cormorant_Garamond, Playfair_Display } from "next/font/google";
import type { SiteLayout } from "@/lib/siteStyle";

// Display serifs for broker websites (/b/…) — names and section titles. Body
// text stays in Manrope. Classic and Showroom use Cormorant Garamond;
// Editorial uses Playfair Display, which isn't preloaded (only a site on the
// Editorial layout ever asks the browser for it).
export const serif = Cormorant_Garamond({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });
export const playfair = Playfair_Display({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", preload: false });

export function displayFont(layout: SiteLayout): string {
  return layout === "editorial" ? playfair.className : serif.className;
}
