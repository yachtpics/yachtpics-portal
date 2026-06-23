# YachtPics Portal — Growth & Marketing Ideas

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

### Notes
- These connect: blog (content) → SEO traffic → public listing pages → broker signups (self-serve) → more public listings → more traffic. The flywheel is the real prize.
- When ready, next step is to pick ONE to scope first (recommend: nail the public-page SEO foundation before the blog, so blog traffic has somewhere to convert).
