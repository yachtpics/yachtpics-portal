import { createClient as createServiceClient } from "@supabase/supabase-js";
import Link from "next/link";

export const dynamic = "force-dynamic";

type EmailRow = {
  id: string;
  sent_at: string;
  email_type: string;
  recipient_email: string;
  recipient_role: string | null;
  broker_id: string | null;
  listing_id: string | null;
  subject: string | null;
  status: string;
};

const TYPE_LABELS: Record<string, string> = {
  broker_invite: "Broker invite",
  assistant_invite: "Assistant invite",
  assistant_added: "Assistant added",
  resend_invite: "Resent login",
  photos_ready: "Photos ready",
  video_ready: "Video ready",
  media_ready: "Photos & video ready",
  welcome: "Welcome",
  download_link: "Download link",
  client_send: "Sent to client",
};

const DAYS_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "0", label: "All time" },
];

function typeLabel(t: string) {
  return TYPE_LABELS[t] ?? t;
}

export default async function EmailLogPage({
  searchParams,
}: {
  searchParams: { type?: string; status?: string; days?: string; q?: string };
}) {
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const days = searchParams.days ?? "90";
  const daysNum = Number(days);

  let query = supabase
    .from("email_log")
    .select("id, sent_at, email_type, recipient_email, recipient_role, broker_id, listing_id, subject, status")
    .order("sent_at", { ascending: false })
    .limit(500);

  if (daysNum > 0) {
    query = query.gte("sent_at", new Date(Date.now() - daysNum * 86400000).toISOString());
  }
  if (searchParams.type) query = query.eq("email_type", searchParams.type);
  if (searchParams.status) query = query.eq("status", searchParams.status);

  const { data: rowsRaw } = await query;
  let logs = (rowsRaw ?? []) as EmailRow[];

  if (searchParams.q) {
    const q = searchParams.q.toLowerCase();
    logs = logs.filter(
      (r) =>
        r.recipient_email?.toLowerCase().includes(q) ||
        (r.subject ?? "").toLowerCase().includes(q)
    );
  }

  // Resolve broker + listing names
  const brokerIds = Array.from(new Set(logs.map((r) => r.broker_id).filter((x): x is string => !!x)));
  const listingIds = Array.from(new Set(logs.map((r) => r.listing_id).filter((x): x is string => !!x)));

  const { data: profs } = brokerIds.length
    ? await supabase.from("profiles").select("id, first_name, last_name, display_email").in("id", brokerIds)
    : { data: [] as { id: string; first_name: string | null; last_name: string | null; display_email: string | null }[] };
  const { data: lsts } = listingIds.length
    ? await supabase.from("listings").select("id, vessel_name").in("id", listingIds)
    : { data: [] as { id: string; vessel_name: string | null }[] };

  const brokerMap = new Map(
    (profs ?? []).map((p) => [
      p.id,
      p.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : p.display_email ?? "—",
    ])
  );
  const listingMap = new Map((lsts ?? []).map((l) => [l.id, l.vessel_name ?? "—"]));

  const sentCount = logs.filter((l) => l.status === "sent").length;
  const failedCount = logs.filter((l) => l.status === "failed").length;

  const selectClass =
    "text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#d4a843]";

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      <div className="mb-1 flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-gray-900">Email Log</h1>
        <p className="text-sm text-gray-500">
          {logs.length} email{logs.length !== 1 ? "s" : ""}
          {failedCount > 0 && <span className="text-red-600"> · {failedCount} failed</span>}
          {failedCount === 0 && sentCount > 0 && <span className="text-green-600"> · all delivered</span>}
        </p>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Every message the portal has sent — invites, photo/video notifications, welcome emails, download links, and client sends.
      </p>

      {/* Filters */}
      <form method="get" className="flex flex-wrap items-end gap-2 mb-5">
        <div>
          <label className="block text-[11px] font-medium text-gray-400 mb-1">Type</label>
          <select name="type" defaultValue={searchParams.type ?? ""} className={selectClass}>
            <option value="">All types</option>
            {Object.keys(TYPE_LABELS).map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-400 mb-1">Status</label>
          <select name="status" defaultValue={searchParams.status ?? ""} className={selectClass}>
            <option value="">All</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-400 mb-1">Range</label>
          <select name="days" defaultValue={days} className={selectClass}>
            {DAYS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-[11px] font-medium text-gray-400 mb-1">Search recipient or subject</label>
          <input name="q" defaultValue={searchParams.q ?? ""} placeholder="email or subject…" className={`w-full ${selectClass}`} />
        </div>
        <button type="submit" className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
          Filter
        </button>
        <Link href="/admin/emails" className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2">Clear</Link>
      </form>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {logs.length === 0 ? (
          <p className="text-sm text-gray-400 p-6">No emails match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 font-medium border-b border-gray-100 bg-gray-50/50">
                  <th className="py-2.5 px-4">Sent</th>
                  <th className="py-2.5 px-4">Type</th>
                  <th className="py-2.5 px-4">Recipient</th>
                  <th className="py-2.5 px-4">Listing</th>
                  <th className="py-2.5 px-4">Broker</th>
                  <th className="py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/50">
                    <td className="py-2.5 px-4 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(r.sent_at).toLocaleString("en-US", {
                        month: "short", day: "numeric", year: "numeric",
                        hour: "numeric", minute: "2-digit",
                        timeZone: "America/New_York", timeZoneName: "short",
                      })}
                    </td>
                    <td className="py-2.5 px-4">
                      <span className="text-[11px] font-medium bg-gray-100 text-gray-700 rounded px-2 py-0.5 whitespace-nowrap">
                        {typeLabel(r.email_type)}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-gray-800">
                      {r.recipient_email}
                      {r.recipient_role && (
                        <span className="ml-1 text-gray-400 text-xs capitalize">({r.recipient_role})</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-gray-600">
                      {r.listing_id ? listingMap.get(r.listing_id) ?? "—" : "—"}
                    </td>
                    <td className="py-2.5 px-4 text-gray-600">
                      {r.broker_id ? brokerMap.get(r.broker_id) ?? "—" : "—"}
                    </td>
                    <td className="py-2.5 px-4">
                      {r.status === "failed" ? (
                        <span className="text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-2 py-0.5">Failed</span>
                      ) : (
                        <span className="text-[11px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded px-2 py-0.5">Sent</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Showing up to 500 most recent. Logging began when this feature went live — earlier sends aren&apos;t recorded here.
      </p>
    </div>
  );
}
