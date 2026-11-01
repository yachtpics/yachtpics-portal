import Link from "next/link";
import { requireAdminPage } from "@/lib/requireAdminPage";
import { serviceClient } from "@/lib/publicSlideshow";
import {
  isCompletedMonth, isMonth, monthLabel, monthlyAutoOn, monthlyBatchSent, planMonthlyReport, previousMonthET,
  recentMonths, renderMonthly, type MonthlyRecipient,
} from "@/lib/monthlyReport";
import type { EmailImage } from "@/lib/emailCoverImage";
import { emailCampaignReport } from "@/lib/emailReport";
import EmailReportTable from "../_components/EmailReportTable";
import MonthlyReportControls from "./MonthlyReportControls";

export const dynamic = "force-dynamic";
// Looks up every broker's access (~140), a month of engagement, three previews.
export const maxDuration = 120;

/** Three previews that show the range: a broker with views, one without a plan, an assistant. */
function pickPreviews(rs: MonthlyRecipient[]): MonthlyRecipient[] {
  const views = (r: MonthlyRecipient) => r.blocks.reduce((t, b) => t + b.totals.views, 0);
  const out: MonthlyRecipient[] = [];
  const add = (r: MonthlyRecipient | undefined) => { if (r && !out.includes(r)) out.push(r); };
  const brokers = rs.filter((r) => r.kind === "broker");
  add(brokers.slice().sort((a, b) => views(b) - views(a))[0]);
  add(brokers.find((r) => !r.blocks[0].hasAccess && r.blocks[0].listings.length > 1) ?? brokers.find((r) => !r.blocks[0].hasAccess));
  add(rs.find((r) => r.kind === "assistant" && r.blocks.length > 1) ?? rs.find((r) => r.kind === "assistant"));
  for (const r of rs) { if (out.length >= 3) break; add(r); }
  return out.slice(0, 3);
}

/**
 * /admin/announce/monthly-report — "Your boats this month" (Nov 1). Last
 * month's Seller Report numbers, pushed to every broker with live listings
 * and their assistants (src/lib/monthlyReport.ts). Send by hand with typed
 * SEND, or switch on "Schedule automatically" and the daily cron sends it on
 * the 1st at ~9 AM ET.
 */
export default async function MonthlyReportPage({ searchParams }: { searchParams: { month?: string } }) {
  await requireAdminPage();
  const svc = serviceClient();
  const month = isMonth(searchParams.month) && isCompletedMonth(searchParams.month) ? searchParams.month : previousMonthET();
  const [plan, autoOn, sentCount] = await Promise.all([planMonthlyReport(svc, month), monthlyAutoOn(svc), monthlyBatchSent(svc, month)]);
  const report = sentCount > 0 ? await emailCampaignReport(svc, plan.type) : null;
  const images = new Map<string, EmailImage | null>();
  const previews = [];
  for (const r of pickPreviews(plan.recipients)) previews.push({ r, ...(await renderMonthly(svc, r, month, images)) });

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <Link href="/admin/announce" className="text-ink-400 hover:text-ink-600 text-sm">← Announcements</Link>
      <h1 className="text-display text-ink-900 mt-1">Your boats this month</h1>
      <p className="text-ink-500 mt-1 text-sm max-w-3xl">
        Each broker with live listings — paying or not — gets last month&rsquo;s numbers for every active boat: buyer views, visitors,
        the photo buyers lingered on, dock-card scans, photo downloads and inquiries. Their assistants get the same, addressed to them.
        Brokers without a plan get one quiet plan line at the end. Campaign key <code className="text-xs">{plan.type}</code>.
      </p>
      {report && report.totals.sent > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-ink-900 mb-3">Results · {monthLabel(month)}</h2>
          <EmailReportTable report={report} />
        </section>
      )}
      <MonthlyReportControls
        month={month}
        monthLabel={monthLabel(month)}
        months={recentMonths(6).map((m) => ({ value: m, label: monthLabel(m) }))}
        autoOn={autoOn}
        sentCount={sentCount}
        counts={{
          brokers: plan.brokers, assistants: plan.assistants, alreadySent: plan.alreadySent, optedOut: plan.optedOut,
          bounced: plan.bounced, noEmail: plan.noEmail, testSkipped: plan.testSkipped, listings: plan.listings,
        }}
        recipients={plan.recipients.map((r) => ({
          key: r.key,
          kind: r.kind,
          name: r.name,
          email: r.email,
          brokers: r.kind === "assistant" ? r.blocks.map((b) => b.name) : [],
          boats: r.blocks.reduce((t, b) => t + b.totals.boats, 0),
          views: r.blocks.reduce((t, b) => t + b.totals.views, 0),
          plan: r.blocks.every((b) => b.hasAccess),
        }))}
        previews={previews.map((p) => ({ key: p.r.key, name: p.r.name, kind: p.r.kind, subject: p.subject, html: p.html }))}
      />
    </div>
  );
}
