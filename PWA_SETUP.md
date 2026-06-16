# PWA support (#35)

Adds installability + offline fallback to the broker portal. App Router, no new dependencies.

## Files added
- `src/app/manifest.ts` — web manifest, served at `/manifest.webmanifest` and auto-linked by Next.
- `public/sw.js` — service worker (network-first navigations + offline fallback, SWR for static assets, never caches Supabase/Stripe/`/api`).
- `src/app/offline/page.tsx` — branded offline fallback screen.
- `src/components/ServiceWorkerRegistration.tsx` — registers `/sw.js` (production only), auto-reloads on new deploys.
- `src/components/InstallPrompt.tsx` — install banner (`beforeinstallprompt` on Chromium, Share-sheet hint on iOS), dismissal remembered.
- `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` — "YP" monogram icons generated from the YachtPics logo (real Y + P letterforms) (white on navy `#0b1f33`).
- `src/app/apple-icon.png`, `src/app/icon.png` — Apple touch icon + favicon, auto-linked by Next.

## Files changed
- `src/app/layout.tsx` — added `viewport.themeColor`, `appleWebApp` metadata, and mounted `<ServiceWorkerRegistration />` + `<InstallPrompt />`.

## Branding
Icons are the YachtPics "YP" monogram (white on navy `#0b1f33`), derived from the official logo. To restyle later, replace the files in `public/icons/` and `src/app/` at the same sizes.

## Why Supabase data isn't cached
Navigations are network-first and the HTML response is never stored, so brokers never get a stale dashboard or a logged-out shell. Only the offline page and static build assets are cached. The middleware matcher (`/dashboard`, `/admin`, auth pages) does not touch `/sw.js`, the manifest, `/offline`, or `/icons`, so registration works unauthenticated.

## How to verify
- `npm run build && npm start` (the SW only registers in production builds).
- DevTools → Application → Manifest: name, theme color, 3 icons, no errors.
- DevTools → Application → Service Workers: `sw.js` activated.
- Lighthouse → "Installable" check passes.
- Toggle DevTools → Network → Offline, reload a route → offline page appears; static assets still load.
- To roll out a new SW version later, bump `CACHE_VERSION` in `public/sw.js`.
