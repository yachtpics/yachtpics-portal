import { Cormorant_Garamond } from "next/font/google";

// The display serif for broker websites (/b/…): the name and section titles.
// Loaded only on these pages; body text stays in Manrope.
export const serif = Cormorant_Garamond({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });
