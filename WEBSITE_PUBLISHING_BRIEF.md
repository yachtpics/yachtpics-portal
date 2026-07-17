# YachtPics — Website Publishing Brief

**One line:** the website is fixed and live; the next project is making the portal feed it.

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

## Next action

**Phase 1.** Pick Valhalla or Waterfront, add the publish switch, get one boat from portal to
yachtpics.com end to end. Small, provable, and it answers the FTP-vs-Vercel question.
