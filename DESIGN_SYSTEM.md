# YachtPics Portal — Design System (Phase 1)

The identity is built **from the logo**: a pure monochrome wordmark — thin, wide-tracked
geometric sans reading "YachtPics.com", a hairline rule, and "Y A C H T   P H O T O G R A P H Y"
in widely letterspaced small caps. The logo is already "modern luxury tech"; the app's job is
to look like it belongs to it. Three consequences drive everything below:

1. **Ink, not navy-blue.** One ramp from paper to the near-black anchor `#050b14`.
2. **Hairline rules** (1px, low opacity) are the primary structural device.
3. **Gold is demoted** from wallpaper (366 hardcoded uses) to a single restrained
   brass/champagne accent — one primary action per screen, focus rings, key highlights.
   Never a large fill, never decoration. **The photography is the only loud thing on screen.**

All tokens live in `tailwind.config.ts`. No hardcoded hex in application code.

---

## 1. Color tokens

### `ink` — the neutral/ink ramp
Light steps are near-neutral grays; dark steps deepen into the blue-black anchor.

| Token | Hex | Use |
|---|---|---|
| `ink-50` | `#f7f8f9` | App canvas (body background) |
| `ink-100` | `#eef0f2` | Subtle fills, hover fills |
| `ink-200/300` | `#e0e3e7` / `#c5cbd2` | Stronger borders, disabled strokes |
| `ink-400` | `#99a2ad` | Placeholder, tertiary text (large sizes only) |
| `ink-500` | `#6d7581` | Secondary text, small-caps labels |
| `ink-600/700` | `#4c5560` / `#343d4a` | Body text on tinted fills |
| `ink-800` | `#1b2433` | Dark hover surface |
| `ink-900` | `#0c1420` | Primary text on light; raised dark surface |
| `ink-950` | `#050b14` | **The anchor.** Dark canvas, ink buttons |

### `accent` — brass / champagne
Refined from the legacy `#d4a843` toward a slightly desaturated brass that sits better on ink.

| Token | Hex | Use |
|---|---|---|
| `accent-300` | `#dfc98a` | Accent text/links **on dark surfaces** |
| `accent-400` | `#d2b167` | Primary-button hover |
| `accent-500` | `#c39e4e` | **Primary action fill** (always with `text-ink-950`), focus rings |
| `accent-600` | `#a58238` | Large accent text / UI accents on white (≥3:1 only) |
| `accent-700` | `#84662a` | Minimum for body-size accent text on white (AA, 5.4:1) |

**Contrast rules:** gold on white fails AA below `accent-700`. Never set body text in
`accent-400/500/600` on a light surface. On `ink-950`, use `accent-300`.

### Semantic
`success` (green), `warn` (amber), `danger` (red), `info` (blue) — each with `50/200` tints
for chips and banners and `600/700` for text. Use these instead of raw Tailwind
`green-* / amber-* / red-* / blue-*`.

### `hairline`
| Token | Value |
|---|---|
| `hairline` (DEFAULT) | `rgba(5,11,20,0.08)` — card borders, dividers |
| `hairline-strong` | `rgba(5,11,20,0.14)` — control borders |
| `hairline-inverse` | `rgba(255,255,255,0.12)` — rules/borders on ink |
| `hairline-inverse-soft` | `rgba(255,255,255,0.07)` |

CSS variables (`--accent`, `--ink-950`, `--hairline*`) are mirrored in `globals.css` for
inline-style contexts (portals, canvas).

### Deprecated
`navy-*` and `gold-*` are aliased onto `ink`/`accent` so stragglers still render.
**Do not use in new code; delete after Phase 2.**

---

## 2. Typography

**Family:** Manrope (single family), self-hosted via `next/font` in `src/app/layout.tsx`
(zero layout shift, no Google Fonts round-trip; the old CSS `@import` is gone). Manrope is a
geometric neo-grotesque: its light weights echo the thin letterforms of the wordmark, its
regular weights stay crisp at UI sizes. Exposed as `--font-sans` → Tailwind `font-sans`.

**Scale** (Tailwind `fontSize` tokens):

| Token | Size / treatment | Use |
|---|---|---|
| `text-display` | 28px, semibold, -0.02em | Page titles (vessel name, greeting) |
| `text-h1` | 22px, semibold | Sub-page titles |
| `text-h2` | 17px, semibold | Card titles |
| `text-body` | 14px / 1.55 | Default body |
| `text-small` | 12px | Metadata, captions |
| `text-label` | 11px, semibold, +0.14em | Base of the caps label |

**Big numbers** (stats): `text-3xl font-light tabular-nums` — thin, wide, quiet.

**The label treatment** — the direct echo of "Y A C H T   P H O T O G R A P H Y":

- CSS utility: `.label-caps` / `.label-caps-inverse` (globals.css) — uppercase, +0.14em
  tracking, 11px semibold. Use for section headers, table headers, form labels, metadata kickers.
- Component: `<Label>` in `src/components/ui` (tones: `light` / `dark`).
- Display variant: `tracking-caps-wide` (+0.24em) with `[text-indent:0.24em]` to optically
  center — used for the wordmark lockup on the login screen.

---

## 3. Spacing, radius, shadow, motion

- **Radius:** `rounded-ctl` (8px — buttons, inputs), `rounded-card` (12px — cards),
  `rounded-surface` (16px — modals).
- **Shadows:** layered and tight, never default Tailwind haze:
  `shadow-elev-1` (resting card), `shadow-elev-2` (hover/raised), `shadow-elev-3` (modals).
  Each includes a 1px ring so surfaces read as cut, not blurred.
- **Motion:** `duration-fast` 120ms, `duration-base` 160ms, `duration-slow` 220ms with
  `ease-quiet`. Color/border/shadow transitions only — no bouncy or playful motion.
- **Rules:** `.rule` / `.rule-inverse` render a 1px hairline `<div>`; or
  `border-b border-hairline` on containers.

---

## 4. UI primitives — `src/components/ui/`

Presentational only, dependency-free. Import from `@/components/ui`.

| Component | API |
|---|---|
| `Button` | `variant: primary \| secondary \| ghost \| danger`, `size: sm \| md`, native `disabled` (dims to 40%, never removes the control — access gating stays visible) |
| `Card`, `CardHeader`, `CardBody` | `CardHeader` takes `title`, optional `kicker` (small caps), `description`, `action` |
| `Input` | `tone: light \| dark` (dark for ink surfaces, e.g. login) |
| `Badge` | `tone: neutral \| success \| info \| warn \| danger \| accent` |
| `Label` | small-caps form/section label, `tone: light \| dark` |
| `cx` | tiny className joiner |

Rules of use: **one `primary` button per view region.** Ink-filled buttons
(`bg-ink-950 text-white`) are acceptable as a "strong secondary" for send/share actions.
Status pills are always `Badge`.

---

## 5. Restyled in Phase 1

- `tailwind.config.ts` — token system
- `src/app/globals.css` — utilities, CSS vars, `next/font` handoff
- `src/app/layout.tsx` — Manrope via `next/font`, themeColor `#050b14`
- `src/components/ui/*` — primitives (new)
- `src/app/auth/login/page.tsx` — full-bleed ink composition: wordmark lockup with hairline
  rule and small-caps "Portal", champagne glow, dark-tone inputs, single accent action
- `src/app/dashboard/page.tsx` — hairline-divided stat row, quiet cards, ink onboarding panel,
  Badge statuses (broker + assistant branches)
- `src/app/dashboard/listings/[id]/page.tsx` — full token migration (~80 hex removals),
  small-caps section headers, hairline cards, brass primary actions, ink send actions.
  **All access gating (`hasAccess`, `accessStatus`, `canSendToClient`, disabled states,
  subscribe prompts) preserved exactly.**

---

## 6. Phase 2 rollout plan (~37 remaining pages)

**Order of attack (visibility-first):**

1. **Shared shell first:** `src/app/dashboard/_components/DashboardNav.tsx` and
   `TrialBanner.tsx`, plus `src/app/dashboard/layout.tsx` (`bg-gray-50` → `bg-ink-50`).
   The nav is on every screen; restyling it pays for every page at once.
2. **Broker-facing pages:** `dashboard/listings` (index, `new`, `[id]/edit`), `shoots`,
   `billing`, `profile`, `team`, `brokerage`, `brokers`, `help`, `tips`, `terms`.
3. **Client-facing surfaces (highest brand exposure):** `/s/[slug]` slideshow, `/client`,
   `/auth/*` (signup, forgot/reset password), root landing page.
4. **`src/app/admin/*`** (all admin pages) — same tokens; admin can adopt a denser variant
   but no new colors.
5. **Shared components:** `HelpTip`, `EnableNotifications`, `InstallPrompt`,
   `ContentRightsModal`, `DownloadLicenseModal`, `ListingQRCode`.

**Mechanical recipe per page:** map `gray-*` → `ink-*`; brand hex → `accent-*`/`ink-*`
(same substitution table used in Phase 1 — see git history for the sed map); raw
`green/amber/red/blue` → semantic tokens; card wrappers → `Card`/hairline+`shadow-elev-1`;
section headings → `.label-caps`; buttons → `Button` variants; pills → `Badge`.
Never alter gating conditions while restyling.

**⚠ Flagged files with their own hardcoded navy/gold — must be updated in Phase 2 so
printed/emailed/exported artifacts still match the app:**

- `src/lib/portalTips.ts` — tip content carries inline color references
- `src/lib/announcementEmail.ts` — email template inline styles (old navy/gold)
- `src/app/print/listing/[id]/page.tsx` — **printed spec sheet**; a broker hands this to a
  buyer, so it must carry the new ink/brass identity (visual template values only — do not
  touch data logic)
- `src/app/dashboard/listings/social/page.tsx` + `src/app/dashboard/listings/[id]/social` —
  **social post canvas** renders colors into exported images; update its palette constants
- `src/app/manifest.ts` — PWA theme/background colors
- `public/` icons / splash if they embed the old gold

**Cleanup gate to close Phase 2:** grep for `#d4a843|#050b14|#c49a35|#b08c2a|#a07820|#0a1628|#0f2035|#1e3a5f`
returns zero in `src/`; then delete the `navy`/`gold` aliases from `tailwind.config.ts`.

---

## 7. Accessibility

- Body text is `ink-600` or darker on light, `white`/`ink-300` on ink — AA everywhere.
- Accent text on white: `accent-700` minimum. On ink: `accent-300`.
- Every interactive element keeps a visible focus: global `:focus-visible` outline in the
  accent, refined per-component with `focus-visible:ring-2 ring-accent-500`.
- Disabled ≠ hidden: gated controls dim (40%) and keep their explanatory `title` tooltips.
- All screens verified at 390px; stat rows and card grids collapse to single column.
