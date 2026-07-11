# YachtPics Portal — Growth & Marketing Ideas

## ★ NORTH STAR (the one thing everything serves)
**Be the easiest and most professional media-delivery portal in yachting — the default brokers think of first.**

- We do NOT compete with YachtWorld / Yatco on listings. We compete — and win — on **media delivery**.
- **Ease of use is the product.** Brokers say sending photos/listings from other systems is so painful they hand it to an assistant or give up. That pain is our wedge.
- Every feature/decision passes one test: *"Is this the fewest-taps, most professional way a broker could send their media?"* If it adds a step, a decision, or friction, it's wrong.
- Keep the assistant workflow first-class (it already is): "so easy you won't need to hand it off — but if you do, your assistant will love it too."
- Guardrails when building: one-tap send, one-click publish, no manual resizing, no zip files, no version confusion, no jargon, mobile-first.

---


A running list of strategic initiatives to revisit. Not scoped or scheduled yet — captured so we don't lose them.

---

## 1. Start a blog
**Why:** Owned content engine — fuels SEO, gives the public side of the portal something to rank for, and positions YachtPics as the authority (not just a vendor).

Open questions / things to figure out:
- Where it lives (portal.yachtpics.com/blog vs. yachtpics.com/blog) — SEO implications of each.
- Audience split: posts for **brokers** (how to market a listing, sell faster) vs. posts for **buyers/owners** (boat-buying guides, what makes great listing photos).
- Cadence and who writes it (us, ghostwritten, AI-assisted with our review).
- Topic seeds: "how to photograph a yacht for sale," "what a buyer looks at first," "spec sheets that sell," broker tips, market/season pieces.
- Tie-in: each post can funnel to the portal's public features (slideshows, flyers) and to a broker signup.

## 2. Market the portal to ALL yacht brokers — not just the ones we shoot for
**Why:** Today the portal grows only through our shoot clients. The bigger opportunity is brokers who upload their own listings and use the marketing tools (flyer, social, QR, leads) — a self-serve growth channel independent of our camera schedule.

Things to figure out:
- The pitch to a broker we *don't* shoot for: "bring your own photos, get instant marketing tools + a branded client portal." What's the hook?
- Pricing/packaging for self-serve brokers vs. shoot clients (do they differ?).
- Onboarding path for a cold broker who's never worked with us.
- Channels: brokerage outreach, boat shows, referrals, the blog/SEO, social.

## 3. Drive the PUBLIC side of the portal — what can it feed to get traffic?
**Why:** The public surfaces (slideshow pages `/s/[slug]`, gallery pages) are already out on the web. Question is what else the portal can expose/syndicate to pull in organic traffic and become a destination, not just a delivery tool.

Things to explore:
- SEO on public slideshow/listing pages (titles, meta, structured data / schema.org `Vehicle`/`Product`, sitemap of public listings).
- A public, browsable "listings" or "featured boats" directory (opt-in by brokers) that search engines can index.
- What can the portal *feed*: an RSS/JSON feed, share-to-social, a public "recently listed" showcase, embeddable widgets brokers can drop on their own sites.
- Cross-link the blog ↔ public listings ↔ broker signup to build an organic funnel.

## 4. Infrastructure: upgrade Vercel to Pro
**Why:** The portal currently runs on Vercel's **Hobby** plan, which has real ceilings we're starting to hit.

- **Cron jobs:** Hobby allows only 2. We hit this — the announcement and tips crons silently didn't run until we consolidated everything into one daily dispatcher. Pro removes the limit (40 crons).
- **Bandwidth:** Hobby includes 100 GB/mo. Streaming large walkthrough videos to buyers can eat this fast as broker count grows.
- **Commercial use:** Hobby is intended for **non-commercial** projects. YachtPics charges brokers (Stripe subscriptions), so Pro is the correct/compliant plan for a revenue product — this alone is reason to upgrade.
- **Function limits:** Pro lifts execution duration/size limits, which matters for large uploads and heavier jobs.

**Cost:** ~$20/mo per member. Low cost, removes several constraints at once.
**Trigger to upgrade:** any of — approaching 100 GB bandwidth, needing more crons/longer functions, or simply formalizing commercial use. A monthly reminder is set to check usage.

---

## 5. Public boats showcase + site migration (DECIDED — building toward this)

**Goal:** a public, searchable "browse boats" experience fed live from the portal database, and ultimately the whole yachtpics.com marketing site rebuilt on the Next.js/Vercel app (retiring the Adobe Muse 2018 site + the hand-maintained Excel list of slideshow links).

**Decisions locked:**
- **Inclusion = opt-OUT.** A published slideshow appears on the public showcase by default; the broker can switch any listing off. Maximizes inventory.
- **Where:** short-term `boats.yachtpics.com` (subdomain → Vercel app, Muse site untouched). Long-term: migrate the root domain onto the app so `/boats` lives at `yachtpics.com/boats` (best SEO) and the marketing site is maintainable.
- Current site: Adobe Muse 2018 (end-of-life, no support since 2020) on GoDaddy. Hard to update — main reason it's stagnant.

**Phase 1 — Public showcase (build first; nothing wasted by later migration):**
- DB: `public_listed boolean default true` on listings (effective only when slideshow is published).
- Broker + admin toggle: "Show on public showcase" (default on, opt-out).
- Public `/boats` index: grid + search + filters (type, length, year, price, location).
- Public listing detail (reuse/upgrade `/s/[slug]`), lead form already present.
- SEO: titles, meta descriptions, schema.org structured data, sitemap, robots.
- Launch on `boats.yachtpics.com`.

**Phase 2 — Migrate marketing site onto the app:**
- Inventory current pages/sections; rebuild (home, services/portfolio, about, contact). Decide: keep look vs. refresh.
- DNS cutover GoDaddy → Vercel for root domain. **CRITICAL: preserve MX/email records (charlie@yachtpics.com).**
- 301 redirects from old Muse URLs → new (preserve SEO).
- Point `/boats` to root domain; retire the Excel slideshow-link list.

**Phase 3 — Monetize:** featured-listing upsell, referral modules (marine financing/insurance/transport/survey), blog for compounding SEO.

**Inputs still needed from Charlie:**
- Rough list of the current yachtpics.com pages/sections (couldn't auto-inventory — Muse renders content via JS/images).
- Design direction: keep the current look or modernize.
- Where email is hosted (to protect it during the DNS move).

---

## 6. Revenue ideas (new angles)

Ranked for YachtPics specifically. #1 and #2 lean on assets no competitor has (the camera + the fabrication shop).

1. **Photography upsell ladder (core, highest margin).** The portal sits downstream of every shoot — use it to sell more shooting. In-app "Book a shoot / add-on" button: drone, twilight reshoot, walkthrough video, lifestyle/at-sea, "Sold!" reshoot. Captures the next booking at the moment the broker is in the tool.
2. **Branded physical products tied to a listing (laser / CNC / UV — the moat).** Portal already knows vessel name, hero photo, specs, broker → auto-personalize a product in one click. Closing/keepsake gifts (engraved plaque, half-hull, UV-printed cutting board/coasters with the yacht profile), engraved QR dock signs, "Owner since [date]" boards. Merges the existing gift business with the portal. See section 7 for the feature design.
3. **Print fulfillment of marketing collateral.** Already generate the flyer digitally — sell the physical print: spec sheets, foam-core boat-show boards, large-format banners, business cards (UV printing), produced + shipped. Recurring per-listing / per-boat-show orders.
4. **Premium single-listing microsites.** Branded standalone luxury web page (own URL) for flagship/million-dollar boats. Data's already in the portal; premium upsell.
5. **White-label / enterprise tier.** License the whole portal to a large brokerage under their brand + domain for a higher monthly fee.
6. **Managed marketing service tier.** Done-for-you social/marketing for a monthly retainer, on top of the self-serve tools. Higher margin than software alone.

## 7. Portal feature: branded keepsakes / gifts (laser · CNC · UV)

**The idea:** a broker opens a listing, clicks "Order a Gift," picks a product, the portal auto-personalizes it from the listing data (vessel name, hero photo, specs, broker logo), shows a live preview, takes payment + shipping — and the order drops into Charlie's fabrication queue as a print/engrave-ready file. Turns the laser/CNC/UV shop into a one-click portal feature and merges the two businesses.

**Why it's a moat:** personalization is automatic because the portal already holds the photo + specs. No one competing on listing software has a fabrication shop; no one competing on engraved gifts has the listing data. Only YachtPics has both.

**Broker-side flow:**
1. New "Order a Gift" button on a listing (next to Spec Sheet / Social Post).
2. Product catalog (start with 2–3 SKUs): e.g., engraved plaque, UV-printed cutting board, profile half-hull board, coaster set, QR dock sign.
3. Live personalization preview (reuse the social-post canvas approach) — auto-fills vessel name + hero photo + date; broker adds recipient name / message.
4. Shipping address + checkout.
5. Confirmation + order status.

**Charlie-side (fabrication):**
- Admin "Orders" dashboard: incoming orders, status (new → in production → shipped), tracking.
- Each order auto-generates a **production file**: the personalization rendered at print/engrave resolution + the full-res vessel photo + the engraving text — ready to drop into LightBurn / CNC toolpath / UV RIP.

**Build phasing:**
- **Phase A — MVP / validate demand (small build):** "Order a Gift" button → product picker → auto-generated production artwork emailed to Charlie + order captured. Payment handled by manual invoice at first (skip Stripe product setup + shipping math). Proves demand with minimal work.
- **Phase B:** full catalog, Stripe one-time checkout, shipping, order-status dashboard + broker notifications.
- **Phase C:** more SKUs, reorder, brokerage gift programs (bulk closing-gift accounts), richer previews.

**DECIDED:**
- Product line (Charlie already makes these): tumblers, coasters, koozies, Sea-Grip bar key, cutting boards — plus **gift sets / bundles**.
- Approach: **full build** up front — Stripe one-time checkout + admin order dashboard (not the lean/invoice MVP).

**Per-product personalization (varies by item):**
- Photo items (cutting board, coasters): UV-print the vessel hero/profile photo.
- Text items (tumbler, koozie, bar key): engrave vessel name + optional date / recipient.
- Production file = full-res photo + personalization data sheet (vessel name, recipient, date, qty, product); Charlie does final layout in LightBurn/CNC/UV RIP. (Full auto-layout per geometry is a later refinement.)

**Inputs still needed from Charlie before/while building:**
- Price per product + per gift set.
- Catalog photos of each product (for the store UI).
- Per-product personalization spec (photo vs text, which fields).
- Shipping approach (flat rate, by product, or free + baked into price).

**Build order (even for "full"):**
1. DB: `products` (+ bundles) and `gift_orders` tables; seed the 5 SKUs.
2. Broker UI: "Order a Gift" button → catalog → personalization preview (reuse social-post canvas) → cart.
3. Stripe one-time checkout (dynamic price_data) + webhook → mark order paid.
4. Admin Orders dashboard: list, status (new → in production → shipped + tracking), production-asset download.
5. Broker order history + status; email confirmations.

---

## Parked: polish the slideshow & video presentation
- Make the client slideshow + video presentation feel more premium, with **self-serve customizations brokers control**.
- Ideas to explore: cover/intro slide with vessel name + price + broker branding, transitions/Ken Burns pan, background music option, theme/color choices, layout templates, an outro slide with broker contact + CTA, optional captions per photo, autoplay/timing controls, branded video intro/outro bumpers.
- Goal: the shared link should look like a designed presentation, not just a photo scroll — a differentiator and a reason brokers keep using (and paying for) the portal.

## Parked: hi-res file delivery
- Portal intentionally stays **web-res only** (single upload per photo — core design). Web-res is fine for most print ads.
- Occasional hi-res requests (print ads, magazines) are handled **ad-hoc**: Charlie sends a link to the original from his own server. Few requests, so no feature needed now.
- **Future option if requests grow:** a "Request hi-res" button on a listing/photo → notifies YachtPics → reply with a server link (or auto-link to the right folder). Could carry a **print-licensing fee** (ties to revenue ideas #2/#3).

---

## 8. Featured-boat spot (free rotating now → paid later)

**Built (free):** a rotating "Recently Photographed" strip on the broker/assistant dashboard — cycles through the current showcase set on login, one tap opens the full showcase gallery. No manual picking; every featured boat gets airtime, weighted to newest. Purpose is retention + training brokers' eyes on that real estate.

**Paid version (later):** a broker pays to pin their listing to the top of the rotation.
- **Audience nuance (important):** the dashboard audience is *other brokers/assistants*, not buyers — so a paid dashboard spot sells **broker-to-broker exposure** (co-brokerage leads), which is real but modest. Price it nominally at first; raise it once we can show real engagement numbers.
- **The high-value paid spot is on the PUBLIC boats showcase** (section 5), which reaches actual buyers. Reserve the premium "featured listing" revenue play for the public site.
- Needs when built: Stripe (one-time boost or recurring), a broker-facing "feature this listing" flow, scheduling/rotation among paying boats, and admin visibility.
- **Sequencing:** free strip (done) → watch engagement → paid dashboard boost → premium featured slot on the public site.

---

### Notes
- These connect: blog (content) → SEO traffic → public listing pages → broker signups (self-serve) → more public listings → more traffic. The flywheel is the real prize.
- When ready, next step is to pick ONE to scope first (recommend: nail the public-page SEO foundation before the blog, so blog traffic has somewhere to convert).
