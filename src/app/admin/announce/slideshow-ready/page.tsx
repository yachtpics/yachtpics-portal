import Link from "next/link";
import { requireAdminPage } from "@/lib/requireAdminPage";
import { serviceClient } from "@/lib/publicSlideshow";
import {
  brokersWithoutAccess,
  findPrepareCandidates,
  planSlideshowReady,
  renderForRecipient,
  SLIDESHOW_READY_TYPE,
} from "@/lib/slideshowReadyCampaign";
import SlideshowReadyControls from "./SlideshowReadyControls";
import { emailCampaignReport } from "@/lib/emailReport";
import EmailReportTable from "../_components/EmailReportTable";

export const dynamic = "force-dynamic";
// Looks up every broker's access (~150) and renders three previews.
export const maxDuration = 60;

/**
 * /admin/announce/slideshow-ready — convert brokers without a plan (Oct 29).
 * Step 1 prepares buyer slideshows on their listings (the same change as the
 * broker's own Create Slideshow — src/lib/slideshowPublish.ts); Step 2 sends
 * one "Slideshow ready" email per broker. Nothing happens until Charlie
 * clicks; every send is deduped in email_log.
 */
export default async function SlideshowReadyPage() {
  await requireAdminPage();
  const svc = serviceClient();
  const noAccess = await brokersWithoutAccess(svc);
  const [candidates, plan, report] = await Promise.all([
    findPrepareCandidates(svc, noAccess),
    planSlideshowReady(svc, noAccess),
    emailCampaignReport(svc, SLIDESHOW_READY_TYPE),
  ]);
  const previews = await Promise.all(
    plan.recipients.filter((r) => !r.testLike).slice(0, 3).map(async (r) => ({ r, ...(await renderForRecipient(svc, r)) }))
  );

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <Link href="/admin/announce" className="text-ink-400 hover:text-ink-600 text-sm">← Announcements</Link>
      <h1 className="text-display text-ink-900 mt-1">Slideshow ready</h1>
      <p className="text-ink-500 mt-1 text-sm max-w-3xl">
        For brokers without a plan ({noAccess.size} right now): prepare buyer slideshows on their listings, then send each of them one
        email pointing at their newest boat&rsquo;s slideshow. Their public links stay private until they choose a plan; they can preview
        and see it in the Portal. Campaign key <code className="text-xs">{SLIDESHOW_READY_TYPE}</code>.
      </p>
      {report.totals.sent > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-ink-900 mb-3">Results</h2>
          <EmailReportTable report={report} />
        </section>
      )}
      <SlideshowReadyControls
        candidates={candidates}
        recipients={plan.recipients.map((r) => ({
          brokerId: r.brokerId, name: r.name, email: r.email, vessel: r.featured.vessel, readyCount: r.readyCount, testLike: r.testLike,
        }))}
        alreadySent={plan.alreadySent}
        optedOut={plan.optedOut}
        previews={previews.map((p) => ({ brokerId: p.r.brokerId, name: p.r.name, subject: p.subject, html: p.html }))}
      />
    </div>
  );
}
