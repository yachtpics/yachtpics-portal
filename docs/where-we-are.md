# Where we are — September 19, 2026

## Sept 18–19 — reel findability, brokerage admins, and the delivery-email nudge

**The reel numbers, read Sept 18.** Nine reels, four brokers, six downloads —
and every one of them on launch day. Nothing since. **Zero Send-to-phone
events** across the whole window, which is the number that says *findability*
rather than *interest*: people who went looking found the tool and used it, and
nobody has stumbled into it since the announcement scrolled off. Charlie is
talking to **Mason Waters** about it.

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
