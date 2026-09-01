import { createClient as createServiceClient } from "@supabase/supabase-js";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * The deletion log, readable.
 *
 * Born from a real support text: a broker went looking for a video that had
 * never existed, and proving that took an hour of database spelunking. Every
 * photo and video deletion now lands here at the moment it happens — who,
 * what, which boat, how big — so that question is a ten-second lookup.
 */
type Row = {
  id: string;
  happened_at: string;
  media_type: string;
  actor_name: string | null;
  actor_role: string | null;
  context_name: string | null;
  broker_name: string | null;
  filename: string | null;
  storage_host: string | null;
  bytes: number | null;
  photo_count: number | null;
  uploaded_at: string | null;
  uploaded_by_name: string | null;
};

function fmtBytes(b: number | null): string {
  if (!b) return "—";
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(b / 1_048_576))} MB`;
}

export default async function DeletionLogPage({
  searchParams,
}: {
  searchParams: { type?: string; q?: string };
}) {
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let query = supabase
    .from("media_deletions")
    .select("id, happened_at, media_type, actor_name, actor_role, context_name, broker_name, filename, storage_host, bytes, photo_count, uploaded_at, uploaded_by_name")
    .order("happened_at", { ascending: false })
    .limit(500);
  if (searchParams.type === "video" || searchParams.type === "photo") {
    query = query.eq("media_type", searchParams.type);
  }

  const { data: raw } = await query;
  let rows = (raw ?? []) as Row[];

  if (searchParams.q) {
    const q = searchParams.q.toLowerCase();
    rows = rows.filter(
      (r) =>
        (r.context_name ?? "").toLowerCase().includes(q) ||
        (r.broker_name ?? "").toLowerCase().includes(q) ||
        (r.actor_name ?? "").toLowerCase().includes(q) ||
        (r.filename ?? "").toLowerCase().includes(q)
    );
  }

  const selectClass =
    "text-sm bg-white border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500";

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      <div className="mb-1 flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-display text-ink-900">Deletion Log</h1>
        <p className="text-sm text-ink-500">{rows.length} event{rows.length !== 1 ? "s" : ""}</p>
      </div>
      <p className="text-sm text-ink-500 mb-5">
        Every photo and video removed from the portal — who deleted it, from which boat or gallery,
        and when it had originally been uploaded. The answer to &ldquo;was there ever a video on this listing?&rdquo;
      </p>

      <form method="get" className="flex flex-wrap items-end gap-2 mb-5">
        <div>
          <label className="block text-[11px] font-medium text-ink-500 mb-1">Type</label>
          <select name="type" defaultValue={searchParams.type ?? ""} className={selectClass}>
            <option value="">Photos & videos</option>
            <option value="video">Videos only</option>
            <option value="photo">Photos only</option>
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-[11px] font-medium text-ink-500 mb-1">Search boat, broker, person, or file</label>
          <input name="q" defaultValue={searchParams.q ?? ""} placeholder="e.g. Above & Beyond" className={`w-full ${selectClass}`} />
        </div>
        <button type="submit" className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet">
          Filter
        </button>
        <Link href="/admin/deletions" className="text-sm text-ink-500 hover:text-ink-700 px-2 py-2">Clear</Link>
      </form>

      <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-hidden">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-400 p-6">
            Nothing here yet — deletions are recorded from the moment this feature went live.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-hairline bg-ink-50/50">
                  <th className="py-2.5 px-4 label-caps">Deleted</th>
                  <th className="py-2.5 px-4 label-caps">What</th>
                  <th className="py-2.5 px-4 label-caps">Boat / Gallery</th>
                  <th className="py-2.5 px-4 label-caps">By</th>
                  <th className="py-2.5 px-4 label-caps">Size</th>
                  <th className="py-2.5 px-4 label-caps">Was uploaded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-ink-50/50">
                    <td className="py-2.5 px-4 text-ink-500 text-xs whitespace-nowrap tabular-nums">
                      {new Date(r.happened_at).toLocaleString("en-US", {
                        month: "short", day: "numeric", year: "numeric",
                        hour: "numeric", minute: "2-digit",
                        timeZone: "America/New_York", timeZoneName: "short",
                      })}
                    </td>
                    <td className="py-2.5 px-4">
                      <span className={`text-[11px] font-medium rounded px-2 py-0.5 whitespace-nowrap ${r.media_type === "video" ? "bg-accent-100 text-accent-800" : "bg-ink-100 text-ink-600"}`}>
                        {r.media_type === "video"
                          ? "Video"
                          : r.photo_count && r.photo_count > 1
                            ? `${r.photo_count} photos`
                            : "Photo"}
                      </span>
                      {r.filename && (
                        <span className="block text-xs text-ink-500 mt-0.5 max-w-[220px] truncate">{r.filename}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-ink-800">
                      {r.context_name ?? "—"}
                      {r.broker_name && <span className="block text-xs text-ink-400">{r.broker_name}</span>}
                    </td>
                    <td className="py-2.5 px-4 text-ink-600">
                      {r.actor_name ?? "—"}
                      {r.actor_role && <span className="ml-1 text-ink-400 text-xs capitalize">({r.actor_role})</span>}
                    </td>
                    <td className="py-2.5 px-4 text-ink-600 whitespace-nowrap">{fmtBytes(r.bytes)}</td>
                    <td className="py-2.5 px-4 text-ink-500 text-xs whitespace-nowrap">
                      {r.uploaded_at
                        ? new Date(r.uploaded_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                        : "—"}
                      {r.uploaded_by_name && <span className="block text-ink-400">by {r.uploaded_by_name}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-ink-500 mt-3">
        Showing up to 500 most recent. The log survives even if the listing or broker it refers to is later deleted.
      </p>
    </div>
  );
}
