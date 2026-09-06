# Where we are — September 5, 2026

A handoff note, written so a fresh session can pick up mid-stream. Charlie is
shooting in Grenada Sept 6–9; he has the Claude Desktop app open on the home
computer and remote-desktop access if something needs his hands.

## The one thing that matters right now

**There are commits waiting to be pushed.** Everything below marked "shipped"
is committed but only reaches the live portal when Charlie runs, from
`C:\Users\charl\yachtpics-portal`:

```
git push
```

Nobody else can run it — it needs his GitHub login in his own terminal, and
Claude can't type into terminals. If he's away, that means remote desktop.

## Recently finished

**Video storage moved to Cloudflare.** All 106 videos now serve from the
private R2 bucket (`videos.storage_host = 'r2'`). Supabase kept safety copies
for a week because emailed video links stay valid 7 days.

- The 6 Cayleigh & Izzie dive videos were cleaned up early on Sept 3 (4.08 GB
  freed) — Charlie's own family footage, and he has the originals.
- The remaining ~27 GB delete themselves automatically: a new cron
  (`/api/cron/video-cleanup`, dispatched from `/api/cron/daily`) activates
  Sept 7, verifies each file on Cloudflare immediately before deleting its
  Supabase copy, skips anything unconfirmed, and emails Charlie a receipt.
  It no-ops after Sept 30. **This only runs if the push above happened.**
- Storage was ~91 GB of a 100 GB quota; expect ~64 GB after cleanup.

**Uploads survive bad connections.** A single large PUT was dying whenever
Charlie's connection hiccupped (live testing: 40 MB failed, 120 MB passed,
300 MB died at 31%). Files over 32 MB now upload as numbered parts, each
retried up to 3 times — verified live on a 304 MB test that survived two
mid-upload drops. See `src/lib/uploadListingVideo.ts` and
`src/app/api/videos/multipart/route.ts`.

**Deletion log.** Every photo/video deletion now writes a row to
`media_deletions` — who, what, which boat, file size, and when it had been
uploaded — snapshotted as text so the log outlives the listing it refers to.
Visible at **/admin/deletions**. Born from a real support mystery ("was there
ever a video on this boat?") that took an hour of database archaeology.

**Admin uploads are attributed.** They used to record no uploader at all, so
"who uploaded these?" could only be answered "YachtPics" — not Charlie or
Samantha. Now stamped like broker uploads always were. Not backfillable.

**Subscription notifications.** The Stripe webhook now emails Charlie the
moment a checkout clears (who, plan, price) and when one cancels. He found out
about his newest subscriber days late from a dashboard he happened to open.

**Photo categories.** Added "Seating" (sorts with the cockpit/deck shots) and
"Aft Berth" (sorts with the cabins), plus "Aerial" earlier.

## Open threads

- **Natural 9 video needs its line.** Charlie uploaded a full interior /
  exterior / drone film for the 2009 Sunseeker 121 (listing
  `576a46c9-3809-41c3-a5cd-c0ae5281a206`, video
  `036be9af-ed02-4b5e-9f78-a6380a3c9c37`) and was choosing a title. The
  recommendation on the table: title **"Natural 9 — The Film"**, line
  *"Interiors, exteriors, and aerials of this 2009 Sunseeker 121, start to
  finish."* Set via the editor under the video on the listing page.
- **Joe Yeni (joe@yenimarine.com)** — trial expired July 30, still actively
  listing (4 boats), downloaded 80 photos three weeks after expiry. He's the
  warmest subscription prospect on the board. He texted about a "subscribe"
  message while looking for a video on *Above & Beyond* — that listing has
  photos only, never had a video; the message he hit was the upload prompt in
  the empty video section, since reworded. **Downloads are always free** —
  that's the product; the subscription is for the extras.
- A scheduled task runs **Sept 8** to verify the cleanup freed the space and
  report back.
- Parked: site-photos bucket (~20 GB) could move to Cloudflare next; boat-page
  SEO for not-indexed pages; Brian Nopper broker site.

## Habits worth keeping

- Verify against the real thing before declaring victory — run the query, load
  the page, test the upload. Several bugs here were only found that way.
- When something fails, say the actual reason. A generic "check your
  connection" hid a real fault for days and cost a confused support text.
- Copy before delete, verify bytes, and put a gap between the two.
