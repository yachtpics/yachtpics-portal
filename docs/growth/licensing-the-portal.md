# Licensing the Portal to other yacht photographers

*Prepared September 12, 2026. Market and pricing research by an Opus pass (vendor pricing pages, Yachting Pages directory, ~45 studio sites); the recommendation is Claude's. Nothing here commits you to anything — it's the paper to react to.*

## The decision in one paragraph

Today YachtPics is a photography business that happens to own software. The software is the part that could be in Newport, San Diego and Palma next year without you getting on a plane. A yacht photographer in any of those harbours has your brokers' cousins as clients and the same delivery problem — and today almost none of them has a delivery tool at all. Licensing the portal to them turns it into a product with a flagship studio, rather than a studio with a product. The question is whether the money and the risk are worth the second business it creates.

## What the research found

**The field is empty.** Of roughly forty-five yacht studios examined worldwide, eleven had any visible delivery platform. One used Pixieset. None used ShootProof or Pic-Time. Most send a Dropbox or WeTransfer link and hope. There is no incumbent to displace and no budget line to fight for — which cuts both ways: nobody is paying for this yet, so you'd be creating the habit, not capturing it.

**The market is small and findable.** Yachting Pages lists 175 photography businesses worldwide (Fort Lauderdale 14, Florida 22, Antibes/Nice 15, Mallorca 9, Newport 5). That directory is superyacht-tilted and misses the brokerage-volume shops; the realistic universe is 150–300 studios who'd recognise themselves in the pitch, of whom perhaps 60–90 shoot enough to pay monthly. This is a boutique business, not a venture one. Sixty studios at the price below is roughly $100k a year of software revenue at software margins.

**The precedent exists.** Spiro was built inside a media company (Wow Video Tours, ~12,000 listings a year), licensed to peer photographers, and now wins customers off Aryeo. Aryeo itself was bought by Zillow for about $35M and then made free — which is the ceiling and the warning in one story: platforms in this space get valued on the agents they reach, and a giant can zero the price overnight. Nobody in yachting is that giant.

**What photographers pay elsewhere:**

| Platform | Price | Notes |
|---|---|---|
| Aryeo (Zillow) | Free Lite; $49 / $99 / $179 mo | Real estate; white-label on paid tiers |
| HDPhotoHub | $5–10 per delivery | Per job; reels, flyers, traffic report; white-label at $5 |
| Spiro | $5 per job | Built by a studio for peers |
| Tonomo | $140 / $250 mo | White-label only at $250 |
| Rela | $99 mo + $10/site; $249 broker | Per-seat above 15 agents; agent analytics |
| Pixieset, ShootProof, Pic-Time, CloudSpot | $7–50 mo | Consumer-grade galleries; no agent tools |

Gallery software tops out near $50. Anything that gives the *agent* marketing tools — reels, sites, analytics — sells at $150–250. The portal is the second kind.

## Three ways to do it

**White-label, per studio.** They get the portal under their own name and domain; brokers see "Newport Yacht Media Portal." Highest price, no brand conflict, and the studio sells it as theirs. You are invisible, every studio will want one tweak, and support lands on you regardless.

**Co-branded — "Powered by the YachtPics Portal."** Cheaper for them, and every studio's reels and slideshows carry your name into a new harbour, so the brand compounds. The risk is real: a careless operator in Palma wearing your name, and Fort Lauderdale brokers seeing "YachtPics" on a competitor's work. In your own harbour that is a problem.

**Territory or franchise.** Solves the conflict cleanly — nobody licenses into your water — and supports higher fees. But it's slow, legally heavy, and locks markets you can't verify are worth locking.

**Recommendation:** white-label as the product, with a co-brand discount for studios who want it — and one hard rule: **South Florida is yours.** Nobody licenses into Palm Beach, Broward or Miami-Dade. That single clause removes the #1 objection (you competing with your licensees) for everyone outside it, and protects the flagship.

## Price

**$149 a month per studio, unlimited listings, white-label and custom domain included, no setup fee. $1,490 a year prepaid.**

A yacht shoot bills $550–2,000 against about $200 for a house, so $149 is less than one job a month — the only comparison a studio owner makes. Setup fees are extinct in this category; don't invent one. Push the annual: prepaid plans retain ten to twenty points better, and a studio that's paid for a year puts its brokers on it.

Billing: use Stripe's Standard Connect model — each studio pays Stripe directly and you take no per-transaction cut. Their brokers subscribe to *them*; you charge the studio. Simpler for you, and it keeps you out of their client relationship.

## The five risks, in order

1. **Conflict of interest.** You own a media business; HDPhotoHub markets specifically on *not* owning one. The South Florida exclusion is the answer. Say it first, before they ask.
2. **Churn.** Creative SaaS under $100 runs 40–58% a year. At sixty studios you'd replace thirty a year to stand still. The annual plan and the fact that their brokers are inside the tool are the two things that hold it down.
3. **Storage cost.** Supabase egress is $0.09/GB; Cloudflare R2 is $15/TB with zero egress. Photos are still in Supabase (videos already moved). **Finish the R2 move before onboarding anyone** — at 10 TB across studios it's the difference between ~$150 and ~$400 a month.
4. **No syndication moat.** Boats Group forbids service providers feeding multiple customers and caps a listing at 50 MB; YATCO's two-way API is $650 a month. Never promise "pushes to YachtWorld." Promise Instagram, email and the client link — where the buyers are anyway.
5. **Support.** Every studio is a non-coder in a different time zone, and their brokers will call *them* when something breaks. Before the first licence: a real help centre, an email support address that isn't yours, and a written "what we fix / what you fix."

## What it needs from the product

Most of it exists. The work is *multi-tenancy*: one portal, many studios, each with its own brand, domain, brokers, billing and storage bucket, and no way to see each other's data. That's a real project — weeks, not days — and the single biggest reason to decide this deliberately rather than drift into it. Also: the YachtPics wordmark and "Made with the YachtPics Portal" credit become per-studio settings; the AI copy, reels, spec sheets and engagement all come along unchanged.

## If you say yes — the first three moves

1. **Finish R2 for photos.** Storage economics before anything else.
2. **Find one studio, not ten.** Newport or San Diego — a good operator with ten-plus regular brokers — and run it for a season at cost. Their feedback is the product spec for multi-tenancy; their brokers' reels are the case study.
3. **Only then price and package.** Write the licence around what the pilot taught you, with the South Florida clause in the first paragraph.

If you say not yet: nothing is lost. Own the harbour first — the office plan and FLIBS are the nearer, cheaper win — and revisit this after a full season, when you'll know whether brokers renew and what they use.
