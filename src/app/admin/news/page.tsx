import { requireAdminPage } from "@/lib/requireAdminPage";
import Link from "next/link";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import NewsControls, { type NewsAdminRow } from "./NewsControls";

export const dynamic = "force-dynamic";

/**
 * Industry News, from the inside.
 *
 * The last fortnight of everything the daily job filed — including the items
 * already hidden, because the point of this page is to change your mind about
 * one. Hiding never deletes: the row stays so tomorrow's run doesn't fetch the
 * same story again.
 */

type Raw = {
  id: string;
  url: string;
  source: string | null;
  title: string | null;
  summary: string | null;
  category: string | null;
  published_at: string | null;
  fetched_at: string | null;
  featured: boolean | null;
  hidden: boolean | null;
  native: boolean | null;
};

export default async function AdminNewsPage() {
  // Role check lives in the page, not only the layout — see requireAdminPage.
  await requireAdminPage();
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data, error } = await service
    .from("industry_news")
    .select("id, url, source, title, summary, category, published_at, fetched_at, featured, hidden, native")
    .gte("fetched_at", since)
    .order("featured", { ascending: false })
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(500);

  const rows: NewsAdminRow[] = ((data ?? []) as Raw[]).map((r) => ({
    id: r.id,
    url: r.url,
    source: r.source ?? "—",
    title: r.title ?? "(untitled)",
    summary: r.summary ?? "",
    category: r.category ?? "industry",
    published_at: r.published_at,
    fetched_at: r.fetched_at,
    featured: !!r.featured,
    hidden: !!r.hidden,
    native: !!r.native,
  }));

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-display text-ink-900">Industry News</h1>
          <p className="text-ink-500 text-sm mt-1">
            The trade press, gathered every morning and rewritten in the portal&rsquo;s voice. Hide anything that
            shouldn&rsquo;t be there; feature anything that should lead.
          </p>
        </div>
        {/* The weekly piece lives one level down — it isn't in the sidebar
            because a second "News" tab there reads as a duplicate. */}
        <Link
          href="/admin/news/digest"
          className="shrink-0 bg-ink-950 hover:bg-ink-800 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
        >
          Yachting this week →
        </Link>
      </div>

      {error ? (
        <div className="bg-danger-50 border border-danger-200 text-danger-700 rounded-card px-4 py-3 text-sm">
          Couldn&rsquo;t read the news table: {error.message}
          <span className="block text-xs mt-1 text-danger-700/80">
            If this says the relation does not exist, run supabase/migrations/20260915_industry_news.sql.
          </span>
        </div>
      ) : (
        <NewsControls rows={rows} />
      )}
    </div>
  );
}
