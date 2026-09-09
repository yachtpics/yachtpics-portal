# Where we are — September 9, 2026

Charlie is home from Grenada. Today's session sharpened the Reel, opened it to
everyone for a fortnight, and wrote the announcement. **Committed by Charlie,
not by Claude — the sandbox shell was wedged all session, so nothing here has
been typechecked.** `npx tsc --noEmit` before pushing.

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

**The open house.** `src/lib/reelPromo.ts` — Sept 9 to Sept 23, the Reel
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
