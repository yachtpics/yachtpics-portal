# Industry News — spec

*Written September 15, 2026. The portal gathers the yachting trade press daily, summarises it in the portal's voice, shows it to brokers, drafts a weekly piece for yachtpics.com and the brokers' inboxes, and the website reads it all from the portal so it never goes stale again (the old `marine-news.php` was a July 2025 one-off).*

## Principles

- **Summarise and link; never republish.** Headline, two sentences, source name, link. Every item names its source. No images copied from sources.
- **The portal's voice.** Calm, specific, premium — the register of the announcement and tips. No exclamation marks, no "stunning", no emoji, no hype.
- **YachtPics' view of the industry, not a scraper.** Native items (a boat on Recently Photographed, a broker's reel, FLIBS) sit in the same feed.
- **Automatic daily; human-approved weekly.** The daily feed needs no hands. The weekly piece is drafted by Claude and approved by Charlie before it goes anywhere.
- **Nothing sends or publishes without approval** — same pattern as the announcement and tips.

## Sources (RSS)

`src/lib/newsSources.ts` — `{ name, url, homepage, category hint }`. Start with:

BOAT International (boatinternational.com/rss), SuperYacht Times (superyachttimes.com/rss), Trade Only Today, Soundings Online, Power & Motoryacht, Yachts International, Yachting Magazine, Robb Report – Motors/Marine, YATCO news, IYBA news, Boats Group / YachtWorld news, Sportfishing Magazine, Marlin Magazine, The Hull Truth is NOT a source (forum). Verify each feed URL actually resolves; keep the list easy to edit.

Categories: `brokerage` (sales, market, MLS, brokerages), `new-builds` (launches, shipyards, models), `shows` (FLIBS, Palm Beach, Miami, Cannes, Monaco), `sportfish` (tournaments, centre consoles, outboards), `superyacht`, `industry` (regulation, people moves, business). One per item, assigned by the model.

## Data

Migration `supabase/migrations/20260915_industry_news.sql`:

```
industry_news (
  id uuid pk default gen_random_uuid(),
  url text unique not null,
  source text not null,          -- "BOAT International"
  source_url text,               -- homepage
  title text not null,           -- rewritten headline, ≤ 90 chars
  summary text not null,         -- two sentences, ≤ 260 chars
  category text not null,
  published_at timestamptz,
  fetched_at timestamptz default now(),
  featured boolean default false,
  hidden boolean default false,
  native boolean default false   -- YachtPics' own item, entered by admin
)
news_digests (
  id uuid pk default gen_random_uuid(),
  week_start date unique not null,   -- Monday
  title text not null,
  intro text not null,
  body_md text not null,             -- the piece, markdown
  html text,                         -- rendered for email/site, set on approve
  status text not null default 'draft',  -- draft | approved | sent
  item_ids uuid[] default '{}',
  created_at timestamptz default now(),
  approved_at timestamptz, sent_at timestamptz
)
```
RLS: authenticated users may `select` from `industry_news` where `hidden = false`; `news_digests` select where status in ('approved','sent'). All writes via service role. Indexes on `published_at desc`, `category`.

## Daily job — `/api/cron/news-fetch`

Wired into `/api/cron/daily` (runs 13:00 UTC). Guarded by the same cron secret as the others.

1. Fetch every source (10s timeout each, browser-ish User-Agent, ignore failures per-source, log a count).
2. Parse RSS 2.0 and Atom with a small in-repo parser (no new dependency; `fast-xml-parser` is NOT installed and the shell can't `npm install`). Extract title, link, published date, description/summary (strip tags). Tolerate CDATA.
3. Keep items from the last 3 days; drop URLs already in `industry_news`; cap at 40 new per run.
4. Batch to Claude via `src/lib/ai.ts` (add `summarizeNews(items)` using the existing `ask` helper; JSON out; model Haiku). System prompt — the voice:

   > You write for a portal used by yacht brokers. For each item return a headline (≤ 90 characters, sentence case, no source name, no clickbait) and a two-sentence summary (≤ 260 characters) stating what happened and why a broker would care. Plain, specific, calm — Burgess, not a dealership. Never invent figures. Choose one category from: brokerage, new-builds, shows, sportfish, superyacht, industry. Skip anything that is an advertisement, a listing for sale, or not about yachting; return skip:true for those.

5. Insert. Return `{ fetched, new, skipped, failedSources }`.

## Portal

- **`/dashboard/news`** — "Industry News": list newest first, category chips (All + the six), each item: category tag, headline (links out, `rel="noopener"`, opens new tab), summary, source · date. Featured items pinned at top with a hairline. Native items get a small YachtPics mark. 30 per page, "Load more". Page style matches the dashboard (existing tokens: `label-caps`, `text-ink-*`, `rounded-card`, hairlines).
- **Dashboard card** — "Latest in yachting": top 3 (featured first), one line each, link to the page. Placed where the dashboard already stacks cards.
- **Sidebar link** "News" for brokers and assistants.
- **Admin `/admin/news`** — table of the last 14 days: hide/unhide, feature/unfeature, and "Add a YachtPics item" (title, summary, link, category) → native. AdminNav entry.

## Weekly piece — `/api/cron/news-digest`

Runs from the daily dispatcher on Mondays only (check weekday in ET). Takes the last 7 days' visible items (max 25, featured first), asks Claude for a piece:

   > Write "Yachting this week" for yacht brokers, about 350 words, in the portal's voice: a one-line title (≤ 60 chars, no date), a two-sentence intro, then four to six short paragraphs each opening with the news and closing with what it means for someone selling boats. Cite sources inline as plain text in parentheses. No lists, no headings, no exclamation marks, no emoji. End with one calm sentence that points to the portal's Reel tool — never a hard sell.

Saves a `news_digests` row as `draft` for that Monday (skip if one exists).

- **Admin `/admin/news/digest`** — shows the draft (rendered), editable title/intro/body, **Approve & publish** and **Approve & send** buttons. Approve renders HTML (simple markdown → paragraphs), sets `approved`. Send: emails every broker + assistant who hasn't opted out, marketing-class (unsubscribe footer, `logEmail` type `news_digest_<week>`), subject = the title, body = the piece + "Made with the YachtPics Portal" footer + a link to `/dashboard/news`; sets `sent`. Uses the existing Resend batch helper.

## Website — reads from the portal

- **`/api/news/public`** (GET, no auth, cached 30 min, CORS `*`): `{ items: [ last 20 visible, {title, summary, url, source, category, published_at} ], digest: latest approved/sent {title, intro, html, week_start} | null }`.
- New **`marine-news.php`** for yachtpics-site: fetches that JSON (cURL, 8s timeout), caches to `news-cache.json` for 60 minutes, renders the weekly piece at the top and the last 20 items below, in the site's existing look (header/nav/footer from the current file). If the fetch fails, serves the cache; if no cache, a one-line notice. `<link rel="canonical">`, `<meta description>` from the digest intro. Charlie uploads the one file to his host.

## Not in scope now

Images from sources (rights), per-broker personalisation, comments, an RSS feed of our own, pushing to social.

## What Charlie checks after the push

1. Admin → News: items from this morning's run with sensible headlines, sources named, links open.
2. Broker view: sidebar "News", the page, the dashboard card.
3. Admin → News → Digest: the first Monday draft reads like the portal, not a press release. Edit, approve, send to yourself first.
4. Upload `marine-news.php`; open yachtpics.com/marine-news.php.
