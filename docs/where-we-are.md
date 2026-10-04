# Where we are — October 4, 2026

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
