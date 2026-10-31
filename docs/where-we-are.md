# Where we are — October 6, 2026

> **2026-10-31 — In Review reels (admin, `/admin/reels/review`) — NOT PUSHED, NOT BROWSER-TESTED · MIGRATION `20261031_review_reels.sql` NOT APPLIED (saving needs it; everything else works without) · no new dependency.** One profile photo per boat shot in a period, between an opening card and the YachtPics end card; nothing on the boat frames. **Boats:** `listings.photographed_at` (else `created_at`) inside the period in Eastern time; pocket listings (`showcase_opt_out`) and test brokers (`isTestBroker`: test/demo/sample/example in the name, John/Jane Doe) out; sold kept. Presets are whole calendar months (This month, Last month, Last 3/6 months, This year, Last 12 months) + custom dates. **Photo (Charlie's rule):** `pickProfilePhoto` (src/lib/reviewReel.ts) — the cover (hero) photo if set and visible, else the first "Profiles" photo in listing order (`orderPhotos`); no other fallback. A boat with neither is left OUT: the API returns it in `noProfile`, and the page lists it under a collapsed "Not included — no profile photo (N)" note, where "Use another photo" adds it to the reel at its date. "Use another photo" also swaps the shot on any boat in the grid. **Render:** new `src/lib/reviewReelRender.ts` — ReelMaker's frames (1080×1920 / 1920×1080, 30 fps, H.264 QUALITY_HIGH), its Editorial still motion (zoom scaled to the hold), `drawTransition` cut/dissolve, and ReelMaker's own end card, now shared as `src/lib/reelEndCard.ts` (ReelMaker's `drawEndCard` calls it; behaviour unchanged — an empty name just skips the headline). Photos: 2000 px derivatives batch-signed by `POST /api/admin/reels/review/sign`, decoded 10 ahead / 4 at a time and closed once played; MP4 streamed to OPFS (Showroom Loop pattern). Music: one reelMusic track ≤150 s, else ~75 s stretches crossfaded. Seconds per boat default 1.0 (≤60) / 0.7 (≤150) / 0.5; slider 0.4–2.0. **Out:** Download, Send to my phone (new upload target `{reviewShare:true}` → `reel-shares/review/`, swept with the other hand-offs; `POST /api/admin/reels/review/link` signs 24 h), caption + Copy. **Saved:** `review_reels` (period, items [{listingId, photoId, included}], settings) via `/api/admin/reels/review/saved`; auto-saved after each render. Routes: `GET /api/admin/reels/review?from&to`, `GET …/photos?listingId`. Nav: "In Review" (Reels now highlights only on its own pages); link on /admin/reels. Checked against live data: Oct 2026 = 64 shot, 5 pocket → 59 with photos → **47 in the reel** (1 cover, 46 Profiles), 12 with no profile photo; 2026 to date = 266 with photos → **223** (12 cover, 211 Profiles), 43 with no profile photo.

> **2026-10-29 — Campaign email tracking.** New table `email_events` (migration `20261029m_email_events.sql`, applied; backfill in `20261029m_email_events_backfill.sql`, run). Slideshow-ready, announcement and tips sends now pick their email_log id before sending (`newEmailLogId`) and pass the HTML through `trackEmailHtml` (src/lib/emailTracking.ts). That wraps our-domain links in `/api/e/c/{token}?u=`, which redirects only to portal.yachtpics.com or yachtpics.com, leaves unsubscribe links alone, and adds the `/api/e/o/{token}.gif` pixel. Tokens are HMAC-signed. Opens are deduped to one per email per hour and obvious bot user agents are skipped. Sign-ins are credited from the login and confirm pages (`POST /api/e/signin`) and from the /auth/callback route, to the most recent tracked email in the last 7 days, one per email. Reports appear on the Slideshow-ready page and at /admin/announce/report?type=….

> **2026-10-29 — Slideshow-ready email opens the slideshow.** The campaign button now links to `/s/{slug}?preview=1`. If the owner has no plan and nobody is signed in, `preview=1` sends the visitor to `/auth/login?next=/s/{slug}?preview=1`, which `safeNextPath` accepts (same-site only). Owners, their team and admins see a dismissible bar: "This is what your buyer sees…" with a link to /dashboard/billing. Those previews are not counted in slideshow views or events. Without `preview=1` the public still gets "temporarily unavailable". **Hero image fix:** the email used a signed link to the 2000px WebP, which mail clients show as broken. It now uses a public ~1200px JPEG (q82) made with sharp (`src/lib/emailCoverImage.ts`). The file is stored once under `email/slideshow-ready/{listingId}/…`, on R2 when configured, otherwise in Supabase `portal-assets`, and reused. If the image fails, the email goes out without it.

## Oct 29 — "Slideshow ready" campaign tooling (/admin/announce/slideshow-ready) — NOT PUSHED · MIGRATION `20261029_slideshow_prepared.sql` APPLIED · no new dependency

- **Step 1 — Prepare:** candidates = active, unsold, unpublished listings with ≥1 visible photo of brokers with NO access (getEffectiveAccessStatus + hasAccess). Checkboxes (test-looking accounts start unticked), "Prepare N slideshows" → `prepareSlideshows` re-checks eligibility, then applies `slideshowPublishUpdate` (new `src/lib/slideshowPublish.ts`, now also used by the broker's and admin's Create Slideshow buttons) + `listings.slideshow_prepared_by / _at`. Side-effect audit: the change is two columns; the only listings trigger guards ownership/sharing; no code sends email/push, publishes to yachtpics.com, touches the showcase or posts socially on publish; public link stays private while the broker has no access.
- **Step 2 — Email:** recipients = brokers without access with ≥1 active unsold published slideshow, email_opt_out false, not already logged `slideshow_ready_2026_10` (sent). Featured = most recent photographed_at (else created_at); "…one of N ready" line when N > 1. Hero image = cover at 2000px, 90-day signed link. Button → `/dashboard/listings/{id}?section=slideshow` (survives the sign-in redirect via ?next=; the listing page now scrolls to Client Slideshow on `?section=slideshow` / `#slideshow`). No "Preview" link: signed out, /s shows "temporarily unavailable". Page: recipient list with checkboxes, 3 rendered previews, Send a test to me (logged as `…_test`), Send with typed SEND; Resend batch + email_log per recipient (dedup).

## Oct 28 — Photo originals → Cloudflare R2 (dual backend + migration tool) — NOT PUSHED, NOT TESTED LIVE · MIGRATION `20261028c_photo_originals_r2.sql` APPLIED · no new dependency

- **Why:** Supabase Storage ~105 GB (Pro includes 100), +~9 GB/week. Full-res originals move to R2 (no egress charge); the 600/2000 px WebP derivatives stay in Supabase.
- **Data:** `photos.storage_backend` ('supabase' | 'r2', default supabase), `original_bytes`, `r2_verified_at`, `r2_copy_error`, `supabase_removed_at`; `listings.site_photos_backend` (null = site-photos bucket, 'r2' = media host); `photo_storage_stats()` (service role); indexes on `photos(storage_path)` and `(storage_backend, id)`.
- **Layout:** R2 key = `photos/listing-photos/{storage_path}` in `R2_PHOTO_BUCKET` (defaults to the private video bucket `R2_VIDEO_BUCKET`, whose CORS already allows PUT/GET from the portal). storage_path never changes, so derivative names are identical.
- **One door:** `src/lib/photoStore.ts` (server: signOriginalPaths/Map/Url, signResizedPath[s], readOriginal, deleteOriginals, presign PUT/HEAD/copy, the switch), `src/lib/photoStoreClient.ts` (browser: signOriginalsInBrowser, photoDrawUrls, uploadOriginal, discardUploadedOriginal, resizeImageBlob), `src/lib/photoStoreShared.ts`. Backends are looked up by path through the caller's client; R2 links only for paths inside their row's listing/gallery folder. New routes: `POST /api/photos/upload-target`, `POST /api/photos/originals`.
- **Switches — both OFF by default (deploy is a no-op for existing behaviour):** new uploads go to R2 only when env `PHOTO_ORIGINALS_BACKEND=r2` (`NEW_ORIGINALS_TO_R2 = false` in photoStore.ts); website photos go to the R2 media host only when env `SITE_PHOTOS_BACKEND=r2` (sitePublish.ts). Unset = Supabase exactly as before.
- **Review fixes (Oct 28, later):** upload-target only signs NEW keys (no photos row, no R2 object), ≤100 MB, length+type signed; discard deletes only that fresh R2 key (never Supabase); R2 PUT failure falls back to the Supabase upload; R2 uploads await their derivatives (makeDerivativesNow) before the row is used; resized links for R2 originals never fall back to the full original (null = "processing" tile / skipped); AI labelling/description/reel copy pass `ensure: true` (derivatives made first); dock card makes a 2000 px JPEG/PNG server side via a staged copy (no sharp installed); website R2 copy is per-photo error-tolerant and time-boxed (35 s, resumable); publish-site restores publish_to_site when the build fails; daily derivatives cron sweeps `_tmp/derive/` older than 1 h; photoAlt moved to src/lib/photoAlt.ts.
- **Derivatives for R2 originals:** ensureDerivatives stages the original under `_tmp/derive/` in listing-photos, runs the same Supabase transform, removes the staged copy.
- **Transforms on R2 originals** use the stored derivatives (contain ≤600 → 600 copy; other contain → 2000 copy; cover → Supabase transform of the 2000 copy); no derivatives yet → the original. Web/Social downloads of R2 originals are resized in the browser (download-urls returns `resize`).
- **Website:** boat pages publish photos to the public R2 media host (`{site_page}/{slug}/{photoId}.{ext}`, same names as site-photos); `site_photos_backend` set only after a successful upload.
- **Migration (Admin → Storage, `/admin/storage`):** job `photo_originals_copy` (50/step, copy → HEAD size+type → mark r2; never deletes; cancel = pause; start again carries on). Gated jobs `photo_originals_cleanup` and `site_photos_cleanup` need the typed phrase "DELETE SUPABASE COPIES"; re-verify on R2 before removing.
- **Speed (Oct 28, later):** `sharp@^0.34.5` added. R2 originals: derivatives made with sharp in the function (`src/lib/photoSharp.ts`: rotate, fit inside, no enlargement, WebP q80), staging only if sharp can't decode (HEIC). Web & MLS (2048) / Social (1080) JPEG q85 (PNG stays PNG) pre-made into R2 `photos/listing-photos/{dir}/_dl/{id}-{v}-{web|social}.{jpg|png}` at upload finalize and in the copy job; recorded in `photos.download_sizes` (migration `20261028d_photo_download_sizes.sql`, APPLIED); download-urls serves them by presigned GET, makes missing ones on demand (35 s budget, rest `pending`, page re-asks); browser resizing removed. removeDerivatives also deletes `_dl` files; cleanup jobs never do. Dock card for R2 photos: sharp JPEG from the original. Admin → Storage: R2 download-file totals + **Speed check** (tile grid, slideshow first image, download start per size, zip start).
- **Upload split + HEIC (Oct 28, later):** R2 uploads make only the 600 tile (`ensureThumb600`, `photos.thumb_at`, migration `20261028e_photo_thumb_at.sql` APPLIED) via `POST /api/listings/[id]/photos/derivatives {quick:true}` — started without holding up the next upload; the tile appears when it lands. That call queues job `r2_photo_finish` (2000 copy → derivatives_at, Web/Social files) and kicks the worker. HEIC (sharp can't decode): 600 / 2000 / Web / Social all via a staged Supabase copy with today's transform params; never "failed" where Supabase succeeded. AI labelling keeps its 800 px image (transform of the 2000 copy; made first if missing).
- **Tested:** typecheck + eslint clean. Nothing copied or deleted.

## Oct 27 — Plan-value copy pass — NOT PUSHED · no migration, no new dependency

- **One source:** `src/lib/planValue.ts` — `PLAN_ONE_LINER` ("Your photos are free. A plan puts them to work."), `PLAN_BENEFITS` (Buyer slideshows · Seller Reports · Unlimited reels · Boat-show dock cards · Your own listings, each with a one-line detail), `PLAN_BENEFITS_SENTENCE`, `PLAN_WEBSITE_EXTRA`, `PLAN_GATE_LINE` ("Included with every plan, from $29 a month.") + `PLAN_GATE_LINK` ("See plans"), `PLAN_FROM_LINE`. Plan card descriptions in `src/lib/plans.ts`.
- **Applied to:** Billing (free box, new "Every plan includes" row, lapsed/cancelled/trial-ended lines, "Choose plan" buttons), dashboard (onboarding step, trial card button, Plan tooltip), TrialBanner, sidebar "Trial Ended" card, listing page gates (Send to Client tooltips, Add Photos, upload area, documents, lapsed-slideshow notice), Social Post and Reel gates + reel watermark + two-reel allowance line, spec-sheet and Seller Report preview overlays, the send-to-client 403 message, login (new line), /see Plans block, welcome + admin-invite emails, trial-ending / trial-ended emails (the "What stops / What you lose" lists now follow the five benefits), Help Billing steps (literal text — the PDF builder parses it), "unlocked" → "covered" in Office-plan copy. PDF rebuilt.
- **Left alone:** admin screens, terms, Stripe/webhook notes to Charlie, the one-off FLIBS announcement email, Day-7 trial email (no stop list), the Office plan description, error messages not about value.

## Oct 26 (late) — Listing-range nudge (no enforcement) — NOT PUSHED, NOT TESTED LIVE · no migration, no new dependency

- **Rule source:** `PLANS[].minListings / maxListings` in `src/lib/plans.ts` (Starter 1–5, Growth 6–10, Pro 11–20, Elite 21+). `src/lib/listingAllowance.ts` → `listingAllowance(svc, brokerId)`: { plan, limit (null for Elite / Office-only / comped / trial / no own Stripe plan), activeCount (status active, sold_at null — pocket listings count), over, suggestedPlan (cheapest plan covering the count), suggestedTotalMonthly (with the $50 website line if it's on their plan; Elite includes it), hasWebsite }. `allowanceMessage()` builds the one line. `ENFORCE_LISTING_LIMITS = false` — when switched on, the listing-creation routes are meant to call the same function and refuse a new active listing at `activeCount >= limit`; nothing blocks today.
- **Billing:** calm notice at the top when over — "You have {n} active boats. {Plan} covers up to {limit}. {Suggested} covers {range} — ${total}/mo." + "Upgrade to {Suggested}" through the existing change-plan flow (confirm dialog; website line kept as is). Data from new `GET /api/billing/allowance` (self only).
- **My Listings:** the same line as a banner above the list (`PlanNudgeBanner`), dismiss = this browser session only (sessionStorage). Brokers get "Upgrade to {Suggested}" → Billing; assistants see it for each broker they work for ("{Name} has …") with "Ask {first name} to upgrade." (no billing action).
- **Admin broker page:** "Over plan: {n} boats on {Plan}" chip in the Subscription card.
- **No emails. Help unchanged** — no Help paragraph mentions the listing ranges.
- **Tested:** typecheck + eslint clean.

## Oct 26 (late) — Broker Websites: section order + "your own photos" — NOT PUSHED, NOT TESTED LIVE · MIGRATION `20261026e_section_order.sql` NOT APPLIED · no new dependency

- **Section order:** `broker_sites.section_order jsonb` (null = the layout's default: Classic/Editorial `proof, yachts, sold, about, testimonials, sell`; Showroom leads with `yachts`). `cleanSectionOrder` (`src/lib/brokerSite.ts`) keeps known keys once and appends missing ones in default order — used on save and on read. Hero always first, Contact + footer last. All three layouts render in that order (`SiteHome` maps keys → sections); header nav anchors follow it (`SiteShell` `order` prop; boat pages too). Preview honours `order=` (comma list). Site reads fall back without the column; saving before the migration answers "section order isn't switched on yet".
- **Proof strip switch:** `sections.proof` (default on) so every movable section has a switch except Yachts (always on).
- **Editor:** "What's on the page" replaced by a **Sections** card (`SectionOrder.tsx`): rows with a drag handle (native HTML5 drag and drop on desktop), up/down buttons on every row (keyboard / touch / phone), the on/off switch per row, and Show prices underneath. Unchanged order stays null so it follows a layout change; Preview carries the unsaved order.
- **Own photos message:** Your boats card: "Boats we didn't shoot can be on your site too — add a listing and upload your own photos." + Add a listing (→ /dashboard/listings/new); empty state says the same. Help ("How boats appear") and the Billing website row ("ours and the ones you photograph yourself") updated; Help also got a Sections step + quick-ref row. PDF rebuilt.
- **Tested:** typecheck + eslint clean.

## Oct 26 (evening) — Broker Websites: three layouts + curated colours — NOT PUSHED, NOT TESTED LIVE · MIGRATION `20261026d_site_style.sql` NOT APPLIED · no new dependency

- **Data:** `broker_sites.layout` (classic | editorial | showroom, default classic), `palette` (default harbor), `accent` (hex or null = palette's), `ground` (hex or null; reserved — not in the editor, honoured only if it keeps the palette's light/dark character). Column-level grant extended to them. Before the migration everything renders Classic / Harbor (site reads retry without the look columns: `readSiteRow` in `brokerSiteServer.ts`); saving the look answers "layouts and colours aren't switched on yet".
- **Colours — `src/lib/siteStyle.ts`:** six palettes (Harbor, Ivory, Slate, Teak, Midnight [dark], Coastal), each bg / surface / ink / muted / rule / accent / band bg+ink / field. A broker accent (brand colour or custom) replaces only the accent; `legibleAccent` keeps hue+saturation and moves lightness the least needed for button text ≥ 4.5:1 (black or white, whichever is better) and ≥ 3:1 against the page — never rejected. `--site-accent-text` is a ≥ 4.5:1 version for small text/icons. Applied as CSS variables on the site root (`--site-bg`, `--site-surface`, `--site-ink`, `--site-muted`, `--site-rule`, `--site-accent`, `--site-on-accent`, `--site-accent-text`, `--site-band-bg/ink`, `--site-field`, `--site-field-border`, `--site-header-bg`); every site component (header, hero, cards, forms, modal, footer, phone bar, boat page chrome) uses them. The embedded slideshow viewer keeps its own styling. The site no longer uses `broker_details.brand_accent` automatically — it's offered as "My brand colour".
- **Layouts:** shared sections in `src/app/b/[slug]/_components/sections.tsx` (`SiteHome`), composition per layout. Classic = today. Editorial = split hero (name in Playfair Display, photo right), narrow centred text sections, yachts as large alternating rows with Request a showing, pull-quote testimonials. Showroom = full-screen crossfading hero of up to 5 boat covers (`ShowroomSlides`, static with prefers-reduced-motion), small centred name, yachts as tall 2-up image cards with overlaid text, Midnight by default. Fonts: Cormorant Garamond (Classic/Showroom), Playfair Display (Editorial, not preloaded) — `_components/fonts.ts`. YachtGrid has `variant` grid | rows | tiles.
- **Preview:** `/b/[slug]/preview?layout=&palette=&accent=` (force-dynamic, noindex). Overrides — and an unpublished / not-yet-live site — only for a signed-in owner, assistant/brokerage admin or Portal admin (`resolveActingBroker`); anyone else gets the public page. A separate route rather than `?preview=1` on `/b/[slug]`, so the public page stays statically cached (reading searchParams there would make every visit dynamic).
- **Editor:** new **Look** card at the top of Dashboard → Website (`LookPicker.tsx`): three layout cards with small SVG sketches in the chosen colours, six palette swatches, "{Palette}'s own" / "My brand colour" / custom colour picker with a live legibility note, Preview button; Save applies and revalidates (`/b/{slug}` layout).
- **Help:** Look step + quick-ref row; PDF rebuilt.
- **Tested:** typecheck + eslint clean. Not rendered against live data here.

## Oct 26 (later) — Broker Websites: every boat shows + on-site boat pages — NOT PUSHED, NOT TESTED LIVE · MIGRATION `20261026c_site_hidden.sql` NOT APPLIED · no new dependency

- **Owner decision:** only ~12% of listings had a published slideshow, so sites looked empty. A site now shows every listing that is status active, `sold_at` null, has ≥1 visible photo, is not a pocket listing (`showcase_opt_out`) and not switched off by the broker (`listings.site_hidden`, new). Recent sales: `sold_at` set, same exclusions. `slideshow_published` no longer matters for the site.
- **Per-boat switch:** migration `20261026c_site_hidden.sql` adds `listings.site_hidden boolean not null default false` (code reads a missing column as "not hidden"). Editor → Your boats: "Show on my website" toggle per boat (hidden until the column exists); pocket listings locked "Pocket listing — not shown"; "Not shown — no photos yet"; Mark sold as before. API: `POST /api/website {action:"set_hidden", listingId, hidden}` (broker / assistant / admin acting; own listing only) + revalidate.
- **Boat pages:** `/b/{site}/yachts/{boat}` — `boat` = vessel-name slug, unique within the broker (clashes / no name → `{name}-{6 chars of id}`, `boatSlugs()` in `brokerSiteServer.ts`); the listing id also works. Inside the site chrome (new shared `SiteShell`: header with logo/name and nav linking back to `/b/{site}#yachts` etc., footer, phone Call/Text/WhatsApp bar), with title, spec line, price per Show prices, location and a "Request a showing" button (ShowingModal → lead kind 'showing'), then the SAME buyer viewer as /s: `SlideshowViewer` with new optional props `embedded` (drops its own title, broker footer, Request Info and credit; no full-screen height), `urlsEndpoint` and `site`. Data: `getSiteBoatListing` (same `LISTING_COLUMNS`, now exported) → `slideshowRows` → `signFirstPaint` / `signSlideshowExtras`, exactly as /s. Remaining links: new `POST /api/b/[slug]/yachts/[listingId]/urls` (same contract and 60/min rate limit as /api/s/[slug]/urls; light check `siteBoatListingById`: site published + entitled + listing passes the site rule). /s and its route unchanged.
- **Analytics:** views/events go through the existing `/api/slideshow/view` and `/api/slideshow/event` with `source: "site"` (and `slug: "site-{boat}"`); the event route now also accepts a listing whose slideshow isn't published when `site` names that broker's published site. Seller Report reads by listing_id, so website visits count (bySource shows "site"). The view route still emails the broker "a buyer opened your slideshow" on a fresh open (6 h throttle), as for /s.
- **Cards** link to the on-site boat page (same tab); "Slideshow" badge dropped, "Video" kept. Sold cards don't link.
- **Revalidate:** home + boat pages `revalidate = 3600`; new pass-through `src/app/b/[slug]/layout.tsx` so every editor change calls `revalidatePath('/b/{slug}', 'layout')` (home and all boat pages).
- **Loader refactor (`src/lib/brokerSiteServer.ts`):** `getLiveSite(slug)` (site + entitlement + broker + boats with covers, no signing; photos read in pages of 1,000, videos per batch) shared by the home page and boat pages; `getPublicBrokerSite` = that + signed covers/hero; `findSiteBoat`, `siteCard`, `boatSpecs`.
- **Help:** "Your Website" boat step rewritten (every boat shows unless switched off; pocket never; boat pages; Seller Report counts visits); quick-ref row replaced. PDF rebuilt.
- **Check after push + migration:** /b/john-doe shows all active boats with photos; a card opens /b/john-doe/yachts/{name} with the slideshow inside the site; All Photos and Video tabs work; Request a showing emails the broker; the listing's Seller Report shows a "site" view; switching a boat off in the editor removes it within a minute.
- **Tested:** typecheck + eslint clean. Nothing run against the database.

## Oct 26 — Website billing: a $50 line on the PLAN subscription (Portal / Portal + Website per tier) — NOT PUSHED, NOT TESTED LIVE · MIGRATION `20261026b_website_addon.sql` NOT APPLIED (after `20261026_broker_sites.sql`) · no new dependency

- **Owner decision (supersedes the same-day $49 separate-subscription draft, which never shipped):** every tier in two versions —

  | | Portal | Portal + Website |
  |---|---|---|
  | Starter (1–5) | $29 | $79 |
  | Growth (6–10) | $49 | $99 |
  | Pro (11–20) | $79 | $129 |
  | Elite (21+) | — | $149, website included |

  The website is ONE Stripe price, $50/mo (lookup_key `website_monthly_50`, product "YachtPics Portal Website", tax exclusive; `STRIPE_WEBSITE_PRICE_ID` overrides), added as a **second item on the broker's plan subscription**. `src/lib/plans.ts`: `WEBSITE_PRICE = 50`, `WEBSITE_INCLUDED_PLANS = ["Elite"]`, `planIncludesWebsite()`, `planPriceWithWebsite()`, `isPlanPriceId()`.
- **Live rule — `websiteEntitlement()` in `src/lib/websiteAddon.ts`:** Portal access AND (own Stripe plan is Elite, OR broker_sites.website_item_id set with the plan active/trialing/past_due, OR website_ends_at in the future with the plan alive, OR billing_status 'comped'). Office coverage alone doesn't count. Used by `/b/[slug]`, the lead API, the editor, the Billing page (`GET /api/website?summary=1`) and the admin card. Before 20261026b only Elite can be live.
- **New subscribers:** `/api/stripe/checkout` takes `withWebsite: true` → one Checkout Session, two line items (plan + website), same in-app-trial deferral as before (the website rides the same trial). Ignored for Elite; Office has its own route. Success → `/dashboard/billing?success=1&website=1`.
- **Existing subscribers:** `POST /api/website/add` (broker only — billing routes are self-only; never an assistant or admin) adds the item with `create_prorations` (no proration when re-adding before website_ends_at — that month is paid). Refused for Elite, comped, already on, or no own Stripe plan (comped account / in-app trial / Office-only → `needsPlan`, the UI sends them to Billing). `POST /api/website/remove`: **removal at period end** — Stripe can't schedule an item removal, so the route writes `website_ends_at = current period end` FIRST, then deletes the item at once with `proration_behavior: "none"` (no credit, no charge, next renewal excludes it); the site stays live until website_ends_at. No cron, nothing to miss. Re-adding clears it.
- **Webhook:** plan events (`checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_failed`) now call `syncWebsiteFromPlanSubscription` after updating `subscriptions`: website_item_id (item present or null), stripe_subscription_id, billing_status mirroring the plan (active/trialing → active, past_due, unpaid/paused/canceled → canceled), current_period_end; item present clears website_ends_at; 'comped' is kept; row created from the broker's name if the item exists and there is no site yet. Plan cancel/unpaid → offline with it. Reel Service separate-sub handling untouched.
- **subscription.items audit (critical):** `upsertSubscription` now reads the plan price from `planItemOf(subscription)` (the item whose price is a PLANS / Office price; else the first non-website item) — was `items.data[0]`, which would have read a broker with the website as an unknown plan; `periodEndIso` in the webhook reads the plan item's period; the new-subscriber email to Charlie sums all items and names the plan item. Unchanged (single-item Reel Service subscriptions): `reelServiceStripe.ts` periodStart/periodEnd/extend. `stripe_price_id` in `subscriptions` therefore stays the PLAN price, so `planForPriceId` / `planLabel` / Billing's current plan are unaffected.
- **Removed from the draft:** the separate `website_addon` subscription kind, its webhook routing, checkout/cancel-as-subscription and its emails. `/api/website/checkout` and `/api/website/cancel` are now one-line aliases of add/remove (the agent's shell can't delete files) — **delete both folders on the ThinkPad**.
- **UI:** Billing shows each tier with Portal and Portal + Website prices and its own button (Elite: "Includes your own website"); current subscribers get "Add website — +$50/mo" / "Remove website" / "Keep website" (when removed but still live); website row with the owner's paragraph (custom-domain line dropped — not built). Editor `WebsitePlanCard`: "Add your website to Growth — $99/mo total" etc., "Website on your Growth plan · $99/mo total · renews …", "Website removed — stays live until …" + Keep, no plan → Billing, Elite / comped states; admin: Comp + "Copy link for the broker" (`/dashboard/website?website=add`, highlights the card — never auto-charges). Admin broker card: entitlement chip + Comp checkbox (disabled while the website line is on their plan).
- **Migration:** broker_sites + website_item_id, stripe_subscription_id, billing_status (none/active/past_due/canceled/comped), current_period_end, website_ends_at; UPDATE revoked from `authenticated` and re-granted on content columns only.
- **Help:** "Your Website" price table step, how to add (with plan / Add website), remove wording; quick-ref rows. PDF rebuilt (19 sections, 65 rows).
- **Tier changes on the existing subscription (fixed the same day):** new `POST /api/stripe/change-plan { priceId | planKey, withWebsite? }` (self-only) swaps the plan item's price on the broker's current active/trialing/past-due subscription (`create_prorations`). `withWebsite: true` adds the $50 line if absent (no proration when re-adding inside a paid-through month); `false` removes it (no proration, `website_ends_at` = period end); omitted keeps it. To Elite: the $50 line comes off (no proration), site stays live as Elite. Elite → lower tier without website: a broker with a site gets `website_ends_at` = period end. `/api/stripe/checkout` now answers 409 "You already have a plan — use Change plan" when the broker already has a live plan subscription. Billing: anyone with a plan subscription gets "Change plan" buttons (confirm shows the new monthly total and any website effect); only brokers without one go to Checkout. Office flow untouched.
- **Check after push + migration:** Starter subscriber → Billing → Add website → Stripe shows two items on the one subscription; `subscriptions.stripe_price_id` still the Starter price; editor reads "Website on your Starter plan · $79/mo total"; /b live. Remove → "stays live until {period end}", the item is gone in Stripe, next upcoming invoice $29. New trial broker → "Choose plan with website" → Checkout shows two lines.
- **Tested:** typecheck + eslint clean. Nothing run against Stripe or the database.

## Oct 26 — Broker Websites (/b/{slug}) — NOT PUSHED, NOT TESTED LIVE · MIGRATION `20261026_broker_sites.sql` NOT APPLIED · no new dependency

- **What it is:** every subscriber gets a personal site at `portal.yachtpics.com/b/{slug}`, filled from their Portal data and edited at **Dashboard → Website** (new sidebar item for brokers and assistants). One page, anchor nav (Yachts · Sold · About · Sell · Contact, hidden when empty): sticky header (logo or serif wordmark, phone), full-bleed hero (chosen photo or newest live boat's cover, 2000px derivative), optional proof strip (≤4 stats), Yachts grid (status active + `slideshow_published` + `sold_at` null, pocket listings excluded; 600px derivative covers; price only when Show prices is on; Slideshow / Video badges; card → `/s/{slug}` new tab; "Request a showing" modal), Recent sales (`sold_at` set, Sold ribbon + month, no price), About (portrait, bio = `broker_details.bio`, credentials, brokerage logo/name, license), Testimonials (≤6), "What's my boat worth?" form, Contact form + phone/email/WhatsApp, footer with `PresentedThrough`. Phone: sticky Call · Text · WhatsApp bar. Display serif **Cormorant Garamond** (next/font, loaded only on /b). Accent = `broker_details.brand_accent`, else Portal gold. Filters (length / builder / price chips) appear at 10+ boats. JSON-LD RealEstateAgent.
- **Visibility:** "This page isn't available" (noindex) when the slug is unknown, the site is off, or the broker has no access (`getEffectiveAccessStatus` + `hasAccess`, same rule as slideshows). `revalidate = 3600`, and every editor save / publish / mark-sold / portrait change calls `revalidatePath('/b/{slug}')`. `/b` is outside the middleware matcher (already public).
- **Code:** `src/lib/brokerSite.ts` (client-safe types, limits, slug rules, cleaners), `src/lib/brokerSiteServer.ts` (`resolveActingBroker` — broker / assistant / brokerage admin of the brokerage / admin with `?brokerId=`; `getPublicBrokerSite`), page `src/app/b/[slug]/page.tsx` + `_components/` (SiteHeader, YachtGrid, ShowingModal, LeadForm). APIs: `/api/website` (GET site + boats; GET `?photos=listingId` hero picker thumbs; PUT fields incl. bio → broker_details; POST `check_slug` / `claim_slug` / `mark_sold`), `/api/website/portrait` (POST/DELETE; public `broker-logos` bucket, `{brokerId}/portrait-{ts}.ext`, path in `portrait_path`), `/api/website/leads` (GET 100 newest, PATCH handled), `/api/b/[slug]/lead` (public; honeypot `company_website`; 5/hour per IP+slug via simpleRateLimit; salted sha256 IP (`LEAD_IP_SALT`, falls back to `CRON_SECRET`); service-role insert; Resend email to the broker's `display_email` with Reply-To = visitor, logged as `site_lead`; push to broker + assistants).
- **Admin:** Admin → Brokers → broker: **Website** card (slug, Published/Off, "Edit website →" opens `/dashboard/website?brokerId=…`).
- **Before the migration:** editor says "Website isn't switched on yet", `/b/*` shows not available, the lead API 404s, the admin card says not switched on. Nothing else reads the new tables/column.
- **Help:** new section **15 Your Website** + 4 quick-ref rows; later sections renumbered (Reel Service 16 … Industry News 19, Your Reels 20). PDF rebuilt (19 sections, 63 rows).
- **Check after push + migration:** Dashboard → Website → Create my website → publish → View site shows the hero, boats with published slideshows, contact form; submit a showing request → email arrives with Reply-To the visitor and the lead appears under Inquiries; Mark sold moves the boat to Recent sales; a broker with a lapsed trial gets "This page isn't available".
- **Tested:** typecheck + eslint clean. Nothing run against the database or Resend.

## Oct 25 — big static assets moved off Vercel to Supabase Storage (`portal-assets`) — NOT PUSHED, NOT UPLOADED · no migration, no new dependency

- **Why:** Vercel Deployment Storage was full; `public/depth/v1/` (~41 MB) and `public/music/` (~5 MB) shipped with every deployment.
- **Where they live now:** the PUBLIC Supabase Storage bucket **`portal-assets`**, same relative paths: `depth/v1/depth-anything-v2-small-q8.onnx`, `depth/v1/ort-wasm-simd-threaded.wasm`, `music/index.json`, `music/*.bin`. Cache-Control 1 year (index.json 5 min).
- **Env var:** **`NEXT_PUBLIC_ASSETS_BASE`** = `https://<project>.supabase.co/storage/v1/object/public/portal-assets/` (Vercel, Production + Preview; NEXT_PUBLIC → needs a redeploy). `src/lib/assetBase.ts` → `assetUrl(path)`: bucket URL when set, same-origin `/path` when unset (**local fallback** — local dev keeps using `public/`).
- **Code:** `src/lib/depthMotion.ts` — the worker stays same-origin (`/depth/v1/worker.mjs` + the two small ORT `.mjs` files); when the variable is set it is started as `worker.mjs?model=…&wasm=…` and `public/depth/v1/worker.mjs` fetches the model with a CORS fetch and sets `ort.env.wasm.wasmPaths = { mjs: local glue, wasm: bucket URL }`. No COOP/COEP is sent, Supabase answers `Access-Control-Allow-Origin: *`. `src/lib/reelSampler.ts` — `MUSIC_BASE = assetUrl("music/")` (index + packs from the same place; pack verification unchanged). `public/sw.js` doesn't cache cross-origin packs (comment added; HTTP cache does it).
- **Upload:** `node scripts/upload-public-assets.mjs` from the portal root (reads `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). Creates the bucket if missing (public, 50 MB file limit), upserts the files, prints each public URL and the exact `NEXT_PUBLIC_ASSETS_BASE` value. Idempotent.
- **`.vercelignore`** (new) lists the `.onnx`, the `.wasm` and `public/music/*.bin`. **Order:** run the upload → set the variable in Vercel → only then push (a deployment with `.vercelignore` but without the variable would have neither copy). If the next build log doesn't show "Removed N ignored files defined in .vercelignore", delete those files from the repo instead (after the upload is verified).
- **Check after push:** an admin Walkthrough render → DevTools Network shows the `.onnx` and `.wasm` from `…supabase.co/storage/v1/object/public/portal-assets/depth/v1/` (200, no CORS error) and the render has depth motion; a "studio" reel's music loads `music/index.json` + packs from the bucket; Vercel deployment size drops by ~46 MB.

## Oct 24 — free trial 14 days for new accounts + trial email sequence + Seller Report onboarding — NOT PUSHED, NOT TESTED LIVE · no migration, no new dependency

- **Owner decision (Oct 24):** accounts opened from **Oct 24 2026 00:00 ET** (`TRIAL_CUTOVER = "2026-10-24T04:00:00Z"`) get a **14-day** trial; accounts opened before keep **30** (including invited-but-not-yet-signed-in ones, whose invite promised 30). One function: `trialDaysFor(row)` + `TRIAL_DAYS` / `TRIAL_DAYS_LEGACY` / `TRIAL_CUTOVER` in `src/lib/subscriptionAccess.ts` (client-safe; re-exported from `brokerAccess.ts`). Cohort key = `subscriptions.created_at` (written by the signup trigger at account creation). The trial still starts on first sign-in: the dashboard layout seeds `trial_ends_at = now + trialDaysFor(sub)`. Already-seeded trials keep their stored end date — nothing retroactive. `getEffectiveAccessStatus` and `/api/subscription/status` now also return `trialDays`. Edge: an account created Oct 24 before this deploys gets a 30-day end seeded by the old code but counts as 14-day cohort for the day-7 offset (ending/ended are relative to the stored end, so correct).
- **Copy:** Billing page "Your {14|30}-day free trial runs until {date}"; Help (Billing step) "14-day … (accounts opened before October 24, 2026 keep their 30 days)" + one sentence on the three trial emails; welcome email and admin invite email use the per-account / current length. Banner, sidebar and dashboard "ends in N days" already read the stored `trial_ends_at`. Login, landing and /see never mentioned a length. Not changed: the brokerage **Office** plan's Stripe trial (`/api/brokerage/checkout`, `trial_period_days: 30`) — separate product, owner to decide.
- **Trial emails (`src/lib/trialEmails.ts`, rewritten; sent by the existing `/api/cron/trial-reminders`, already in `/api/cron/daily`, 9am ET).** Offsets in Eastern calendar days from each broker's own trial start (= stored end − 14/30 days): **`trial_day7`** on day 7 (catch-up to day 9, only with 3+ days left) — the broker's published listings' last-7-day views / visitors / photo looks (dwell events) / client sends (new `listingPeriodTotals` in `src/lib/engagement.ts`), up to 5 rows busiest first, each linking to `/report/listing/{id}`; no slideshow published → "Publish a slideshow and the report starts filling in"; published but unopened → "send it to one buyer". **`trial_ending`** at 2 days left (1 if a run was missed) → day 12 / day 28. **`trial_ended`** the first run after `trial_ends_at` passes (≤3 days late) → day 14–15 / day 30–31; photos still free, Starter $29. Who: role broker, in-app trial (no Stripe sub, status ≠ active), not opted out, not covered by an Office plan or a paid Reel Service boat. Dedup per type in `email_log` (status sent) since this trial began; the old `trial_expiring` / `trial_lapsed` count as already sent, so anyone mid-trial never gets both. Old "3 days left" / "lapsed" templates removed. `?dry=1` on the route lists who would get what without sending. Admin → Trials header text updated.
- **Onboarding:** dashboard home trial card (6+ days left) now leads with "Start with your first listing: publish the slideshow, send it to one buyer, and read its Seller Report tomorrow." with links to the most recent listing and its Seller Report (My Listings if none), then "Your free trial ends in N days."; the welcome email (first sign-in) carries the same line in a brass box above Quick Start.
- **Help:** Billing step updated (above); PDF rebuilt (18 sections, 59 rows).
- **Check after push:** a test broker created today → first sign-in → Billing says "Your 14-day free trial runs until {14 days out}"; an older trial account still shows its original date. `GET /api/cron/trial-reminders?secret=…&dry=1` → `plan` lists the brokers due today and which email. Dashboard home of a trial broker shows the Seller Report line.
- **Tested:** typecheck + eslint clean; all three templates rendered locally (both day-7 fallbacks too). Nothing sent, nothing run against the database.

## Oct 24 — Reel Service paid in the Portal (Stripe, $179/listing/month) — NOT PUSHED, NOT TESTED LIVE · MIGRATIONS `20261024_reel_service_stripe.sql` + `20261024b_reel_service_period.sql` NOT APPLIED (in that order, after `20261023_reel_service_listings.sql`) · no new dependency

- **Owner decision (Oct 23 evening), supersedes the $149/Zoho setup:** $179 per listing per month, up to 4 reels, paid by card in the Portal at the moment of ordering (Stripe Checkout, recurring, Stripe Tax on, promo codes allowed). Attached to a listing; several boats = several subscriptions. Includes Starter-level Portal access while a paid boat is active (active/past_due) for a broker with no plan. Cancel from the listing page → runs to the end of the paid month. Sold/archived listing → the daily `/api/cron/reel-service` sets the boat to cancel at period end. Failed renewals: Stripe retries/dunning → `past_due` (still in service) → `paused` when Stripe marks it unpaid (planner skips it).
- **Zoho path retired, code kept:** `REEL_SERVICE_ZOHO_BILLING = false` in `src/lib/plans.ts` hides `ReelServiceBilling` on the board; the `billing` action and `price_per_listing_cents` stay. Admin broker card: price field removed, checkboxes are the comp path (`billing_status 'comped'`, `started_by 'admin'`, "comped — no charge"); paid boats show Paid / Past due / Paused (+ renews / ends date) and can't be unchecked there.
- **Code:** `src/lib/reelServiceStripe.ts` (price via lookup_key `reel_service_monthly_179` or `STRIPE_REEL_SERVICE_PRICE_ID`, created on first use; broker customer = `subscriptions.stripe_customer_id`, same as plan checkout; webhook handlers; emails; sold-boat sweep). Routes `POST /api/reel-service/checkout`, `POST /api/reel-service/cancel`, `GET /api/reel-service/listing` (broker / assistant / admin via `assertListingAccess`, shared in `src/lib/reelServiceCaller.ts`; checkout: broker or assistant only). `/api/stripe/portal` takes an optional `{ returnPath }`.
- **Webhook (`/api/stripe/webhook`):** events whose subscription metadata `kind = "reel_service"` are handled first and never reach `upsertSubscription` (which would otherwise have written the boat over the broker's Portal plan via the shared customer). `checkout.session.completed` → row active + stripe ids + period end, broker enrolled (`reel_service_subscriptions`, legacy all-boats brokers get their other boats recorded as comped first), this boat's month planned at once (`planReelServiceMonth(..., { listingIds })`), confirmation email (`reel_service_started`, deduped in email_log by subscription id), note to Charlie. `customer.subscription.created/updated` → re-fetch from Stripe and sync status / cancel_at_period_end / current_period_end. `invoice.payment_failed` → past_due. `customer.subscription.deleted` → canceled + ended_at now + "Reel Service on {Vessel} has ended…" email (`reel_service_ended`; offers Starter $29 if no plan). Duplicate checkout for a boat already on → second subscription canceled, Charlie emailed to refund. Handler errors answer 500 so Stripe retries; all handlers replay safely. `maxDuration = 60`.
- **Planner:** a row is in service when `ended_at is null` and `billing_status in ('active','comped','past_due')`; before the migration every row reads as comped (selects retry without the column).
- **Paid month, not calendar month (owner, Oct 24 — migration `20261024b`):** a paid boat (active/past_due, Stripe sub, `current_period_start` known) is planned per paid period [current_period_start, current_period_end): up to 4 reels, created all at once at purchase / renewal, `due_at` spread evenly from the start (4 reels → 0, 7, 14, 21 days), `service_period_start` on each job; `period` = the calendar month the paid period starts in (slots continue past 4 if two periods start in one month). The card's "N of 4", the Queue counts and the planner's "already planned" check use the paid period; comped boats keep the calendar month (due_at null). `customer.subscription.updated` with an advanced period start plans the next 4 (the daily cron fills them too). Render station + board's Make all take planned jobs soonest-due first (nulls last); the board shows "due {date}" (red when overdue); the Queue has **Next due** (overdue highlighted).
- **Extend (Queue, paid boats in good standing):** 1–30 days → `stripe.subscriptions.update(id, { trial_end: current_period_end + N days, proration_behavior: "none" })` — Stripe's documented way to move the next billing date of an active subscription (a free trial until the new date; no charge, no credit; `billing_cycle_anchor` can't be set to an arbitrary future date on update, and `pause_collection` only voids invoices without moving the date). The sub reads `trialing` meanwhile; the sync keeps the row `active` and keeps `current_period_start`, so no extra reels are planned; at trial_end Stripe charges $179 and the next paid period starts. The row is re-synced at once (the webhook syncs it again) and a line is appended to `reel_service_listings.note`. Route: `POST /api/admin/reel-service { action: "extend", listingId, days }`.
- **"Enabled" governs comped boats only (owner, Oct 24):** the admin broker card's switch is now **Comped reels on** ("Paid boats run until the broker cancels or payment fails."). A paid boat (active/past_due, not ended, Stripe sub) is planned, rendered and delivered whatever that switch says: the planner reads every `reel_service_subscriptions` row (plus any broker with a paid boat and no row) and, for a disabled broker, plans only the paid boats (`plannedListingIds` in `reelService.ts`); legacy "no rows = all boats" still needs enabled. The first purchase creates the broker's row enabled; an existing disabled row is left alone. "Your Reels" (sidebar, Help section, page) also shows for brokers with a paid boat (`paidReelServiceBrokerIds` in `brokerAccess.ts`). Board: a disabled broker with paid boats is listed ("Comped reels off · N paid boats running"); the Queue shows their paid boats normally.
- **Comped reels off ends the comps (Oct 24):** switching "Comped reels on" OFF sets `ended_at = now` on the broker's comped rows still in service and appends `[ended: comped reels switched off]` to their `note` (no migration), so the listing card reads not enrolled and the broker can buy the boat; switching it back ON clears `ended_at` only on comped rows carrying that mark and removes it (`applyCompSwitch` in `/api/admin/reel-service`). The admin card keeps those boats checked ("comped — off while comped reels are off"); unchecking one drops its mark so it won't come back. Paid rows are never touched. Card status, checkout and the webhook duplicate guard already treat an ended comped row as not enrolled (a purchase takes the row over).
- **Reels per boat = the broker card's number (Oct 24):** `reel_service_subscriptions.reels_per_listing` (1–10, default 4; hint "Default 4. More than 4 is a courtesy — the price doesn't change.") drives the Queue's "delivered / N" and owed count, the listing card's "N of M this month" (`reelsPerBoat` from `/api/reel-service/listing`) and the planner. `REEL_SERVICE_REELS_PER_BOAT` is only the default and the public copy. Paid-period due dates are spread evenly: step = floor(period days / reels) days from day 0 (28 days if the period end is unknown; 4 reels → 0/7/14/21); existing jobs keep their dates.
- **Admins never pay for a broker (Oct 24 fix):** on a broker's listing an admin's Reel Service card shows **Copy pay link** (`/dashboard/listings/{id}?reel_service=add` — the broker, signed in, lands on the listing and checkout opens once for that boat; the param is stripped) with "or send them portal.yachtpics.com/rs", and **Comp this boat (no charge)** (confirm → new admin action `comp_listing`, which plans this month's reels; refused while the broker's comped reels are off). `/api/reel-service/checkout` answers 403 for an admin who isn't the listing's broker or assistant (`canBuy` in `src/lib/reelServiceCaller.ts`). An admin's own listings still check out normally; `/dashboard/reel-service` shows an admin only their own listings.
- **Broker UI:** `ReelServiceListingCard` under Boat shows on the broker listing page and the admin listing page (Add → checkout; active badge "N of 4 this month" + renewal; Cancel with confirm; Payment problem → billing portal; paused; comped badge only; green "Reel Service is on. First reels are on the way." after `?reel_service=started`; "not available yet" before the migration). Reel page: "Delivered by YachtPics" strip (`DeliveredReelStrip`). Billing page: "Add Reel Service · $179/mo per listing" row → `/dashboard/reel-service` (pick a boat). Public `/rs` (three lines + sign-in, `next=/dashboard/reel-service`; outside the middleware matcher, so already public). Your Reels: "add or cancel from the boat's page".
- **Admin:** Reel Service board gets a **Queue** table (all boats on the service, delivered vs 4 this month, days to renewal, last delivery, status chip, fewest delivered first, past-due/paused highlighted) and a status chip per boat. Admin → Shows: **Reel Service QR (PNG/SVG)** for portal.yachtpics.com/rs.
- **Help:** new section **15 Reel Service** (what, $179/listing/month, up to 4, add, cancel, where reels appear, failed payments, Portal access) + two quick-ref rows; later sections renumbered (Recently Photographed 16, Tips 17, News 18, Your Reels 19). PDF rebuilt (18 sections, 59 rows).
- **Charlie's Stripe dashboard to-dos:** turn on Stripe Tax (Settings → Tax; add the Florida registration); Settings → Billing → Subscriptions and emails: Smart Retries on, failed-payment emails on, and "If all retries fail" → **mark the subscription as unpaid** (that's what makes it pause instead of cancel); Developers → Webhooks → the portal endpoint must send `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Billing portal (Settings → Billing → Customer portal) should allow updating the payment method.
- **Check after push (migration applied):** on a test listing, Add Reel Service → Stripe test card → back on the listing with the green banner, the card turns to "Reel Service active · 0 of 4 this month" within seconds, the board shows 4 planned reels for the boat and a Paid chip, the Queue lists it, an email arrives. Cancel → "Ends {date}". Broker with no plan: the trial banner goes away while the boat is paid.
- **Tested:** typecheck + eslint clean. Nothing run against Stripe or the database.

## Oct 24 — Reel Service render station — NOT PUSHED, NOT TESTED LIVE · no migration, no new dependency

- **What it is:** `/admin/reel-service/render` (admin only; reached from the board's **Open render station** button, which opens it in a new tab with `?auto=1` so it starts by itself). Leave it open on the office ThinkPad: every minute it fetches the **planned** reels of this month and last (`GET /api/admin/reel-service?planned=1`, oldest first) and renders them one at a time with the same `ReelServiceRenderer` the board's Make buttons use (component reused as is — output unchanged). Big status line, Start/Pause, Render now, made/failed/waiting counters, and a list of this session's results (boat, look, ok/failed, seconds). A failed reel is tried once more per station session; then it stays failed for a look on the board. The board becomes review-and-deliver; Make / Make all still work there.
- **One station:** a localStorage lease `reelStationLease` = {id, at, since, running}, refreshed every 10 s (stale after 30 s). A second tab in the same browser shows "Another render station is already running" with **Take over** (the first tab stops after its current reel). The board shows "Render station: active (last seen N s ago)" under the header when the lease is fresh — same browser only. Server-side guard across browsers: the station claims each job with `{ action: "rendering", claim: true }` (`/api/admin/reel-service/jobs/[id]`), an atomic update only while the job is still planned (`retry: true` → only while failed); 409 → skipped. The board's own unguarded `rendering` is unchanged.
- **Keep-awake:** asks for a screen wake lock while running (re-taken when the tab is visible again); the page says to keep the tab open, in front and the computer awake. Jobs stuck in `rendering` from a closed tab are NOT picked up (planned only) — Make them from the board.
- **Browser-only on purpose for now:** rendering needs canvas + WebCodecs + the depth engine, which don't run in a Vercel function; this keeps the existing engine and output. A server/worker renderer would be a separate project.

## Oct 24 — background job queue (admin bulk actions run on the server) — NOT PUSHED (parent will push), NOT TESTED LIVE · MIGRATION `20261023c_jobs.sql` NOT APPLIED · NEW DEPENDENCY `@vercel/functions` 1.6.0

- **What changes for Charlie:** Admin → Overview **Re-publish live boats** and **Photo thumbnails** no longer run in the browser tab. Click, close the tab if you like — the server finishes it, and the card shows a progress bar, the last 3 lines ("Short Story — published", "1,240 photos made · 18,000 to go"), elapsed time and **Cancel**. Reopening the page picks the running job back up. New **Admin → Jobs** page (nav after Metrics): start any of the three jobs, see what's running, recent runs with status / queued / started / finished, the log, and **Retry** for a failed or cancelled job (resumes from where it stopped). The third job, **Label photos still marked Other**, labels every active listing's photos that are still Other/blank (never hand-set ones, never ones the AI already labelled) — there was no bulk re-label before; the listing page's one-listing Label/Re-label button is unchanged.
- **Before the migration is applied** everything still works the old way: enqueue answers 503 "jobs table not ready" and both Overview cards fall back to the in-tab loop with a note ("keep it open"); the Jobs page says the table is missing.
- **How it works (`src/lib/jobs/`):** `types.ts` (kinds, labels, `JobRow`, `StepResult`, `JobFatalError`), `queue.ts` (`enqueueJob` — returns the existing row instead of a duplicate if the same kind + params is already queued/running, also enforced by a unique partial index; `cancelJob`, `retryJob`, `listJobs`, `kickWorker`), `runner.ts` (`HANDLERS` + `runWorkerStep`). The worker **`POST /api/jobs/work`** (maxDuration 60) answers 202 at once, then (kept alive with `waitUntil` from `@vercel/functions`) claims the oldest queued job — or a running one whose worker died (its 2-minute lease `locked_until` expired) — with a compare-and-swap on `steps`, runs ONE batch (~40 s budget), saves done/failed/total/cursor/log, and POSTs itself again. It stops when nothing is claimable or the job was cancelled mid-batch. Guards: 2,000 batches max per job, 3 failed or timed-out batches in a row → failed (Retry carries on). Self-calls go to `NEXT_PUBLIC_SITE_URL` if set, else the origin the request came in on (portal.yachtpics.com), else `VERCEL_URL`.
- **Worker auth:** header `x-jobs-secret` = `CRON_SECRET` (the chain, the enqueue kick, the daily cron) or a signed-in admin. Fails closed (500) if `CRON_SECRET` is unset, like the cron routes. `?wait=1` runs the batch inline and returns the result (debugging).
- **Kick + safety net:** `/api/admin/jobs` POST `enqueue`/`retry` wakes the worker straight away; `/api/cron/daily` also POSTs the worker once a day for anything queued or stranded.
- **Handlers:** `republish_site` — live boats (same filter as `/api/admin/site/published-listings`) in id order, cursor = last listing id, same steps as the publish-site route (flag on → build → FTP upload → flag off if the upload fails), stops starting boats when the slowest so far wouldn't fit. `derivatives_backfill` — wraps `runDerivativeBackfill` (no cursor; the photos table is the queue); done = copies made, failed = "can't be resized"; fails with a clear message if a whole batch makes no progress. `relabel_photos` — params `{ listingIds, force? }` (or `{ scope: "unlabelled" }` from the Jobs page, resolved to ids at enqueue, max 500), cursor `{ i, pos, labelled }`, one listing at a time through the new shared `src/lib/labelPhotos.ts` (the `/api/photos/categorize` route now calls the same helper — behaviour unchanged).
- **Adding a job kind:** add it to `JOB_KINDS`/`JOB_LABELS` in `types.ts`, write a handler in `runner.ts` that does ONE batch from `job.cursor` before `ctx.deadlineMs` and is safe to re-run (idempotent per item), register it in `HANDLERS`, validate its params in `normaliseParams` (`src/app/api/admin/jobs/route.ts`), and use `startJob` + `<JobProgress>` (`src/components/admin/JobProgress.tsx`) on the button.
- **Migration to apply** (`supabase/migrations/20261023c_jobs.sql`, safe to re-run): table `jobs` (+ `locked_until`, `steps`, `step_errors` beyond the brief, for the lease and the guards), index `(status, created_at)`, unique partial index on `(kind, md5(params::text))` where queued/running, RLS on with one policy: admins all (`is_admin()`); no broker access.
- **New dependency:** `@vercel/functions` 1.6.0 (official, no dependencies of its own) in package.json + lockfile. On the ThinkPad after pulling, run `npm install` once (Vercel installs from the lockfile on its own).
- **Help:** admin-only, so the broker Help page and PDF are unchanged. Dock-card zips on Admin → Shows stay client-side (they're a download).
- **Check after push (migration applied):** Admin → Overview → Re-publish all → the card appears; close the tab, reopen Overview a minute later — it's still counting; Admin → Jobs shows it running then done with one log line per boat. Start Photo thumbnails, press Cancel — it stops after the current batch. Vercel → Logs: `/api/jobs/work` calls roughly every 40 s while a job runs.
- **Tested:** typecheck + eslint clean. Not run live (no DB table, no deploy).

## Oct 21 — yachtpics.com menu: "Clients" → "Boats" — NOT PUSHED, nothing published, no DB changes

- **Template (`src/lib/siteTemplates.ts` `nav()`):** the yacht-photos.html item now reads **Boats**. Typecheck clean. The next "publish to website" rewrites the Portal-generated pages that went up with "Clients" (live Oct 21: yacht-photos.html, brokerage_boats.html, valhalla_boat_sales.html, waterfront_yacht_brokerage.html, brokerage_boats/78_princess_amy_leigh_iii, valhalla_boat_sales/41_valhalla_overbooked).
- **Hand-written pages:** checked all 184 sitemap URLs live. 78 hand-written pages already said Boats; only index.html, portal.html and marine-news.php said Clients. Those three are staged in `C:\Users\charl\yachtpics-site\_upload-2026-10-21\` (README inside). portal.html there is the Oct 19 staged copy (carries the unuploaded "Walkthrough and Marquee" edit); marine-news.php is the Oct 19 staged copy. Homepage "See All 90+ Clients" button left as is (body copy).

## Oct 20 — "Where can the Portal post your reels?" + personal-Instagram hints — NOT PUSHED, no DB or API changes

- **Help (all brokers, in `sections` so it reaches the PDF):** new **11 Where can the Portal post your reels?** (Page / IG business-creator / personal FB profile / personal IG, anchor `#where-can-the-portal-post`) and **12 Switch Instagram to Creator (2 minutes)** (iPhone path checked Oct 20: Settings and activity → For professionals → Account type and tools → Switch to professional account; Page link via Edit profile → Page). Creator accounts are public (Instagram does not allow private professional accounts), so the copy says so. Later sections renumbered 13–17, Your Reels 18; two quick-ref rows. PDF rebuilt (17 sections, 57 rows).
- **Profile → Social accounts (`SocialAccounts.tsx`, still admin-only):** a Page with no Instagram (`ig_user_id` null, already in the connections/pending data) shows a quiet "switch to Creator and link it" note with **Show me how** → the Help entry; zero Pages from Facebook now explains Page vs personal profile with a link to facebook.com/pages/create. Typecheck + eslint clean.

## Oct 19 — boat show kit, phase 1 (FLIBS 2026) — NOT PUSHED (parent will push), NOT TESTED LIVE · MIGRATION `20261019_boat_shows.sql` NOT APPLIED · NEW DEPENDENCY `pdf-lib`

- **What brokers get:** while a show is coming up (FLIBS 2026, Oct 28 – Nov 1), each listing shows a quiet **Boat shows** card under the banner (`src/components/BoatShowCard.tsx`, also on the admin listing page): tick **At FLIBS 2026** (saves at once), add **Dock / slip** + optional note → Save, **Dock card (PDF)** with a 5 × 7 / Letter picker (off with "Publish the slideshow first" until the slideshow is live). Messages go through each page's existing banner. **My Listings**: a FLIBS 2026 chip on marked boats and a one-line banner "Showing at FLIBS 2026? Mark your boats so your dock cards are ready. N marked." (dismiss = this browser session only, `sessionStorage`); `/dashboard/listings?show=flibs26` highlights it and brings it back even if dismissed. Everything hides itself until the migration is applied (reads return nothing).
- **Route `/api/listings/[id]/show`:** GET (anyone who can read the listing, RLS) → shows still to come, this listing's entries, `canEdit`, published; PUT `{showKey, location, note}` / DELETE `?show=` — editors only: owner, their assistants, brokerage admins of the owner's brokerage, admins (`assertListingAccess` + `includeBrokerageAdmin`); show must exist, be active and not over (Eastern date). Location ≤ 60, note ≤ 280 chars, one line. Writes with the service role.
- **Dock card `/api/listings/[id]/show-card?show=flibs26&size=5x7|letter`** (readers via RLS; 409 if no published slideshow). Built by `src/lib/dockCardPdf.ts` with **pdf-lib** (nothing PDF-capable was installed; MIT, pure JS, no native parts). Vector text in standard PDF fonts (Times for the name, Helvetica otherwise) and a vector QR from the existing `qrcode` package (decodes; checked with OpenCV). Layout: cover photograph full-bleed → dark band (broker's `brand_ground` if dark, else the slideshow's ink) with spec line in the accent (broker's `brand_accent` or Portal gold), vessel name, dock/slip → ivory panel with the broker's logo (else brokerage name), broker name, brokerage, phone · email, QR + "Scan for the slideshow and video" → footer with the show (small) and a discreet "YachtPics Portal". QR → `https://portal.yachtpics.com/s/{slug}?from=flibs26#video`. Cover = chosen cover / first visible photo (`listing_hero_photos`), fetched server-side as a 2000px **JPEG** transform of the original (the stored 2000px copies are WebP, which PDFs can't carry); falls back to the original. Logos are fetched only from our own Supabase host and only PNG/JPG embed (WebP/SVG logos fall back to the brokerage name). No price on the card (no "show price" field exists). Sample: `Claude outputs/dockcard-sample-5x7.pdf` (+ two preview PNGs there).
- **Admin → Shows** (`/admin/shows`, nav item after Photo Categories): per upcoming show, the marked boats (boat + specs, broker, brokerage, dock/slip — "Not given" in amber, note, marked when / by whom if not the broker), sorted brokerage then boat, count, **Export CSV** (client-side), per-row **Dock card** links, **All dock cards (N)** → zip of every published boat's PDF (JSZip on demand, 3 at a time, failures listed), size picker; plus **Unmarked recent listings** (active, updated in the last 60 days, not marked) to nudge.
- **QR attribution:** `/s/[slug]` reads `?from=` (wins over `?src=`); it goes on the view row (`slideshow_views.source`, which already existed) and on every `track()` event (`slideshow_events.source`, new column; plain "link" visits stay null). `/api/slideshow/event` stores it, and retries without it if the column isn't there yet. Engagement (`src/lib/engagement.ts` + `ListingEngagement`) adds "Scanned at FLIBS 2026: N" (distinct visits whose source is a show key) and labels that source "FLIBS 2026 dock card". Seller Report untouched.
- **Announcement (ready, NOT sent):** `announcement_flibs26_mark_boats` in `src/lib/announcementEmail.ts`, first on /admin/announce with its one-line description. Brokers + assistants, opted-in only, email_log dedup. Window already open (from Oct 19 00:00 UTC) → sends on the first daily run (~9am ET) after Approve; closes **Tue Oct 27 13:00 UTC** (so Mon Oct 26 is the last run). Subject "Showing at Fort Lauderdale? Tell your Portal.", button "Mark my show boats" → `/dashboard/listings?show=flibs26` (signed-out readers sign in and come back to it). The Walkthrough "Send now" warning no longer shows on other campaigns.
- **Help:** new section **12 Boat Shows** (marking, dock/slip, assistants and brokerage admins, the dock card, what the QR opens, the "Scanned at" stat); Recently Photographed/Tips/News renumbered 13–15, Your Reels 16; two quick-ref rows. PDF rebuilt (15 sections, 55 rows).
- **Migration to apply** (`supabase/migrations/20261019_boat_shows.sql`, safe to re-run): `boat_shows` (+ FLIBS 2026 seed; read for anon + authenticated), `listing_show_entries` (unique listing+show; RLS read = listing readers via the same helpers as the listings policies, write = owner / `assistant_has_access` / `is_admin`, `auth.uid()` wrapped in `(select …)`), `slideshow_events.source` + partial index `(listing_id, source) where source is not null`, and a partial index on `slideshow_views (listing_id, source)` for the scan count.
- **New dependency:** `pdf-lib ^1.17.1` in package.json + lockfile. On the ThinkPad after pulling, run `npm install` once (Vercel installs from the lockfile on its own).
- **Charlie's next steps:** (1) apply the migration in Supabase → SQL editor; (2) push; (3) open Admin → Announce → "FLIBS 2026 — mark your show boats" → Send test to yourself → read it → **Approve** (goes out the next morning at 9am ET); (4) watch Admin → Shows fill in; download "All dock cards" when you're ready to print.
- **Check after push (with the migration applied):** on a listing, tick At FLIBS 2026, add a slip, Save, reload (it stays); Dock card (PDF) opens a 5 × 7 card with the cover, your slip and a QR — scan it with a phone (opens the slideshow); My Listings shows the chip and "1 marked."; Admin → Shows lists it, CSV downloads, All dock cards gives a zip; after one scan, the listing's Engagement shows "Scanned at FLIBS 2026: 1".
- **Tested:** typecheck + eslint clean. PDF generator run locally at both sizes with a real Short Story photo (rendered and QR decoded). Routes, RLS and the email not run live.

## Oct 19 — buyer Video tab — NOT PUSHED (parent will push), NOT TESTED LIVE, no DB changes

- **What:** `/s` (`SlideshowViewer.tsx`) and `/g` (`GallerySlideshow.tsx`) slideshows, filmstrips and All Photos are now photos only; videos moved to a new **Video** tab (after All Photos, only when a playable video exists) rendered by shared `src/components/VideoStack.tsx` (stacked, max 960px, poster, title-or-filename caption, one plays at a time; /g keeps per-video Download when downloads are open). `#video` on the link opens that tab; a video-only listing/gallery opens on it. `/s` now also selects `videos.title` (`publicSlideshow.ts`). Tracking unchanged: each play still logs `video_play`; no tab-open event (a new kind needs a DB check-constraint change).
- **Help:** Videos step updated (Video tab, `#video` links; the old "front of the slideshow" line was stale). PDF rebuilt (14 sections, 53 rows). Typecheck + eslint clean.

## Oct 19 — /see showcase, login strip, Presented-through credit — NOT PUSHED (parent will push), NOT TESTED LIVE, no DB changes

- **yachtpics.com nav fix (`src/lib/siteTemplates.ts` `nav()`):** the menu stamped on published boat/brokerage pages and yacht-photos.html now matches the hand-written pages: Home / Gallery / Video / Clients (was "Boats"; **renamed back to Boats Oct 21**, see above) / Team / Marine Blog (marine-news.php) / Portal (portal.html) / Contact. Nothing published. Note: portal.html returned 404 on the live site on Oct 19 — upload it before the next publish or the new Portal link will be dead. Hand-written pages (index.html etc.) still need Portal added by hand.
- **Sitemap (`renderSitemap()` in `src/lib/sitePublish.ts`):** now also lists `marine-news.php` (0.6) and `portal.html` (0.7), dated the publish day like every other row. Help page: no change (website-only, not broker-facing).

- **`/see` (public, `src/app/see/page.tsx`, rebuilt at most hourly — `revalidate = 3600`):** headline "Shot on Tuesday. / On your buyer's phone by Wednesday.", links to the live Short Story slideshow (`/s/r01b4xhu`, new tab) and Request access. "One listing, every output": **Delivered** (Short Story cover + slideshow link), **Reels** (Walkthrough + Underway, 9:16, muted/loop/playsInline, `preload="none"`, play only while on screen — `src/app/see/_components/ShowcaseReelVideo.tsx`, the only client piece), **Shared** (an illustrated iMessage-style card built from the real cover/name/specs + slideshow link), **Posted** (Reel → Caption → Live labels). "In numbers" (live: brokers with ≥1 listing, listings, photos — omitted if any read fails; 122 / 254 / 24,525 on Oct 19). Quotes section reads `src/content/seeQuotes.ts` (ships empty → hidden). Plans line takes the lowest price from `src/lib/plans.ts` ($29 Starter, checked). Footer: © YachtPics Enterprises LLC · North Palm Beach · Privacy · yachtpics.com. Link preview: "YachtPics Portal — See it", one-line description, hero as OG image.
- **Media (`src/lib/seeShowcase.ts`):** the cover = first photo in the buyer-slideshow order. Hero uses the cover's **already-public website copy** in `site-photos/miles_yacht_group/122_horizon_short_story/` through Supabase's public render URL (2000px WebP ≈ 430 KB; OG 1200×630) — stable, never expires. Fallback if that copy is missing: the 2000px stored derivative / an OG transform, signed 7 days. **Today the fallback is what runs:** the 268 files in that website folder are from an older photo set — none of Short Story's current 256 photo ids has a public copy (republishing the boat to the site would create them; /see then switches to the public URL by itself). Reels: private R2 video bucket `showcase/short-story/{walkthrough|underway}.mp4`, HEAD-checked then signed 7 days at render; missing → poster + "Coming soon" (both missing today).
- **Save to showcase (admin only):** listing Reel page, after a 9:16 render, next to Post to Facebook / Instagram → **Save to showcase ▾** → Walkthrough / Underway. Only shows on listings listed in `src/content/showcase.ts` (Short Story today) and does NOT need Meta connected. Uploads through the existing social upload target (`social-uploads/{listing}/…`, reused if that render was already uploaded), then `POST /api/admin/showcase/reel` (`requireAdmin`; `{listingId, look, path}`) copies it server side (new `r2VideoCopy` in `src/lib/r2.ts`) to the fixed key — overwrites, so Replace = save again. Green/red line under the buttons. /see shows a new reel within the hour.
- **Landing (`src/app/page.tsx`):** new subhead (photos, reels, client galleries, slideshow sharing, posting) + quiet "See it →" under the two buttons.
- **Login:** one "New" line under the logo from `src/content/whatsNew.ts`; "See what your listings could look like →" under "Need access? Request an account".
- **Credit (`src/components/PresentedThrough.tsx`):** small low-contrast "Presented through the YachtPics Portal" → /see on `/s` (below the broker footer), `/g` (last line of the page) and `/d` (below the copyright note). Nothing else on those pages moved.
- **Watch:** the login "New" line, the landing subhead and /see's Posted block describe Facebook/Instagram posting, which is still admin-only (`SOCIAL_PUBLISHING_FOR_BROKERS = false`). Charlie asked for this copy; flip the flag (and do the Help update CLAUDE.md describes) before brokers read it as something they can do — or soften the copy.
- **Help:** no change — Save to showcase is admin-only; the credit line, /see and the login line aren't broker tools.
- **Charlie's to-do:** on Short Story's Reel page make a **Walkthrough** reel → Save to showcase → Walkthrough; make an **Underway** reel → Save to showcase → Underway. Send broker quotes (quote, name, brokerage) for `seeQuotes.ts`.
- **Check after push:** open /see on a phone (no sideways scroll, reels show "Coming soon" until saved), paste portal.yachtpics.com/see into iMessage (card with the Short Story photo), open an /s link and find the credit under the broker card, and the login page's two new lines.
- **Tested:** typecheck + eslint clean. Public render URLs for the site-photos copy checked (200, WebP). Not run live.

## Oct 19 — shared listing photo management — NOT PUSHED (parent will push), NOT TESTED LIVE, no DB changes

- **What:** the broker listing page (`src/app/dashboard/listings/[id]/page.tsx`, 3,074 → 1,743 lines) and the admin listing page (`src/app/admin/listings/[id]/_components/AdminListingDetail.tsx`, 2,329 → 1,379 lines) no longer carry their own copies of photo management. Both use **`src/components/listing-photos/`**: `useListingPhotos` (rows, /api/thumbs thumbnails + missing list, lightbox display copies signed on demand, cover id, custom categories, AI-configured check), `usePhotoActions` (upload 4-at-a-time with Retry, replace, delete one/selected/all, drag reorder, Sort to standard order, category one/bulk, cover, show/hide, AI labels, select mode — each reports through `onMessage({kind, text, ms})` so each page keeps its own banner), `useDownloads` (`useSizedDownloads` = broker sizes/zip/log; `useOriginalSave` = admin originals/share sheet), `PhotoGrid` (variant `broker` gallery wall / `admin` compact cards), `Lightbox`, `PhotoToolbar` (+ delete dialogs), `UploadStatus` (progress, failed+Retry, category prompt, hidden inputs), `DownloadControls` (size menu, admin save panel), `OrientedThumbnail`, `types.ts` (`BROKER_PHOTO_CAPABILITIES` / `ADMIN_PHOTO_CAPABILITIES`). Existing helpers reused, not forked; `uploadListingPhoto()` gained an optional `categorySource` (broker uploads still write `category_source`, admin uploads still leave it null).
- **Looks:** markup/classes moved verbatim — both pages should look exactly as before. Same API routes and bodies (single delete still `{photoId, storagePath}` from the broker page and `{photoIds:[id]}` from admin; categories still direct-with-`manual` on broker and `/api/admin/photos/update-category` on admin).
- **Drift resolved (behaviour that changed on purpose, failures only unless noted):**
  - AI-label after upload — was broker only → **both** (admin uploads the filename can't place now get labelled when AI is on).
  - Upload — broker was one-at-a-time with no failure report (and said "N uploaded" even when some failed) → **both** 4 at a time, file order kept, "8 uploaded, 2 failed: … Retry", orphan file removed if the record fails, leave-page warning while uploading. Broker category prompt (AI off) unchanged; Retry keeps the category picked.
  - Drag-save failure — admin only → **both** show the red "Couldn't save the new order".
  - Single delete error — broker only → **both**. Delete selected / Delete All on broker now also wait for the server and say why if refused (they used to vanish regardless).
  - Sort to standard order — broker didn't check the save → **both** check it; broker now also shows "Sorted to standard order." and only reorders on screen once saved.
  - Show/hide, category save, bulk category — broker never checked errors → **both** report failures in red; bulk keeps the failed photos selected. Broker bulk apply now also confirms "Set N photos to …" (still leaves select mode as before).
  - Cover-photo error on broker showed in green → red.
  - Admin banner: failures now stay until closed (a few used to clear after 3–5 s); a confirmation's timer no longer wipes a newer message.
- **Left page-specific (on purpose):** broker page-level drop overlay and the content-rights / download-licence gates, Flyer cover Fit/Fill, Send to Client; admin save-originals vs broker sized downloads (two role hooks, same module); tile and lightbox looks (variants). Admin tiles don't show the "File missing" state (they get the data, but showing it would change the admin look) and the admin lightbox still shows the original rather than the 2000px copy — both easy follow-ups. **Not fixed (needs a route change):** `/api/admin/photos/update-category` doesn't set `category_source = 'manual'`, so a broker's "Re-label photos" can overwrite an area YachtPics set by hand.
- **Thumbnail backfill:** unaffected — uploads/replaces still call `requestDerivatives` (now via the shared helper on both pages), `/api/thumbs` unchanged, Admin → Overview card untouched.
- **Help:** no feature change for brokers (the only new thing they can see is the failed-upload Retry line), so Help page/PDF untouched.
- **Check after push:** broker listing — upload 6 photos (they arrive in file order), drag one and reload, Sort to standard order, set a cover ★, hide/show, change one category and bulk-set 3, Replace one, open the lightbox and page with arrows, download one photo + a zip at Web & MLS, Select → Delete 2. Admin listing — same run, plus ↓ Save / Download all, the lightbox filmstrip, and an upload of a photo with a meaningless filename (it should get an AI label). Both pages should look exactly as before.
- **Tested:** typecheck + eslint clean (changed + new files). Not tested live.

## Oct 18 — pre-generated derivatives (stored photo thumbnails) — NOT PUSHED (parent will push), NOT TESTED LIVE · DB column ALREADY LIVE (`20261018f`)

- **What changes for people:** listing pages, slideshows and client pages stop asking Supabase to resize every photo on every visit. Each photo now gets two stored copies made ONCE — **600px** (tiles, filmstrip, grid, listing covers) and **2000px** (main slide, lightbox) — and pages sign a whole listing's copies in ONE call. Faster pages, and no more 429 "too many resizes" failures (~138/day) for photos that have copies.
- **Where they live:** same private bucket, `{brokerId}/{listingId}/_d/{photoId}-{v}-600.webp` and `…-2000.webp` (gallery photos: `galleries/{id}/_d/…`). `{v}` = short hash of the original's path, so a replaced photo gets NEW keys (no stale year-long cache). Uploaded with `cacheControl 31536000`, `image/webp`, upsert. Segment 2 is still the listing id, so the existing storage RLS (`storage_listing_id`) covers them — readable by exactly the people who can read the original; written only by the service role. No new policies, nothing public. Naming is in ONE place: `src/lib/photoDerivativePaths.ts` (browser-safe).
- **How they're made:** `src/lib/photoDerivatives.ts` → `ensureDerivatives(ids)` signs a 2-minute Supabase *transform* link for the original, fetches it with `Accept: image/webp` (no `format` option — supabase-js only allows `'origin'`, which would give JPEG), and uploads the bytes. WebP verified Oct 18 (600 ≈ 20–35 KB, 2000 ≈ 90–170 KB, ~0.5–0.9 s each). Anything that doesn't come back as WebP is NOT stored. Transforms honour EXIF orientation, so copies are upright (same pixels today's thumbnails show; `OrientedThumbnail` and the other orientation handling are untouched and still work for fallbacks). Concurrency 4 (6 for the admin button), 429/5xx retried with back-off. `sharp` is not installed, so no new dependency.
- **`photos.derivatives_at`:** null = not made; a time = both copies exist; `1970-01-01` = "can't be resized" (original missing / unreadable / too big) so the backfill doesn't retry it forever — those photos simply keep the old path. Only set when the row still points at the same file.
- **Triggers:** (1) **upload** — `requestDerivatives()` in `src/lib/uploadListingPhoto.ts` (fire-and-forget, batched 8 at a time or after 1.5 s, `keepalive`) → `POST /api/listings/[id]/photos/derivatives` (signed in + listing rule with co-brokers and brokerage admins; only this listing's photos). Wired into the shared upload helper (admin listing page + admin New Listing), the broker listing page upload, broker New Listing and admin New Broker. **Replace** clears `derivatives_at`, removes the old copies, then asks for new ones. (2) **daily** — `/api/cron/derivatives` (CRON_SECRET, fails closed), fired by `/api/cron/daily`, ~50 s newest-first. Gallery photo uploads have no trigger; the daily run picks them up. (3) **admin button** — see backfill below.
- **Consumers (all fall back per photo to the old transform signing when there's no copy):** `/api/thumbs` (broker listing page, admin listing page, showroom picker strips — display only); `/s` and `/g` now send ALL tile + slide links with the page (two batch calls) when copies exist, so the viewer's chunked `/urls` requests only happen for photos not backfilled (chunking code kept; `/api/s|g/[slug]/urls` also prefer copies); `/d` and `/client` grid tiles (copy for every photo that has one; old 24-tile transform cap only for the rest); My Listings covers (`listing_hero_photos` + one small read for id/derivatives_at); broker listing page **lightbox shows the 2000 copy** (original if none / unsignable). **Downloads still use originals / the chosen size.** Unchanged on purpose: reels, showroom render, Reel Service, OG link-preview images (1200×630 crop, one call), AI describe/categorize, the dashboard home hero, print/report pages.
- **Deletes:** `/api/photos/delete` (the single door for admin + broker photo deletes), admin delete-listing and admin gallery delete now also remove the `_d` copies. Listing delete removes files by row path, NOT by folder prefix — so the copies had to be named explicitly (done). Pre-existing gap, not touched: admin **delete-broker** removes rows but no storage files at all (originals or copies).
- **Migration:** `supabase/migrations/20261018f_photo_derivatives.sql` — record only; the column + partial index were applied by SQL today.
- **Cost / storage note:** copies add ~150–200 KB per photo ≈ **4–5 GB** for today's 24,317 photos (plan includes 100 GB). Supabase bills image transformations per distinct original resized per month; the backfill resizes every photo once (most are already being resized by page views today), after which page views stop resizing at all.
- **Backfill procedure for Charlie (after this is pushed and live):**
  1. Open the portal, go to **Admin → Overview** (the Business Pulse page).
  2. Find the **Photo thumbnails** card. The button reads **Generate thumbnails (remaining: 24,317)** (or whatever is left).
  3. Click it and leave the tab open. The bar fills and the count goes down — roughly 100–150 photos per 45-second step, so the whole archive takes about **2–4 hours**. You can keep using other tabs.
  4. **Stop** (or closing the tab) just pauses it. Click the button again any time and it carries on where it left off. The daily job also chips away at whatever is left.
  5. When it says **Done**, every photo has stored copies. "Can't be resized" photos (if any) keep working the old way.
- **Help:** no broker-visible feature change (same pages, just faster), so Help/PDF untouched. The admin card is admin-only.
- **Check after push:** upload 3 photos to a test listing, wait ~10 s, reload — in the network panel the tiles come from `/object/sign/…/_d/…-600.webp` instead of `/render/image/`. Replace one photo → it shows the new picture after reload. Open an `/s` link for a backfilled listing → no `/api/s/…/urls` photo requests, slides are `…-2000.webp`. Open a photo in the broker lightbox → `…-2000.webp`; Download still gives the full-size JPEG. Delete a photo → its two `_d` files are gone in Supabase Storage.
- **Tested:** typecheck + eslint clean. Transform→WebP output and timings checked read-only against prod. Generation, upload of copies and the admin button not run (no storage writes from here).

## Oct 18 — broker flow fixes — NOT PUSHED (parent will push), NOT TESTED LIVE, no DB changes

- **Billing honesty:** checkout (`/api/stripe/checkout`) now passes `subscription_data.trial_end` = the in-app trial end (`subscriptions.trial_ends_at`) when the broker is still on the portal trial (status `trialing`, no Stripe sub) and it's ≥ 49 h away (Stripe needs 48 h); otherwise no trial and billing starts at checkout. The Billing page says which applies ("you won't be charged until {date}" / "choosing a plan now starts billing today"), buttons read "Choose plan" during the trial (not "Switch plan"/"Start free trial"), success says "Your plan is active." plus "Billing starts when your trial ends on {date}." only when a trial_end was passed (`?trial_end=` on the success URL). `alert()`s replaced with inline error text; "cancelled -- your plan" fixed.
- **Office-plan brokers:** dashboard uses `getEffectiveAccessStatus`, so office-covered (and paid) brokers no longer see "Your free trial ends in N days — Upgrade" or the "Choose a plan" onboarding step; the Plan tile reads "Office plan" for them.
- **Shoots & Invoices hidden:** nav item, dashboard "Total Shoots" tile and the Shoots card removed (`/dashboard/shoots` page left in place; table is empty, invoicing is in Zoho).
- **Return-to-page after sign-in:** middleware adds `?next=<path+query>` when bouncing a signed-out visitor; login honours it (password + magic link), the magic-link email carries it to `/auth/confirm`, which honours it. One validator `src/lib/safeNext.ts` (single leading "/", no "//", "\\", ":" or control chars), also used by `/auth/callback`. Signed-in visitors hitting /auth/login?next=… go straight there. `/auth/login?error=auth_error` now shows a friendly line.
- **Expired client galleries:** `/g/[slug]` keeps showing the slideshow after the download window closes (downloads off, quiet note "Downloads for this gallery have closed. Contact {name} for files."). Unpublished galleries (the only "revoked" state — there's no revoked column) stay fully blocked, now with a quiet page naming the contact instead of a 404. Contact = gallery creator (admins read "{First} at YachtPics", studio email fallback). Download/signed-url routes already enforce the time limit server-side.
- **Phone nav:** explicit short labels (Home, Listings, Recent, Reels, Brokers, Profile); bottom bar capped at 5 tabs + **More** (sheet with the rest: Help, Tips, News, Billing, Team, Brokerage…). Desktop sidebar now prefix-matches, so My Listings stays highlighted inside a listing.
- **Listing page:** closing the Save dialog no longer falls through to a plain download; Copy Link only says "Copied" once the clipboard accepts it (else shows the link); a listing that fails to load shows "This listing isn't available" + Back link; Send to Client errors are inline in the dialog; single-photo downloads are named "Sea Dream – Salon.jpg".
- **Auth pages:** friendly messages instead of raw Supabase text (`src/lib/authErrors.ts`: wrong password, email not confirmed, rate limited, etc., generic fallback) on login/signup and forgot/reset/set-password; `autoComplete` on email/password fields (current-password on login, new-password elsewhere); dashboard greets "Welcome, {name}" on the first visit (welcomed_at unset or < 30 min old), "Welcome back" after.
- **Help:** updated — removed the Shoots & Invoices section (sections renumbered 01–14, Your Reels now 15) and its quick-ref row; billing step now explains the trial starts at first sign-in and choosing a plan early doesn't charge until it ends (last two days excepted); added the phone tabs / More step and quick-ref row; "Start a free trial" quick-ref → "Choose a plan". PDF rebuilt (`public/YachtPics_Portal_User_Guide.pdf`, 14 sections, 51 rows).
- **Check after push:** as a trial broker open Billing (copy + "Choose plan"), run a test checkout and confirm Stripe shows the trial end date; sign out, open an emailed listing link, sign in → lands on that listing; on a phone, bottom bar shows ≤ 6 items and More opens; open an expired `/g/` link → slideshow plays, no download button, note shows.
- **Tested:** typecheck + eslint clean. Not tested live.

## Oct 18 — speed pass 1 — NOT PUSHED (parent will push), NOT TESTED LIVE, MIGRATION 20261018d NOT APPLIED

- **Buyer slideshow `/s/[slug]`:** broker_details now fetched with profile/photos/videos; photo, video, video-poster and deck-plan signing run in parallel (was 4 steps in a row).
- **Dashboard:** layout + home page share one per-request `getCurrentUser()` (`src/lib/getCurrentUser.ts`, React `cache()`), so Supabase Auth is asked once per load.
- **Video posters:** the upload-time still (`videos.thumbnail_path`, in the `listing-photos` bucket) is signed and passed as `poster=` on the buyer slideshow, gallery `/g`, download page `/d`, and the broker listing page. New helper `withVideoPosters()` in `src/lib/videoUrls.ts`. No still → unchanged. (Client gallery `/client/[id]` has no inline player, so nothing to do there.)
- **Photo reorder in one request:** `src/lib/reorderPhotos.ts` calls `reorder_photos(listing, ids[])` (migration `20261018d_reorder_photos.sql`, security invoker so RLS applies, 0-based). Until the migration is applied it falls back to the old per-photo updates automatically. Used by broker listing page (drag + "Sort to standard order") and admin listing detail.
- **Broker listing page no longer signs every original on load.** The lightbox signs the open photo + neighbours on demand (cached); downloads sign fresh links at download time (fixes downloads failing on a page open > 1 hour). "File missing" tiles now come from `/api/thumbs`, which returns a `missing` list alongside `urls`.
- **JSZip** loaded on demand in `/g`, `/d`, `/client` download handlers.
- **Admin listing page:** removed the dead read-every-photo fallback for `distinct_photo_categories` (function confirmed live).
- **Help:** no broker-visible feature change, so Help/PDF untouched.
- **Check after push:** open a listing, click a photo (lightbox shows after a beat), download one photo and a multi-photo zip; drag a photo and reload (order sticks); open a slideshow with a video that has a still — the still shows before Play.
- **Tested:** typecheck + eslint clean.

## Oct 18 — Security hardening — NOT PUSHED (parent will push); DB part already live

- **Database (already applied to prod by SQL; recorded in `supabase/migrations/20261018c_security_hardening.sql`, safe to re-run):** trigger `protect_profile_privileges` blocks users changing their own `role` / `is_brokerage_admin` / `brokerage_id` (service role, postgres and portal admins still can); `handle_new_user()` forces any sign-up role other than broker/assistant/client to broker; anon has no rights on `profiles`; `search_path` pinned on the SECURITY DEFINER helpers; EXECUTE revoked from anon on several helpers. Note: four of those functions are still executable via the PUBLIC grant, so the anon revoke alone doesn't bite — see the follow-up list below.
- **Cron routes fail closed:** all 12 `/api/cron/*` routes now return 500 "CRON_SECRET not configured" if the env var is missing instead of running unauthenticated (Bearer header and `?secret=` both still accepted).
- **Welcome email** `/api/email/welcome` now needs header `x-internal-secret` = `CRON_SECRET`; the dashboard layout sends it.
- **Removed** the logo debug route `/api/debug/logo` (moved out of `src/` to `.git/stale-debug-route/` because deletes are blocked in this shell — Charlie can delete that folder).
- **Logo upload:** PNG / JPG / WebP only, 2 MB max, extension taken from the file type. SVG is no longer accepted (it can carry script); Profile page file picker and hint text updated to match. Existing SVG logos keep working.
- **Login callback:** `next=` only honoured for same-site paths (`/…`, not `//…`, no `\` or `:`), so it can't bounce people to another site.
- **Download logging** `/api/listings/[id]/log-download` now checks the caller can reach the listing (`assertListingAccess` with co-broker + brokerage admin, falling back to an RLS read so colleagues' shared listings still log).
- **Next.js 14.2.5 → 14.2.35** (`package.json` pinned exact + lockfile). Only the lockfile was updated here (`--package-lock-only`); run `npm install` on the ThinkPad after pulling. Vercel installs from the lockfile.
- **Help:** the only broker-visible change is the logo file types; Profile page text updated, Help page/PDF didn't mention logo formats so no rebuild needed.
- **Tested:** typecheck + eslint clean. Not tested live.

## Oct 18 (later) — Post a listing reel to Facebook / Instagram from the listing's Reel Maker (admin only) — NOT PUSHED (parent will push), NOT TESTED LIVE, MIGRATION 20261018b NOT APPLIED

- **What:** on a listing's **Reel** page (`/dashboard/listings/[id]/reel`, the only place the listing Reel Maker lives), after rendering, admins get **Post to Facebook / Instagram** next to Download — only when `/api/social/connections` says Meta is configured and a Page is connected. Opens the existing `SocialPostDialog` (now takes `source: { kind: "reel_service_job", id } | { kind: "listing_reel", id, upload, durationSec, width, height }`; Reel Service board updated). Caption drafted from the listing + broker card only (name; year make model · length′; location; "Presented by {broker}, {brokerage}."; "Delivered through the YachtPics Portal.").
- **Upload:** on Post the dialog uploads the rendered MP4 (progress %) through the existing private-R2 upload routes with a new admin-only target `{ listingId, socialUpload: true }` → `social-uploads/{listing_id}/{uuid}.mp4` (server-chosen key; `resolveVideoUploadTarget`). Remembered per render, so re-posting doesn't re-upload. No new bucket, no RLS change. Swept after 35 days by `/api/cron/reel-share-sweep`.
- **Publish:** `POST /api/social/publish` accepts `sourceKind: "listing_reel"` (admin only even when `SOCIAL_PUBLISHING_FOR_BROKERS` flips): checks listing, key prefix, file exists in R2, 9:16 and 3–90 s; rows get `source_kind='listing_reel'`, `source_id`=listing, `video_path`=key. `startPost` now calls `postVideoUrl()` which signs a 2-hour link from `video_path` at send time (cron re-signs for scheduled Instagram). `GET /api/social/posts` also takes `?sourceId=`.
- **Limits:** Films (16:9) can't be posted; reels over 90 s (possible only with many clips/long holds) or under 3 s are blocked with the reason. Reel Studio (no listing) has no button.
- **Migration (write-only, not applied):** `supabase/migrations/20261018b_social_listing_reels.sql` — `social_posts.video_path text` + check that listing_reel rows have it. Reel Service posting works without it.
- **Help:** admin-only, so the broker Help page and PDF are unchanged.
- **Tested:** typecheck + eslint clean. Not tested against Meta.

## Oct 18 — Facebook & Instagram Reels posting (admin only) + public Privacy / Data deletion pages — NOT PUSHED (parent will push), NOT TESTED LIVE (no App Secret yet), MIGRATION NOT APPLIED

- **What:** Admin → Reel Service → any ready/delivered reel → **Post to Facebook / Instagram**: pick a connected Page (any connection, for admin), tick Facebook and/or Instagram (IG greyed out if the Page has no linked IG professional account), caption prefilled from `job.caption` (2,200 limit), **Post now** or **Schedule for** a date/time (15 min – 29 days). The dialog lists this reel's posts (or all recent) with status, **View** link, and **Cancel** on scheduled ones; while an Instagram reel is processing it nudges it every ~8 s until live.
- **Connect:** Profile → **Social accounts** (`src/components/SocialAccounts.tsx`, shown only when `META_APP_ID` is set AND the viewer is admin — or a broker once `SOCIAL_PUBLISHING_FOR_BROKERS` in `src/lib/meta/config.ts` is true). Connect → Facebook Login (`/api/meta/connect`, CSRF state cookie, redirect URI derived from the request origin) → `/api/meta/callback` swaps the code for a long-lived user token and keeps it in an encrypted httpOnly cookie for 15 min → back on Profile the user ticks which Page(s) → each saved with an AES-256-GCM-encrypted Page token (doesn't expire), IG id + username. Disconnect deletes the row, cancels that Page's scheduled posts, and revokes the app's permissions with Meta when it was that Facebook user's last Page (best effort, app token).
- **Publishing (`src/lib/meta/publish.ts`, `server.ts`):** Facebook — `video_reels` start → rupload with `file_url` (a 2-hour signed R2 link) → finish `PUBLISHED`. Instagram — `/{ig}/media` REELS + `share_to_feed` → poll `status_code` → `media_publish` → permalink. `POST /api/social/publish` (maxDuration 60) runs both in parallel inline with a 45 s budget; an IG reel still processing stays `posting` with the container id and is finished by the dialog (`POST /api/social/posts {action:"check"}`) or the daily cron.
- **Scheduling (Hobby = daily cron only):** Facebook schedules are handed to Facebook immediately (`video_state=SCHEDULED`) so they publish at the exact time; Instagram has no scheduling API, so scheduled IG posts go out at the **daily run (13:00 UTC)** on or after their time. New `/api/cron/social` is fired by `/api/cron/daily` (no new vercel.json entry). Self-gating until Meta is configured.
- **Meta Data Deletion Callback:** `POST /api/meta/data-deletion` verifies `signed_request` (HMAC-SHA256, `META_APP_SECRET`), deletes that Facebook user's connections, cancels their scheduled posts, returns `{ url: https://portal.yachtpics.com/data-deletion?code=YP-…, confirmation_code }`.
- **Public pages (no login; middleware only guards /dashboard, /admin, /client):** `/privacy` (YachtPics Enterprises LLC, Facebook & Instagram section, providers, retention, rights, contact) and `/data-deletion` (Disconnect / remove the app / email for full deletion within 30 days; `?code=` shows "Your deletion request … has been processed."). Footer links: home page (Privacy) and login page (Privacy · Data deletion). The existing Terms page is `/dashboard/terms` (behind login), so it isn't linked from public pages.
- **Migration (write-only, not applied):** `supabase/migrations/20261018_social_publishing.sql` — `social_connections` (unique broker+page; browser roles get column-level SELECT on everything except `page_token_enc`, plus RLS own-rows/admin) and `social_posts` (adds `connection_id` and `updated_at` beyond the brief). Run it before connecting.
- **Charlie's setup steps:** `docs/meta-setup.md` (dashboard fields, Vercel env vars `META_APP_ID`, `META_APP_SECRET`, `SOCIAL_TOKEN_KEY`, optional `NEXT_PUBLIC_META_APP_ID` / `META_LOGIN_CONFIG_ID`).
- **Help:** admin-only, so the broker Help page and PDF are unchanged. CLAUDE.md now notes Help must be updated when `SOCIAL_PUBLISHING_FOR_BROKERS` flips (brokers will also need a posting button on their Reels page then).
- **Tested:** typecheck + eslint clean; encryption round-trip, tamper rejection, `signed_request` verify (good/bad signature) and the login URL checked in Node. **Untested:** everything that talks to Meta (needs the App Secret + migration).

## Oct 18 — admin reliability — NOT PUSHED (parent will push), NOT TESTED LIVE, no DB changes

Admin pages now say when something fails instead of always claiming success.

- **Listing page (`AdminListingDetail.tsx`)**: the banner has a red error style. Status Save, publish/unpublish slideshow, photo show/hide, Sort to standard order, bulk area apply and Send ready email now report failures (red) instead of green. Photo deletes only disappear from the screen once the server confirms; a failed delete keeps them and says why.
- **Uploads (listing page + New Listing)**: 4 photos upload at a time (order still follows the file order). Failures are listed ("8 uploaded, 2 failed: a.jpg, b.jpg") with a Retry for just those. A photo whose file uploaded but whose record failed has its file removed (no orphans). Closing the tab mid-upload asks first. Shared helper: `src/lib/uploadListingPhoto.ts`.
- **Send ready email**: media type defaults to what's on the listing (photos / video / both), shows "Last sent {date}" from the email log, and asks before sending again.
- **New Listing from the invite flow**: if the auto ready-email fails, it stays on the page with "Listing created, but the ready email didn't send — send it from the listing page." If photos fail, it stops with Retry instead of moving on (and the submit button locks so a second click can't make a duplicate listing).
- **Brokerage members**: remove / shared-inventory / brokerage-admin changes snap back with a red message if the server refuses.
- **Admin nav**: "Video Migration" removed from the nav (route `/admin/media` still works); "Photo Categories" added next to Listings; the two identical priority lists merged into one.
- Help: no change — all admin-only.
- **To check**: on a listing, upload a batch (watch it go faster); try hiding a photo; open Send ready email on a boat that already had one (should ask to confirm).

## Oct 18 — replace photo + download sizes — NOT PUSHED (parent will push), NOT TESTED LIVE, no DB changes

- **Replace photo (broker listing page + admin listing page):** each photo has a **Replace** action (broker: circling-arrows icon next to download, in the hover row and the phone row, shown when the viewer can upload; admin: "Replace" button next to ↓ Save). Pick a file → it uploads to a NEW storage path (`{owner}/{listing}/{ts}-r….ext`, never overwritten in place) → `POST /api/listings/[id]/photos/[photoId]/replace` repoints the row's `storage_path` + `filename` and removes the old file. Same row id, so display order, category, visibility and the listing's `hero_photo_id` (cover) all stay. The tile shows "Uploading…/Swapping in…", then swaps to a fresh thumbnail signed for the new path (no stale cache). Failures: red banner (both pages) + a red strip on the broker tile; the uploaded file is removed again if the swap is refused. The photos table has no width/height/orientation columns, so nothing else to update. `uploaded_by` and `category_source` are left as they were.
  - **Route access:** signed-in user; `assertListingAccess` with co-brokers, no brokerage admins (same rule as photo delete, since it removes a file). Photo must belong to the listing. New path must be `{listing broker or caller}/{listingId}/{file}`, exist in storage and not belong to another photo. Old file is removed only if no other row points at it. The removal goes in the deletion log (`extra.replaced = true`).
  - Shared client helper: `replaceListingPhoto()` in `src/lib/uploadListingPhoto.ts`.
- **Download sizes (broker listing page):** size menu next to **Download All** and next to **Download N** in Select mode: Full resolution / Web & MLS (2048px) / Social (1080px). It applies to every download button on the page, including the per-photo one (its tooltip names the size), and is remembered per browser (`yp_download_size`). Links come from the new `POST /api/listings/[id]/photos/download-urls` `{ photoIds, size }` at download time. This replaced the browser-side signing the downloads used before; the lightbox still signs originals on demand. Resized = Supabase transform `width = height = N, resize: contain, quality 85, format: origin` (long edge capped, verticals stay vertical, JPEG stays JPEG). Same access as log-download (listing rule + co-broker + brokerage admin, falling back to an RLS read for shared listings).
  - Zips: `{Vessel}/{nn} {Category}.jpg` inside `{Vessel}-photos[-2048px|-1080px].zip`. Singles: `Sea Dream – Salon.jpg` (resized adds ` (2048px)` / ` (1080px)`). Fetches run 6 at a time for resized (8 for originals), and a 429/5xx is retried twice with back-off. Same progress bar. Photos that fail are now counted ("3 photos couldn't be added to the zip…", red banner); before, they were skipped without a word. A failed single download says so instead of falling into the zip path.
  - **Not changed:** the Download button on the My Listings row (`/dashboard/listings`) still downloads originals only, and so do `/g`, `/d` and `/client` (another agent's files).
- **Help:** section 03 gained three steps (Replace; download sizes; what the zip looks like and the failure count). The phone-row step now mentions replace, and the File Missing step now says use Replace. Two new quick-ref rows (replace a photo; web/social sizes). PDF rebuilt (14 sections, 53 rows). Brokerage help unchanged.
- **Check after push:** on a listing, Replace a photo that is the cover and sits mid-order. It should stay in the same spot with the same category and ★, show the new picture right away, and still show it after a hard refresh. Download one photo and a 10+ photo zip at Web & MLS and at Social: open a vertical (should be 2048/1080 tall) and the zip folder layout. As admin, Replace on the admin listing page (green banner on success).
- **Tested:** typecheck + eslint clean (one pre-existing `<img>` warning in AdminListingDetail). Not tested live.

## Oct 18 — client pages: image sizes, previews, self-refreshing links — NOT PUSHED (parent will push), NOT TESTED LIVE, no DB changes

- **Right-sized photos on the buyer/client pages.** `/s/[slug]`, `/g/[slug]`, `/d/[token]` and `/client/[id]` no longer send the full-size original for every tile. Shared helper `src/lib/publicPhotoUrls.ts` signs Supabase transforms: **thumb = 600px box, q72** (filmstrip + grid tiles), **full = 2000px box, q82** (main slide; Supabase caps at 2500), **OG = 1200×630 cover, q80** (link previews). Originals are signed only where something downloads (`/d`, `/client`, `/g` while downloads are open — as the fallback if re-signing fails). The deck plan stays original size. Tiles are `loading="lazy"` + `decoding="async"` and use `RetryImg` (backoff on Supabase 429s); signing runs in waves of 100 like `/api/thumbs`.
- **Links refresh themselves.** New client hook `src/lib/useSelfRefreshingUrls.ts`: when the tab comes back (visibilitychange / pageshow) and links are > 100 min old, or an image/video fails on links > 30 min old (fresh-link failures are left to RetryImg), it POSTs to a re-sign route — one in flight, ≥ 20 s apart. Routes: **`/api/s/[slug]/urls`** (re-runs the page's exact checks via shared `src/lib/publicSlideshow.ts`: published slug + owner plan live, or owner/team/admin preview) and **`/api/g/[slug]/urls`** (gallery published; expired galleries stay viewable, as on the page; shared `src/lib/publicGallery.ts`). Both return display sizes only (never originals), keyed by photo/video id, and 429 after 10 calls/min per slug (in-memory, `src/lib/simpleRateLimit.ts`). `/g` downloads still re-sign originals through `/api/g/[slug]/signed-urls` (unchanged). `/d` (6 h links) and `/client` (signed-in) got no refresh route.
- **HOTFIX same day (perf regression):** the first version signed every photo at two sizes on the server (one Supabase call each) — `/s/qq3mjx6a` (257 photos) went from ~0.5 s to ~15 s. Now: the page signs only the **opening photo at 2000px + the first 12 tiles at 600px** (≤ 13 calls, parallel), plus one `createSignedUrls` batch for video stills / deck plan (and, on `/g` while downloads are open, the originals as download fallback). Loaders are React `cache()`d (`slideshowRows`, `getBrokerCard`, `getGalleryRows`), so generateMetadata and the page share one DB read. The viewer (`useProgressivePhotoUrls` in `src/lib/useSelfRefreshingUrls.ts`) asks `/api/s|g/[slug]/urls` with `{ids ≤ 60, size: "thumb"|"full"}`: slide size for current −3…+8, tiles in chunks of 60 once the filmstrip or grid opens; one call at a time, slide size first; waiting tiles show a plain paper square, a waiting slide shows its tile copy. Routes sign one size per call, 20 at a time; `{}` re-signs videos/deck plan. Rate limit raised to **60/min per slug per client IP**. `/d` and `/client` tiles: only the first 24 get a 600px copy, the rest fall back to the original as before (`signTransformed` limit). Server per `/s` request now: 1 OG + 1 full + 12 tiles = 14 single signings + ≤ 1 stills/deck batch + ≤ 1 video batch.
- **Rich link previews:** `generateMetadata` on `/s` (title "Sea Dream — 2019 65′ Viking", spec line + "Presented by {broker}, {brokerage}"), `/g` (gallery title + "presented by {contact}") and `/d` (vessel + "Photos/Videos to download"); hero/first photo as a 7-day 1200×630 `og:image`, `twitter:card = summary_large_image`. Unpublished / lapsed-plan / revoked / expired / missing → neutral "YachtPics Portal", no image. Price is deliberately left out of previews.
- **Share sheet:** the client gallery's "Copy slideshow link" uses `navigator.share` on phones (touch devices), clipboard on desktop; "Link copied ✓" only after the clipboard accepts it, otherwise the link is shown to copy by hand. (`/s` and `/g` have no copy-link button for viewers.)
- **Alt text:** photos read "{category or Photo} — {vessel/gallery name}" on all four pages (filmstrip squares stay decorative inside labelled buttons).
- **Help:** no broker-visible feature change (buyer/client pages only, same behaviour), so Help/PDF untouched.
- **Check after push:** open an `/s` link on a phone with the network panel/Data usage — tiles should be ~50–100 KB from `/render/image/`, main slide a few hundred KB; open "All Photos" on a big listing and scroll (no broken tiles). Leave an `/s` tab for 2+ hours, come back — photos still show. Paste an `/s` link into iMessage/WhatsApp — card with the hero photo and vessel name. On a phone, client gallery → "Share slideshow link" opens the share sheet.
- **Tested:** typecheck + eslint clean. Not tested live.

## Oct 15 — Showroom Loop (admin only, /admin/showroom) — NOT PUSHED (parent will push), NOT BROWSER-TESTED IN THE PORTAL

- **What:** a new admin tool that makes one long **1920×1080, 30 fps H.264 MP4** of a brokerage's (or one broker's) recent boats for the office monitor — the highlight slideshow Samantha has been building by hand for Offshore Yacht Group. Admin nav: "Showroom Loop", right after Reel Studio. Rendered entirely in the browser (Chrome/Edge); nothing is uploaded or stored, no new tables.
- **Pick the source:** brokerage (brokers via `profiles.brokerage_id`) or a single broker. Active listings, newest first by `photographed_at` (else `created_at`); each row shows the cover photo, name, year/length/make-model and broker. Boats shot (or, without a shoot date, created) in the last **120 days** are pre-ticked. Reorder by drag or ▲/▼.
- **Auto-pick (`src/lib/showroomPick.ts`):** 6–10 photos per boat (default 8, per-boat control), visible photos only. Priority: hero → Profiles Running → Aerial → Profiles → Bow/Stern/Flybridge/Tower/Hard Top/Cockpit/Aft Deck/Swim Platform → Salon → Galley → Master Stateroom → Helm/Pilothouse/Skylounge → VIP/Guest Stateroom → (anything else allowed, only if still short). Never heads (incl. "Master Stateroom Head" etc.), engine/mechanical/electrical/generator rooms, lazarette, crew, laundry, bilge, "Other" or uncategorised (a broker-chosen hero is kept whatever its category). Round one takes the **first** photo of each category; further rounds add one more per category, choosing the frame furthest from those already taken; the result plays in priority order (outside first, then the rooms). Each boat shows its picks as a strip — click to drop, ◀/▶ to reorder, ⇄ + the Add/swap panel to replace, or Add/swap to append; "Re-pick automatically" resets.
- **On screen (`src/lib/showroomRender.ts`):** title on each boat's first photo only (the Editorial reel look: Cormorant caps, gold rule, spec line "2017 · 60′ Pachoud Yachts XF60" with nulls left out — no broker, no price), faded in and out. Brokerage logo (first non-null `broker_details.brokerage_logo_url`, else `logo_url`, among the source's brokers; or a logo file chosen in the tool, kept in memory only) small in a chosen corner (default bottom-right, 6% of frame height, soft shadow) over every photo, and large on the **opening and closing cards, which are pixel-identical** so a monitor on repeat loops seamlessly (checked: first vs last frame PSNR 51 dB). No logo → the cards show the brokerage name. Optional line under the logo.
- **Motion:** 5 s per photo (3–8), gentle Ken Burns (push in / drift right / pull out / drift left in turn, 6%), 1 s crossfades; between boats a 1.5 s dip through black (or a 1.5 s crossfade). Landscape fills the frame; portrait sits whole over a blurred, dimmed copy of itself. Live total, e.g. "6 boats · 48 photos · 4:12"; a confirm over 15 minutes.
- **Music:** Off by default; Calm / Elegant / Coastal first, the other moods available. reelMusic is built for reel-length tracks (one intro, one build, one cadence onto an end card; the whole track is one OfflineAudioContext buffer), so a multi-minute loop is scored as **one short track per boat**, composed just before that boat plays, with the boat's photo changes as cut points and the cadence landing as the boat leaves; consecutive tracks overlap by 1 s with an equal-power crossfade. Each track is levelled by reelMusic itself (same −14 LUFS / ceiling). The loop ends faded to near-silence, so the audio loops too. AAC as ReelMaker; no AAC encoder → silent with a note.
- **Render:** progress bar + Cancel; photos fetched as a 2400 px rendition (signed `listing-photos` URL with transform, falling back to the plain `createSignedUrl(path, 3600)` original — ReelMaker's approach), decoded ≤ 3 ahead with two at a time and closed once played; the MP4 streams to the browser's private file storage (OPFS, fast-start reserved) where available, else memory. Download name `{Brokerage-or-Broker}-Showroom-{YYYY-MM-DD}.mp4`.
- **Tested:** typecheck + eslint clean. Pick logic run in Node against Offshore's real category mix. A headless render ran in Playwright's Chromium **with VP9/Opus swapped in for the test only** (that Chromium has no H.264/AAC encoder): 3 boats / 6 photos (one portrait, one failing to load) rendered to the expected 29 s, frames, titles, logo, dip, portrait fill and loop seam checked by eye; music joins measured smooth. **Not verified:** the real H.264/AAC path in Chrome on the portal, real photos, and long (10 min+) renders — first thing to check: open /admin/showroom, pick Offshore Yacht Group, render at 3 s/photo with 6 per boat, and play the file looped.
- **Oct 15 (later) — 1080p / 4K toggle (default 1080p), NOT PUSHED:** 4K = 3840×2160 at 30 fps. Everything drawn scales with frame height (titles, logo ≈ 6% of height, card text, blur fill, Ken Burns), so 4K is the same picture, sharper (checked: a 4K frame scaled down vs the 1080p frame matches, PSNR 37–44 dB). Photos: 1080p keeps the 2400 px Supabase rendition; **4K always fetches the signed original** (Supabase transforms stop at 2500 px) and decodes it to ≤ 4400 px, decoding 2 ahead, one at a time (1080p: 3 ahead, two at a time). Encoder: `getFirstEncodableVideoCodec(["avc"], {3840×2160, bitrate})` — mediabunny picks the level (5.1 at 4K); if it fails: "This computer can’t make 4K video — use 1080p." (no silent fallback). Bitrate targets (variable bitrate): **12 Mbps at 1080p (was 8)**, **35 Mbps at 4K**. UI: estimated file size beside the toggle, render-time note (4K ≈ 3–4× longer, ~3× bigger), red warning + confirm over 4 GB (FAT32 USB sticks), long-loop confirm at **15 min for 1080p / 8 min for 4K**; filename gets `-4K`. Without the browser's private file storage, loops estimated over 1.6 GB stop with a message rather than run out of memory. Headless test (Playwright Chromium, **VP9/Opus swapped in for the test only** — no H.264 there): 19 s, 3 photos at 4K rendered in 113 s vs 27 s at 1080p (software encoding, no GPU), 22 Mbps vs 7 Mbps actual. Real H.264 4K in Chrome not verified.
- **Help:** admin-only, so the broker Help page and PDF are unchanged.
- **Files:** new `src/app/admin/showroom/{page,ShowroomBuilder}.tsx`, `src/lib/showroomPick.ts`, `src/lib/showroomRender.ts`; changed `src/app/admin/_components/AdminNav.tsx`.

## Oct 10 — Help and reel tip: Walkthrough and Underway are for everyone now — NOT PUSHED (parent will push), NOT BROWSER-TESTED

- The depth looks opened to every broker on **Fri Oct 9, 9am ET** (release gate unchanged in `src/lib/depthLooksRelease.ts`; the Reel page still uses it).
- **Help (`src/app/dashboard/help/page.tsx`):** the Walkthrough/Underway line is now an ordinary step in `sections`, right after "Reel — pick a look", with no date wording, and the pick-a-look line now names Walkthrough and Underway in the list of looks. The per-viewer gate on the Help page is gone (`DEPTH_LOOKS_STEP`, `depthLooksOpenForViewer`, `sectionsNow` and the `depthLooksRelease` / `getEffectiveAccessStatus` imports removed); the page stays `force-dynamic` for the per-viewer "Your Reels" section. Stack Underway stays out (admin-only; Help never covered it).
- **Reel tip (`src/lib/portalTips.ts`):** the looks paragraph now includes Walkthrough and Underway.
- **PDF rebuilt** (`python3 scripts/build_user_guide.py`) — the guide now includes the Walkthrough/Underway step (it never did before, since gated lines lived outside `sections`).
- Note: `CLAUDE.md`'s Help-page rule still cites `DEPTH_LOOKS_STEP` as an example of a gated line; that constant no longer exists (`REEL_SERVICE_SECTION` is the remaining example).

## Oct 7 (later) — Coastal revised (mallet lead, more bass) + 8th mood "Coastal Drive" — NOT PUSHED (parent will push), NOT BROWSER-TESTED

- **Coastal, after Charlie heard the first sample:** the singing saw/triangle lead is replaced by a **bright, plucky mallet / marimba-style lead** (additive partials 1×, 4×, 9.2× with the upper ones dying fast, a light FM shimmer on the attack, 3 ms attack, 0.45–1.6 s decay scaled to the note, a touch more stereo delay) — same seeded motif logic (A, A′, B, A″). **Bass** now sine + clean 2nd and 3rd harmonics (sines; ~100–250 Hz so phones carry it), low-pass opened to 900 Hz, sidechain still gentle; **bass stem vs the mix went from −4.7 dB to −0.6 dB (+4.1 dB)** — pre-level K-weighted bass −18.2 → −11.4 LUFS against a mix of −13.5 → −10.8; the final level pass still lands the track at −14 LUFS. Lead stem ≈ −19 LUFS (pre-level).
- **Coastal Drive** (`coastal_drive`, label "Coastal Drive", blurb "Coastal with more punch"): same harmony, motif and mallet (`composeCoastalLayers(..., drive: true)`), **126–130 BPM**, firmer kick (150→50 Hz, 2 ms attack, plus a soft band-passed click), snappier clap/snare on 2 and 4 (brighter, shorter, with a pitched body), **off-beat open hats + a 16th shaker**, a **rhythmic 8th-note bass** (seeded rest pattern, odd octave lift) even further forward (bass +4.8 dB over the rest of the mix vs Coastal's +4.0), and a **1-beat 16th snare fill into every other breath**. No distortion anywhere. Not the Auto default for any look.
- **Samples** (30 s, cuts 4.2/8.7/13.1/17.6/22.0, end card 26.5, seed 1): **Coastal 121 BPM, −14.1 LUFS, true peak −1.61 dBTP** (breaths into the 13.1 cut with riser and the 22.0 cut, 1 bar each) → `$HOME/coastal_sample.wav` (overwritten); **Coastal Drive 128 BPM, −14.0 LUFS, −1.86 dBTP** (2-beat breath with a snare fill and riser into the 17.6 cut) → `$HOME/coastal_drive_sample.wav`.
- **The six other moods are bit-identical** (fingerprints unchanged). Help's Reel — music step lists Coastal and Coastal Drive; PDF rebuilt.

## Oct 7 — Throttle removed (7efde70); 7th music mood "Coastal" — NOT PUSHED (parent will push), NOT BROWSER-TESTED

- **Throttle** (fast, distorted go-fast mood) was tried and rejected by Charlie — reverted in 7efde70. Nothing of its sound is reused.
- **Coastal** (label "Coastal", blurb "Warm, melodic, feel-good"), in `src/lib/reelMusic.ts`: original, built only from broad traits shared by three tracks Charlie likes (no melody, chords or hook copied). Harmony carries it, drums sit underneath. **118–126 BPM** (fitted to the cuts), **seeded minor key whose progressions lean to the relative major** (e.g. VI–VII–III–III, i–VI–III–VII) and **resolve to the relative major (III, maj9) on the end card** via VI → VII. Not the Auto default for any look.
- **Layers (`composeCoastalLayers`):** a 1–2 bar soft opening (pad + plucks), then the full groove. Soft rounded 4-on-the-floor kick (low-passed, 5 ms attack), light clap on 2 and 4, airy shaker on the 8ths (the odd 16th); warm clean bass (sine + a little triangle 2nd harmonic, no distortion) gently ducked, as is the pad; a **vocal-like lead** (soft saw + triangle through a low-pass, delayed vibrato, 70 ms glide between legato notes) singing a seeded two-bar motif in phrases A, A′ (new ending), B (lifted), A″ (resolving), strong beats snapped to chord tones; plucked 8th-note arpeggios underneath (triangle + soft 2nd harmonic, through the delay).
- **Breaths:** before about every 2nd–3rd cut (seeded 2 or 3; preferring cuts within 120 ms of a beat) the **drums and bass drop out for one beat, two beats or a bar** (seeded, never back past the previous cut) and the full groove returns **on the cut** — on its beat when the cut sits near one — with a soft noise swell into it and an airy cymbal on it. A **gentle filtered riser** goes into the first big breath landing after 30% of the reel, then no more than about one every 30 s; the shared gentle riser goes into the end card. End card: soft kick, airy cymbal, bass, rolled pluck chord and the lead sliding onto the home chord, then the normal fade.
- **Level:** K-weighted to −14 LUFS with a −1.6 dBFS ceiling (as Lift). 30 s sample (cuts 4.2/8.7/13.1/17.6/22.0, end card 26.5): **121 BPM, −14.2 LUFS, true peak −1.60 dBTP**; breaths 11.13–13.11 s (1 bar, lands on the 13.1 cut, + riser) and 20.05–22.04 s (1 bar, lands on the 22.0 cut). 45 s check (seed 2): −14.1 LUFS, −1.61 dBTP, breaths into the 13.4 (1 beat), 22.3 (1 bar, riser) and 31.2 (1 beat) cuts. Stems (pre-level, K-weighted): lead −17.7, bass −18.2, drums −20.5, pad −22.0, plucks −22.9, reverb −22.8 LUFS. Sample: `$HOME/coastal_sample.wav` on the Cowork VM (seed 1).
- **The six existing moods are bit-identical** (fingerprints unchanged). Picker and Reel Service board list it automatically; Help's Reel — music step lists Coastal; PDF rebuilt.
- **Not verified:** listening quality, browser rendering.

## Oct 6 (latest) — 6th music mood "Lift" — NOT PUSHED (parent will push), NOT BROWSER-TESTED

- **What:** a new mood in `src/lib/reelMusic.ts` in the broad style of a second track Charlie likes — traits only (no melody, chords or hook copied). Bright, building, uplifting: **major key only** (seeded), **134–138 BPM** 4-on-the-floor. Picker label **"Lift"**; not the Auto default for any look.
- **Arc (`composeLiftLayers`):** intro — the shared pad plus a plucky 8th-note arpeggio in the mids (root D4–C♯5, ~300–600 Hz) behind a closed low-pass (1.3 kHz), with a soft kick pulse; **riser over the 2–3 bars before the drop** — the pluck filter opens to 7 kHz, a noise sweep and a light clap roll (8ths → 16ths) build, delay opens up; **the drop lands exactly on a cut**: the cut nearest 45% of the reel (preferring 40–50%) is chosen and the beat grid is turned so it's a downbeat, with a chord change there onto the home chord. Drop — steady kick, off-beat open hats, claps on 2 and 4, a crash, wide detuned chord stabs, the pluck up front with 16th pickups and an occasional octave sparkle, and a moderate clean sine/triangle bass on the off-beats; **bass, chords and pad duck under every kick** (sidechain-style). End card — kick, a wide tonic chord and a pluck flourish, then the shared fade.
- **Level:** K-weighted to −14 LUFS like Groove, with a **−1.6 dBFS sample ceiling for Lift only** so its true peak stays under −1 dBTP. 30 s sample (cuts at 4.5/9.3/14.1/18.6/23.4, end card 27 s; drop on 14.1 s): **−14.3 LUFS, true peak −1.13 dBTP** (sample peak −1.60); seed 2: −14.3 LUFS, −1.18 dBTP. Intro→drop RMS ×1.83 (seed 2 ×1.94); spectral centroid ~0.6 kHz → ~1.8 kHz. Note rate by construction: intro 8ths ≈ 4.5/s; drop ≈ 5.6/s plus the drums. Sample: `$HOME/lift_sample.wav` on the Cowork VM (seed 1, outside the repo).
- **Existing moods bit-identical** (Calm, Cinematic, Elegant, Upbeat, Groove fingerprints unchanged).
- **UI:** "Lift" chip in the Reel page Music picker and in the Reel Service board menu; the picker now shows a one-line description of the chosen mood (`MUSIC_BLURB`, e.g. "Lift — Bright, building, uplifting.") and the same text as a hover title on each chip.
- **Help:** Reel — music step lists Lift; PDF rebuilt. (Brokerage help doesn't mention music — no change.)
- **Not verified:** listening quality (review the sample), browser rendering.

## Oct 6 (later) — 5th music mood "Groove" — NOT PUSHED (parent will push), NOT BROWSER-TESTED

- **What:** a new mood in `src/lib/reelMusic.ts`, "similar in feel" to a track Charlie likes — built from broad style traits only (no melody, chords or hook copied; nothing was transcribed). Modern melodic hip-hop / trap-lite, tasteful: **minor key only** (seeded), **106–110 BPM** (fitted to the cuts like the others; 120 on Stack looks), half-time bounce.
- **Layers** (`composeGrooveLayers`): **808** — sine sub through soft tanh saturation (WaveShaper, 2× oversampled), locked to a seeded syncopated kick pattern (two patterns alternate per two-bar phrase), chord roots with the odd octave jump and ~35% short pitch glides; drops out for the last two beats before the end card, then slides down onto the tonic. **Drums** — short punchy kick, layered clap/snare (three-burst flam + body) on 2 and 4, closed hats on 16ths (8ths in the intro) with seeded 1/32 or 16th-triplet rolls in answer bars and a 1/32 roll into the end card. **Lead** — bright chopped pluck (saw + square through two formant-like band passes at ~820/1250 Hz, notes ~600–1300 Hz, short gated envelope, occasional 32nd stutters) playing a seeded one-bar syncopated motif on the minor pentatonic; the answer bar varies the tail and **slides up into a held note** (with light vibrato) at each phrase end; darker/quieter before the build; slides up into the tonic on the end card. **Pad** — the shared pad, darker (750 Hz) and quieter. No keys arpeggio / bells / standard bass in this mood.
- **Level:** Groove is levelled by **K-weighted loudness (BS.1770) to −14 LUFS** (plain RMS over-counts the sub) with the same soft limiter (≤ −1 dBFS) and a slightly firmer compressor. Measured on a 30 s reel (Node): **−14.1 to −14.2 LUFS, peaks −1.5 to −2.2 dBFS, sub (<120 Hz) peaks ≈ −7 dBFS**, sub ≈ 60% of the energy. Sample: `$HOME/groove_sample.wav` on the Cowork VM (seed 1, outside the repo).
- **Existing moods unchanged:** fingerprints of Calm/Cinematic/Elegant/Upbeat renders are bit-identical before and after.
- **UI:** appears in the Reel page Music picker and the Reel Service board menu (both list every mood). **Not** the Auto default for any look.
- **Help:** the Reel — music step lists Groove; PDF rebuilt.
- **Not verified:** listening quality (review the sample WAV), browser rendering.

## Oct 6 — Original music in reels (composed in the browser, owned by YachtPics) — NOT PUSHED (parent will push), NOT BROWSER-TESTED, NOT LISTENED TO

- **What it is:** an optional music track baked into the MP4, composed in the browser for that reel by a new procedural composer (`src/lib/reelMusic.ts`, Web Audio `OfflineAudioContext`, stereo 48 kHz). Nothing sampled or licensed — every sound is synthesized — so YachtPics owns it and brokers can post anywhere with no copyright claims. **Owner decision:** broker reels default to **Off** (post silent, add a trending sound in Instagram); Reel Service reels default to **on (Auto)**.
- **Composer:** input `{durationSec, cutTimesSec, mood, seed, endCardStartSec, bpm?}` → AudioBuffer exactly `durationSec` long; same inputs + seed → same samples (checked). Moods: **Calm** (Walkthrough, Classic; 76–84 BPM), **Cinematic** (Cinematic, Marquee Still; 76–82, minor key 40% of the time, soft pulse), **Elegant** (Editorial, Marquee, Gallery; 88–96, soft shaker + kick), **Upbeat** (Energy, Stack, Stack Underway, Underway; 98–104, or **120 BPM on Stack looks** to match reelStack's grid). "Auto" = the look's mood. Seed picks the key (C/D/E♭/F/G/A/B♭) and progression (Imaj7–vi7–IVmaj7–V9sus and five relatives; minor: i–VI–III–VIIsus etc.). Layers: warm pad (detuned saw + triangle, rootless 7th/9th voicings in G3–F♯4, slowly opening low-pass), FM-light keys arpeggio (seeded pattern, humanized ±8 ms / ±12% velocity) with a stereo ping-pong delay, sub bass on roots with a soft octave so phone speakers carry it, and the gentle rhythm for Elegant/Upbeat (round kick, filtered-noise shaker, soft snap on 2 & 4 for Upbeat). Generated-noise ConvolverNode reverb.
- **Sync to the edit:** every tempo in the mood's range and every beat phase is scored by how close the reel's cuts (unit joins, Stack band swaps, Marquee bottom-band turns) fall to a beat; the best grid wins, and the downbeat goes where most cuts hit bar lines. Chord changes are on bar lines; the build starts at the bar nearest the cut closest to ¼ of the way in; a soft bell plays on cuts that land within 60 ms of a beat (max one a bar); a filtered riser leads into the end card; the cadence is IV→V(sus) (minor: VI→VIIsus) → **tonic exactly on the end card**, then a 2–3 s fade ending exactly at the reel's length.
- **Level:** high-pass → DynamicsCompressor → post-render level pass (RMS of the body to −16 dBFS, soft limiter, ceiling −1 dBFS). Measured in Node (node-web-audio-api, outside the repo): **−14.0 to −14.3 LUFS integrated, peaks −1.0 to −1.9 dBFS**, all four moods; 43 s track renders in ~4 s there (browsers are usually faster). Stems balanced (calm: pad −18.5, keys −19.6, bass −21.6, reverb −24 LUFS). A chained `setTargetAtTime` blew up in that engine, so the composer uses only plain ramps.
- **ReelMaker (broker Reel page):** new **Music** control beside Length — Off / Auto · <mood> / Calm / Cinematic / Elegant / Upbeat; Off shows "Leave off to add a trending sound when you post". With a mood: **▶ Preview** (composes for the reel as it stands and plays it; **■ Stop**) and **Try another** (new seed). Choice remembered per browser (`localStorage yp.reel.music`, try/catch); seed starts from the listing id so a boat keeps its track until Try another. When music ≠ Off the track is composed after the timeline is final (before the encoder starts) and added as an **AAC-LC (`mp4a.40.2`) 48 kHz stereo** track via mediabunny `AudioBufferSource` — checked first with `canEncodeAudio("aac")`. **No AAC encoder (e.g. Firefox, older Safari) → renders silent with a note**; an encode failure after start cancels that output and re-renders silent. The result line says "original YachtPics music (Calm) — free to post anywhere" or the old "silent (add trending audio when you post)". Video timing is untouched (frames are timestamped as before); the buffer is dropped once encoded; the preview AudioContext is closed on Stop / end / unmount / new render. **Music Off = exactly the old output path** (same Output/CanvasSource, no audio track). Applies to the widescreen Film too.
- **Reel Service:** settings gain `music: {mood, seed?}` — new plans store `{mood: "auto"}`; **jobs without the field play Auto** with a seed from the job id (`jobMusic()` in `reelService.ts`); re-plans keep a music choice made on the board. Board: per job a **"Music: auto (calm) / off / calm / …"** menu and **Re-roll** (route action `music`, `{mood?, reroll?}`); a change sends the job back to planned (not while rendering, not once delivered). The renderer passes it to ReelMaker; the "Made" note shows "music: calm" or the silent reason.
- **Help:** Marketing Tools gained a "Reel — music" step and a quick-ref row ("Add original music to a reel"); the Reel step, the length step and Send-to-my-phone no longer say reels are always silent; Your Reels (gated) says Reel Service reels come with original music (silent on request). **PDF rebuilt** (15 sections, 51 rows). Reel tip (`portalTips.ts`) updated — it said reels are silent.
- **Not verified:** how it actually *sounds* (nobody has listened — first thing to check: Preview each mood on a real listing, and Try another a few times); Safari/iPhone (Safari only recently got WebCodecs `AudioEncoder`; older iOS will render silent with the note); that Instagram/iPhone Photos accept the AAC track (standard AAC-LC in MP4 — expected fine); mediabunny with the whole audio track added before the first video frame (in-memory fast-start, expected fine); preview start delay on a phone (composition runs before playback, ~1–4 s).
- **Files:** new `src/lib/reelMusic.ts`; changed `src/components/ReelMaker.tsx`, `src/lib/reelService.ts`, `src/app/admin/reel-service/{ReelServiceBoard,ReelServiceRenderer}.tsx`, `src/app/api/admin/reel-service/jobs/[id]/route.ts`, `src/app/dashboard/help/page.tsx`, `src/lib/portalTips.ts`, `public/YachtPics_Portal_User_Guide.pdf`. Typecheck and eslint clean. No migration (settings is jsonb).

## Oct 6 — Help page brought up to date + the "Help page rule" in CLAUDE.md — NOT PUSHED (parent will push), NOT BROWSER-TESTED

- **Help (`src/app/dashboard/help/page.tsx`)** caught up with everything brokers got since mid-September: reel looks now list Marquee and Marquee Still (and which looks are reel-only), Marquee Top/Bottom pinning, reel lengths corrected (Full 27 / Long 40 / Short 12 photos — Long was missing), video clips in reels (2–4 s, 3 per reel, 2 on a phone, not on Stack), the two included reels per listing and what counts as using one (Billing), the Office plan (Brokerage → Billing), Team page for inviting assistants, photo areas incl. Port/Starboard Engine Room and Electrical Panel, the phone photo-button row, the download license, installing the portal as an app, yachtpics.com listing pages (YachtPics chooses; pocket listing also takes a boat off the site), and a new Industry News section (15). **"Your Reels" (section 16 + a quick-ref row) is shown only to Reel Service clients** — same test as the sidebar item, worked out per request. The depth-looks line stays release-gated as before. Admin-only things (Reel Studio, Stack Underway, Reel Service board, Brand as YachtPics) are left out.
- **PDF guide regenerated** from the page (`python3 scripts/build_user_guide.py` → `public/YachtPics_Portal_User_Guide.pdf`, 15 sections, 50 rows). It never contains the gated depth-looks line or Your Reels. **After Fri Oct 9:** consider moving the Walkthrough/Underway line into `sections` (and the reel tip) and rebuilding the PDF.
- **New rule in `CLAUDE.md`:** any change a broker or assistant can see updates Help (and the PDF) in the same change; admin-only stays out, gated things are described with their gate or added per viewer; say so in this note.
- **Leftovers fixed too:** the reel tip in `src/lib/portalTips.ts` now names Marquee and Marquee Still and Energy's current cuts (depth looks left out — tips have no date logic); Cinematic's blurb says "the quietest of the looks" (was "of the six"); the listing page's pocket-listing checkbox says it also keeps the boat off yachtpics.com; `src/app/dashboard/brokerage/help/page.tsx` gained section 08 "The Office Plan" (what it covers, Brokerage → Billing, seats; no price) and a quick-ref row.
- **`CLAUDE.md` also gained a "Conventions" section:** this note first; PowerShell (no `&&`, one command per line, exact steps); ES5 tsconfig (no Set/Map spreads or for..of); `requireAdminPage()` / `requireAdmin()`; no scratch files in `src/`.

## Oct 4 — Reel Service (monthly reels for EVERY active listing of enrolled brokers) — PUSHED (444bac6, 6739470), migration APPLIED · Oct 6 tuning NOT PUSHED (parent will push), NOT BROWSER-TESTED

- **Oct 6 — after Charlie's first test (test broker John Doe, one listing, one 276 s walkthrough).** Feedback: some joins too abrupt, some clips too short; the board showed 9–10 segments of 2–4 s, close-in-time segments back to back, one reel on Energy, and **slot 1 and slot 4 had identical segments**. Changes (video-led reels only; broker reels untouched):
  - **Fewer, longer segments:** 6–7 per reel (`MAX_SEGMENTS = 7`), **4–6 s each** (rhythm 5/4/6/5/4/6/5 rotated per reel), **hook 5 s** (the earliest 5 s+ segment on Full tour and Underway & exterior, a seed-chosen early one otherwise). Target ~30–34 s of video.
  - **Photo beats 2–2.5 s** (2.25 / 2 / 2.5 by variant; `settings.photoHoldSec` → ReelMaker `auto.photoHold`), **3 per reel** (4 if needed to split close segments).
  - **Softer joins:** every join into, out of and between video segments is a **0.75 s smooth crossfade** (`settings.clipJoinSec` → ReelMaker `auto.clipJoin`, applied after the look's transitions are dealt, so no cut/flash/whip touches video; Underway's varied joins already skipped clips). Photo↔photo joins keep the look's own. During a crossfade out of a segment its last frame holds (as it always has).
  - **No close-in-time segments back to back:** play order picks, after the hook, the earliest remaining segment at least **15% of the video** away from the previous one (`MIN_ADJACENT_GAP`); where that isn't possible the join gets a photo beat between (`closeJoins` → `videoLedOrder`). Checked: no back-to-back pair under 15% in any planned reel.
  - **Looks:** video-led pool is now **Cinematic, Walkthrough, Underway, Editorial**, with **Classic only as fallback**; **Energy removed**. The board's look menu for a video-led job offers only these.
  - **No reused footage within a listing's month:** each reel's segment seed comes from its **month + slot** (+ a re-plan bump), and the planner first **cuts out every range already used by that listing's other reels that month** (± 0.6 s), then lays segments into the free footage (angle window first, then the whole video). Only if the free footage can't hold even 3 segments are the used ranges ignored — and then the least-overlapping of a dozen placements is taken. On the 276 s test video: 4 reels × 6–7 segments, **zero overlapping ranges**, slot 4 nothing like slot 1. On a short video (75 s) a month of four 30–45 s reels can't avoid some overlap; reel length wins.
  - **Why the duplicate happened:** "Change look" re-seeded segments with `variant × 7 + 3` — 3 for a first Full tour — which is exactly the seed the planner had given slot 4 (its 4th reel). Both seeds now come from month + slot. **Why `inSec`/`footageSec` were null:** the jobs were planned before the video's length was known (it was written to `videos.duration_sec` by the first render). The planner does read `duration_sec`; re-planned jobs now carry real seconds (`inSec`).
  - **Re-planning for tests:** per-job **Re-plan now works on delivered reels** (confirm first; the job goes back to `planned`, off the broker's Your Reels page until made and delivered again; not while rendering). New **"Re-plan all"** on each listing header (admin route action `replan_listing`) re-plans every reel of that listing for the month in slot order as if planned fresh (delivered included, rendering skipped). Note: re-delivering a reel already emailed does **not** email again (email_log dedup is per job).
  - **Typical video-led reel now:** hook 5 s → 6–7 segments of 4–6 s (~30–35 s video) with 3 photo beats of 2–2.5 s, 0.75 s smooth crossfades around video, end card 3 s → **~40–46 s, ~75–80% video**.
  - **Oct 6 (later) — after the re-render ("not all joins are soft", "one photo isn't on long enough"). NOT PUSHED.** Root causes, both in the render path (ReelMaker auto mode), not the planner: (1) only joins *touching a clip* were turned into the 0.75 s crossfade — photo↔photo, photo→end card and (on Underway) its varied dip/soft-wipe joins between photos kept the look's own transition; and every clip **froze on its last frame** for the whole 0.75 s crossfade out (the clip stopped decoding at the end of its turn), which reads as a stop-then-switch. (2) A crossfade plays at the *start* of the incoming unit, so a 2.25 s photo beat spent its first 0.75 s fading in — only ~1.5 s fully on screen (the look's holdScale / length budget were not involved: `photoHold` is absolute and clip holds are fixed). Fixes (Reel Service video-led renders only, i.e. `auto.clipJoin` set): **every** join — between segments, into/out of photo beats, between photos, into the end card — is now a smooth 0.75 s crossfade, and Underway's varied joins are bypassed; **photo beats and the end card get their slot lengthened by the join**, so a beat is fully visible for its whole planned hold (2.25–2.5 s; `VIDEO_LED_PHOTO_HOLDS` now 2.25/2.25/2.5) — on screen 0.75 s fade in + 2.25–2.5 s clean + 0.75 s fade out (under the next segment); **segments keep playing through their crossfade out** (`tailSec` = clipJoin on each clip: the decoder reads 0.75 s past the segment's turn; the renderer and planner leave that much footage after each segment — `SEG_MARGIN` 1.0 s, used ranges include the tail). The opening hook has no join in (first frame), the title fades over it as before. Broker reels: unchanged (`tailSec` 0, no clipJoin). Reels run ~2–3 s longer than before (~43–49 s). To see it: Re-plan all (or just Make again — timing comes from the render, the plan only gains the slightly longer photo hold on re-plan) → Make all → Preview.
  - **Oct 6 (later still) — edits inside the source video; fill-frame video. NOT PUSHED. Migration `supabase/migrations/20261006_video_shot_cuts.sql` NOT APPLIED** (`alter table videos add column if not exists shot_cuts jsonb`). Frame analysis of a rendered reel showed the "too short" moments were **hard cuts inside the edited walkthrough** (galley→salon etc.): segments began ~0.5 s before an edit point. Now:
    - **Shot detection** (`detectShots` in `src/lib/reelClips.ts`, in the admin's browser): decode the whole video at **5 fps, 160 px wide**; each frame's signature = 32-bin luma histogram + 16×9 grid of mean luma; step distance = ½ histogram L1/2 + ½ min(1, 4 × grid mean-abs-diff). A step is a **cut when it is > 0.30 and ≥ 3× the median step within ±2 s** (+0.02) — pans and walking moves raise every step a little, a cut raises one a lot. Each cut is then pinned to the frame by decoding the 0.2 s between the two samples at ~30 fps and taking the biggest jump. Near-black samples (mean luma < 6%) are fades through black and belong to no shot. Cross-dissolves longer than ~0.4 s may be missed (the 0.3 s margin is the cushion). Cost: reads every frame once — a 4–5 min 4K walkthrough is the whole file's download and roughly a minute; done once per video.
    - **Stored** on `videos.shot_cuts` as `{v:1, fps, durationSec, shots:[[start,end],…]}` (route action `shots`), plus a per-session cache. Found by the board's **"Measure videos & find edits (N)"** (which then re-plans the unmade reels of those listings) and, if still unknown, at the **first render** of the video. **Without the column** everything still works: the planner plans as before, the renderer detects at render time and keeps the result for the session (the board says "edits found at render time").
    - **Segments fit to shots:** the planner (`freeIntervals`/`placeInFree`) only lays segments into stretches **inside one shot, 0.3 s clear of each edit** (`SHOT_EDGE_MARGIN`), including the 0.75 s each segment plays through its crossfade out; shots shorter than 3 s are skipped; a segment that lands in a shot shorter than planned is **cut down to fit in whole seconds (not under 3 s)**; the month's no-reuse ranges are subtracted shot by shot. The renderer re-checks every segment against the shots (old plans included): kept as is if it fits; otherwise moved to the nearest shot that holds it (or shortened to fit the nearest, ≥ 3 s), with a note "N segments moved or shortened to stay inside one shot". Simulated on a 276 s video cut into 31 shots: 4 reels, every segment + tail inside one shot with the margins, no overlaps between reels.
    - **Fill-frame video:** in video-led renders on full-bleed looks (Editorial, Walkthrough, Underway, Classic) video segments now **fill the 9:16 frame** — the decoder hands back frames already cropped to 1080×1920 (centred across, 40% from the top down), drawn edge to edge; no "whole" picture on a blurred backdrop. Photos keep their framing (whole photo on the blurred backdrop by default); a crossfade between the two is a plain blend of two full-frame pictures. **Cinematic is out of the video-led pool** (Charlie, Oct 6): video-led reels use exactly **Editorial, Walkthrough, Underway, Classic** (one each per listing per month; Classic no longer "fallback only"); Cinematic stays for photo-led reels. The board's look menu for video-led jobs offers only those four, "Change look" refuses Cinematic for them, and any planned video-led job still on Cinematic gets one of the four on Re-plan / Re-plan all. Broker reels: unchanged (`auto.clipFill` only in Reel Service renders).
    - Board: each listing shows its videos as "<title> · 276 s · N shots detected" (or "edits not found yet").
    - Not verified: the detector on real footage (threshold 0.30 / 3× local median is a first setting — check the shot count it reports against the edit points Charlie knows: 15.0 s, 20.2 s, 33.2 s in the test reel), detection speed and download size on the 4K file, fill-frame crop on the hook with the title over it.
  - **To regenerate Charlie's 4 test reels:** (apply `20261006_video_shot_cuts.sql` first, then "Measure videos & find edits") /admin/reel-service → October 2026 → John Doe → Pomboo → **Re-plan all** → **Make all ready-to-render** → Preview → Deliver (no new email; the reels are on his Your Reels page once delivered).
  - Files: `src/lib/reelService.ts` (segments, order, looks, seeds, used-range exclusion, `replanListingMonth`, delivered re-plan), `src/lib/reelClips.ts` (`ClipLength` adds 5 and 6 — the picker still offers 2/3/4), `src/components/ReelMaker.tsx` (`auto.photoHold`, `auto.clipJoin`), `src/app/admin/reel-service/ReelServiceRenderer.tsx` (passes them; uses planned `inSec` when present), `src/app/admin/reel-service/ReelServiceBoard.tsx` (Re-plan on delivered, Re-plan all), `src/app/api/admin/reel-service/route.ts` (`replan_listing`). Typecheck clean.
- **What it is:** a paid add-on (billed outside the Portal; just an admin switch). **Charlie's rule (Oct 4): 4 reels a month for EACH active listing** of an enrolled broker (`reels_per_listing`, default 4, 1–10), leaning on video clips. First clients: a few Northrop & Johnson brokers. A listing's reels in one month must look different from each other — angle, look, photo subset/order, clips and clip moments all rotate.
- **Migration `supabase/migrations/20261004_reel_service.sql` — NOT APPLIED.** Two tables, RLS on both (admin all via `is_admin()`; brokers read their own rows):
  - `reel_service_subscriptions` (broker_id PK → profiles, enabled, **reels_per_listing** int default 4 check 1–10, started_at, note, updated_at). Broker reads own row.
  - `reel_service_jobs` (id, broker_id, listing_id, period 'YYYY-MM', slot, angle, look, settings jsonb, status planned|rendering|ready|delivered|failed, video_path, storage_host, caption, error, created_at, rendered_at, delivered_at; **unique (listing_id, period, slot)** — slots are numbered per listing per month; broker_id kept on the row). Broker reads own rows with status ready/delivered. All writes are service-role (admin API routes, cron).
  - plus **`videos.duration_sec numeric`** (nullable; listing video lengths for the planner, measured in the admin's browser).
- **Planning** (`src/lib/reelService.ts`, `planReelServiceMonth(admin, period)`): for each enabled subscription, for each of the broker's **active listings with ≥8 visible photos**, creates the missing jobs up to `reels_per_listing` for that listing + month (idempotent; the unique slot index stops a double run; a listing that goes active mid-month gets its full set on the next daily run). Per listing:
  - **Slot 1 of a listing's first-ever month is its launch reel: a Full tour** (`settings.launch`, shown as "launch" on the board).
  - **Angles:** each reel takes an angle the listing hasn't had this month, in order — **Full tour** (slideshow order, hero first, ~18 spread across the boat), **Underway & exterior** (running/aerial/profiles first, other exteriors, closes on two big rooms), **Inside** (salon, galley, dining, staterooms, heads; opens on an exterior), **Details** (helm, cockpit, flybridge, engine room, electrical, lazarette…; topped up with exteriors). An angle without ≥8 photos of its kind falls back to **another Full tour with a different photo subset/opening shot** (the "variant" — how many reels of that angle the listing has had) and a different look.
  - **Looks:** four different looks per listing per month (never one the listing already has this month), from Underway, Marquee, Cinematic, Walkthrough, Energy, Stack, Stack Underway. Avoids last month's look on the same angle (angle+look pair) and, where possible, last month's looks altogether — but with videos on the listing a clip-playing look wins over that last preference (Stack / Stack Underway play no clips).
  - **VIDEO-LED (Charlie, Oct 4 later: the N&J brokers want more video than photos).** *(Segment counts/lengths, photo holds and the look pool below are the Oct 4 version — superseded by the Oct 6 bullet above.)* When a listing has ≥20 s of usable footage (`VIDEO_LED_MIN_FOOTAGE`; edges trimmed; an unmeasured video counts as 90 s), each reel is video-led: **~28–32 s of video cut into 9–11 segments of 2–4 s** (hook 4 s, then a rotating 3/2/3/4/2… rhythm; at most 14), **3–5 photo beats** (about one per 7 s of video; ~1.25–1.6 s each), title drawn over the opening segment, end card as before → **~38–45 s, ~75% video**. Order: `clip:0, clip:1, photo, clip, clip, photo, …` (`videoLedOrder`; no photo before the second segment). Looks for video-led jobs come only from `VIDEO_LED_LOOKS` = Underway, Cinematic, Walkthrough, Energy, Editorial, Classic (never Stack / Stack Underway / Marquee pair); "Change look" refuses the others for a video-led job and the board only offers those six.
  - **How segments are chosen** (`chooseSegments` in `src/lib/reelService.ts`): skip each video's first/last 5%; an angle narrows an *untitled* video to where it usually is (Underway & exterior: first half; Inside: from 35% on; Full tour/Details: all), widened again if too short; *titled* videos steer it instead (running/aerial/drone/exterior… for Underway & exterior, interior/walkthrough/salon… for Inside) when they hold enough. Segments are shared between videos by usable length; each video's window is cut into equal slices, one segment per slice, placed at a golden-ratio offset from a per-reel seed (the listing's running reel count) — so **no overlaps within a reel**, and the listing's 4 reels a month land on different moments (checked: a 150 s walkthrough gave hooks at 12.1 / 7.9 / 14.2 / 10.7 s and different in-points throughout). Most listings have one long walkthrough, so all segments usually come from that one video, in time order.
  - **Settings JSON** now stores `segments: [{videoId, inFrac, inSec|null, durSec}]` (replaces `clips`), plus `videoLed`, `footageSec`, `unmeasuredVideos`, `needsMoreVideo`, `estVideoSec`, `estPhotoSec`. `order` still uses `clip:N` for `segments[N]`. `inSec` is null when the video's length wasn't known at planning; the renderer measures each video once, uses `inFrac × length`, and pushes any segment that would overlap the previous one later (or drops it if it no longer fits), with a note.
  - **Too little video** (<20 s usable, or no video): planned **photo-led as before** (photos with 2–4 segments threaded through) and flagged on the board **"Needs more video · N s footage"** (or "no video").
  - **Video lengths:** new column **`videos.duration_sec`** (added to the same unapplied migration). Filled in the admin's browser: the board's **"Measure videos (N)"** button (reads each video's header via a signed link, saves the lengths, then **re-plans that month's not-yet-made jobs of those listings** — `replan_unmade` deletes planned/failed jobs and re-runs the planner; ready/delivered jobs are kept; new jobs take the lowest free slots), and every Reel Service render also saves the lengths it measured. Unmeasured listings show a "N videos not measured" badge.
  - **Caption:** templated, no AI — "2019 64' Viking 64 Convertible “Name” for sale in Palm Beach, FL." / a second line that varies by angle and variant (tour / running / interior / details framings, several each) plus a rotating sign-off / up to 5 hashtags.
  - Checked with a mock database (Oct/Nov/Dec on a 28-photo listing with 2 videos): each month got Full tour, Underway & exterior, Inside, Details with four different looks, no angle+look repeated from the month before, clips rotating; a 10-photo listing got four Full tours with four looks and different captions. Re-checked after the video-led change with three listings (150 s measured walkthrough / one unmeasured video / a 15 s video): the first two got four video-led reels a month (9–11 segments, 4 photos, ~77% video by estimate, no overlapping segments, four different video-led looks, none repeating last month's angle+look); the third got four photo-led reels flagged "Needs more video".
- **Automatic:** `/api/cron/reel-service` (new, called every day by `/api/cron/daily`) plans the current ET month — the whole month on the 1st, and any missing slots later (a broker enrolled or re-enabled mid-month, or a listing that went active mid-month, gets its full set for the month). Enabling a broker on the admin broker page also plans this month immediately.
- **Rendering (admin page `/admin/reel-service`, in the admin nav as "Reel Service"):** month picker, "Plan <month>", per job Make / Make again / Re-plan / look picker / Preview / Deliver, and "Make all ready-to-render" (planned, failed, or stuck "rendering"). Jobs render **one at a time in this browser**: `ReelServiceRenderer` builds the listing's ReelSource with the same loader the Listing Reel page uses (extracted unchanged to `src/lib/listingReelSource.ts`), measures each clip (`probeClip`) to set its in-point (an unreadable/too-short clip is left out with a note), then mounts `<ReelMaker auto={…}>`. **ReelMaker change:** new optional `auto` / `onAutoProgress` / `onAutoDone` / `onAutoError` props. With `auto` set it starts from the given look/length/framing/order (clips cut from the listing's videos exactly as "Add to reel" makes them), skips the opening auto-selection, renders once when the encoder check passes, shows only a small live canvas, never claims against the allowance, never watermarks, files no reel_events. Without `auto` nothing changes. The MP4 is uploaded through the existing private-bucket upload (`uploadVideoToPrivateBucket`, single PUT or multipart) with a new target `{ reelServiceJobId }` (admin only) → **R2 private bucket `reel-service/{broker_id}/{YYYY-MM}/{job_id}.mp4`** (overwritten on Make again), then the job goes `ready` (`storage_host = 'r2'`). Any failure marks the job `failed` with the reason and the batch carries on. Leaving the tab mid-batch asks first; a background tab renders very slowly. Depth looks (Walkthrough, Stack Underway) read depth first (~7–9s a photo the first time).
- **Board grouping:** brokers → listings, each listing with its footage badge and "N of M made · K delivered"; jobs by slot, each showing **Video-led / Photo-led · video X s (N segments) / Y photos · ~Z% video · ~T s**.
- **Engine change — segments share one source video** (`src/lib/reelClips.ts`, `createClipInputPool`; `ReelMaker` render): before, every clip opened its own mediabunny `Input` (own range cache, own file parse) for the whole render — the reason for the old cap of 5. Now each render has a pool keyed by source video: the first segment of a video opens it, every segment holds a reference, and the `Input` is disposed when the **last** segment of that video is released (1.5 s after it plays, as before) or when the render ends. Each segment keeps its own small frame sink (frames sized to the frame box; with the default "whole" framing ~1080×608) and its **decoder only runs while that segment is on screen** (the iterator opens on its first frame and closes on release — unchanged). A video that can't be opened fails fast for its later segments (they play as stills). So a reel of ~10–14 segments from one walkthrough holds one Input + one range cache, and at most two decoders at once (during a join). Broker renders: same frames, same output (a broker reel's clips each come from their own video, or share one if cut from the same video); the 3/2 clip caps in the picker are unchanged. The only other ReelMaker change: `auto.videoFirst` lets an auto render open on a clip (the title is drawn over it, as over a title photo); the interactive Reel Maker still always moves a photo first.
- **Delivery:** per job "Deliver", per broker "Deliver next round" / "Deliver all ready", and top-level "Deliver next round (N)" / "Deliver all ready (N)". **Next round** = for each listing, its lowest-slot reel that is ready — so brokers can get one reel per listing at a time (e.g. one a week). Delivering → jobs `delivered` and **one email per person per broker** (`src/lib/reelServiceEmail.ts`, type `reel_service_delivery`): the broker and every assistant linked in `broker_assistants`, skipping `email_opt_out` and missing addresses; dedup via email_log `metadata.jobIds` (nobody is told about the same reel twice). Reels are grouped by listing (the boat once, then each reel): angle, "Watch & download" → `/dashboard/reels#reel-<id>`, and the caption. Usual template, unsubscribe footer + List-Unsubscribe headers.
- **Broker side:** `/dashboard/reels` ("Your Reels" in the dashboard nav, only for a broker enrolled or with delivered reels, or an assistant of one; admins can open the URL and see the latest 60 across everyone). Delivered reels newest first: inline preview (6h signed link), **Download** (fresh signed link with a filename, via `/api/reel-service/jobs/[id]/url`, which checks broker / linked assistant / admin; non-admins only for delivered reels), and on phones **Save or share** (fetch, then a second tap opens the share sheet; falls back to a download), caption with **Copy**.
- **Admin broker page:** new "Reel Service" card (enabled, reels per listing each month, note).
- **Files:** new `supabase/migrations/20261004_reel_service.sql`, `src/lib/reelService.ts`, `src/lib/reelServiceEmail.ts`, `src/lib/listingReelSource.ts`, `src/app/api/admin/reel-service/route.ts`, `src/app/api/admin/reel-service/jobs/[id]/route.ts`, `src/app/api/reel-service/jobs/[id]/url/route.ts`, `src/app/api/cron/reel-service/route.ts`, `src/app/admin/reel-service/{page,ReelServiceBoard,ReelServiceRenderer}.tsx`, `src/app/admin/brokers/[id]/_components/ReelServiceCard.tsx`, `src/app/dashboard/reels/{page,ReelList}.tsx`. Changed: `src/components/ReelMaker.tsx` (auto mode only), `src/app/dashboard/listings/[id]/reel/page.tsx` (uses the extracted loader), `src/lib/videoUploadTarget.ts` + `src/lib/uploadListingVideo.ts` (reel-service target), `src/app/api/cron/daily/route.ts`, `src/app/admin/brokers/[id]/page.tsx`, `src/app/admin/_components/AdminNav.tsx`, `src/app/dashboard/_components/DashboardNav.tsx`, `src/app/dashboard/layout.tsx`. Typecheck and eslint clean.
- **Admin how-to:** (1) apply the migration; (2) broker page → Reel Service → set reels per listing (default 4) → Enabled (plans this month for every active listing); (3) /admin/reel-service → check the plan, change a look or Re-plan anything you don't like → "Make all ready-to-render", keep the tab in front; (4) Preview a few → "Deliver next round" once a week (or "Deliver all ready").
- **Known limits / not verified:** nothing run in a browser yet — the auto render, the clip measuring, the upload to the new key, the share sheet and the email are untested end to end. Video-led renders (10–14 segments) are meant for a desktop browser; memory with many segments is untested (one shared Input per video, one small frame sink + poster bitmap per segment). Two segments of the same video decoding at once during a join relies on mediabunny allowing two sinks on one track (believed fine, untested). Energy's opening "burst" can turn an early photo beat into a flash frame. The segment windows for untitled videos (exterior first half, interior from 35%) are a guess at how walkthroughs are shot. Photo picking relies on categories (a listing whose photos are all "Other" gets Full tour every time, with different spreads). No AI caption (template only). No server render farm — reels only make while the admin page is open. Listings that lose their photos/videos after planning: missing photos are skipped, missing clips left out; Re-plan to refresh. Re-rendering a delivered job isn't offered (Re-plan/Make are hidden once delivered). Old MP4s are never deleted.

## Oct 4 — Listing photo grid on phones: controls no longer cover the photo — NOT PUSHED (parent will push), NOT BROWSER-TESTED

- **Why:** on Charlie's folded Z Fold (~360–390px wide, 2-column grid) the dashboard listing page (`src/app/dashboard/listings/[id]/page.tsx`, used by admins and brokers) showed five 44px white circles (star, drag grip, download, hide, delete) over each ~170px tile, hiding the photo. Touch screens always show them (`hover:none`).
- **Phones (below `sm`, <640px):** download / hide-show / delete moved to a row of small ghost icon buttons (32px tap target, 16px icons, no border or shadow) **directly under the photo**, above the number + category line. Own row rather than inside the plaque because at ~170px the category select would have been squeezed to ~50px. Delete keeps its two-step confirm in that row ("Delete?" · Cancel · Confirm). The star (top-left) and drag grip (top-right) stay on the photo as 28px semi-transparent white corner buttons; the grip keeps the dnd-kit listeners inside the sortable card, so drag-to-reorder works as before.
- **sm and up:** unchanged — 32px white star/grip, hover-revealed action bar over the bottom of the photo.
- **Unchanged:** tap photo = lightbox (or select in select mode); select-mode checkbox (24px, top-left); all controls hidden in select mode. Only `SortablePhotoCard` touched. Typecheck clean.
- **How to test:** phone (or devtools ~375px) → a listing → photos: full photo visible with two small corner buttons; icons under each photo; hide/show, download, delete→Cancel and delete→Confirm work; drag the grip to reorder; tap photo opens the viewer. Then desktop width: looks as before.

## Oct 4 — Admin photo download, phone-first (Save / share full-size photos) — NOT PUSHED (parent will push), NOT BROWSER-TESTED

- **Why:** Charlie wants the listing originals on his phone when traveling, to post, without the hard drive.
- **Where (admin → a listing → Photos):** a **↓ Save** button under every photo (in the Hide / Delete row — always shown, not hover-only); **Download all** next to Select; in Select mode a **Download N** button beside Delete; a **↓ Save** button at the top of the lightbox.
- **Files:** full-resolution originals from the `listing-photos` Supabase bucket — the same files brokers download. URLs are signed fresh (15 min) at the moment of saving with the admin's browser client (falls back to the page's 1-hour URLs), so a page left open still works. No new API route (Supabase storage serves signed URLs cross-origin; the broker zip download already fetches them the same way). No licence modal and no broker `log-download` entry for the admin.
- **Phone** (touch screen + a browser that can share image files — Android Chrome/Samsung Internet, iPhone Safari): the photos are fetched (panel at the bottom: "Getting full-size photos… 3 of 10"), then the panel says "N photos ready" with a **Save / share N photos** button. Tapping it opens the phone's share sheet: Save image / Save to Photos, Instagram, Facebook, etc. (The extra tap is deliberate: iOS only opens the share sheet from a fresh tap, and fetching uses up the first one.) **10 photos per share sheet**: with more, after each share the next 10 are fetched and the button comes back ("Photos 11–20 of 24 ready"). Closing the sheet without choosing keeps the batch to tap again. **Download instead** saves the batch as ordinary files one by one. A phone browser that can't share files gets the files one after another as downloads.
- **Desktop:** one photo → the file; several → a zip (`<vessel>-photos.zip`, JSZip, no compression).
- **File names:** `<vessel>-<NN>-<category>.<ext>`, NN = position in the listing's order.
- **Errors:** plain message in the bottom panel ("Couldn't get the photos. Check your connection…", or "N photos couldn't be downloaded; the rest were saved"). Buttons are disabled while a save is in progress or a batch is waiting.
- **Files:** new `src/lib/photoSave.ts` (share-sheet detection, fetch-as-File with 3 at a time, share, sequential save, zip); `src/app/admin/listings/[id]/_components/AdminListingDetail.tsx` (buttons, bottom panel, lightbox button). Broker side untouched. Typecheck and eslint clean.
- **How to test:** (1) Desktop: a listing → ↓ Save on one photo → full-size file; Select 3 → Download 3 → zip; Download all. (2) iPhone Safari and the Z Fold (folded and unfolded): ↓ Save on one photo → "1 photo ready" → Save / share → Save Image / Save to Photos → check it's in the photo library at full size; Download all on a listing with 11+ photos → two rounds of the share sheet. Try sharing straight to Instagram. (3) Check the panel isn't hidden behind the lightbox. Not verified: HEIC/TIFF originals in share sheets (all listing photos seen so far are JPEG); how many files Instagram/Facebook accept from one share (Instagram may take only some).

## Oct 4 — Subscriber early-access email (`announcement_walkthrough_early_2026_10`), Mon Oct 5 — NOT PUSHED (parent will push), NOT BROWSER-TESTED

- **What:** a second announcement campaign alongside the general Walkthrough launch. Subject "You’re first: two new reel looks, before anyone else", eyebrow "Early access for subscribers", same template as the general email (shared `announcementShell` in `src/lib/announcementEmail.ts`; all its copy in `announcementEarlyHtml` there). The general email's HTML is unchanged.
- **Window:** `DEPTH_LOOKS_SUBSCRIBER_OPEN_AT` (Mon Oct 5 13:00 UTC) → `DEPTH_LOOKS_OPEN_AT` (Fri Oct 9 13:00 UTC), both imported from `depthLooksRelease.ts`. The daily cron's Monday run (~13:00–13:35 UTC) is the first that can send; if approved later it goes on the next daily run up to Thu Oct 8.
- **Approval:** app_settings key **`announcement_walkthrough_early_2026_10_approved`** = `true` (or Approve on /admin/announce). New type, so NOT approved — nothing sends until it is set.
- **Audience:** brokers whose `getEffectiveAccessStatus` passes `isDepthLooksSubscriber` (active: paying Stripe incl. checkout trial, Office plan, comped; not the invite trial), looked up per broker, plus every assistant linked to one of them in `broker_assistants` (an assistant for several brokers qualifies if any one is a subscriber). Same rules as before: role broker/assistant, `email_opt_out = false`, has `display_email`, email_log dedup.
- **General campaign now skips anyone with a `sent` email_log row for the early type** (counted as skipped; shown on /admin/announce as "left out"). Otherwise unchanged (type, window Oct 9–16, approval key, copy).
- **Cron:** `/api/cron/announce` now walks `ANNOUNCEMENT_CAMPAIGNS` (early first, then general), each with its own window / approval / dedup, and returns `{ok, campaigns: {<type>: result}}`. `maxDuration = 60` on it.
- **/admin/announce:** one section per campaign (description, window, approval key, preview, audience count, test, approve, send now with a "can't open yet" warning before each audience's open time). The API (`/api/admin/announce`, still `requireAdmin()`) takes `campaign: <type>`; missing = general launch.
- **Files:** `src/lib/announcementEmail.ts`, `src/lib/sendAnnouncement.ts` (`planAnnouncement`, `getSubscriberBrokerIds`, `runAnnouncementSend(admin, sentBy, campaign?)`), `src/app/api/cron/announce/route.ts`, `src/app/api/admin/announce/route.ts`, `src/app/admin/announce/page.tsx`, `src/app/admin/announce/AnnounceControls.tsx`. Typecheck clean.
- **To do:** push before Mon Oct 5 13:00 UTC; on /admin/announce send yourself a test of the early-access email, then approve it.

## Oct 4 — Subscribers get the depth looks Mon Oct 5; new admin-only look "Stack Underway" — NOT PUSHED, NOT BROWSER-TESTED

- **Subscriber early access (Charlie's call, Oct 4).** Walkthrough and Underway now open to **subscribers from Mon Oct 5 2026, 9:00 AM ET** (`DEPTH_LOOKS_SUBSCRIBER_OPEN_AT = "2026-10-05T13:00:00Z"`), everyone else still from **Fri Oct 9, 9:00 AM ET** (`DEPTH_LOOKS_OPEN_AT`, unchanged), admins always. New in `src/lib/depthLooksRelease.ts`: `depthLooksOpenFor({ isAdmin, isSubscriber }, now?)`, `msUntilDepthLooksOpenFor(...)`, `isDepthLooksSubscriber(status)`.
  - **"Subscriber"** = the app's existing access answer, `getEffectiveAccessStatus` (`src/lib/brokerAccess.ts` — own plan or the brokerage's Office plan, the same lookup behind `/api/subscription/status`, the social post gate and the reel allowance), taken at status **`"active"`**: a live Stripe subscription (incl. a Stripe checkout trial), an active/trialing Office plan, or a hand-unlocked **comped** account (status active, no Stripe id — e.g. Miles Yacht Group). Unlike `hasAccess()`, it does **not** count the invite trial (`trial_active`/`trial_expiring`) — those brokers get the looks Oct 9. One-line change in `isDepthLooksSubscriber` if Charlie wants trials in.
  - **Whose plan:** the listing broker's (like the social page and the allowance). The listing reel page asks `/api/subscription/status?brokerId=` alongside its other loads and passes `isSubscriber` to ReelMaker in `source`. A viewer the route refuses (not the broker or a linked assistant — e.g. a co-broker or brokerage admin) or a network hiccup = not a subscriber → looks on Oct 9.
  - **ReelMaker:** still reads the release after mount (no hydration mismatch); a page left open over the viewer's instant (Oct 5 for a subscriber, Oct 9 for everyone else) picks the looks up about a second after it. A broker not yet entitled who somehow has a depth look selected falls back to Editorial. Reel Studio is admin-only, unchanged.
  - **Help page:** the Walkthrough/Underway line shows for a subscriber from Oct 5, everyone from Oct 9 (and admins always). It only queries the database between Oct 5 and Oct 9.
  - **Unchanged:** the announcement email and its window (`src/lib/announcementEmail.ts`), and the `/admin/announce` "brokers can't open the looks yet" warning (still about the Oct 9 general release, still accurate).
- **Stack Underway (admin-only, always).** New look `stack_underway` right after Stack: "Stack's three frames, with the main photo moving in depth." Stack's layout, palette, type, timing and joins are shared (`STACK_LOOK` in `reelStyles.ts`) and it deals exactly Stack's timeline for the same photos (the seed uses "stack"). **Judgement call:** Stack's three bands are equal height — there is no larger band — so "the main photo" was taken as **every full-frame photograph** (the title photo, the breathers between runs, the landing) **plus the middle band of each run** (`STACK_MAIN_ROW = 1`, the centre of the frame). Those get the depth engine's camera move (same engine and move choice as Walkthrough/Underway, on the same drift clock as Stack's push; the outgoing middle-band photo holds where its move ended during a swap). The top and bottom bands keep Stack's push — no depth on them. The engine's frame is the photograph's own size and every pixel in it is inside the photograph (its overscan), so it covers the band exactly as the bitmap did and never shows past the photo's edge. **"Reading depth…" reads only the main photographs** (full-frame + middle band), in the order they first play. No WebGL2 / unreadable depth / slow software GL → Stack's normal motion for those photos; never errors. Memory: same engine, disposed in the render's `finally`. Reel-only (switching to film falls back to Energy, as Stack does). New style fields `stackDepth: "main"` and `adminOnly: true` (deliberately not `motion: "depth"`, so it isn't part of the broker release); a broker never sees it and one who somehow has it selected falls back to Editorial. No clips (same as Stack). `LOOK_LABEL` "Stack Underway" in /admin/reels.
  - **Oct 4 (later) — Underway's wipes and dips (Charlie, after testing).** Stack Underway now has `joins: "varied"`; the choice is one shared helper in ReelMaker (`variedJoin`: dip to the ground between outside and inside, else soft wipe in the camera's direction after a glide, else smoothstep dissolve), used by Underway (unchanged behaviour) and Stack Underway. **Between units** (title → first run, run ↔ full-frame breaks, into the landing): that choice, at the length Stack dealt the join, so the timeline and running time are Stack's. A run is judged by its **middle band** — the photo it opens on coming in, the one it ends on going out. **Into the end card:** ordinary dissolve. **Inside a run** (each swap, Stack's 0.24s, clipped to its band): the **middle band** takes the full choice (dip / soft wipe after a glide / dissolve); the **top and bottom bands** dip on an outside↔inside change, otherwise keep the move Stack dealt them (whip, push, fade, hard wipe). The bands filling in at the start of a run keep Stack's whip-in. Top/bottom bands' slow push unchanged. A band dip at 0.24s is a quick blink through the ground — if it reads as a flicker, the easy change is side bands back to Stack's swap only. Plain Stack, Underway and Walkthrough unchanged. Files: `src/components/ReelMaker.tsx`, `src/lib/reelStyles.ts`. Typecheck clean. NOT PUSHED, NOT BROWSER-TESTED.
- **Files:** `src/lib/depthLooksRelease.ts`, `src/lib/reelStyles.ts`, `src/components/ReelMaker.tsx`, `src/app/dashboard/listings/[id]/reel/page.tsx`, `src/app/dashboard/help/page.tsx`, `src/app/admin/reels/page.tsx`. Typecheck clean.
- **How to test:** (1) admin → a listing → Reel → **Stack Underway** → Make the reel: "Reading depth…" for the main photos only, then the title photo, the full-frame breaks, the landing and the middle band should move in depth while the top/bottom bands push as in Stack. Compare with Stack on the same photos — same order, cuts and timing. (2) Broker on a subscribed (or comped/office-plan) account: before Mon Oct 5 9am ET no Walkthrough/Underway; from then both, plus the help line. (3) Broker without a plan (or on the invite trial): nothing until Fri Oct 9 9am ET, then both. (4) Any broker: never Stack Underway. To test before the dates, temporarily edit the constants locally.


## To do — after the Oct 9 depth-look launch

- **Stack Underway — built Oct 4, admin-only** (see the Oct 4 entry). After launch: Charlie to review, then decide whether to open and announce it as a new look.

- **Oct 2 — Depth looks open to brokers Fri Oct 9, 9:00 AM ET (subscribers Mon Oct 5 from the Oct 4 change); Walkthrough announcement campaign APPROVED (app_settings). PUSHED Oct 3 (fa09653).**
  - **Release:** `DEPTH_LOOKS_OPEN_AT = "2026-10-09T13:00:00Z"` and `depthLooksOpen()` in the new `src/lib/depthLooksRelease.ts` (Charlie's call, Oct 2). From that instant every broker sees **Walkthrough** and **Underway** in the reel's look picker; admins always do. Before it, a broker who somehow has one selected falls back to Editorial. `WALKTHROUGH_ADMIN_ONLY` is gone. The ReelMaker reads the release after mount (no server/browser mismatch) and a page left open over the instant picks the looks up about a second after it. **To move the date:** edit that one line.
  - **Help page** (`/dashboard/help`, Marketing Tools): one new line on Walkthrough and Underway, after the list of looks — shown only once the release time has passed (worked out on each request). The PDF user guide is untouched. The existing "pick a look: six styles" line and the reel tip email in `portalTips.ts` still list only the original six looks (no Marquee, no depth looks) — left as they were.
  - **Announcement** (`src/lib/announcementEmail.ts`): `announcement_walkthrough_2026_10`, subject "Your listing photos now move like you’re aboard", eyebrow "New in the Portal", headline "Your listing photos, now a walkthrough". Window **Fri Oct 9 13:00 UTC → Fri Oct 16 13:00 UTC** (it opens at the same instant the looks unlock, never before): the daily cron (~13:00–13:35 UTC, 9am ET) first runs inside it on Friday morning. **It is a new type, so it is NOT approved — nothing sends until Approve is clicked on /admin/announce.** Same mechanism as before (window + approval switch + email_log dedup). The website campaign (`announcement_website_2026_10`, sent to all 150 on Oct 2) and its proof-line constants are now in git history. `/admin/announce` gained a one-line description of the campaign and, until Oct 9 9am ET, a warning above "Send now" (which ignores the window) that brokers can't open the looks yet.
  - **To do:** Send yourself a test from /admin/announce, read it, then Approve. Expect it to go out Friday Oct 9 around 9am ET.

## Oct 2 — Walkthrough and Underway, the depth-motion looks — v3 — PUSHED and live Oct 2 (commit 6ce56d6) · admins only until Fri Oct 9 9:00 AM ET

- **Live.** Pushed to production on Oct 2 as one commit, 6ce56d6 (the three cloud commits v1–v3 squashed). Charlie's first real render, on his phone: Walkthrough, 21 photos, a 51-second reel, 111 seconds in total to make it. It looked good. He may want longer holds later — left as they are for now.

- **What they are.** Two new looks after Cinematic in the picker, on reels and films: **Walkthrough** ("The camera moves through each photograph. Depth, not a zoom.") and **Underway** ("Walkthrough's moves with wipes and dips between rooms. Made for social."). Every other look moves a photograph by enlarging it — the chair and the window behind it grow together. These move a camera *through* the photograph: near things grow and shift faster than far things, which is what reads as being aboard. **Every pixel on screen is sampled from the photograph; nothing is generated or filled in.** The camera never looks past the photograph's edge: each move is enlarged just enough (the overscan) to stay inside it, and a test marches every move on every test photo to check that.
- **How it got here (all Oct 2, three commits):** v1 was a gentle forward push. Charlie: "looks good, but not enough movement — more 3D". v2 made the move bigger, added a sideways arc and snapped the depth map's edges to the photograph's edges so objects move as solid pieces. v3 (this) gives each photograph its own camera move from a small vocabulary, and adds Underway. Charlie approved a rendered sample (Short Story, ten shots) of exactly this behaviour; the browser code is a port of that sample's Python.
- **The moves** (full strength; `MOVES` in `src/lib/depthMotion.ts`): **push_arc** (walk in on an arc: push 0.17, slide 0.035), **pull_arc** (the same, walking back out), **glide** (slide past: push 0.06, slide 0.075), **rise** (push 0.09, lift 0.05), **diagonal** (push 0.12, slide 0.045, lift −0.03). Push = forward travel as a fraction of the distance to the nearest surface; slide/lift = sideways/up-down travel, end to end, as a fraction of the frame. The sideways drift alternates direction photograph to photograph.
- **How a move is chosen** (per photograph, in play order): interiors work through push_arc → glide → diagonal → rise → pull_arc; exteriors through glide → pull_arc → rise → diagonal → push_arc; the list is rotated by the photograph's place in the reel, and the previous photograph's move is skipped (never the same move twice running). Each candidate is tried on the CPU at low resolution and given a **tear score** — how much of the frame would show stretched picture where there is detail, in %. A move is scaled by m = min(1, 0.9 ÷ score) and taken if m ≥ **0.6** (`SCORE_FULL = 0.9`, `MIN_SCALE = 0.6`). If no move qualifies — typically thin or mirror-like things close to the lens, like stainless rails, stanchions and poles, which tear under any strong move — the photograph gets the **gentle** move (push 0.09, slide 0.012, played backwards on an exterior) on a softened depth map that puts any stretching beside objects rather than on them. `FAR = 8`.
- **Underway's joins** (Walkthrough always dissolves): between two full-frame photographs, stepping between **outside and inside** the boat (either way) is a **dip to the ground colour** (out by 45%, back from 55%); otherwise, coming out of a photograph whose camera **glided**, a **soft wipe** (22%-wide feathered edge) travelling the way the camera was moving; otherwise a **dissolve**. Same length as the dissolve, so the timeline and the "about N seconds" readout are unchanged. Without depth (flat-zoom fallback) there is no glide, so dips and dissolves only. Joins into or out of a **video clip**, and into the **end card**, keep the ordinary dissolve. The **title photograph** joins the next photograph by the same rules (as in the approved sample); its title timing is unchanged. Exterior/interior comes from the photo's category (`isExterior`).
- **How it works, plainly.** When a depth-look render starts, the page reads the depth of each photograph with a small depth model that runs **in the broker's own browser** (no service, no upload, no per-video cost) and chooses its move; the heading says **"Reading depth…"** with a percentage (about 7–9s a photo here; phones read a smaller image). Then a WebGL shader moves the camera frame by frame. What doesn't depend on the order (the depth, the edge-snapped map, the contrast map, each move's tear score) is kept for the session; the moves themselves are re-chosen each render, so "Make it again" skips the model and takes well under a second a photo.
- **Who sees them:** admins always; subscribers from **Mon Oct 5 2026, 9:00 AM ET** (`DEPTH_LOOKS_SUBSCRIBER_OPEN_AT`, Oct 4 entry); every broker from **Fri Oct 9 2026, 9:00 AM ET** (`DEPTH_LOOKS_OPEN_AT` in `src/lib/depthLooksRelease.ts`, see the entry above — this replaced the `WALKTHROUGH_ADMIN_ONLY` constant that shipped in 6ce56d6). Covers every look with `motion: "depth"` (both). Before then a broker doesn't see them in the picker, and a broker who somehow has one selected is put back on Editorial.
- **The looks' settings** (`src/lib/reelStyles.ts`, one shared `DEPTH_LOOK` so a palette change lands on both): Cinematic's palette and type (black ground, wide-tracked serif caps, `#c9b183` accent), full-bleed (`backdrop: "scrim"`), no thirds, no burst, `motion: "depth"`, `zoom: 0.085` (only the flat-zoom fallback). Walkthrough `holdScale: 1.25`; Underway `holdScale: 1.15` and `joins: "varied"`. Per-photo holds — **Walkthrough:** reel Short 2.13s (1.81s at 12 photos), Full 2.38s up to 18 (1.59s at 27), Long 2.38s up to 26 (1.56s at 40); film 3.25s. Running times: Short ≈23–28s, Full ≈34–50s, **Long ≈53–69s**, film 18 photos ≈65s. **Underway:** reel Short 1.95s (1.67s at 12), Full 2.18s up to 18 (1.46s at 27), Long 2.18s up to 26 (1.44s at 40); film 2.99s. Running times: Short ≈22–26s, Full ≈32–46s, **Long ≈49–64s**, film 18 photos ≈60s. Long goes over 60s with 26+ photos on both.
- **Falls back, never fails.** No WebGL2 or module workers, the model won't load, a photograph whose depth can't be read, a lost GPU context, or a machine drawing WebGL in software (one frame slower than 120ms after the first photo is read) → those photographs (in the software case, the whole reel) get the ordinary flat zoom. The render never errors because of it.
- **Memory.** Every prepared photograph keeps its 960px depth map on the GPU (~1.0–1.2 MB each in R16F; ~41–49 MB for a 40-photo Long reel), released when the render ends. The session cache keeps up to 40 photographs' depth + contrast maps in half floats (~2.1–2.5 MB each, ~85–100 MB at most). Photo textures: at most 3 at once (~13 MB each).
- **Files.** New: `src/lib/depthMotion.ts` (the engine — worker client, depth post-processing, contrast map, tear score, move choice, overscan, WebGL2 ray-march shader, caches; loaded with a dynamic import only when a depth look's render starts), `public/depth/v1/` (`depth-anything-v2-small-q8.onnx` 27.3 MB — Depth Anything V2 Small, Apache-2.0, from Hugging Face `onnx-community/depth-anything-v2-small`; `ort.wasm.min.mjs`, `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.wasm` 14.2 MB — onnxruntime-web **1.30.0**, MIT, copied from the npm package, NOT in package.json; `worker.mjs`; `README.md` with hashes and re-fetch URLs). Changed: `src/lib/reelStyles.ts` (the two looks, `motion` and `joins` fields), `src/lib/reelTransitions.ts` (new `softwipe` type, `timing: "smooth"` curves for dip and dissolve, optional scratch canvas — every existing transition unchanged), `src/components/ReelMaker.tsx` (picker gate, "Reading depth" step with each photo's exterior/previous move/turn, speed check, `drawPhoto` uses the engine's frame with the zoom held at 1, Underway's join choice, scratch canvas released in `finally`), `src/app/admin/reels/page.tsx` (`LOOK_LABEL` "Walkthrough", "Underway"; metrics already record `look`), `next.config.mjs` (`/depth/:path*` served `public, max-age=31536000, immutable` — the folder is versioned, so a new model goes in `/depth/v2/`). `public/sw.js` unchanged.
- **First depth-look render on a device downloads ~41 MB** (model + runtime) once; after that the browser cache serves it.
- **Verified in the cloud sandbox** (headless Chromium 141, software WebGL — SwiftShader, production build), on the ten Short Story shots in the sample's order, fed exactly as the Python sees them (1920×1080):
  - **Moves chosen:** the browser matched the Python run with the same model and input size (q8 at 392) on 8 of 10 shots. The 2 differences are scores sitting right on the 0.6-strength line (score 1.5): shot 2 (aft deck, 001) — browser rise 1.51 → gentle, Python 1.46 → rise at 0.61 strength (the sample Charlie saw, made with the bigger fp32 model, also chose gentle there, 1.61); shot 10 (flybridge, 100) — browser push_arc 1.48 → push_arc at 0.61 strength, Python 1.58 → diagonal (the approved sample also chose diagonal). Small differences in how the browser and Python shrink the photo for the model move these borderline scores by a few percent, so a photograph near the line can land on either move.
  - **Frames vs Python** (same move, same maps): 26–40 dB PSNR, SSIM 0.75–0.99; lowest on the galley (172: the browser's score gave a slightly weaker pull, 0.1375 vs 0.1444) and the master (185: same move, differences in the near plant's and bed's depth). **Bounds:** on all ten shots (and the gentle move), at both ends of each move, every ray lands inside the photograph (worst margin −0.002, i.e. inside).
  - **Transitions:** the real drawing code vs the sample's `blend` on two photographs: dip, wipe left→right, wipe right→left and dissolve at 25/50/75% all 52.6 dB or better (two identical).
  - Depth reading ≈6–7s of model time (≈12s for the first, which loads the model), ≈0.9–1.1s edge-snapped map, ≈0.3–0.45s contrast map, ≈0.17–0.26s per move tried (most photos try one; the aft deck tried four). Re-choosing a cached photo's move: 0.6 ms, or ≈0.27s when it needs a new move's score. Crossfade canvases stay correct; dispose works. `tsc`, `lint` (no new warnings) and `next build` pass.
- **NOT verified here** (Charlie has since rendered a real Walkthrough reel on his phone, see above; Underway in the real page not yet confirmed): a real reel or film rendered through the Listing Reel or Reel Studio page from the sandbox (its Chromium has no H.264 encoder, and those pages need a sign-in) — so Underway's join choice inside the ReelMaker, as opposed to the transition drawing itself, had not run; speed on a real GPU (software WebGL here takes ~0.9–1.8s a frame — that's why the 120ms guard exists); phones; Safari; whether the page stays responsive while depth is read (the work yields between steps, but each step still holds the page for up to ~1s); how it feels at reel speed. Known artefacts, also in the Python: thin hanging things (the salon's pendant lights) show slivers of stretch at their edges; the aft-deck stanchion bends a little even on the gentle move.
- **To check after pushing:** sign in as an admin → a listing → Reel → pick **Walkthrough** → Make the reel. Expect "Reading depth… N%" for several seconds a photo, then the usual encoding. In the video, each photograph should move differently from the one before (walking in, gliding past, rising, a diagonal, walking out), the foreground passing faster than the background. Then **Underway** on the same photos: expect a dip to black where the film goes from outside the boat to inside (or back), a soft sideways wipe after a gliding shot, dissolves elsewhere. Make it again: the reading step should finish almost at once. Sign in as a broker: neither look should be in the picker before Fri Oct 9, 9:00 AM ET; both should be there from then.

- **Sept 30 — Last-call reel follow-up auto-sends Wed Sept 30, 9–10am ET.** `LASTCALL_AUTO_SEND_ON = "2026-09-30"`; `/api/cron/reel-followup` now checks week one and last call separately (window open AND ET date == its `*_AUTO_SEND_ON`) and returns `{week1, lastcall}`; same `runReelFollowUpSend` + email_log dedup, so a hand send first is fine. On Sept 30 `reelPromoDaysLeft()` is 1 → "Last day" subject/copy. /admin/reels Last call card shows the "Scheduled…" line. Must be PUSHED before 13:00 UTC Sept 30.
- **Sept 29 — Reel allowance: two included reels per listing from Oct 1 ET (Charlie's policy).** Open house still ends end of Sept 30 ET (`REEL_PROMO_END`). After it: subscribers (own plan or office plan — same check as `/api/subscription/status`, via `getEffectiveAccessStatus` + `hasAccess`) and admins are unlimited; everyone else gets **2 reels per listing**, free and clean. A reel counts only when it's **taken off the page** (Download, Send to my phone, Save to camera roll, Add film to listing); rendering/previewing is free; re-taking the same render doesn't count again; counting starts fresh after `REEL_PROMO_END`.
  - **Server:** `src/lib/reelAllowance.ts` + `src/app/api/reels/claim/route.ts`. `POST {listingId, renderId}` → `{ok:true, unlimited:true}` (admin / promo / subscriber, nothing written) · `{ok:true, remaining}` (already-claimed render, or a new `reel_events` row kind `claim` with render_id) · **402** `{ok:false, remaining:0}` when two distinct renders are already claimed. `GET ?listingId=` → `{unlimited, used, remaining}`. Access: `assertListingAccess` with co-broker + brokerage-admin. Race between two new renders is settled by re-reading in creation order and backing out the loser (402). `/api/reel-events` still cannot write `claim`.
  - **Migration `supabase/migrations/20260929_reel_claims.sql` — APPLIED to prod Sept 29.** Adds `reel_events.render_id text`; widens the kind check to add `claim` and `save_to_camera_roll` (the camera-roll button had been sending that kind since it shipped and every row was refused with a 400); index on `(listing_id, kind)`; partial unique index on `(listing_id, render_id) where kind='claim'`.
  - **Client (`ReelMaker`):** each finished render gets a `renderId` (`crypto.randomUUID`, fallback). Every take-action calls the claim first; 402 → the actions are replaced by "The two reels included with this listing have been used. Subscribers make as many as they like. See plans" (→ /dashboard/billing); network/5xx/other errors let the action through (console.warn). GET on mount and after each claim drives "Included with this listing: N of 2 left." (non-subscribers, after the promo only). Once used up, new renders preview with the existing watermark. Save to camera roll: if the claim isn't already settled, Safari may drop the share sheet after the network call — the page then says "Tap Save to camera roll once more" (second tap opens at once). Studio (no listingId) never claims. On a metered listing the preview `<video>` gets `controlsList="nodownload"` and no right-click menu, so the player itself isn't a claim-free download path (not a hard lock).
  - **Listing reel page no longer locks non-subscribers** (`locked` is always false there; the old subscription fetch is gone) — the allowance replaces the plan lock.
  - **/admin/reels:** `claim` ("Included reel used") and `save_to_camera_roll` ("Saved to camera roll") labelled in the log; every rollup counts take-action kinds by name, so existing numbers are unchanged.
  - **Last-call email copy** (`lastCallHtml`): "goes back behind the subscription on …" → "The reel open house closes on …" (no longer true under the new policy); added "New this week: add a few seconds of your listing video to any reel." and, before the button, "After the 30th, every listing still comes with two reels, free — make them, keep them, post them. Subscribers make as many as they like." Send window unchanged. NOT PUSHED, NOT BROWSER-TESTED.
- **Sept 24 — Week-one reel follow-up forced quiet + auto-sends Fri Sept 25, 9–10am ET.** `WEEK1_FORCE_QUIET = true` (leads with the new looks, now incl. a "Video clips." item; subject "Two new reel looks and video clips — free until …"); the daily cron calls `/api/cron/reel-followup`, which sends via the same `runReelFollowUpSend` as the admin button only when the week-one window is open AND the ET date is `WEEK1_AUTO_SEND_ON` ("2026-09-25"); email_log dedup means a hand send first is fine. Must be PUSHED before 13:00 UTC Friday. Last call unchanged (hand send).
- **Sept 23 — Reel Studio: "Add photos & videos".** The Studio's top picker now takes photos and videos (`accept="image/*,video/*"`); videos queue in the page (`pendingVideos`) and ReelMaker opens each in the same clip trimmer as "Add clip" (`pendingClipFiles` / `onPendingClipsConsumed` props), one after another, skipping past the clip cap with a note; with no photo yet they wait with "Add at least one photo…". "Add clip" stays. NOT BROWSER-TESTED.

## Sept 23 — Video clips in reels (listing reel + Reel Studio) — NOT PUSHED, NOT BROWSER-TESTED

- **What it does.** A reel can now carry short video clips alongside its photos: **muted, 2s / 3s (default) / 4s each, at most 3 per reel (2 on a phone)**. Each clip counts toward the photo cap and takes its place in the order like a photo (numbered tile, badge **"Clip 3s"**, tap to remove). Built into `ReelMaker`, so both pages have it:
  - **Listing reel (admins only for now — Samantha first; brokers see nothing new until the `admin ?` gate in the listing reel page is removed):** a **Video clips** row shows the listing's videos (by `display_order`, poster = the video's `thumbnail_path` still). Tap one → the trimmer.
  - **Reel Studio:** an **Add clip** button (`<input type="file" accept="video/*">`) → the trimmer. The file never leaves the device.
  - **Trimmer** (`src/components/ReelClipTrimmer.tsx`): muted `<video playsinline>` preview, a slider for where the clip starts, 2s/3s/4s chips, **Play clip** (loops just those seconds) and **Add to reel**. "Add to reel" first *probes* the clip (opens it with mediabunny, checks the browser can decode it, reads one frame at the in-point). If that fails the clip is refused right there with one of two messages: storage/CORS → *"This video can't be read by the browser yet — the video storage needs one setting (admin: run the R2 self-test)."*; format → *"This clip's format can't be decoded in this browser. Re-export it as H.264 or record in 'Most compatible'."* (e.g. HEVC on a browser without HEVC decode).
- **Looks.** Every single-photo look (Editorial, Cinematic, Gallery, Classic, Energy, and the film versions): a clip is one unit held for exactly its length, joined by the look's usual transitions; no drift/zoom on it; whole/fill follows the Framing chips like a photo. Clips are never placed in a thirds slot, a wall or the Energy burst (they play full frame). **Marquee / Marquee Still:** a clip always plays in the **bottom band** (never top; its badge reads a fixed "Bottom"), whole or cropped per Framing; the bottom band's turns are no longer equal shares when clips are in — a clip's turn is its length, photos share the rest. **Stack:** no clips — the clip picker greys out with a one-line reason, and clips already chosen are left out of the Stack reel (with a note) and come back on any other look.
- **Timing.** The title always sits on a photo: if the order starts with a clip, the first photo is moved ahead of it. On a reel, clip seconds come out of the Length's time budget first and the photos share the rest (so Full still lands near 40s); the "about N seconds" readout includes the clips (and says "clips Ns"). A reel needs at least one photo to render.
- **How frames are read (memory).** `src/lib/reelClips.ts`. At render start each clip gets one mediabunny `Input` (`UrlSource` over the signed R2 link — HTTP range requests, only the bytes around the chosen seconds, cache capped at 16 MB; or `BlobSource` for a Studio file) and a `CanvasSink` sized to what the frame needs (cover or contain, never above the video's own size, a pool of 4 canvases). Before each output frame the render loop moves every on-screen clip forward to `inSec + t` on a sequential `sink.canvases(start, end)` iterator — decoded as the render reaches it, never the whole clip up front. A clip being carried out by a transition holds its last frame; 1.5s after its turn the Input is disposed. Everything is also released in the render's `finally`. A clip that can't be opened at render time (or fails mid-render) plays as a still (its first frame / poster) with a note under the preview — it never kills the render.
- **CORS change — ONE-TIME STEP after pushing.** `r2EnsureVideoCors()` in `src/lib/r2.ts` now allows the `range` request header and exposes `Content-Range`, `Content-Length`, `Accept-Ranges`, `ETag` (range requests from JavaScript need these; ETag was already needed by multipart uploads). Nothing applies it automatically. **To apply:** sign in to the portal as an admin, then open `https://portal.yachtpics.com/api/admin/r2/selftest` in the same browser (there is no button for it in the admin pages). It answers with a page of text; look under `privateBucket`. If it says `"ok": true` with **no** `corsNote`, the new rule was written. If there's a `corsNote` ("The API token can't manage bucket settings…"), set it by hand instead: Cloudflare dashboard → **R2** → the private video bucket (whatever `R2_VIDEO_BUCKET` is set to in Vercel; `yachtpics-video` by default) → **Settings** → **CORS Policy** → **Edit**, replace the contents with this, **Save**:

  ```json
  [
    {
      "AllowedOrigins": ["https://portal.yachtpics.com", "http://localhost:3000"],
      "AllowedMethods": ["GET", "PUT", "HEAD"],
      "AllowedHeaders": ["content-type", "range"],
      "ExposeHeaders": ["Content-Range", "Content-Length", "Accept-Ranges", "ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
  ```

  Note the self-test only reaches the private-bucket step (where CORS is applied) if the public website bucket checks pass first.
- **How to check it.** On a listing with a video: Reel → Video clips → tap a video → drag the slider, Play clip, Add to reel → the tile shows "Clip 3s" with its number → Make the reel; the clip should play, silent, for 3s in its place. If "Add to reel" shows the storage message, the CORS step above hasn't taken. In the Studio: Add clip → pick a phone video → same. Try an iPhone HEVC video in Firefox or older Chrome for the format message.
- **Metrics.** `reel_events` has fixed columns and no free-form field, so **clip count is not recorded** (it would need a new `clip_count integer` column + a line in `reelEvents.ts`). `photoCount` on a render row now counts photos only.
- **Files:** `src/lib/reelClips.ts` (new), `src/components/ReelClipTrimmer.tsx` (new), `src/components/ReelMaker.tsx`, `src/lib/reelStack.ts` (`planSingles` `fixedHolds`; `splitMarquee` `clipIndices`; `planMarquee` `clipLens`; marquee unit `bottomStarts`/`bottomLens`), `src/app/dashboard/listings/[id]/reel/page.tsx`, `src/app/admin/reel-studio/page.tsx` (phone detection moved to `detectPhone()` in reelClips; `maxClips` in its budget), `src/lib/r2.ts`. Typecheck clean; nothing could be run in a browser yet.

## Sept 23 — Portal speed (clicks felt slow in the broker demo)

- **Why it felt slow:** only one route (`/dashboard/listings/[id]`) had a `loading.tsx`, so on every other page the App Router kept the old page on screen until the new one had finished all its queries. Worst case `/admin/listings/[id]`: ~14 Supabase round trips awaited one after another.
- **Skeletons:** new `src/components/PageSkeleton.tsx` (`list` / `detail`); one-line `loading.tsx` added to `/dashboard`, `/dashboard/listings`, `/admin`, `/admin/listings`, `/admin/listings/[id]`, `/admin/brokers`, `/admin/brokers/[id]`, `/admin/reels`. The `/dashboard` and `/admin` ones also cover every other page under them that has no skeleton of its own.
- **Parallel reads (same queries, same clients):** `/admin/listings/[id]` went from ~14 sequential waves to 2. `/admin/reels` from 5 to 2. `/admin/brokers/[id]` from 3 to 2. `/admin/brokers` from 2 to 1. `/dashboard` from 4 to 3: the strip's photo signing now runs alongside the broker/assistant reads. `dashboard/layout.tsx` from 3 to 2 for brokers: the subscription is read alongside the profile and ignored for non-brokers.
- **Bundle:** the listing page's `ListingQRCode` (qrcode lib) is now loaded with `next/dynamic`, `ssr: false`.
- **Security fix: admin pages now check the admin role themselves.** Before, the role check lived only in `admin/layout.tsx`, and Next skips layouts on client-side navigation (a request can claim the layout is already on screen), so 15 service-role admin pages were reachable by any signed-in user sending a crafted request. New `src/lib/requireAdminPage.ts`: `getUser()` plus `profiles.role`, redirecting to `/auth/login` or `/dashboard`, wrapped in React `cache()`. All 25 server `page.tsx` under `/admin` call it first, and the admin layout uses it too (one lookup per request when both run). The 9 `"use client"` admin pages read through RLS or call admin APIs.
- **Security fix: `/api/admin/delete-listing` had no auth at all.** `/api` isn't in the middleware, so anyone with a listing id could delete it and its photos. It now calls `requireAdmin()`. The other 41 `/api/admin` routes were checked: all verify admin (via `requireAdmin()` or getUser plus role) before any service-role work. `invite-assistant` also lets a broker invite their own assistant, which is intended.
- **Middleware** (`src/middleware.ts`): the redirect gate for `/dashboard`, `/admin` and `/client` now uses `getSession()` (local cookie read, no Auth round trip) instead of `getUser()`. The comment in the file says it is a redirect convenience, not the security boundary. Cookie refresh is unchanged: an expired token is still refreshed and written via `setAll`. `/auth/login` and `/auth/signup` keep `getUser()`, so a revoked-but-unexpired token can't create a redirect loop.
- **`next.config.mjs`:** `staleTimes.static` 0 → 30 (`dynamic` stays 0). Prefetched skeletons now survive long enough to show instantly on click; data is still fetched fresh every time.
- **Category dropdown query:** `supabase/migrations/20260923_distinct_photo_categories.sql` adds `distinct_photo_categories()` (security invoker, so the same RLS as before). **NOT APPLIED YET.** `/admin/listings/[id]` calls the rpc and falls back to the old all-photos query on error. Until it is applied, that branch costs one extra round trip inside wave 1.
- **Cost of the fix:** on client-side navigation inside `/admin`, each page now does its own getUser plus role lookup (2 round trips). The middleware change takes one Auth round trip back off every protected request.

## Sept 23 — Marquee, a new reel look (reel only)

- **Marquee layout rework after Charlie saw renders (both looks).** Bands on 1080×1920, set as named, commented fields on `mq` in ReelMaker (`top`, `heroEnd`, `titleH`, `bottomH`; `bottomTop`/`bottom` are derived):

  | Band | Pixels | Height | Share of frame |
  |---|---|---|---|
  | Top photo (heroes, cover-cropped) | 192 → 710 | 518px (≈2.08:1) | 10% → 37% |
  | Middle (title) | 710 → 1010 | 300px | 37% → 52.6% |
  | Bottom photo (one at a time) | 1010 → 1730 | 720px (`W / 1.5`, a 3:2 whole) | 52.6% → 90.1% |

  The top photo starts at 10%, under Instagram's header, because the 14% rule is for type, not pictures. The title block is not resized for the 300px band; drawTitle's shrink-to-fit handles it, keeping a 20px minimum gap to each photo. The ordinary block (lead-in, one-line name, spec, location: about 299px drawn) sets at **~87%**, a two-line spec row at ~77% and a two-line name at ~70%. The **bottom band follows the Framing chips again** (they're back for Marquee looks): *whole* (default) = the photo contained on the usual blurred backdrop, cropped to the band; *fill* = cover-crop. The top band is always cover-cropped. **Title centring:** drawTitle now places every line from one set of baseline offsets used by both the draw and the measure (identical positions on every look). On a Marquee the block is centred between the two photos on its *drawn* ink height (`measureText` ascent of the first line + offsets + descent of the last), so the gaps (and the hairlines on the photo edges) are equal above and below.
- **Bottom band is one photo at a time now, not a scrolling strip** (Charlie didn't like the strip; Marquee and Marquee Still both). Each bottom photo fills the full band (whole or cover-cropped per the Framing chips; see above), held for an equal share of the Marquee segment under a gentle drift (40% of the top band's zoom), and cut to the next in ~0.6s, clipped to the band, with a move dealt per cut by `dealMarqueeMoves` in `reelStack.ts`: **crossfade, push left, push up, wipe** (hard edge left→right with a thin accent line) or **zoom-dissolve** (in from 1.08×). The moves are picked evenly and never the same twice in a row, from `seededRandom(seed * 11 + 7)` with the reel's usual `seed`, so preview, export and every render of the same photo set match. They are stored on the unit (`bottom`, `moves`). The strip code (tiles, 4:3 crops, loop) is gone. New padding rule: if **fewer than 2** photos are left for the bottom, the top photos join it too (both looks).
- **Marquee top/bottom badges and manual Top pinning:** while a Marquee look is chosen, each picked photo in the picker shows a **Top** / **Bottom** badge (from the same `splitMarquee` call the renderer makes); tapping it pins photos to the top band (`topIds` → `splitMarquee(…, { topIndices })`, max 4, or 1 on Still), with a one-line explainer, a "Top N · Bottom M" count and **Back to automatic**.
- **Marquee Still** (`marquee_still`, right after Marquee in the picker, reel only, same Film fallback to Editorial): Marquee with the top band held on the cover alone — no drift, zoom or crossfade — and every other photo (profiles/aerials included) in the bottom band, cover added to it if fewer than 2 remain; same bands, palette, type, timing and end card via `splitMarquee(…, { still })` / `heroStill`.
- **Marquee** is the seventh look, after Stack in the picker: *"Hero on top,
  details in the middle, the rest of the boat below, one photo at a time."* A split
  screen that holds for the whole reel while the photographs move inside it.
  **Reel (9:16) only** — hidden on Film exactly as Stack is (the `looks` memo
  filters both out; switching to Film while on Marquee falls back to
  Editorial).
- **Layout (1080×1920).** Three full-width bands between 14% (where
  Instagram's top overlay ends) and 86% (the foot of Gallery's print), ground
  above and below. **Top band** 14–42%: the hero photographs, one at a time,
  cropped to fill, each held for an equal share of the reel with the usual
  slow drift (exteriors pull out, interiors push in) and a ~1s crossfade.
  **Middle band** 42–66.5%: the ground colour with the title block centred on
  it, drawn by `drawTitle` (same fonts, same prepared name/builder/spec/where
  strings, so `subject === "free"` just works), accent hairlines on the top
  and bottom edges; the type fades up over 0.6s and stays, and is kept above
  the 65% type-safe line (a block too tall for the band is scaled down about
  its centre rather than spilling). **Bottom band**: one photo at a time (see
  the first two bullets above; the band percentages there supersede the ones in
  this bullet).
- **Which photos go where** (`splitMarquee` in `src/lib/reelStack.ts`). Top
  band: the first selected photo (the cover) plus any selected **Profiles**,
  **Profiles Running** or **Aerial** photos, in selection order, capped at 4;
  if that finds fewer than 2, the first 3 selected photos. Bottom band:
  everything else, in selection order. If **fewer than 2** are left for it,
  every photo plays there, heroes included, so the band still has a cut.
- **Timing.** `planMarquee` returns one `"marquee"` unit plus the usual end
  card. The marquee unit's length is taken from `planSingles` (the quiet,
  dissolve-only plan for the same photo count, Length and `holdScale` 1), so
  the "about N seconds" readout and the Length budgets hold. Same end card,
  same dissolve into it. No room labels on Marquee (the switch explains why);
  the Framing chips are replaced by a one-line note.
- Admin reel metrics (`/admin/reels`) label the new look "Marquee".
- **Not yet seen in a browser** — typechecks clean, but the first real render
  is the test: check the band proportions, the bottom-band cuts on Short vs Long,
  and a long vessel name in the middle band.

## Sept 23 — video order and the admin slideshow toggle

- **Admins can choose which videos go in the client slideshow.** The admin
  listing page's video cards now have the same **Hide from slideshow / Show in
  slideshow** button and **Hidden from slideshow** badge as the broker page.
  The write goes through a new `PATCH /api/admin/videos/[id]` (`requireAdmin` +
  service role), not the browser client: the repo's `videos` RLS
  (`supabase/videos-setup.sql`) has no admin policy, and an update that RLS
  filters out returns no error — it would look saved and change nothing.
- **Drag-to-reorder on both listing pages (admin and broker).** Each video card
  has the photo grid's grip (`title="Drag to reorder"`); only the grip starts a
  drag, after 8px of movement, so taps on the buttons and the player still
  work on a phone. Dropping writes `display_order = position` for every video.
  Shared component: `src/components/SortableVideoList.tsx`. The broker page
  writes via the browser client and checks rows came back, so a write RLS
  refuses (e.g. a co-broker) reverts with an error instead of lying. Uploads
  still append at the end (`videos.length + i`).
- **`display_order` is honoured everywhere.** Every videos list now sorts
  `display_order ASC NULLS LAST, created_at`: admin + broker listing pages,
  `/s/[slug]` (still filtered to `in_slideshow`), `/d/[token]`, the
  send-to-client email's video links, website publish (`sitePublish.ts`), and
  the gallery readers (`/client/[id]`, `/g/[slug]` + its signed-urls route,
  admin gallery page) for consistency.
- **Backfill migration written, needs applying:**
  `supabase/migrations/20260923_video_display_order_backfill.sql` numbers any
  null `display_order` by `created_at` within each listing (after any already
  numbered rows) and sets the column default to 0.

## Sept 18–21 — reel findability, brokerage admins, and the delivery-email nudge

- **Sept 21 — the Reel Studio subject switch (Yacht / Something else).** The
  Studio no longer assumes the subject is a boat. Above the form there is now a
  two-chip switch, **What's this reel of?** — **Yacht** keeps the existing
  vessel form exactly as it was; **Something else** replaces it with three
  fields, **Title** (required), **Second line** and **Detail**, so a reel can be
  of a product, a panel, an event, anything. The choice and the three fields
  live in the same localStorage draft as the boat fields; a draft written
  before today opens on **Yacht**.
  - **`ListingData.subject`.** The renderer gained an optional
    `subject?: "vessel" | "free"` with `subtitle` and `detail` beside it.
    On `"free"` the title card draws `vessel_name` as the headline, `subtitle`
    where the year/builder/model line would go and `detail` where the
    length/type/staterooms/price row would go — and **skips every vessel
    field**, the location and the asking price included. With both free lines
    blank the headline stands alone: the gap that carried the spec row, and the
    rule inside it, collapses in the **measure pass and the draw pass together**
    (`collapseTrail`), so the block sits where a one-line title should rather
    than hanging above a hole. The price and location chips disappear from the
    maker's own controls for the same reason.
  - **The listing reel is untouched.** `/dashboard/listings/[id]/reel` passes
    no `subject` at all, so every vessel code path runs exactly as before —
    `subject` undefined and `"vessel"` are the same path. The download filename
    still derives from `vessel_name` alone, which the Studio fills with the
    Title, so a free reel saves as its own name with nothing boat-shaped
    attached.

**The reel numbers, read Sept 18.** Nine reels, four brokers, six downloads —
and every one of them on launch day. Nothing since. **Zero Send-to-phone
events** across the whole window, which is the number that says *findability*
rather than *interest*: people who went looking found the tool and used it, and
nobody has stumbled into it since the announcement scrolled off. Charlie is
talking to **Mason Waters** about it.

- **Sept 20 — reel lengths are time budgets now, not holds.** Each length
  aims for a running time and shares it between the photos chosen: **Short
  ~20s / up to 12**, **Full ~40s / up to 27**, **Long ~55s / up to 40**. The
  hold is `clamp((target − title − end) / n, 1.25, holdMax)` — 1.9s ceiling
  (Short keeps its 1.7s), 1.25s floor — so it stays put until the budget is
  full, then tightens as photos are added. **Full with 18 or fewer holds
  exactly 1.9s, as before**; at 27 it's ~1.27s and still ~40s. More than the
  cap means a second reel. (`target` in `LENGTH` reads 24.6 / 41.5 / 57 — a
  touch over the chip's round number because the title photo holds for the
  title, not a beat.) The hold re-derives on every tap, so the seconds readout
  is live. **Film unchanged** (2.6s, 24 photos).
  - **Lazy backdrops.** The blurred "whole photo" plates used to be built for
    every photo before the first frame — a frame-sized canvas each, ~320MB at
    forty. Now `getBackdrop(i)` builds on first use and keeps the six most
    recent (a unit plus its crossfade neighbour is the most ever on screen).
    Drawing is identical. Bitmaps are still held for the whole render: a
    wall keeps earlier photos on screen, a Stack band outlives its swap, and
    every transition redraws the outgoing unit, so "close after its unit" is
    not safe as stated. What *is* safe is done: a `finally` on `render()`
    closes every photo bitmap and the logo and empties the backdrop cache once
    the render is over — finished, cancelled or failed.
- **Sept 20 — Reel Studio, admin only (`/admin/reel-studio`).** Samantha can
  now make a reel from photographs on the phone in her hand, with no listing
  behind it: pick off the camera roll, type the boat's name and a couple of
  facts, render. Same looks, same lengths, same fit options, same brand card
  and end card as the listing reel — because it is literally the same renderer.
  **Nothing is uploaded**; the photos are decoded in the browser and the film
  is encoded there, so it is safe to point at a boat that isn't in the portal
  at all.
  - **The extraction.** The listing reel page's whole body moved to
    `src/components/ReelMaker.tsx`, which takes a `ReelSource` —
    `{ listing, photos, broker, listingId, isAdmin, isOwner, locked }` where
    each photo carries its own `loadBitmap(longEdge)`. A mechanical move: not a
    look, a constant or a line of copy changed. `/dashboard/listings/[id]/reel`
    is now a loader that does all the Supabase work and renders `<ReelMaker>`;
    everything listing-shaped (`track()` rows, Add to listing, the AI caption,
    Send to my phone) is gated on `listingId`.
  - **A phone budget.** On a narrow screen or a low-memory device the Studio
    passes `{ maxPhotos: 12, longEdgeScale: 0.75 }` — twenty-six 2200px bitmaps
    is half a gigabyte in the tab, which a laptop shrugs off and an iPhone does
    not. It can only ever lower the cap the format and length already set.
  - **Save on the phone that made it.** When the browser can share a file,
    the finished reel gets a **Save to camera roll** button — `navigator.share`
    with the mp4, which on iOS offers Save Video. Feature-detected and in
    `ReelMaker`, so the listing reel gets it too.
  - **Deliberately not for brokers.** The reel generator is the reason a broker
    keeps listings in the Portal; a studio that makes reels out of loose photos
    is the one thing that would undo that. This is an internal tool for our own
    advertising, behind the admin layout.

- **Sept 20 — more photos per reel and per film.** The reel gains a third
  length, **Long** — 26 photos at the Full hold, about 55s, still inside the
  30–60s reach band — and the film's cap goes **14 → 24** (~72s at its 2.6s
  hold; it goes to one buyer, not a feed). Samantha needs more photos per
  reel. `reel_length` now carries `"long"` through to `reel_events`
  unchanged.

- **Brokerage admins now get the delivery email.** When an admin notifies a
  broker that media is ready, the broker's brokerage admins are emailed too —
  `/api/email/notify-brokerage-admin`, logged with
  `recipientRole: "brokerage_admin"`. The read routes take an
  `includeBrokerageAdmin` opt-in through `assertListingAccess`, so nothing
  widens by accident. Needed a profiles RLS migration for members of one
  brokerage to see each other —
  `supabase/migrations/20260919_brokerage_members_read_each_other.sql`
  (`same_brokerage()`), applied live.
- **Admin can edit every broker field.** `BrokerContactEditor` +
  `/api/admin/update-broker` — not a subset any more. Assigning a brokerage
  syncs `broker_details.brokerage_name` so the two never drift. The **Valhalla
  label mismatch is deliberate — leave it.**
- **One vessel-type list.** `src/lib/vesselTypes.ts` — 31 types (Power
  Catamaran and Sailing Catamaran included), now the single source for all four
  forms that used to carry their own copy.
- **Social post.** Tag defaults to **None**; "Brand as YachtPics" is
  admin-only; constants live in `src/lib/yachtpicsBrand.ts`. Added
  `public/brand/yachtpics-logo-white.png` — it was simply missing, so the end
  card had been rendering logo-less.
- **Delivery emails now carry a reel nudge.** `src/lib/reelNudgeEmail.ts`, used
  by notify-broker and notify-assistant: a boxed aside under the main CTA,
  promo-aware (it names the free-until date only while the open house is on),
  and skipped on a video-only delivery since reels are built from photographs.
  The delivery email is the highest-intent moment there is — the broker is
  about to post the boat — so the reel is in front of them every time now,
  not just in the one announcement.

**Decided, not built.** After the promo closes, the durable allowance is **two
reels included with every shoot** — that replaces the promo line in the nudge
when it ships. **Custom reel packages stay a separate paid service.** Revisit
around **Sept 30**.

# Previous — September 16, 2026

## Sept 16 — the announcement went out

**Sent 9:27am ET to 145 recipients (109 brokers, 36 assistants), zero failures.**
Subject: *The first reel generator in yachting — free until September 30*. The
open house runs to **Sept 30**; watch uptake on **/admin/reels**.

What shipped before it, in order:

- **Stack is a reel-only look.** It never stacked on film (`planStack` only runs
  when `format === "reel"`), so on film it was Energy under another name. Hidden
  from the picker on film; selecting Film falls back to Energy.
- **Reels show the WHOLE photograph by default** (`SPEC.reel.defaultFit`
  `"fill"` → `"whole"`). Most of what we shoot is horizontal, and a horizontal
  frame cropped to 9:16 loses about two-thirds of itself. Cinematic still
  crops — the letterbox IS its idea and it has no framing choice.
- **Gallery on film:** window 0.54 → 0.63 of frame height, type block set
  smaller and tighter. A 3:2 photo now draws 1021×680 instead of 875×583.
  NOTE: the block is measured in one pass and drawn in another, and the gaps
  were hard-coded in both. Six shared constants now drive both passes
  (`gapNameToSpec`, `gapSpecTrail`, `gapLeadToName`, `padLead`, `padSpec`,
  `footMargin`); for a loose block each equals the old literal, so the other
  five looks are untouched. Change one and change both passes, or the block
  anchors short and draws long and the location line walks off the frame.
- **Reel metrics.** New `reel_events` table + `/api/reel-events` + a `track()`
  beacon on the Reel page. One row per finished render (look, format, length,
  fit, photo count, seconds, brand, render ms) and one per download / send to
  phone / copy caption / add to listing. Admin rows are KEPT and tagged, shown
  greyed and excluded from every total — dropping them would make "no test
  data" and "tracking is broken" look identical. Read at **/admin/reels**.
- **Two follow-ups, built and waiting** on /admin/reels: *One week in*
  (window Sept 21–26) and *Last call* (Sept 27 – Oct 1). The week-one email
  pulls live numbers from `reel_events`, and falls back to a no-numbers variant
  below `THIN_WEEK` (5 brokers / 10 reels) — broadcasting a thin week tells 145
  people nobody bothered. Neither sends on a schedule; read then send by hand.
- **Announce cron now runs DAILY**, not Mondays only. It is gated three times
  (send window, approval flag, email_log dedup), so a daily call is idempotent.
  The approve button used to say "Approve for Monday" over a date already a week
  past; it now names the next real run, computed per page load.

**Vercel Hobby crons fire anywhere inside the scheduled HOUR**, not on the
minute — `0 13 * * *` can land any time from 13:00 to 13:59 UTC, and delivery
is best-effort. The 9am send was still pending at 9:20, so it went by hand.
Do not plan a to-the-minute send around this cron.

## Sept 16 — admin can mark a pocket listing

Charlie: *"everything a broker can do the admin should be able to do as well."*
Pocket listing is `showcase_opt_out`, and the API behind it
(`/api/listings/[id]/showcase-optout`) has always accepted admins — the
CONTROL was missing, not the capability. Samantha (an admin) hit exactly this:
a broker told her a boat was a pocket listing and she could not record it.

- Toggle added to **AdminListingDetail**, beside the website controls.
- **Fixed a real bug found on the way:** the "publish to website" button read
  `listing.showcase_opt_out` from the server prop, so marking a boat private
  left that button live until a reload — on the one control where being wrong
  puts a private boat on the public web. It reads live state now.
- **New: `showcase_opt_out_by` / `showcase_opt_out_at`.** Once admins can set
  the flag, "a pocket listing" stops implying "the broker asked for this" — and
  that is the whole basis for deciding whether clearing it is housekeeping or
  overriding a client's privacy instruction. A NULL setter on an opted-out row
  means the broker: every such row predates the switch. The old copy ("Broker
  kept this a pocket listing", "Broker: pocket listing") was a guess the moment
  this shipped and is now neutral, with the real answer underneath.

**Open:** Samantha to check with Tyler Beckford whether **34 Sea Vee 2009** is
meant to be a pocket listing. Two other Beckford boats from the same upload
session are already marked; that is suggestive, not proof. No exposure either
way — it is not in the showcase, not on the site, slideshow unpublished.


## Sept 16 — Energy's wall, the cross-fade bug, and the admin navigation

### The thirds movement, second pass

Charlie on Energy: *"too fast, and slowing it down won't fix it — the photos need
to stay on screen as they appear."* Right call. At Energy's pace one-at-a-time
reads as flicker; a photograph is gone before the eye settles.

`thirds` is now `"single" | "wall"` per look:

- **Editorial and Classic keep `"single"`** — one at a time, empty ground
  between. Charlie approved this on Natural 9. Under a dissolve there is time
  for the pause to register.
- **Energy runs `"wall"`** — photographs arrive one by one and STAY: top, then
  middle, then bottom, three on screen together, extra beat on the completed
  wall, then it clears. Two walls in an 18-photo reel. 37.7s, still in band.

Two things that mattered in the build, both worth keeping in mind for any
future movement:

1. **The settled photographs must not move.** Cuts inside a wall are pinned to
   hard cuts (`dur: 0`) with the arrival animated inside the unit. Run a
   transition across them and the already-placed photos dip in brightness —
   reads as a glitch.
2. **Each arrival is dealt its own move** from the Stack vocabulary (slide from
   either side, push up or down, fade, wipe), never the same twice running.

Walls are uncaptioned — one room label over three photographs is ambiguous.

### The cross-fade bug the thirds movement introduced

Charlie, on Editorial: *"the next photo shows up then the other fades out. They
should fade in and out at the same time."*

He read it as timing; it was compositing. `drawTransition`'s dissolve drew the
outgoing frame at full alpha and faded the incoming one over it — a true
cross-fade when both fill the frame, because the incoming covers the outgoing as
it arrives. **Two photographs in different thirds never overlap**, so the
outgoing sat at full strength for the whole transition and vanished in a single
frame. `drawTransition` now takes a `disjoint` flag and fades both at once when
the frames don't share pixels. Confirmed good.

### The admin navigation — three attempts, one real cause

This took three goes and the first two were treating symptoms. Worth recording
so nobody repeats them.

**The real cause, in `auth/login/page.tsx`:**

```
let destination = "/dashboard/listings";
if (profile?.role === "admin") destination = "/admin";
```

**Signing in is the only thing in the entire portal that routes to `/admin`.**
The Reel lives at `/dashboard/listings/[id]/reel`, so opening it swapped the
admin nav for the broker one — and with no link back anywhere, signing out and
in again was genuinely the only way home. Charlie had been typing `/admin` on
the end of the URL since the portal was built.

**The fix, in `dashboard/layout.tsx`:** when `role === "admin"`, render
`AdminNav` instead of `DashboardNav`. **The navigation follows who you are, not
which folder the page lives in.** An admin keeps the admin nav everywhere.

Two earlier attempts, both reverted:
- An Admin item added to `DashboardNav` — dead code once an admin never sees
  that nav at all.
- `target="_blank"` on the admin page's Reel link — a workaround for losing the
  nav, left in by mistake after the real fix landed, which is why Charlie
  suddenly got new windows.

**The Seller Report keeps `target="_blank"` deliberately.** `/report/listing/[id]`
has no layout and no navigation — it is a one-page print/PDF document. Opened in
place it strands you. Charlie confirmed: leave it.

### Still to check before the announcement

Classic · Energy's wall · **Gallery on Film** · **Stack on Film** — all on
Natural 9. Editorial is confirmed good.

---

## Sept 15 evening — the reel audit, six fixes, and the thirds movement

**Goal: get the looks presentable and send the announcement.** Charlie's words:
"we can always tweak them later but need to be presentable first."

**The shell is still dead** (the Sept 8 Windows update — `device_bash` reports
"Workspace unavailable"). Claude writes files; Charlie runs `npx tsc --noEmit`,
commits and pushes. Everything below was typechecked in isolation and verified
against the original's error profile — identical, so no new type errors — but
only Charlie's `tsc` sees the real tsconfig.

### Timing, measured rather than assumed

All six looks run through the real `planSingles`/`planStack` at the default
(Full, 18 photos): Editorial 41.2s, Cinematic 45.0s, Gallery 37.7s, Classic
43.4s, Energy 35.3s, Stack 33.1s. **Every one inside the 30–60s band the portal
itself recommends.** Film 31–48s, Short 18–25s. Nothing needed retuning.

### Six defects fixed

1. **Room labels were unreachable on Cinematic and Gallery reels.** Their
   caption belongs in the band above the picture, but on a reel that band holds
   the title for the whole film, and below the picture is Instagram's caption
   zone. The code silently skipped it while still showing the switch — and the
   announcement promises the feature. The toggle now hides with a reason, as it
   already did for Stack. **The design fix is still open:** the band could carry
   the room name from photo two onward instead of the title.
2. **Gallery on film drew a 3:2 photo at 729×486 inside 1920×1080** — the reel's
   0.45-height inset proportion carried over to a 16:9 frame, leaving a postage
   stamp in ~600px of cream each side. Window is now 0.62 height.
3. **Gallery on film had no bottom clamp**, so the location line fell off frame
   on any vessel name wrapping to two lines ("Sunseeker Predator 108" is enough).
4. **Stack on film was strobing** — the fallback routed through Energy's planner
   and re-added the burst and flash cuts Charlie had removed. Now falls back with
   `STACK_VOCAB` and no strobe.
5. **End card printed "Broker"** when a profile had no name. Line omitted instead.
6. **`applyBrand` passed the accent through unchecked.** It carries the end-card
   phone number; a navy logo via "Match my logo" landed near 1.3:1 on Editorial's
   ground — invisible. `legibleAccent` keeps the hue and moves lightness until it
   clears 4.5:1.

### The thirds movement (new, Charlie's idea)

One photograph at a time, landing in the top, middle or bottom third, **never
the same third twice running**, empty ground between. Runs in movements
alternating with full-frame photographs — the title photo, the flash burst and
the landing shot always keep the whole frame. Reels only.

- **On Editorial, Classic and Energy** (`thirds: true` in `reelStyles.ts`), each
  at its own pace. Not on Cinematic or Gallery — their window IS the
  composition. Not on Stack, which already owns the divided frame.
- **Capped at 40% of the film** (`THIRDS_MAX_FRACTION`). The first pass put 11
  of 18 photos in thirds on Editorial and it stopped reading as Editorial —
  which matters because Editorial is the default. Raise the constant for more.
- Placed photos hold 1.15× longer; they're smaller and need the extra beat.
- Room captions follow the photo to whichever third it lands in.
- Verified across photo counts 7–18: zero same-third repeats.

**Then a bug this introduced, found by Charlie on Natural 9 and fixed:** the
dissolve drew the outgoing frame at full alpha and faded the incoming one over
it — a true cross-fade when both fill the frame, but two photos in *different*
thirds never overlap, so the outgoing sat at full strength and vanished in one
frame. `drawTransition` now takes a `disjoint` flag and fades both at once when
the frames don't share pixels. **Charlie confirmed this looks right.**

### Announcement copy

- **"About twenty seconds" was wrong** — that's the Short setting; the Full
  default is 33–45s, and the Reel page itself tells brokers 30–60s reaches
  furthest. Now "around forty seconds — the length the feed actually rewards."
- **Subject names the closing date, not a duration** ("free until October 5",
  read from `reelPromoEndsOn()`), so it can't decay while the email waits.
- **Send window pulled in to Sept 23.** An announcement landing three days
  before the offer closes is worse than one that waits — if that date passes,
  push `REEL_PROMO_END` out and move the send window with it.

### Still to check before sending

Classic · Energy · **Gallery on Film** · **Stack on Film** — all on Natural 9,
which has the specs. A listing without them falls back to the vessel name
"Now Available" with no lead-in and no spec row, and every look collapses into
every other; that is what made Charlie think Classic, Gallery and Cinematic
looked alike.

### Cosmetic, deliberately left

Hairline pulsing slightly on Gallery cuts; a ~10px corner of the outgoing photo
surviving one frame of a diagonal wipe; the Stack band whip-in partly masked by
the transition bringing the run in; the opening spec row still carrying five
facts where the end card was trimmed to three.

### Worth doing after the send

The Reel page could warn when a listing is too thin to render well — the
readiness strip already knows which fields are missing.

---

# Previous — September 9, 2026

Charlie is home from Grenada. Today's session sharpened the Reel, opened it to
everyone for a fortnight, and wrote the announcement. **Committed by Charlie,
not by Claude — the sandbox shell was wedged all session, so nothing here has
been typechecked.** `npx tsc --noEmit` before pushing.

## Sept 15 afternoon — news sources audited and rebuilt

Charlie read the summary drafts: **the voice is approved.** That item is closed.
The remaining news work was the sources, and every one of the sixteen was tested
this afternoon — fetched over HTTP and run through the portal's own `parseFeed`,
not just pinged.

**`src/lib/newsSources.ts` rewritten (committed to the working tree, not pushed;
typechecks clean under `--strict`).**

- **The three `unverified` entries are gone.** BOAT International, SuperYacht
  Times and IYBA have no feed at any address, and none of the three has a dated
  sitemap to fall back on — SuperYacht Times now refuses machine readers
  outright at the Cloudflare edge. They were failing every morning and would have
  gone on failing. The evidence for each is written into
  `PUBLICATIONS_WITHOUT_FEEDS` at the foot of that file so nobody re-guesses
  those addresses in six months. Getting them would mean scraping, which is a
  different job with different manners — worth a conversation, not a quiet start.
- **Three added, all watched returning XML:**
  - **Marine Industry News** (`marineindustrynews.co.uk`) — real trade press,
    ten items inside the three-day window on its own. The closest working
    replacement for what IYBA and SuperYacht Times were meant to supply.
  - **The Triton** (`triton.news`) — the Fort Lauderdale marine-business paper.
    Quiet (newest item July 8), kept for its patch rather than its pace.
  - **Motor Boat & Yachting** (`mby.com`) — thirty items deep, moving most days.
    Covers the motor-yacht new-build ground Yachts International has vacated.
- **YATCO moved to the site-wide `/feed/`** — fuller than the news channel, and
  it publishes in bursts either way (newest item May 27).
- **Two sources are alive but effectively silent:** Yachts International (newest
  item **19 Dec 2025**) and The Triton. Both kept — the addresses are sound and
  cost nothing — but neither should be counted towards the daily intake. If
  Yachts International is still quiet at the end of 2026, retire it.
- **Boats Group 403s from data-centre networks** (a Cloudflare rule on the
  caller's address — even `/robots.txt` is refused; the URL itself is right).
  Left in deliberately: **check `failedSources` after the next run.** If Vercel's
  egress is blocked too it will be named every morning and can be retired then.

**End-to-end result through the real parser:** 177 items parsed, **40 inside the
three-day window**, one failed source (Boats Group). Compare the first run's six.
Forty is exactly `MAX_NEW`, but that is the backfill effect of a cold start — on
a steady daily run the windows overlap and dedup keeps it to a handful. No reason
to raise the cap yet.

**Still open on news:** first Monday digest draft Sept 21. The website upload is
DONE — see below.

## Sept 15 — the website side — UPLOADED AND LIVE (Sept 16)

**The portal is pushed and live.** `portal.yachtpics.com/api/news/public` answers
with real items in the approved voice, so `marine-news.php` works the moment it
lands. (The note above saying the overnight build was not pushed is out of date.)

**DONE. Charlie uploaded all 94 files on Sept 16 and confirmed the Marine Blog
is up and running on yachtpics.com.** Nothing below is outstanding; it is kept as
the record of what went up and why, and as the map if any of it needs redoing.

They were staged in `C:\Users\charl\yachtpics-site\_upload-2026-09-15\` — 94
files, all flat, all bound for the web root. If a future batch goes the same way:
open that folder in FileZilla's local pane, select all, drag across, and show
hidden files or `.htaccess` gets skipped.

Three things the last handoff got wrong, found by checking the live server rather
than the local copies:

1. **The live site was still serving the July 2025 hand-written page** at
   `marine-news.php` — Bezos's *Koru* in St. Tropez. The upload was never done.
2. **There was no nav link anywhere.** The claim that the Marine Blog link
   already pointed at it was false: the live nav is Home / Gallery / Video /
   Clients / Team / Contact, and the only links to the blog sat in the blog
   pages' own footers.
3. **The new `marine-news.php` shipped with three broken assets** — a nav link to
   `videos.html` (404; the page is `video.html`), a logo at
   `images/yachtpicslogo.png` (404) and an `og:image` at
   `images/marine-blog-preview.jpg` (404). All three would have gone live.

What is in the upload folder:

- **90 pages with a "Marine Blog" nav item**, inserted before Contact. Each one
  was fetched from the live server, edited, and byte-compared afterwards: the
  only difference from what the server currently holds is that single `<li>`.
  **This matters — the local copies in `yachtpics-site\` are from April and have
  drifted** (live `index.html` says "Clients" where the local copy still says
  "Boats"), so uploading the local copies would have quietly reverted live edits.
  The 78 per-boat gallery pages under subfolders have no nav and were left alone.
- **`marine-news.php`, restyled.** The PHP logic is untouched — the presentation
  layer was rewritten to use `styles.css`, the site's real header, nav and
  footer, and Cormorant Garamond / Inter on the cream ground with the gold
  accent. It arrived styled like the 2019 site (Verdana, navy, grey nav bar) and
  would have read as a different company's page. Lints clean under `php -l`;
  rendered against the live API it returns 15 items across three days with every
  local link resolving.
- **`marine-news.html` → a redirect** to `marine-news.php` (canonical + meta
  refresh + JS), and **`.htaccess`** gains one line: `Redirect 301
  /marine-news.html /marine-news.php`. Belt and braces — if the host honours the
  301 the HTML is never served; if it ignores it, the page redirects on its own.
- **`sitemap.xml`** gains a `marine-news.php` entry. It did not list the blog at
  all. Note the sitemap carries `lastmod` dates from Sept 13, so if something
  regenerates it, this edit will be overwritten.

**Checked after upload:** Charlie confirmed the Marine Blog is live and working
on yachtpics.com. Still worth a glance if anything looks off later —
yachtpics.com/marine-news.html should redirect rather than show the July 2025
page, and the page writes `news-cache.json` beside itself (one-hour TTL); if the
host forbids the write it costs the cache, not the page.

**Worth considering next:** the page has no "photographed by YachtPics" call to
action on it. A daily-refreshing industry feed is a reason for brokers to return
to the site — there is nothing on it asking them to book a shoot.

## Sept 15 — uploaded, and a watchdog on it

Charlie uploaded and checked the page: **it is live and looks right.**

**The daily refresh is real, verified end to end**, not just assumed from the
config. `vercel.json` has one cron, `0 13 * * *` → `/api/cron/daily`, and the
dispatcher fans out to `news-fetch` every day (one cron rather than several
because Hobby caps a project at two). The live page was showing 5 items from
Sept 15, 9 from the 14th and 1 from the 13th.

Three honest caveats, none of them faults:
- **13:00 UTC is 9am ET only until Nov 1.** After the clocks go back it lands at
  8am ET. Nothing breaks; the feed simply arrives an hour earlier all winter.
- **Up to ~90 minutes of lag** from a story being filed to the site showing it:
  `s-maxage=1800` at Vercel's edge plus the PHP page's own 1-hour
  `news-cache.json`. Invisible on a daily feed.
- **Sept 15's newest item was published 16:15 UTC — after that day's 13:00
  cron** — so that batch came from a hand-triggered run, presumably Charlie's.
  The first fully automatic run to confirm is Sept 16.

**Scheduled task: "Marine Blog freshness check", daily 15:00 UTC (11am ET).**
Read-only. It fetches both `/api/news/public` and `marine-news.php`, compares
them, and stays silent unless something is wrong — one line when healthy. It
raises a flag on: either URL non-200; zero items or the empty state; newest item
over 72h old; newest item over 36h old on a Tue–Sat (the trade press is quiet at
weekends, so Monday sparseness is normal and not flagged); the page running more
than ~3h behind the API, which would mean `news-cache.json` has gone stale or
unwritable on the host; or the nav link disappearing. It carries the likely
causes in rough order — cron not firing, `ANTHROPIC_API_KEY` expired (news-fetch
self-gates to nothing without it, so it **fails silently** — this is the one that
would rot the page unnoticed), bulk RSS failures, or the host blocking the cache
write.

**Why this exists:** nothing in the chain errors when it breaks. The page just
keeps showing the last three days, then quietly empties. Without the check
there is no signal at all.

Its runs will pause for approval if anything needs it — Charlie can set the task
to approve automatically in its settings if a run ever stalls.

## Sept 15 overnight — Industry News (built while Charlie slept; NOT pushed)

Spec: `docs/news-spec.md`. Two Opus build passes + one Opus review; migration
`20260915_industry_news.sql` **already applied to the live DB** via MCP.

- **Daily feed.** `/api/cron/news-fetch` (in the daily dispatcher, 9am ET)
  reads 13 trade-press RSS feeds (`src/lib/newsSources.ts`; 11 marked
  `unverified` — the job's `failedSources` says which to fix), parses with
  `src/lib/rss.ts`, rewrites each item with `summarizeNews` (ai.ts, Haiku) in
  the portal's voice, files to `industry_news`. Items without a date are
  dropped; URLs normalised; 21-day dedup. Hidden ≠ deleted (so it can't be
  re-imported).
- **Portal.** `/dashboard/news` (category chips, load more), "Latest in
  yachting" card on the dashboard (renders nothing until there are items),
  "News" in the broker + assistant sidebars. Admin `/admin/news`: hide /
  feature / add a YachtPics item; AdminNav "News".
- **Weekly piece.** `/api/cron/news-digest` Mondays (ET-gated twice): drafts
  "Yachting this week" from the last 7 days via `draftNewsDigest` (ai.ts) into
  `news_digests` as a draft. Admin `/admin/news/digest` (button on the News
  admin page): edit, Save, Approve & publish, Approve & send (marketing-class,
  opt-out honoured, unsubscribe footer, `email_log` type
  `news_digest_<week>`, dedup), Send test to me. `src/lib/newsDigest.ts`.
- **Website.** `/api/news/public` (no auth, 30-min CDN cache, CORS) feeds a
  NEW `C:\Users\charl\yachtpics-site\marine-news.php` (cURL + 60-min file
  cache) — Charlie uploads that one file to the host; the site's existing
  "Marine Blog" nav link already points at it. The old July-2025 hand-written
  sections are gone by design.
- Not typechecked (shell still dead). Review found no compile errors.
- **Sept 15 morning:** first run filed 6 items (only 2 feeds resolved). Sources
  re-verified: 13 live feeds of 16 (`newsSources.ts`); BOAT International,
  SuperYacht Times and IYBA publish no RSS — left `unverified`. Charlie can
  trigger the run from Vercel → Settings → Cron Jobs → Run (secret is
  Sensitive, can't be revealed). Still to do: Charlie judges the voice of the
  summaries; upload `marine-news.php`; first Monday draft (Sept 21).
  **Superseded by the Sept 15 afternoon audit above — voice approved, the three
  feedless publications removed, three working ones added.**
- **Session hygiene:** this session is very long — start new sessions per
  topic and open with "read docs/where-we-are.md first."

**Charlie, in the morning:**
1. Push (three commands). Vercel green.
2. The feed fills at the next 9am ET run. To fill it now: open Vercel →
   project → Settings → Environment Variables → copy `CRON_SECRET`, then visit
   `https://portal.yachtpics.com/api/cron/news-fetch?secret=<paste>` in the
   browser — it returns a small JSON with counts and `failedSources`.
3. Admin → News: sanity-read the headlines. Hide anything off. Feature one.
4. Broker view: sidebar News, the page, the dashboard card.
5. ~~Upload `marine-news.php` to the web host.~~ DONE Sept 16 — the whole
   94-file batch went up and the Marine Blog is live.
6. Monday: Admin → News → "Yachting this week": read the draft, edit, Send
   test to me, then Approve & send.

## Sept 11 (before the announcement — still unsent)

- **Reply-to mailbox.** Portal mail comes from `hello@yachtpics.com`; that
  address didn't exist (bounced). Charlie created it as an alias in GoDaddy
  Email & Office (Microsoft 365). Test reply received.
- **"Ready" email: pick the recipient.** Admin listing page now has a second
  dropdown next to Photos/Video: *Broker & assistant / Broker only / Assistant
  only*. Button renamed "Send ready email". Broker-only also suppresses the
  assistants' push; assistant-only gives the assistants the push instead.
  Message reports exactly who got it and flags failures instead of hiding them.
- **Both notify routes now require an admin session** (`requireAdmin`) —
  before this anyone with a listing id could fire the email. Subject lines no
  longer show a literal `&amp;`.
- Sandbox shell still dead: it's the Sept 8 Windows update ("Failed to start
  Claude's workspace"). File tools fine; Charlie commits and pushes.
- **Reel polish (rendered every look on Natural 9 and judged the frames).**
  - Sans looks now typeset in Manrope (read from `--font-sans`), system fonts
    fallback only; weights 300/500/600/800 preloaded. Gallery headline weight
    300; Energy 800, tracking -3.
  - Cinematic: window 1.85 → 1.66:1; spec line no longer collides with the name
    (84px name→spec gap for every look, rule or not); room caption sits under
    the picture, centred, in the look's soft colour — never on the photograph.
    Same for Gallery.
  - Gallery: always shows the whole photograph (no square crop), no inner
    margin, title hangs from the photo's real bottom edge; framing chips hidden
    for it.
  - Hairlines 2.2px @ 70% (were 1.4px, invisible after H.264).
  - End card rewritten: vessel name 96/82/68px in the look's own family, weight,
    tracking and casing; broker name 48px regular; brokerage; contact falls back
    to the broker's display_email when no phone/website; more air before
    "Request a private showing". Blurred plate only for full-bleed whole-photo
    mode (was bleeding over Gallery's page on dark brand grounds).
  - Picker text: "quietest of the five", Gallery blurb updated.
- **Transition engine (Sept 12).** Charlie: Energy "too jerky… the
  transitions are just straight cuts… needs random cuts, fades, wipes, cross
  dissolves — high-end CapCut/TikTok." `src/lib/reelTransitions.ts`: vocabulary
  (whip, push, wipe, zoom-through, flash, quick dissolve, dip), weighted deal
  with no repeats and alternating directions, `drawTransition(ctx, …, a, b)`
  composes any two whole-frame draws. `src/lib/reelStack.ts` now builds a
  unified `Timeline` of `units` (photo / stack run / end) + `transitions` for
  every look (`planSingles` for the five, `planStack` for Stack); quiet looks
  dissolve as before. Energy softened: zoom .07, holdScale .9 (~30s Full),
  weight 700, slower snap. Stack uses the same vocabulary between movements.
  Burst slowed to 3 × 0.34s after Charlie: "first 4 or 5 photos flashed by too
  fast, second half looked good."
- **Arc + hold pattern (from the GoPro Quik research).** Energy/Stack holds
  follow `HOLD_PATTERN` [0.65, 1, 1.3, 0.65, 1, 1.6] × base hold (short-short-
  long — the "musical" lever), the flash burst moved from after the title to
  ~55% in (Charlie: the opener "flashed by too fast"), and the last photo
  holds 1.9× (Energy) / 2.6 beats (Stack) as a landing before the card. Both
  resolve into the end card on a flash. Energy Full ≈ 33s, Stack Full ≈ 38–46s.
- **Stack singles + band moves (Charlie).** Full-frame singles in a Stack now
  show the whole photograph on a blurred plate (`wholeOverride` on
  `drawPhoto`); hero + burst stay full-bleed. Band swaps are dealt a move each
  (`BandMove`: left/right whip, up/down push, fade, wipe with seam) — never
  the same twice running; the three arrivals alternate sides.
- **YachtPics ad switch (admin only)** on the Reel page: `YACHTPICS_CARD` /
  `YACHTPICS_COLORS` in reel/page.tsx; wordmark at
  `public/brand/yachtpics-logo-white.png` (Charlie copies it from J:); lead-in
  "Photographed by YachtPics"; CTA "Book your shoot"; both phones; Add-film
  hidden. Broker reels' credit line now "MADE WITH THE YACHTPICS PORTAL".
- **Gallery / Cinematic title persists** for the whole reel (Charlie: "a lot
  of open space that can be used"); windows moved to 42% so a caption above
  the picture clears the location line.
- **Safe zone + length.** On 9:16 reels the title, spec and room captions now
  sit in the band from 16% down (Instagram covers the top 14% and bottom 35%);
  picture below. Letterbox window at 40%, Gallery page at 38%. Block clamps so
  it never enters the picture. New Length chips: Full (~40s, 18 photos,
  default) / Short (~20s, 10 photos), reel only.
- **Stack look + flash burst.** Sixth look `stack` (`src/lib/reelStack.ts`
  plans it): hero + title → 3-photo flash burst (0.34s each, white flash on each
  cut) → **movements**: runs of three full-height bands whip-swapping one per
  beat (3–5 swaps) alternating with one or two full-frame singles, lengths
  from a seeded rng (same boat + photos = same film), photos cycle so the
  film runs to `beat × max(8, n)` (~37s Full, ~23s Short) → flash to end
  card. Charlie's note that drove this: "not all photos should be in a
  stack — some full screen, then the stack, then another photo." Energy gets the same burst opener
  (`hook: "burst"`). Reel only; on film a stack look behaves as Energy.
  Framing + room-label chips hidden for Stack. AI headline no longer cut
  mid-word (word-boundary trim at 48, model asked for <40). Promo end moved to
  Sept 30; announcement send window to Sept 27 — **announcement is on hold
  until Charlie has seen Stack.**

## Today's work (Sept 9)

**The Reel, tightened.** Research first — how Burgess, Edmiston, Northrop &
Johnson and the luxury-real-estate houses actually present listing film, plus
2026 reel-length data. Then:

- **~21 seconds** instead of ~28 (average watch time on a Reel is ~19s, and
  completion rate is what the feed ranks on). Film trimmed to ~41s.
- **Four looks**, each a complete treatment rather than a colour swap —
  Editorial (serif caps on a gradient), Cinematic (letterboxed, slow, nothing
  over the photograph), Gallery (warm off-white, photo inset), Classic (warm,
  title case, lower-left). `src/lib/reelStyles.ts`.
- **Title rebuilt.** Measured as a block and placed as a whole, so a two-line
  name can't climb back into the picture; sits above Instagram's caption
  furniture. Editorial uses Edmiston's grammar — italic lead-in, name in caps,
  terminal full stop.
- **Room labels**, optional and off by default (the top houses don't label).
  Lower-left, transient, skipped on beauty shots.
- **Motion answers the subject** — exteriors pull out, interiors push in, the
  same amount every time. Random per-photo variation is the template tell.
- **Write with AI** — reads the frames actually chosen, in order, and returns a
  headline for the opening frame plus a caption and hashtags. Broker edits
  both; the headline only reaches the film if they tick it. `draftReelCopy` in
  `src/lib/ai.ts`, route `/api/listings/[id]/reel-copy`. Needs
  `ANTHROPIC_API_KEY`.

**Later the same day** (all reviewed by an Opus subagent, still untypechecked):
- **Send to my phone** — rendered reel goes to `reel-shares/<listingId>/` in the
  private bucket, `/api/listings/[id]/reel-link` signs a 24h download link,
  shown as a QR (error-correction L, 224–256px — signed URLs are long) and
  emailed as backup. `/api/cron/reel-share-sweep` deletes copies >48h, from the
  daily dispatcher. The reel itself is the broker's once saved.
- **Brand colours** — `broker_details.brand_accent/brand_ground` (migration
  applied live + saved to `supabase/migrations/20260909_broker_brand_colors.sql`).
  Two colour inputs + "Match my logo" (dominant saturated hue from the logo
  bitmap) + reset. `applyBrand` re-derives text colours only when the ground
  changes. Scrims tint to the ground.
- End card: vessel name + year/builder/model, hairline, then the broker.
  Title holds longer (4.2s reel / 5s film). Panel renamed "Generate your
  headline & caption".

**Evening of Sept 10 — Reel refinements, from Charlie's first real use:**
- Fifth look **Energy** (hard cuts, punch-in, ~15s) for centre consoles and
  sportfish. `cut: "punch"` on the style drives a near-zero crossfade and the
  snap-and-settle zoom.
- Photos play **in tap order** (`chosen` is now an ordered array; number on the
  thumbnail = place in the film). "First N" = slideshow order, cover first.
- Room labels: plain white text with a drop shadow (no gradient), 38px,
  bottom-left of the actual picture (portrait or landscape), on for the whole
  photo, every categorised photo including Profiles. Title photo never gets one.
- Title holds longer (4.2s reel / 5s film). End card: name + year/builder/model
  only. Long lines wrap with their tracking (`wrapTracked`).
- Brand colours save only when the viewer IS the broker (`isOwner`).
- Announcement text updated for all of the above. Build error on Vercel
  (Map iteration) fixed.

**NEXT SESSION — Charlie: "there is a lot more we can do with the reels."**

**First job, Charlie's ask:** put **Send to my phone** on the Social Post page
and anywhere else that generates a deliverable — spec sheet, seller report,
QR code, anything a broker would want on their phone. The reel version
(`reel-shares/` prefix, `/api/listings/[id]/reel-link`, QR + email backup,
48h sweep) is the pattern; generalise the prefix/route so images and PDFs
ride the same rails.

Ideas already on the table, none started:
- Music: parked deliberately (no licensing yet). If revisited: 3–5 licensed
  tracks, beat-synced holds, optional — silent stays the Instagram default.
- Film-look toggle (light grain + vignette).
- Watch Stack on a real centre console (Svengali/Intrepid); tune whip
  speed/smear and burst count from Charlie's reaction.
- Instagram direct publishing: possible via Meta app + App Review (2–4 wks),
  Business accounts only, no trending audio via API. Not started.
- Check with Charlie whether the opening frame's spec row should also trim to
  year/builder/model like the end card did.

**The open house.** `src/lib/reelPromo.ts` — Sept 9 to Sept 30, the Reel
unlocked for every account regardless of plan (nothing else changes). Banner on
the Reel page, "Free" flag on the listing-page button. **Change the dates by
editing the two constants at the top of that file.**

**Help + Tips.** Help covers the looks, the options and Write with AI, with new
quick-reference rows. Six new tips appended (`listing-reel`, `reel-copy`,
`engagement`, `seller-report`, `named-sends`, `tour-and-plan`).

**Announcement.** New campaign type `announcement_reel_2026_09` — the old type
is retired, so nobody is skipped by dedup. Leads on the Reel and the fortnight.
**Unapproved by default: nothing sends until Charlie approves it on
/admin/announce.**

## Competitive position (researched Sept 9)

Worth knowing, and worth using in conversation: **no other yacht platform has a
self-serve reel generator** — not YATCO, not YachtWorld/Boats Group, not
IYBA/Yachtbroker.org, not Rightboat. The nearest thing in yachting is a $499/mo
agency retainer. Per-photo dwell analytics: nobody has it, in yachting or real
estate. Deck plans: zero competitors show them. Denison and Galati each built
an owner dashboard in-house *because no vendor sells one*.

Where we're behind: broker-to-broker eblasts (IYBA sells one at $300/mo,
United blasts 2,000+ brokers), automatic social publishing, and a listing
*score* with benchmarks rather than a pass/fail checklist — Boats Group is
publishing hard conversion numbers on theirs. Ranked recommendations are in the
session transcript; the top three were: make the Seller Report an automatic
weekly email, add an "what your broker did this week" activity feed to it, and
turn the readiness checklist into a score.

---

# Previous — September 6, 2026 (evening)

A handoff note, written so a fresh session can pick up mid-stream. Charlie is
shooting in Grenada Sept 6–9. He asked for a deep-dive on "the next big
thing" (see `docs/next-big-thing.md`), read it, and said build all of it —
so this session did. Everything below is **committed but not pushed.**

## The two things that matter right now

**1. Push.** From `C:\Users\charl\yachtpics-portal`:

```
git push
```

Vercel builds in a minute or two. Nobody else can run it — it needs his
GitHub login. The `_to_delete/` folder at the repo root (git-ignored) holds
lock files and temp objects the cloud session couldn't delete from `.git`;
the whole folder can simply be deleted.

**2. Add one environment variable in Vercel** so the AI features switch on:
Vercel → yachtpics-portal → Settings → Environment Variables →
`ANTHROPIC_API_KEY` = a key from console.anthropic.com → redeploy. Without it
the portal behaves exactly as before (the filename guess, the category
prompt, no Draft button). `ANTHROPIC_MODEL` is optional (defaults to
`claude-haiku-4-5`).

## What shipped today (all five items from the deep-dive)

**Listing Reel** — `Reel` button next to Social Post on every listing.
Turns the photos (slideshow order, cover first) into a 9:16 reel (~28s, up to
10 photos) or a 16:9 film (~54s, up to 14). Title card with vessel name /
builder / length / staterooms / price / location (price and location can be
switched off), slow push-in or "whole photo on a soft backdrop", broker end
card with logo and contact, quiet YachtPics credit. Renders **in the
browser** with WebCodecs via the `mediabunny` package (new dependency) —
no server, no render service, no per-video cost. Silent by design (add
trending audio in Instagram). The film can be added to the listing as a
video in one click ("— The Film"), which puts it in the slideshow and Send to
Client. Watermarked for lapsed plans. Needs Chrome/Edge/Safari; Firefox 130+.
Files: `src/app/dashboard/listings/[id]/reel/page.tsx`, `src/lib/canvasText.ts`.

**Listing Intelligence** —
- Send to Client now has a Client Name field and every send gets a token;
  the slideshow link in the email is `?src=send&t=<token>`. Opens are
  attributed by name: push + email say "Mark opened your slideshow" and Sent
  History shows exact open counts (`client_sends.token/client_name/
  open_count/last_opened_at`). Sends before Sept 7 keep the old "gallery
  viewed since" wording, honestly.
- The public slideshow records per-photo dwell (≥1.5s), a heart to save
  photos (kept in the viewer's browser), video plays, 360° tour clicks,
  Details opens, and a per-session summary (seconds on page, photos seen).
  New table `slideshow_events`; new columns on `slideshow_views`. Route:
  `/api/slideshow/event`. Anonymous — random per-tab session id, no cookies.
- **Engagement panel** on the listing page (views, unique visitors, time per
  visit, saved photos, 30-day bars, "what buyers linger on" with thumbnails,
  where views come from). `src/components/ListingEngagement.tsx`,
  `src/lib/engagement.ts`, `/api/listings/[id]/engagement`.
- **Seller Report** at `/report/listing/[id]` — one letter page, broker
  branded, print / save as PDF, forward to the owner.

**AI at upload** (only when `ANTHROPIC_API_KEY` is set) —
- Photos the filename can't place are labelled by a vision model right after
  upload (the category prompt is skipped). "Label photos" button relabels
  anything still Other; when nothing is Other it becomes "Re-label photos"
  (everything not set by hand). Hand-set categories are never overwritten
  (`photos.category_source` = manual / filename / ai).
  `src/lib/ai.ts`, `/api/photos/categorize`.
- "Draft with AI" on Edit Listing writes a description from specs + six
  photos in the portal's register; lands in the textarea, saved only when the
  broker saves. `/api/listings/[id]/describe`.

**360° tour + deck plan** — `listings.tour_url`, `listings.deck_plan_path`.
Edit Listing has a new section. Slideshow shows a "360° Tour" tab-button and
the deck plan under Details. Tour link is validated server-side (http/https).

**Listing readiness** — the strip under the listing title: 9 checks (12+
photos, cover, labels, 5 core specs, description, published, video, tour,
docs), each unmet one a link to where it gets fixed.
`src/components/ListingReadiness.tsx`.

Help page updated for all of the above. User-guide PDF **not** regenerated.

## Database

Migration applied live on Sept 6 via the Supabase MCP (additive only) and
saved as `supabase/migrations/20260906_listing_intelligence_reel_tour_ai.sql`.

## What to check after the push

1. Open any listing → **Reel** → Make the reel. Expect a progress bar, then
   a playable video. Download it; it should play on a phone. Try Film, then
   "Add film to this listing" → it appears in the Videos section.
2. Send to Client with a name → open the link from the email → the broker
   gets "Name opened your slideshow" and Sent History shows "opened it 1 time".
3. In the slideshow: heart a photo, sit on a few, open Details. Back on the
   listing, the Engagement panel fills in within a minute (flushes every 8s).
4. Engagement → Seller Report → prints to one page.
5. After adding the key: upload an `IMG_1234.jpg` — it should get a real
   category on its own. Edit Listing → Draft with AI.
6. Render Natural 9 in **Cinematic** — the spec line should sit clear of the
   name, and the room caption should be in the black bar, not on the photo.
7. Render **Gallery** — the whole yacht should be visible, with the name below
   it.
8. Watch any **end card** — the boat name should be the biggest thing on it,
   and an email should show when the broker has no phone.

## Open threads (carried forward)

- **Natural 9 video needs its line** — listing
  `576a46c9-3809-41c3-a5cd-c0ae5281a206`, video
  `036be9af-ed02-4b5e-9f78-a6380a3c9c37`. Suggested: **"Natural 9 — The
  Film"** / *Interiors, exteriors, and aerials of this 2009 Sunseeker 121,
  start to finish.*
- **Joe Yeni (joe@yenimarine.com)** — warmest subscription prospect;
  downloads are always free, the subscription is for the tools (and now the
  Reel and the Seller Report are two more reasons).
- Video cleanup cron activates Sept 7; a scheduled task on **Sept 8** checks
  it freed ~27 GB.
- Parked: site-photos bucket to Cloudflare; boat-page SEO; Brian Nopper site;
  the closing-gift feature (GROWTH_IDEAS §7) — the moat, next in line.

## Habits worth keeping

- Verify against the real thing before declaring victory. This session could
  only typecheck and lint (no browser, no `next build` — the Linux VM has the
  Windows swc binary); the checks above are the real test.
- When something fails, say the actual reason.
- Copy before delete, verify bytes, and put a gap between the two.
