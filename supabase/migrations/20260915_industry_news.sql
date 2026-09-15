-- Sept 15, 2026 — Industry News.
-- NOT yet applied. Run this in the Supabase SQL editor (or via the MCP) before
-- the first /api/cron/news-fetch, otherwise the job returns a "relation does
-- not exist" error and files nothing.
--
-- Two tables: the daily feed, and the weekly piece drafted from it.
-- Additive only; safe to run twice.

-- ── The feed ──────────────────────────────────────────────────────────────
create table if not exists public.industry_news (
  id            uuid primary key default gen_random_uuid(),
  url           text unique not null,
  source        text not null,                     -- "BOAT International"
  source_url    text,                              -- the publication's homepage
  title         text not null,                     -- rewritten headline, <= 90 chars
  summary       text not null,                     -- two sentences, <= 260 chars
  category      text not null,                     -- brokerage | new-builds | shows | sportfish | superyacht | industry
  published_at  timestamptz,
  fetched_at    timestamptz not null default now(),
  featured      boolean not null default false,
  hidden        boolean not null default false,
  native        boolean not null default false     -- YachtPics' own item, entered by an admin
);

create index if not exists industry_news_published_idx on public.industry_news(published_at desc);
create index if not exists industry_news_category_idx on public.industry_news(category);
-- The daily job asks "what have we filed lately?" before it writes.
create index if not exists industry_news_fetched_idx on public.industry_news(fetched_at desc);

alter table public.industry_news enable row level security;

-- Brokers and assistants read the feed; nothing writes through this policy.
-- Every insert and update goes through the service role (the cron job and the
-- admin API), so hiding an item really does hide it.
drop policy if exists "Signed-in users can read visible news" on public.industry_news;
create policy "Signed-in users can read visible news"
  on public.industry_news for select
  to authenticated
  using (hidden = false);

-- ── The weekly piece ──────────────────────────────────────────────────────
create table if not exists public.news_digests (
  id           uuid primary key default gen_random_uuid(),
  week_start   date unique not null,               -- the Monday
  title        text not null,
  intro        text not null,
  body_md      text not null,                      -- the piece, markdown
  html         text,                               -- rendered for email and the site, set on approve
  status       text not null default 'draft'
                 check (status in ('draft', 'approved', 'sent')),
  item_ids     uuid[] not null default '{}',
  created_at   timestamptz not null default now(),
  approved_at  timestamptz,
  sent_at      timestamptz
);

create index if not exists news_digests_week_idx on public.news_digests(week_start desc);

alter table public.news_digests enable row level security;

-- A draft is Charlie's until he approves it; nobody else sees it.
drop policy if exists "Signed-in users can read published digests" on public.news_digests;
create policy "Signed-in users can read published digests"
  on public.news_digests for select
  to authenticated
  using (status in ('approved', 'sent'));
