import Link from "next/link";
import { requireAdminPage } from "@/lib/requireAdminPage";
import { serviceClient } from "@/lib/publicSlideshow";
import { emailCampaignReport, trackedEmailTypes } from "@/lib/emailReport";
import EmailReportTable from "../_components/EmailReportTable";

export const dynamic = "force-dynamic";

/** /admin/announce/report?type=… — opens, clicks and sign-ins for any tracked email send. */
export default async function EmailReportPage({ searchParams }: { searchParams: { type?: string } }) {
  await requireAdminPage();
  const svc = serviceClient();
  const type = (searchParams.type ?? "").trim();
  const [types, report] = await Promise.all([trackedEmailTypes(svc), type ? emailCampaignReport(svc, type) : Promise.resolve(null)]);

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <Link href="/admin/announce" className="text-ink-400 hover:text-ink-600 text-sm">← Announcements</Link>
      <h1 className="text-display text-ink-900 mt-1">Email results</h1>
      <div className="flex flex-wrap gap-2 mt-3">
        {types.length === 0 && <p className="text-sm text-ink-500">No tracked sends yet.</p>}
        {types.map((t) => (
          <Link
            key={t.type}
            href={`/admin/announce/report?type=${encodeURIComponent(t.type)}`}
            className={`text-xs rounded-full border px-3 py-1 ${t.type === type ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 text-ink-600 hover:border-ink-400"}`}
          >
            {t.type} <span className="opacity-60">({t.count})</span>
          </Link>
        ))}
      </div>
      {report && (
        <div className="mt-6">
          <EmailReportTable report={report} />
        </div>
      )}
    </div>
  );
}
