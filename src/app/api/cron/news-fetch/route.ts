import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { NEWS_SOURCES, type NewsSource } from "@/lib/newsSources";
import { parseFeed, type FeedItem } from "@/lib/rss";
import { isAiConfigured, summarizeNews, type NewsInput } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Only the last three days. Older items are somebody else's archive. */
const MAX_AGE_DAYS = 3;
/** A ceiling on one morning's intake, so a feed that dumps its back catalogue can't flood the page. */
const MAX_NEW = 40;
/** Per source. A slow publisher must not spend the whole function's budget. */
const FEED_TIMEOUT_MS = 10_000;
/** Items per model call — small enough to stay inside a sane token budget. */
const BATCH = 10;
/** Several trade-press sites refuse a bare fetch; this is a plain browser string, not a disguise. */
const USER_AGENT =
  "Mozilla/5.0 (compatible; YachtPicsPortal/1.0; +https://portal.yachtpics.com) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";

type SourceResult = { source: NewsSource; items: FeedItem[]; ok: boolean };

type Candidate = {
  title: string;
  url: string;
  excerpt: string;
  publishedAt: string;
  publishedMs: number;
  source: NewsSource;
};

/** Fetch one feed. Returns null for anything that isn't a 200 with a body. */
async function fetchFeed(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8",
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Same article, same row. Campaign parameters differ between the feed and the
 * site, and without this the Monday item reappears on Tuesday wearing a
 * different `utm_source`.
 */
function normaliseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    const drop: string[] = [];
    u.searchParams.forEach((_value, key) => {
      if (/^utm_/i.test(key) || key === "fbclid" || key === "gclid" || key === "mc_cid" || key === "mc_eid") {
        drop.push(key);
      }
    });
    for (let i = 0; i < drop.length; i++) u.searchParams.delete(drop[i]);
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * The daily gather.
 *
 * Reads every source in the list at once, keeps what is genuinely new, asks
 * Claude to rewrite it in the portal's register, and files it. Everything here
 * is designed to fail quietly in one place rather than loudly everywhere: a
 * source that 404s, a feed that has become an HTML holding page, a model call
 * that times out — each costs that item or that publication, not the run.
 *
 * Runs from the daily dispatcher at 13:00 UTC, behind the same cron secret.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    const querySecret = req.nextUrl.searchParams.get("secret");
    if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  if (!isAiConfigured()) {
    return NextResponse.json({ ok: true, skipped: "AI is not configured (ANTHROPIC_API_KEY is missing)." });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Every source, together.
  const results: SourceResult[] = await Promise.all(
    NEWS_SOURCES.map(async (source): Promise<SourceResult> => {
      const xml = await fetchFeed(source.url);
      if (!xml) return { source, items: [], ok: false };
      const items = parseFeed(xml);
      // An empty parse means the address returned something that wasn't a feed.
      return { source, items, ok: items.length > 0 };
    })
  );

  // 2. Recent, unique, dated.
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  const failedSources: string[] = [];
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  let fetched = 0;

  for (const result of results) {
    if (!result.ok) {
      failedSources.push(result.source.name);
      continue;
    }
    fetched += result.items.length;
    for (const item of result.items) {
      // No date means no way to tell this morning's story from last spring's,
      // and importing an undated archive once is worse than missing a source.
      if (!item.publishedAt) continue;
      const ms = Date.parse(item.publishedAt);
      if (Number.isNaN(ms) || ms < cutoff) continue;
      const url = normaliseUrl(item.url);
      if (seen.has(url)) continue;
      seen.add(url);
      candidates.push({
        title: item.title,
        url,
        excerpt: item.excerpt,
        publishedAt: item.publishedAt,
        publishedMs: ms,
        source: result.source,
      });
    }
  }

  // 3. Drop what we already hold. Three weeks of history covers anything a
  //    three-day window could offer up again.
  const since = new Date(Date.now() - 21 * 86_400_000).toISOString();
  const { data: known, error: knownError } = await admin
    .from("industry_news")
    .select("url")
    .gte("fetched_at", since)
    .limit(5000);
  if (knownError) {
    return NextResponse.json(
      { ok: false, error: knownError.message, hint: "Has 20260915_industry_news.sql been run?" },
      { status: 500 }
    );
  }
  const knownUrls = new Set<string>((known ?? []).map((r) => r.url as string));

  const fresh = candidates.filter((c) => !knownUrls.has(c.url));
  fresh.sort((a, b) => b.publishedMs - a.publishedMs);
  const picked = fresh.slice(0, MAX_NEW);

  if (picked.length === 0) {
    return NextResponse.json({ ok: true, fetched, new: 0, skipped: 0, failedSources });
  }

  // 4. Rewrite, in batches, all at once.
  const batches: Candidate[][] = [];
  for (let i = 0; i < picked.length; i += BATCH) batches.push(picked.slice(i, i + BATCH));

  const summarised = await Promise.all(
    batches.map((batch) => {
      const input: NewsInput[] = batch.map((c) => ({ title: c.title, excerpt: c.excerpt, source: c.source.name }));
      return summarizeNews(input);
    })
  );

  type NewsRow = {
    url: string;
    source: string;
    source_url: string;
    title: string;
    summary: string;
    category: string;
    published_at: string;
  };

  const rows: NewsRow[] = [];
  let skipped = 0;
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const result = summarised[b];
    for (let j = 0; j < batch.length; j++) {
      const candidate = batch[j];
      const summary = result[j];
      if (summary.skip) {
        skipped++;
        continue;
      }
      rows.push({
        url: candidate.url,
        source: candidate.source.name,
        source_url: candidate.source.homepage,
        title: summary.title,
        summary: summary.summary,
        category: summary.category,
        published_at: candidate.publishedAt,
      });
    }
  }

  // 5. File. `ignoreDuplicates` is the belt to the filter's braces — two feeds
  //    can carry the same syndicated story under the same address.
  let inserted = 0;
  if (rows.length > 0) {
    const { data, error } = await admin
      .from("industry_news")
      .upsert(rows, { onConflict: "url", ignoreDuplicates: true })
      .select("id");
    if (error) {
      return NextResponse.json({ ok: false, error: error.message, fetched, skipped, failedSources }, { status: 500 });
    }
    inserted = (data ?? []).length;
  }

  return NextResponse.json({ ok: true, fetched, new: inserted, skipped, failedSources });
}
