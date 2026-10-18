# Facebook & Instagram posting — Meta app setup

The portal can post finished Reel Service reels to a Facebook Page and its
linked Instagram professional account. It is **admin only** until Meta approves
App Review (`SOCIAL_PUBLISHING_FOR_BROKERS = false` in `src/lib/meta/config.ts`).
Until the env vars below are set, the feature stays hidden or shows
"Facebook isn't configured".

Meta app: **YachtPics Portal**, App ID **2089232371709558** (development mode).
Graph API version used by the code: `GRAPH_VERSION` in `src/lib/meta/config.ts` (v23.0).

## 1. Meta App dashboard (developers.facebook.com → My Apps → YachtPics Portal)

**App settings → Basic**

| Field | Value |
| --- | --- |
| App Domains | `portal.yachtpics.com` |
| Privacy Policy URL | `https://portal.yachtpics.com/privacy` |
| User data deletion | choose **Data deletion callback URL** → `https://portal.yachtpics.com/api/meta/data-deletion` |
| Terms of Service URL (optional) | leave blank for now (the portal's license terms page is behind login) |
| App icon / Category | as you like (Business) |

Copy the **App Secret** from this page (click Show) — it goes into Vercel as
`META_APP_SECRET`. Never paste it anywhere else.

**Facebook Login for Business → Settings** (under Use cases → "Manage everything on your Page" → Customize, or Products)

| Field | Value |
| --- | --- |
| Valid OAuth Redirect URIs | `https://portal.yachtpics.com/api/meta/callback` |
| Client OAuth login | On |
| Web OAuth login | On |
| Enforce HTTPS | On |

To test on your own computer as well, add `http://localhost:3000/api/meta/callback`
(the portal builds the redirect URI from whatever address it's opened on).

**Permissions** (Use cases → each use case → Permissions): make sure these are added —
`pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
`instagram_basic`, `instagram_content_publish`, `business_management`.

Optional: if you create a **Facebook Login for Business configuration** with those
permissions, put its Configuration ID in Vercel as `META_LOGIN_CONFIG_ID`; the
Connect button then uses it instead of the permission list. Not required in
development mode.

**Roles**: in development mode only people with a role on the app (App Roles →
Roles) can connect. Charlie is admin, so he can test now.

## 2. Vercel environment variables

Vercel → the portal project → Settings → Environment Variables → add each for
**Production** (and Preview if you want it on preview deploys):

| Name | Value |
| --- | --- |
| `META_APP_ID` | `2089232371709558` |
| `NEXT_PUBLIC_META_APP_ID` | `2089232371709558` (optional — the server reads `META_APP_ID`) |
| `META_APP_SECRET` | the App Secret from App settings → Basic |
| `SOCIAL_TOKEN_KEY` | a new random 32-byte key, base64 (see below) |
| `META_LOGIN_CONFIG_ID` | optional, see above |

**Making `SOCIAL_TOKEN_KEY`** — open PowerShell in `C:\Users\charl\yachtpics-portal`
and type this one line, then press Enter:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copy the output (44 characters ending in `=`) into the variable. Keep it safe:
it encrypts the stored Page tokens. If it ever changes, every connected Page
must be disconnected and connected again.

After adding the variables, redeploy (Vercel → Deployments → ⋯ → Redeploy) so
they take effect.

## 3. Database

Run `supabase/migrations/20261018_social_publishing.sql` in the Supabase SQL
editor (project xdrxuojdjhivlbgcsugx) before connecting a Page.

For posting **listing reels** (below), also run
`supabase/migrations/20261018b_social_listing_reels.sql` (adds
`social_posts.video_path`; additive, safe to run twice). Reel Service posting
keeps working without it; only listing-reel posts need it.

## 4. Try it

1. Open `https://portal.yachtpics.com/dashboard/profile` → **Social accounts** →
   **Connect Facebook & Instagram**. Allow your Page (and its Instagram account)
   when Facebook asks. You come back to Profile; tick the Page → **Connect selected**.
2. Admin → **Reel Service** → a ready or delivered reel → **Post to Facebook / Instagram**.
   Pick the Page, tick Facebook and/or Instagram, check the caption, **Post now**.
   Facebook usually finishes inside the request; Instagram can take a minute —
   keep the dialog open and it goes live, then shows **View**.

## Posting a listing reel (admin only)

Open a listing → **Reel** → make a **Reel (9:16)** → next to **Download MP4**,
**Post to Facebook / Instagram** (shown only to admins, once Meta is configured
and a Page is connected). The dialog is the same one Reel Service uses; the
caption is drafted from the listing (name, year / make / model / length,
location, broker and brokerage) and ends "Delivered through the YachtPics
Portal." — edit it before posting. On **Post now / Schedule** the MP4 uploads
first (progress shown) to the private video bucket at
`social-uploads/{listing_id}/{uuid}.mp4` (key chosen by the server, admin only);
the post stores that key in `social_posts.video_path` (`source_kind =
'listing_reel'`, `source_id` = the listing) and a fresh 2-hour signed link is
made whenever Meta needs to fetch it (at posting, or at the daily run for a
scheduled Instagram post). Films (16:9) and reels outside 3–90 s can't be
posted — the button is disabled with the reason. Uploads are swept after 35 days.

## How scheduling works (Vercel Hobby = one daily cron)

- **Facebook**: a scheduled reel is uploaded straight away and Facebook itself
  publishes it at the exact time (15 minutes to 29 days ahead). Cancel deletes it
  from Facebook.
- **Instagram** has no scheduling API, so a scheduled Instagram reel goes out at
  the portal's **daily run (13:00 UTC — 9am ET in summer, 8am in winter)** on or
  after the chosen time. "Post now" is the main path.
- The daily run (`/api/cron/social`, fired by `/api/cron/daily`) also finishes any
  Instagram reel still processing after "Post now".

## Opening it to brokers (after App Review)

Set `SOCIAL_PUBLISHING_FOR_BROKERS = true` in `src/lib/meta/config.ts`. Brokers
then see Profile → Social accounts and can post their own **delivered** reels
(the posting UI for brokers still has to be added to the broker Reels page).
Listing-reel posting stays admin only regardless — the publish route and the
upload target both check for admin.
**Update the broker Help page and rebuild the PDF in the same change** (CLAUDE.md, Help page rule).
