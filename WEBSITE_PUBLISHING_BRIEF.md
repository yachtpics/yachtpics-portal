# YachtPics — Website Publishing Brief

**One line:** the portal feeds the website. Phase 1 shipped 17 Jul 2026.

## Status

**Phase 1 — DONE.** Simmer Down (52′ Prestige, 113 photos) went portal → yachtpics.com
via the publish switch. The chain works: public bucket, generated boat page with the
portal slideshow, regenerated brokerage page, FTPS push. Both vetoes in place.

**The FTP-vs-Vercel fork is settled: stay on FTP.** Phase 1 proved a scoped cPanel FTP
account + generated static pages is enough. No reason to migrate the site onto Vercel.

**What Phase 1 taught us that we didn't know going in:**

- **The Boats index is the real bottleneck.** `yacht-photos.html` is a hand-built list of
  85 links. A brokerage page can exist and be live with nothing linking to it. That — not
  effort — is why the site sits at 85 brokerages listed while 90+ have been served, and why
  no brokerage was added for ~18 months. Hand-editing HTML per brokerage was never worth
  the return. Phase 2 kills it.
- **4,000+ boats shot, 1,384 on the site.** The gap is 20 years of publishing costing an
  afternoon. Now that it costs a toggle, the gap closes on its own going forward.
- **Photo order: don't touch it.** Charlie uploads out of Lightroom in viewing order, so
  `display_order` IS the intended order. A category sort actively breaks it — "Head" is one
  label covering several rooms, each interleaved beside its own stateroom. The canonical
  order is an opt-in button (`photoOrder.ts`), never an automatic fallback.
- **The site's numbers overstated.** H1 claimed ninety brokerages against a list of 85;
  the homepage CTA said "90+ Clients". Both fixed. The "90+ Served" stat may still be true —
  served ≠ listed.
- **Slideshow crossfade:** the website (and now the portal) use a symmetric 1200ms
  cross-dissolve. The staggered "hold the outgoing opaque" model only reads correctly when
  consecutive shots are the same shape — a wide shot followed by a tall one parks its wings
  either side, then winks out.

Recovered from the "Yachtpics.com optimization review" session (13 Jul 2026) so the agreed
plan lives in the repo instead of a transcript. Everything under **Settled** is decided —
a future session should start from it, not reopen it.

---

## 1. Where the website stands

The site was rebuilt and is live on GoDaddy. The SEO plumbing is confirmed end to end:

| Item | State |
|---|---|
| `https://www.yachtpics.com/sitemap.xml` (new) | ✅ Success — **86 pages discovered** |
| `http://www.yachtpics.com/sitemap.xml` (2016) | Success — 8 pages |
| Analytics tag | ✅ Survived the rebuild, confirmed tracking the new homepage title in realtime |

**Baseline** (last 7 days, essentially all pre-rebuild): Direct 56 sessions · Referral 9 ·
**Organic Search 8** · 252 active users over 30 days. Roughly one organic visitor a day.

**Expected curve** — watch *indexed pages*, not clicks:
- 2–5 days: "Indexed" starts climbing off 2. First real signal.
- 2–3 weeks: impressions appear in Performance. Own name + brokerage combos rank first.
- 1–3 months: organic clicks meaningfully above 6-per-quarter.

Check: Search Console → Indexing → Pages. If it's still stuck at 2 a week out, something's wrong.

---

## 2. The decision: this is TWO features, not one

**Feature 1 — The Dock stays exactly as it is.**
Broker-only, login-required (`/dashboard/showcase`). Its job is showing brokers what we've
been shooting. Internal proof, not marketing. **Don't touch it.**

**Feature 2 — Website publishing.** A separate pipeline: new listing + photos in the portal
→ a slideshow appears on yachtpics.com under that brokerage's page. Automatic, with **two
independent vetoes**:
- **Ours** — don't send this one.
- **The broker's** — pocket listing (`showcase_opt_out`, already built).

Either veto blocks it. Nothing becomes public that wasn't already going to be public.

**Endgame:** the portal is the source of truth, the website is its public face.
Lightroom → portal → website, with FileZilla out of the loop.

---

## 3. Settled — do not reopen

- **Consent is not an ethical hurdle.** Juicebox galleries have been public on yachtpics.com
  for twenty years. A generated boat page is the same exposure, not a new one.
- **Keep the broker's direct `mailto:` + contact tracking.** Do *not* route contact through a
  YachtPics form — it puts us between broker and buyer (which brokers hate) and weakens the
  exact story we want to tell them: *"your boat got 400 views from our site last month."*
  Broker gets the lead direct, we get the metric. (Contact-tap tracking now exists —
  `showcase_events`, `kind = 'contact_click'`.)
- **Opt-out, not opt-in.** Opt-in produces an empty page.
- **Announce first, publish a week later.** Use `/admin/announce`. Framed as a gift:
  *your boats are going on yachtpics.com, here's what it looks like, flip the switch on
  anything that shouldn't be public.* A veto nobody knows about doesn't get used.
- **`in_showcase` is already the curation switch.** No new consent architecture needed.

### A pocket listing is a *timing* problem, not a consent problem

Charlie, 17 Jul: **a boat is only a pocket listing for a week or two** — long enough for the
broker to sell it in-house before other brokers get involved. After that it's a normal
listing and there's nothing to protect.

This reframes the whole veto. `showcase_opt_out` is a permanent switch, but the underlying
need has a two-week shelf life. Which means:

- **Publishing an older boat carries no pocket risk at all.** The 14 boats published on
  17 Jul were all shot well before that, so none could still have been pocket listings.
- **Automatic publishing is only dangerous in one window** — the first couple of weeks after
  the shoot. That's the entire risk surface.

So when publishing goes automatic (the endgame: new listing + photos → website), **do NOT
rely on brokers remembering a switch.** Use a **hold**: auto-publish N days after the shoot,
where N ≈ 21 — comfortably past the two-week pocket window. The pocket period then expires
on its own, nobody has to remember anything, and `showcase_opt_out` remains as an override
for the broker who wants longer.

Safe by construction rather than by vigilance. Opt-out depends on someone paying attention;
a hold doesn't.

---

## 4. Hard constraint — the trap

**`/s/[slug]` is subscription-gated.** The code says plainly: *"The live client slideshow is a
paid feature."* If a broker's plan lapses, the link goes dark. With 0 paying brokers, feeding
the website from those would produce a wall of "temporarily unavailable."

**`/s/[slug]` must never be what feeds the website.** The Dock's data is the right source —
it's our marketing, not the brokers' paid product, and it isn't subscription-gated.

---

## 5. Three things that will actually bite

**1. Brokerage names don't line up.** The Dock shows both "HMY Yachts" *and* "HMY Yacht
Brokerage" — same company, two spellings. Also "One Water Yacht Group" vs the website's
`onewater_yacht_group.html`, "Kadey Krogen" vs `kadey-krogen_yachts_inc.html`. Today
`brokerage_name` is free text on each broker. To drive 79 pages from it we need a proper
brokerage record that owns the canonical name **and the website page it maps to**.
~80 rows, one time. This is the unglamorous heart of the project.

**2. The 1,530 old links must never break.** Brokers have been sent those URLs for years.
Brokerage pages become: **new boats (portal-driven) up top, archive (Juicebox links) below.**
The archive recedes as new work accumulates. It never gets deleted — it just stops being the
thing we maintain.

**3. Photos are private, 1-hour signed URLs.** Static pages can't use them; they'd be dead by
lunchtime. Published boats need a public path — a public Supabase bucket is the clean answer.

---

## 6. Phasing

- **Phase 1 — one brokerage, end to end.** Pick **Valhalla** or **Waterfront** (both are proper
  brokerages in the portal already). New listing → boat page + that brokerage page regenerates.
  Prove the whole chain on something small. This also tells us whether to stay on FTP or move
  the site onto Vercel.
- **Phase 2 — the brokerage mapping**, then roll to all 79.
- **Phase 3 — archive recedes.** Old galleries stay reachable; new work is portal-driven.

**What it produces on yachtpics.com:**
- `/recently-photographed.html` — the public showcase
- **`/boat/<name>.html` — one page per boat.** The real SEO prize: ~60 new pages with builder,
  year, length, type, location. *"2018 Horizon FD85 85′ Motor Yacht."* That's the long-tail the
  Juicebox archive can never rank for.
- Later: each brokerage page shows its own recent boats.

---

## 7. The long-term fork

The cleanest end state probably isn't FTPing files to GoDaddy — it's **yachtpics.com served by
the same Next.js app as the portal**, with the Juicebox archive proxied through from GoDaddy so
every old link still resolves. One system, no FTP.

That's likely where this ends up. But prove the model with Phase 1 first rather than migrate the
site on a hunch.

---

## 8. Open housekeeping

- `Documents\YachtPics` folder to hold both projects and this brief.
- GoDaddy monthly → annual switch. Free money.

---

## Cleanup backlog (not urgent)

**Broken archive links from an old site restore.** A few years back the site had an
incident and was reloaded from backup; some gallery folders never made it back. So the
archive lists galleries whose folders 404 — confirmed on `grande_yachts_international`
(rows 13 & 14: `48_cruisers_feisty` and `38_pursuit_g-force` both missing; row 14 is also
mislabelled). These have been dead on the live site for years with no complaints, and the
publisher only rewrites a page when a boat is published to it, so there's no new harm.

To clean up properly (needs FileZilla to see the actual gallery folders, which the
HTML-only download doesn't include): for each `brokerage_site_archive.href`, check whether
the folder exists on the server; delete rows whose folders are gone (or re-point if the
gallery exists under a different name). Do it per-page as pages get republished, not as a
big-bang — a page nobody's touching can wait.

**A republish renders with whatever code is live at that instant.** Push → wait for Vercel
green → *then* toggle. Republishing a minute after pushing silently regenerates the page with
the old template. Cost us two rounds.

**Uploading static pages over generated ones wipes them.** The local copies of
`waterfront_yacht_brokerage.html` / `valhalla_boat_sales.html` are pre-publish snapshots.
Order is: upload static → *then* republish one boat per affected brokerage to regenerate.

**`site_slug` is sticky by design** — set on first publish and reused forever, so URLs stay
stable when a boat is renamed. If the slug logic changes, existing slugs must be cleared
(`set site_slug = null`) and the boat republished, or it keeps the old URL.

**Cache-bust when verifying** (`?cb=…`). Fetching the same URL repeatedly returns stale
copies and will have you debugging a page that was already fixed.

## Next action

**Phase 2 — make a new brokerage cost nothing.** Today a brokerage needs three manual steps
to reach the website: `site_page` set by hand in SQL, a boat published to trigger the page,
and a hand-edited link in `yacht-photos.html` or nothing points at it. Three pieces fix it:

1. **Auto-derive `site_page`** from the brokerage name, with an admin override for the
   mismatches ("Valhalla Yacht Sales" → `valhalla_boat_sales.html`, "HMY Yacht Sales" →
   `brokerage_boats.html`, "One Water" → `onewater_yacht_group.html`).
2. **Generate the Boats index from the database** on every publish, so a new brokerage
   appears in the list automatically. This is the piece that unblocks the backlog.
3. **A "publish brokerage" action**, so a page can exist before its first boat.

Then adding a brokerage is: add it in the portal, publish a boat, done. No HTML, no FileZilla.

Phase 3 — roll to all 85+, archive recedes.

## Future ideas

**Real estate / non-marine use case (noted Jul 2026).** The portal's core loop —
photos in, publish a slideshow, send a clean link to a client, downloads always free — is
not boat-specific. Kelly Sprigg (SYC Yachts; her client came to Samantha wanting to
subscribe) is also a successful real-estate agent, and the same present-and-send workflow
maps directly onto property listings. Worth exploring as an adjacent market when there's
appetite: same product, swap "boat" for "property," potentially a separate brand skin.
Low urgency, high optionality — a warm first customer already in reach if we ever want to
test it.
