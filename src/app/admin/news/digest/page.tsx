import Link from "next/link";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { DIGEST_SELECT, digestEmailType, digestWeekLabel, type DigestRow } from "@/lib/newsDigest";
import DigestEditor from "./DigestEditor";

export const dynamic = "force-dynamic";

/**
 * "Yachting this week", before anyone has seen it.
 *
 * Monday's cron leaves a draft here and stops. Everything after that is
 * Charlie's: read it, fix the sentence that sounds like a press release,
 * approve it, send yourself a copy, then send it to everyone.
 */
export default async function AdminNewsDigestPage() {
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const [digestsResult, profilesResult] = await Promise.all([
    service.from("news_digests").select(DIGEST_SELECT).order("week_start", { ascending: false }).limit(13),
    service.from("profiles").select("id, display_email").in("role", ["broker", "assistant"]).eq("email_opt_out", false),
  ]);

  const rows = (digestsResult.data ?? []) as unknown as DigestRow[];
  const latest = rows[0] ?? null;
  const past = rows.slice(1);
  const eligibleIds = new Set<string>(
    (profilesResult.data ?? []).filter((p) => p.display_email).map((p) => p.id as string),
  );
  const eligible = eligibleIds.size;

  // How many of this week's ELIGIBLE recipients already have it — the dedup,
  // shown. Counting every sent row would include people who've since opted
  // out and could read "0 remaining" while others still lack it.
  let alreadySent = 0;
  if (latest) {
    const { data: sentRows } = await service
      .from("email_log")
      .select("recipient_id")
      .eq("email_type", digestEmailType(latest.week_start))
      .eq("status", "sent");
    alreadySent = (sentRows ?? []).filter((r) => r.recipient_id && eligibleIds.has(r.recipient_id as string)).length;
  }

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-display text-ink-900">Yachting this week</h1>
          <p className="text-ink-500 text-sm mt-1">
            The weekly piece, drafted from the feed every Monday morning and held here until you approve it. Nothing
            publishes or sends on its own.
          </p>
        </div>
        <Link
          href="/admin/news"
          className="shrink-0 text-sm text-ink-600 bg-white border border-hairline-strong hover:border-ink-400 px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
        >
          ← The feed
        </Link>
      </div>

      {digestsResult.error ? (
        <div className="bg-danger-50 border border-danger-200 text-danger-700 rounded-card px-4 py-3 text-sm">
          Couldn&rsquo;t read the digests table: {digestsResult.error.message}
          <span className="block text-xs mt-1 text-danger-700/80">
            If this says the relation does not exist, run supabase/migrations/20260915_industry_news.sql.
          </span>
        </div>
      ) : latest ? (
        <DigestEditor digest={latest} eligible={eligible} alreadySent={alreadySent} />
      ) : (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 px-6 py-12 text-center">
          <p className="text-sm text-ink-500">No piece has been drafted yet.</p>
          <p className="text-sm text-ink-400 mt-1">
            The draft is written on Monday mornings from the week&rsquo;s feed. It needs at least four visible items to
            be worth writing.
          </p>
        </div>
      )}

      {past.length > 0 && (
        <div className="mt-8">
          <p className="label-caps mb-2">Earlier weeks</p>
          <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-hidden">
            <ul className="divide-y divide-hairline">
              {past.map((d) => (
                <li key={d.id} className="px-5 py-4">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <p className="text-sm font-semibold text-ink-900">{d.title}</p>
                    <p className="text-xs text-ink-400 shrink-0">
                      {digestWeekLabel(d.week_start)} &middot;{" "}
                      {d.status === "sent" ? "Sent" : d.status === "approved" ? "Approved" : "Draft"}
                    </p>
                  </div>
                  <p className="text-xs text-ink-500 mt-1 leading-relaxed">{d.intro}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
