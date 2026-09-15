import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { NEWS_CATEGORIES, NEWS_CATEGORY_LABELS, isNewsCategory } from "@/lib/newsSources";

export const dynamic = "force-dynamic";

/**
 * Industry News.
 *
 * What the yachting trade press said, in the portal's words, with the link to
 * the source. We summarise and credit; we never republish. The list is
 * gathered by /api/cron/news-fetch each morning and needs no hands.
 */

const PAGE = 30;

type Row = {
  id: string;
  url: string;
  source: string;
  source_url: string | null;
  title: string;
  summary: string;
  category: string;
  published_at: string | null;
  featured: boolean | null;
  native: boolean | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

function categoryLabel(value: string): string {
  return isNewsCategory(value) ? NEWS_CATEGORY_LABELS[value] : value;
}

function chipClass(active: boolean): string {
  return `text-xs font-medium px-3 py-2 rounded-ctl border transition-colors duration-fast ease-quiet whitespace-nowrap ${
    active
      ? "bg-ink-950 text-white border-ink-950"
      : "bg-white text-ink-600 border-hairline-strong hover:border-ink-400 hover:text-ink-900"
  }`;
}

function NewsRow({ row }: { row: Row }) {
  const date = fmtDate(row.published_at);
  return (
    <article className="px-5 py-4 sm:px-6 sm:py-5">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="label-caps">{categoryLabel(row.category)}</span>
        {row.native && (
          <span className="text-[10px] font-medium uppercase tracking-caps text-accent-700 border border-accent-200 bg-accent-50 rounded-full px-2 py-0.5 leading-none">
            YachtPics
          </span>
        )}
      </div>
      <h2 className="text-h2 text-ink-900">
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-accent-700 transition-colors duration-fast ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 rounded-sm"
        >
          {row.title}
        </a>
      </h2>
      <p className="text-sm text-ink-600 leading-relaxed mt-1.5">{row.summary}</p>
      <p className="text-xs text-ink-400 mt-2.5">
        {row.source_url ? (
          <a
            href={row.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-500 hover:text-ink-700 transition-colors duration-fast"
          >
            {row.source}
          </a>
        ) : (
          <span className="text-ink-500">{row.source}</span>
        )}
        {date && <span> &middot; {date}</span>}
      </p>
    </article>
  );
}

export default async function DashboardNewsPage({
  searchParams,
}: {
  searchParams: { category?: string; show?: string };
}) {
  const supabase = await createClient();

  const active = isNewsCategory(searchParams.category) ? searchParams.category : null;
  const requested = Number(searchParams.show);
  const show = Number.isFinite(requested) ? Math.min(300, Math.max(PAGE, Math.round(requested))) : PAGE;

  let query = supabase
    .from("industry_news")
    .select("id, url, source, source_url, title, summary, category, published_at, featured, native")
    .eq("hidden", false)
    .order("featured", { ascending: false })
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(show + 1);
  if (active) query = query.eq("category", active);

  const { data } = await query;
  const all = (data ?? []) as Row[];
  const hasMore = all.length > show;
  const rows = all.slice(0, show);

  const featured = rows.filter((r) => !!r.featured);
  const rest = rows.filter((r) => !r.featured);

  const href = (category: string | null, count: number) => {
    const parts: string[] = [];
    if (category) parts.push(`category=${encodeURIComponent(category)}`);
    if (count !== PAGE) parts.push(`show=${count}`);
    return parts.length > 0 ? `/dashboard/news?${parts.join("&")}` : "/dashboard/news";
  };

  return (
    <div className="px-4 sm:px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-6 pb-6 border-b border-hairline">
        <h1 className="text-display text-ink-900">Industry News</h1>
        <p className="text-ink-500 text-sm mt-1">
          What the yachting trade press is reporting, gathered each morning and kept short. Every headline links
          straight to the publication that wrote it.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <Link href={href(null, PAGE)} className={chipClass(active === null)}>
          All
        </Link>
        {NEWS_CATEGORIES.map((c) => (
          <Link key={c} href={href(c, PAGE)} className={chipClass(active === c)}>
            {NEWS_CATEGORY_LABELS[c]}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 px-6 py-12 text-center">
          <p className="text-sm text-ink-500">
            {active ? "Nothing under this heading yet." : "Nothing here yet."}
          </p>
          <p className="text-sm text-ink-400 mt-1">The portal gathers the trade press every morning; check back tomorrow.</p>
        </div>
      ) : (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-hidden">
          {featured.length > 0 && (
            <>
              <div className="divide-y divide-hairline">
                {featured.map((row) => (
                  <NewsRow key={row.id} row={row} />
                ))}
              </div>
              {rest.length > 0 && <div className="border-t border-hairline-strong" />}
            </>
          )}
          <div className="divide-y divide-hairline">
            {rest.map((row) => (
              <NewsRow key={row.id} row={row} />
            ))}
          </div>
        </div>
      )}

      {hasMore && (
        <div className="mt-5 text-center">
          <Link
            href={href(active, show + PAGE)}
            className="inline-block text-sm text-ink-600 bg-white border border-hairline-strong hover:border-ink-400 px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
          >
            Load more
          </Link>
        </div>
      )}

      <p className="text-center text-ink-400 text-xs mt-6">
        Summaries are written for the portal. Follow the link for the full story at the source.
      </p>
    </div>
  );
}
