import { requireAdminPage } from "@/lib/requireAdminPage";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  ANNOUNCEMENT_CAMPAIGNS, announcementApproveKey, type AnnouncementCampaign,
} from "@/lib/announcementEmail";
import { planAnnouncement } from "@/lib/sendAnnouncement";
import { DEPTH_LOOKS_OPEN_AT, DEPTH_LOOKS_SUBSCRIBER_OPEN_AT } from "@/lib/depthLooksRelease";
import AnnounceControls from "./AnnounceControls";

export const dynamic = "force-dynamic";
// The subscriber campaign's audience looks up ~150 brokers' access.
export const maxDuration = 60;

const ET_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
};
const fmtET = (ms: number) => new Date(ms).toLocaleString("en-US", ET_FORMAT) + " ET";

/**
 * The next daily cron run that can send this campaign.
 *
 * The Vercel dispatcher fires at 13:00 UTC every day — 9am Eastern — and calls
 * the announce job daily. So the label names the NEXT run, computed fresh on
 * each page load (a fixed date went stale the moment that day passed, on a
 * control that mails ~150 people). The cron also refuses to send before the
 * campaign's sendAfter, so it is the first 13:00 UTC at or after that moment.
 */
function scheduleLabelFor(c: AnnouncementCampaign): string {
  const windowOpens = Date.parse(c.sendAfter);
  const from = new Date(Math.max(Date.now(), windowOpens));
  const run = new Date(from);
  run.setUTCHours(13, 0, 0, 0);
  const next = from.getTime() <= run.getTime() ? run : new Date(run.getTime() + 86_400_000);
  if (Date.now() > Date.parse(c.sendBefore) || next.getTime() >= Date.parse(c.sendBefore)) {
    return "— the scheduled window has closed (use Send now, or move the dates in announcementEmail.ts)";
  }
  return fmtET(next.getTime());
}

/**
 * "Send now" ignores the window. Both campaigns announce looks that open at a
 * set instant (subscribers Oct 5, everyone Oct 9), so warn while sending would
 * jump the gun.
 */
function sendNowWarningFor(c: AnnouncementCampaign): string | null {
  const opensAt = Date.parse(c.audience === "subscribers" ? DEPTH_LOOKS_SUBSCRIBER_OPEN_AT : DEPTH_LOOKS_OPEN_AT);
  if (Date.now() >= opensAt) return null;
  const who = c.audience === "subscribers" ? "Subscribers" : "Brokers";
  return `${who} can't see Walkthrough and Underway until ${fmtET(opensAt)}. Sending now would announce looks they can't open yet.`;
}

export default async function AdminAnnouncePage() {
  // Role check lives in the page, not only the layout — see requireAdminPage.
  await requireAdminPage();
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const rows = await Promise.all(
    ANNOUNCEMENT_CAMPAIGNS.map(async (c) => {
      const [plan, { data: setting }] = await Promise.all([
        planAnnouncement(service, c),
        service.from("app_settings").select("value").eq("key", announcementApproveKey(c)).maybeSingle(),
      ]);
      return { c, plan, approved: setting?.value === true };
    })
  );

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-display text-ink-900">Announcements</h1>
        <p className="text-ink-500 text-sm mt-1">
          Each campaign has its own window, approval and dedup. Approve each one separately.
        </p>
      </div>

      <div className="space-y-12">
        {rows.map(({ c, plan, approved }) => (
          <section key={c.type}>
            <div className="mb-4">
              <h2 className="text-h2 text-ink-900">{c.label}</h2>
              <p className="text-ink-500 text-sm mt-1">&ldquo;{c.subject}&rdquo;</p>
              <p className="text-ink-400 text-xs mt-1">{c.description}</p>
              <p className="text-ink-400 text-xs mt-1">
                Window: {fmtET(Date.parse(c.sendAfter))} → {fmtET(Date.parse(c.sendBefore))} · approval key <code>{announcementApproveKey(c)}</code>
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Preview */}
              <div>
                <p className="label-caps mb-2">Preview</p>
                <div className="border border-hairline rounded-card shadow-elev-1 overflow-hidden bg-ink-50">
                  <iframe
                    srcDoc={c.html({ firstName: "Charlie", unsubToken: "preview" })}
                    title={`${c.label} preview`}
                    className="w-full"
                    style={{ height: 640, border: "none", background: "#f8f9fa" }}
                  />
                </div>
              </div>

              {/* Controls */}
              <AnnounceControls
                campaignType={c.type}
                audienceLabel={c.audience === "subscribers" ? "subscribers & their assistants" : "brokers & assistants"}
                eligible={plan.recipients.length}
                alreadySent={plan.skippedAlreadySent}
                excluded={plan.skippedExcluded}
                initialApproved={approved}
                scheduleLabel={scheduleLabelFor(c)}
                sendNowWarning={sendNowWarningFor(c)}
              />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
