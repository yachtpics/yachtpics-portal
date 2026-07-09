import type { Config } from "tailwindcss";

/**
 * YachtPics design tokens — Phase 1 of the identity refresh.
 *
 * The system is built from the logo: pure monochrome, thin geometric
 * letterforms, a hairline rule, wide-tracked small caps. Three ideas:
 *
 *  1. `ink`      — one ramp from paper-white to the blue-black anchor
 *                  (#050b14) that already underpinned the app. Light steps
 *                  are near-neutral; dark steps deepen into the ink anchor.
 *  2. `accent`   — gold demoted from wallpaper to a single restrained
 *                  brass/champagne accent. Use for one primary action,
 *                  focus rings, and key highlights. Never a large fill.
 *                  Text on white must use accent-700 or darker (AA).
 *  3. `hairline` — 1px low-opacity rules as the primary structural device,
 *                  echoing the rule in the wordmark.
 *
 * Legacy `navy`/`gold` scales are aliased onto the new ramps so any
 * straggler class still renders; do not use them in new code.
 */

const ink = {
  50: "#f7f8f9",
  100: "#eef0f2",
  200: "#e0e3e7",
  300: "#c5cbd2",
  400: "#99a2ad",
  500: "#6d7581",
  600: "#4c5560",
  700: "#343d4a",
  800: "#1b2433",
  900: "#0c1420",
  950: "#050b14", // the anchor — canvas ink
};

const accent = {
  50: "#faf6eb",
  100: "#f4ebd3",
  200: "#e9daab",
  300: "#dfc98a", // champagne — accent text on dark surfaces
  400: "#d2b167",
  500: "#c39e4e", // primary action fill (with ink-950 text)
  600: "#a58238", // large text / UI accents on white (≥3:1)
  700: "#84662a", // minimum for body-size accent text on white (AA)
  800: "#634c20",
};

const success = {
  50: "#eefaf2",
  200: "#c7ebd2",
  300: "#8fd6aa",
  600: "#1d7d48",
  700: "#175f39",
};

const warn = {
  50: "#fdf8ea",
  200: "#f2e3b0",
  300: "#e6cd7f",
  700: "#8a6a1d",
  800: "#6e5517",
};

const danger = {
  50: "#fdf1f0",
  200: "#f5cfca",
  300: "#eba49c",
  500: "#d24a3d",
  600: "#b93a2f",
  700: "#992f26",
};

const info = {
  50: "#eef4fb",
  200: "#c9dcf1",
  700: "#2b5c94",
};

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink,
        accent,
        success,
        warn,
        danger,
        info,
        hairline: {
          DEFAULT: "rgba(5, 11, 20, 0.08)",
          strong: "rgba(5, 11, 20, 0.14)",
          inverse: "rgba(255, 255, 255, 0.12)",
          "inverse-soft": "rgba(255, 255, 255, 0.07)",
        },
        // ── Deprecated aliases (Phase 2: migrate, then delete) ──────────
        navy: {
          50: ink[50],
          100: ink[100],
          500: ink[700],
          600: ink[800],
          700: ink[800],
          800: ink[900],
          900: ink[950],
        },
        gold: {
          400: accent[500],
          500: accent[600],
          600: accent[700],
        },
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
      },
      fontSize: {
        // Type scale — see DESIGN_SYSTEM.md
        display: ["1.75rem", { lineHeight: "1.15", letterSpacing: "-0.02em", fontWeight: "600" }],
        h1: ["1.375rem", { lineHeight: "1.2", letterSpacing: "-0.015em", fontWeight: "600" }],
        h2: ["1.0625rem", { lineHeight: "1.3", letterSpacing: "-0.01em", fontWeight: "600" }],
        body: ["0.875rem", { lineHeight: "1.55" }],
        small: ["0.75rem", { lineHeight: "1.5" }],
        label: ["0.6875rem", { lineHeight: "1.2", letterSpacing: "0.14em", fontWeight: "600" }],
      },
      letterSpacing: {
        caps: "0.14em", // standard small-caps label
        "caps-wide": "0.24em", // wordmark-adjacent display caps
      },
      borderRadius: {
        ctl: "0.5rem", // controls: buttons, inputs, selects
        card: "0.75rem", // cards and panels
        surface: "1rem", // modals, large surfaces
      },
      boxShadow: {
        // Layered, low-blur elevation — never default Tailwind haze
        "elev-1": "0 0 0 1px rgba(5,11,20,0.04), 0 1px 2px rgba(5,11,20,0.05)",
        "elev-2":
          "0 0 0 1px rgba(5,11,20,0.04), 0 2px 6px -1px rgba(5,11,20,0.06), 0 10px 24px -10px rgba(5,11,20,0.12)",
        "elev-3":
          "0 0 0 1px rgba(5,11,20,0.05), 0 4px 12px -2px rgba(5,11,20,0.10), 0 28px 56px -16px rgba(5,11,20,0.25)",
      },
      transitionDuration: {
        fast: "120ms",
        base: "160ms",
        slow: "220ms",
      },
      transitionTimingFunction: {
        quiet: "cubic-bezier(0.25, 0, 0.15, 1)",
      },
      spacing: {
        // Section rhythm helpers
        18: "4.5rem",
        22: "5.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
