import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAiConfigured, draftNewsDigest, type DigestItemInput } from "@/lib/ai";
import { etDayOfWeek, etWeekStart } from "@/lib/newsDigest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A week of the feed. Enough to write 350 words from, not enough to drown in. */
const MAX_ITEMS = 25;

/**
 * Monday's draft.
 *
 * Reads the week's visible items, asks Claude for the piece, and files it as a
 * draft. That is the whole job: nothing here approves anything, renders any
 * HTML, or sends any email — the draft sits on /admin/news/digest until Charlie
 * has read it.
 *
 * Runs from the daily dispatcher, which only lists it on Mondays; the Monday
 * check is repeated here so that a stray call on a Thursday still does nothing.
 * `?force=1` (behind the cron secret) writes a draft on any day — the way to
 * see the first one without waiting for Monday.
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

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && etDayOfWeek() !== 1) {
    return NextResponse.json({ ok: true, skipped: "not Monday in New York" });
  }
  if (!isAiConfigured()) {
    return NextResponse.json({ ok: true, skipped: "AI is not configured (ANTHROPIC_API_KEY is missing)." });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const weekStart = etWeekStart();

  // One piece per week. A second run on the same Monday — the dispatcher
  // retried, someone pressed the URL — must not overwrite an edited draft.
  const { data: existing, error: existingError } = await admin
    .from("news_digests")
    .select("id, status")
    .eq("week_start", weekStart)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json(
      { ok: false, error: existingError.message, hint: "Has 20260915_industry_news.sql been run?" },
      { status: 500 }
    );
  }
  if (existing) {
    return NextResponse.json({ ok: true, weekStart, skipped: "a digest already exists for this week", status: existing.status });
  }

  // The last seven days, featured first — the same order a broker sees.
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: items, error: itemsError } = await admin
    .from("industry_news")
    .select("id, title, summary, source, category, published_at, featured")
    .eq("hidden", false)
    .gte("published_at", since)
    .order("featured", { ascending: false })
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(MAX_ITEMS);
  if (itemsError) {
    return NextResponse.json({ ok: false, error: itemsError.message }, { status: 500 });
  }

  const rows = items ?? [];
  // Three stories is not a week. Better a quiet Monday than a thin piece.
  if (rows.length < 4) {
    return NextResponse.json({ ok: true, weekStart, skipped: "too few items this week", items: rows.length });
  }

  const input: DigestItemInput[] = rows.map((r) => ({
    title: (r.title as string | null) ?? "",
    summary: (r.summary as string | null) ?? "",
    source: (r.source as string | null) ?? "",
    category: (r.category as string | null) ?? "industry",
  }));

  const draft = await draftNewsDigest(input);
  if (!draft) {
    return NextResponse.json({ ok: false, weekStart, error: "The model didn't return a usable draft", items: rows.length }, { status: 502 });
  }

  const { data: created, error: insertError } = await admin
    .from("news_digests")
    .insert({
      week_start: weekStart,
      title: draft.title,
      intro: draft.intro,
      body_md: draft.body_md,
      status: "draft",
      item_ids: rows.map((r) => r.id as string),
    })
    .select("id, week_start, status")
    .single();

  if (insertError) {
    // 23505 — another invocation won the race and wrote this week's row first.
    if (insertError.code === "23505") {
      return NextResponse.json({ ok: true, weekStart, skipped: "a digest already exists for this week" });
    }
    return NextResponse.json({ ok: false, weekStart, error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    weekStart,
    id: created?.id ?? null,
    status: "draft",
    items: rows.length,
    title: draft.title,
  });
}
