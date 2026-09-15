import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
// Dynamic so the data is read per request rather than frozen at build time.
// The Cache-Control header below is what actually does the caching — Next only
// substitutes its own no-store default when a route doesn't set one.
export const dynamic = "force-dynamic";

/** What yachtpics.com shows. Twenty is a page of news, not an archive. */
const MAX_ITEMS = 20;

/** Half an hour at the edge, and a stale copy served for an hour while it refreshes. */
const CACHE_CONTROL = "public, s-maxage=1800, stale-while-revalidate=3600";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * The feed yachtpics.com reads.
 *
 * Public on purpose: this is the same summary-and-link material brokers see,
 * and the website should never again be a hand-written page that ages. No auth,
 * no personal data, nothing hidden — the service-role client is here only
 * because there is no signed-in user to read through RLS with, and both
 * filters (`hidden = false`, and an approved digest) are applied explicitly.
 */
export async function GET() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const [itemsResult, digestResult] = await Promise.all([
    service
      .from("industry_news")
      .select("title, summary, url, source, category, published_at")
      .eq("hidden", false)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(MAX_ITEMS),
    service
      .from("news_digests")
      .select("week_start, title, intro, html")
      .in("status", ["approved", "sent"])
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (itemsResult.error) {
    return NextResponse.json(
      { items: [], digest: null, error: "News is unavailable" },
      { status: 500, headers: { ...CORS, "Cache-Control": "no-store" } }
    );
  }

  const digest = digestResult.error ? null : digestResult.data ?? null;

  return NextResponse.json(
    { items: itemsResult.data ?? [], digest },
    { headers: { ...CORS, "Cache-Control": CACHE_CONTROL } }
  );
}

/** Browsers ask before they fetch cross-origin. */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, "Cache-Control": CACHE_CONTROL } });
}
