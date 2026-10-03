import { requireAdminPage } from "@/lib/requireAdminPage";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  announcementHtml, ANNOUNCEMENT_TYPE, ANNOUNCEMENT_SUBJECT, ANNOUNCEMENT_SEND_AFTER, ANNOUNCEMENT_SEND_BEFORE,
} from "@/lib/announcementEmail";
import { depthLooksOpen, DEPTH_LOOKS_OPEN_AT } from "@/lib/depthLooksRelease";
import AnnounceControls from "./AnnounceControls";

export const dynamic = "force-dynamic";

const APPROVE_KEY = `${ANNOUNCEMENT_TYPE}_approved`;

export default async function AdminAnnouncePage() {
  // Role check lives in the page, not only the layout — see requireAdminPage.
  await requireAdminPage();
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const [{ data: profiles }, { count: sentCount }, { data: setting }] = await Promise.all([
    service.from("profiles").select("id, display_email").in("role", ["broker", "assistant"]).eq("email_opt_out", false),
    service.from("email_log").select("id", { count: "exact", head: true }).eq("email_type", ANNOUNCEMENT_TYPE).eq("status", "sent"),
    service.from("app_settings").select("value").eq("key", APPROVE_KEY).maybeSingle(),
  ]);

  const eligible = (profiles ?? []).filter((p) => p.display_email).length;
  const alreadySent = sentCount ?? 0;
  const approved = setting?.value === true;

  // The Vercel dispatcher fires at 13:00 UTC every day — 9am Eastern — and now
  // calls the announce job daily rather than only on Mondays. So the label
  // names the NEXT run, computed fresh on each page load.
  //
  // It used to print this campaign's ANNOUNCEMENT_SEND_AFTER date, which went
  // stale the moment that day passed: the button read "Approve for Monday"
  // above a date a week gone, while approving would actually have armed a send
  // for whenever the job next happened to run. A stale date on a control that
  // mails 148 people is worth fixing before it is worth explaining.
  //
  // The cron also refuses to send before ANNOUNCEMENT_SEND_AFTER, so the next
  // run that can actually send is the first 13:00 UTC at or after that moment.
  const nextRun = (() => {
    const windowOpens = Date.parse(ANNOUNCEMENT_SEND_AFTER);
    const from = new Date(Math.max(Date.now(), windowOpens));
    const run = new Date(from);
    run.setUTCHours(13, 0, 0, 0);
    return from.getTime() <= run.getTime() ? run : new Date(run.getTime() + 86_400_000);
  })();
  const windowClosed = Date.now() > Date.parse(ANNOUNCEMENT_SEND_BEFORE);
  const scheduleLabel = windowClosed
    ? "— the scheduled window has closed (use Send now, or move the dates in announcementEmail.ts)"
    : nextRun.toLocaleString("en-US", {
        weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
      }) + " ET";

  const previewHtml = announcementHtml({ firstName: "Charlie", unsubToken: "preview" });

  // This campaign announces Walkthrough and Underway, which brokers can only
  // open from DEPTH_LOOKS_OPEN_AT. The scheduled window already starts there;
  // "Send now" ignores the window, so say so while it would jump the gun.
  const opensOn = new Date(Date.parse(DEPTH_LOOKS_OPEN_AT)).toLocaleString("en-US", {
    weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  }) + " ET";
  const sendNowWarning = depthLooksOpen()
    ? null
    : `Brokers can't see Walkthrough and Underway until ${opensOn}. Sending now would announce looks they can't open yet.`;

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-display text-ink-900">Announcement</h1>
        <p className="text-ink-500 text-sm mt-1">&ldquo;{ANNOUNCEMENT_SUBJECT}&rdquo;</p>
        <p className="text-ink-400 text-xs mt-1">The Walkthrough and Underway reel looks, open to every broker from {opensOn}.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Preview */}
        <div>
          <p className="label-caps mb-2">Preview</p>
          <div className="border border-hairline rounded-card shadow-elev-1 overflow-hidden bg-ink-50">
            <iframe srcDoc={previewHtml} title="Announcement preview" className="w-full" style={{ height: 640, border: "none", background: "#f8f9fa" }} />
          </div>
        </div>

        {/* Controls */}
        <AnnounceControls
          eligible={eligible}
          alreadySent={alreadySent}
          initialApproved={approved}
          scheduleLabel={scheduleLabel}
          sendNowWarning={sendNowWarning}
        />
      </div>
    </div>
  );
}
