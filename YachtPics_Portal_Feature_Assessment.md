# YachtPics Portal — Feature Assessment & Roadmap

*A competitive deep-dive and prioritized recommendation list. Benchmarked against photographer client galleries (Pixieset, Pic-Time, ShootProof, CloudSpot), real-estate media delivery (Aryeo, HD Photo Hub), and the yacht incumbent (YATCO BOSS).*

---

## The strategic thesis (read this first)

Your portal sits at the intersection of three product categories, but it should not try to be all three:

- **Photo/client-gallery tools** (Pixieset, Pic-Time) — great at delivery, proofing, and presentation.
- **Real-estate media platforms** (Aryeo) — great at turning a shoot into a *marketing package*: a property website, branded links, flyers, social posts, scheduling, invoicing.
- **Yacht MLS / back-office** (YATCO BOSS) — listings, syndication to YachtWorld/boats.com, CRM, AI spec writing.

**Don't chase YATCO.** They own the MLS/CRM/syndication lane and brokers already pay for it. Your wedge is narrower and sharper: **the best possible way to present a listing's media and turn the people who view it into leads** — then hand the broker ready-to-use marketing assets. Win "the listing looks incredible and I can see who's interested," and you become indispensable without competing with the MLS.

Everything below ladders up to that thesis.

---

## What you already do well (the base is strong)

Per-listing photo delivery with categories, drag-reorder, hide, lightbox, bulk select/download/categorize · video upload · PDF documents · branded public slideshow with view tracking & sent history · send-to-client email · single + ZIP downloads · external download links · **gated client Galleries** with expiry · **brokerages** with per-listing shared inventory · **co-brokers** on a listing · 30-day trial + Stripe billing + automated conversion emails + Trials board · owner Business Pulse dashboard · buyer-view email/push alerts · PWA install · storage monitoring · email log · engagement metrics · "Added by" attribution.

That's already ahead of a basic gallery tool. The gaps below are about **depth of presentation, lead generation, and marketing leverage** — exactly where Aryeo and the QR-lead-capture playbook are winning.

---

## Tier 1 — Fast, high-impact wins (do these first)

| Feature | What it is | Why it matters | Effort |
|---|---|---|---|
| **QR code per listing** | Auto-generate a QR that opens the vessel's slideshow/page. Downloadable for print. | Boat shows, dock signage, flyers, brochures — a scan takes someone straight to the gallery. Tailor-made for how yachts actually get marketed. Real estate proved this converts. | **Low** |
| **Lead capture on the public share** | Optional "Request info / Contact broker" form, and/or require name+email to unlock full-res downloads. Broker gets the lead + a notification. | Today your slideshow views are **anonymous**. This turns passive viewers into named, contactable leads — the single biggest revenue lever for a broker. | **Med** |
| **One-click branded flyer / spec sheet** | Generate a polished one-page PDF (hero photo + key specs + broker brand) from the listing. | Aryeo's marketing suite is a top selling point. Brokers print these for shows and email them to buyers. You already have Adobe tooling to do it beautifully. | **Med** |
| **Cover photo + cinematic slideshow** | Let the broker pick the hero/cover image; add optional ambient music and an autoplay full-screen "cinematic" mode. | Standard in Pixieset/Pic-Time. Small touches that make the presentation feel premium and "yacht-grade." | **Low–Med** |
| **Global search & filters** | Search/filter listings by vessel, make, length, location, status across the portal. | As inventory grows past a screen or two, this becomes daily-use essential for brokers, assistants, and you. | **Low–Med** |
| **Pay-now on shoot invoices** | Add a Stripe "Pay invoice" button to the Shoots & Invoices you already track. | Faster cash flow for YachtPics with near-zero added workflow — you already have the invoice records. | **Med** |

---

## Tier 2 — Strategic bets (the real differentiators)

**1. The Vessel Microsite (your flagship opportunity).**
Today a broker shares a *photo slideshow*. Aryeo's killer feature is a full auto-generated **property website**. Do the yacht version: one branded link that shows the hero gallery, walkthrough video, **structured specs**, the brochure/docs, and a **"Contact broker / Request a viewing"** form — all under a clean URL with the broker's logo. This is the artifact a broker sends to every serious buyer, drops into emails, and puts behind the QR code. It upgrades you from "photo host" to "the place the listing lives."

**2. Buyer favorites & reactions.**
Let buyers heart photos on the slideshow/microsite. The broker sees engagement and *which shots resonate*. Pixieset/Pic-Time built proofing on exactly this. For a broker it's gold: "the buyer favorited the engine room and the master — they're serious."

**3. Social-ready auto-exports.**
One click turns a gallery into Instagram/Facebook-ready assets: vertical and square crops, plus a short auto-built reel/slideshow clip. Aryeo sells "social posts" as part of its suite; brokers constantly need ready-to-post content and rarely have time to make it. With your Adobe pipeline this is a genuine "wow" differentiator.

**4. Structured vessel specs.**
Add proper spec fields (LOA, beam, draft, year, builder, engine make/hours, fuel, staterooms, heads, etc.). This is foundational plumbing — it powers the microsite, the flyer, and any future syndication, and it's table stakes versus YATCO. Medium effort, unlocks three other features.

**5. Shoot booking / scheduling.**
Let brokers request a shoot through the portal; you manage it on a calendar; on completion the listing auto-creates and the broker is notified. Aryeo's scheduling system is core to how media companies scale. This streamlines *your* operation and deepens the broker relationship at the top of the funnel.

**6. Weekly broker digest + referral program.**
A Monday email to each broker — views, new leads, listings that need attention — keeps the product top-of-mind and reinforces value (great for trial conversion). Pair with a simple **referral credit** ("refer a broker, get a month") to turn happy brokers into a growth channel.

---

## Tier 3 — Bigger / enterprise (later, or for premium tiers)

- **Listing syndication / export to YachtWorld · boats.com · YATCO.** The biggest yacht-broker expectation, and the heaviest lift. Don't rebuild a MLS — start with a clean "export package" (all assets + a spec sheet formatted for upload), then explore a proper feed. A real premium-tier differentiator.
- **White-label / custom domain for brokerages.** Let a brokerage run the portal under its own subdomain and branding. Natural upsell for your brokerage tier.
- **3D tours & deck/floor plans.** Embed Matterport/iframe tours and deck plans on the microsite — increasingly expected on higher-end listings.
- **Watermarking + download PIN/limits** on public shares, for pre-sale image protection (Pixieset security toolkit).
- **2FA + audit log + SSO.** Security maturity for when brokerages and bigger accounts come aboard.

---

## Ease-of-use polish (ongoing, low-effort, high-goodwill)

Saved "Send to client" message templates · scheduled sends · duplicate/clone a listing · per-listing activity timeline (views, downloads, sends, leads in one feed) · resumable large-video uploads (the reliability item deferred earlier) · in-app "What's new" changelog · onboarding-checklist completion tracking · a lightweight feedback/NPS prompt · accessibility & performance pass.

---

## What I'd deliberately *not* build

- **A print/photo store (Pixieset-style).** Brokers don't sell prints to buyers — wrong audience. Skip it.
- **A full CRM.** YATCO and dedicated CRMs own this. Capture leads and hand them off cleanly (even just email/export); don't try to manage the whole pipeline.
- **A full MLS / public marketplace.** Stay the broker's media + presentation layer, not a competing listing destination.

---

## Suggested 90-day sequence

1. **Weeks 1–2:** QR codes + cover photo + cinematic slideshow + global search *(fast, visible wins; momentum)*
2. **Weeks 3–5:** Lead capture on public shares + buyer favorites *(turn views into leads — the core thesis)*
3. **Weeks 5–8:** Structured specs → the **Vessel Microsite** *(the flagship)*
4. **Weeks 8–10:** One-click flyer/spec sheet + social-ready exports *(marketing leverage on top of the microsite)*
5. **Weeks 10–12:** Pay-now invoices + weekly broker digest *(monetization + retention)*

Then evaluate the Tier-3 bets (syndication, white-label) based on what brokers ask for once the above is live.

---

*The throughline: make each listing look unmistakably premium, capture the people who look at it, and hand the broker something ready to market with. That's a lane YATCO doesn't occupy and Pixieset can't speak yacht — which is exactly where YachtPics wins.*
