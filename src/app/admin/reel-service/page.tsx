import { requireAdminPage } from "@/lib/requireAdminPage";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { isPeriod, loadReelServiceEnrolment, periodET } from "@/lib/reelService";
import { parseShotInfo } from "@/lib/reelClips";
import { metaAppIdConfigured } from "@/lib/meta/config";
import ReelServiceBoard, { type BoardJob, type BoardSub, type BoardVideo } from "./ReelServiceBoard";

export const dynamic = "force-dynamic";

/**
 * Reel Service — admin only.
 *
 * The month's planned reels for every enrolled broker: plan, re-plan, change
 * a look, make them (one at a time, in this browser, with the ordinary
 * ReelMaker engine), and deliver them (status + one email per person).
 */
export default async function ReelServicePage({ searchParams }: { searchParams: { period?: string } }) {
  await requireAdminPage();
  const period = isPeriod(searchParams?.period) ? searchParams.period! : periodET();
  const admin = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const [{ data: subs, error: subErr }, { data: jobs }] = await Promise.all([
    admin.from("reel_service_subscriptions")
      .select("broker_id, enabled, reels_per_listing, note, started_at, profiles:broker_id(first_name, last_name, display_email)")
      .order("started_at", { ascending: true }),
    admin.from("reel_service_jobs")
      .select("id, broker_id, listing_id, period, slot, angle, look, settings, status, video_path, caption, error, rendered_at, delivered_at, listings:listing_id(vessel_name, year, make, model)")
      .eq("period", period)
      .order("slot", { ascending: true }),
  ]);

  const subRows = ((subs ?? []) as unknown as {
    broker_id: string; enabled: boolean; reels_per_listing: number; note: string | null; started_at: string;
    profiles: { first_name: string | null; last_name: string | null; display_email: string | null } | null;
  }[]);
  // Which boats each broker has in the service (Oct 23, per-boat pricing);
  // a broker with no per-boat rows still gets every active boat ("legacy").
  const enrolment = await loadReelServiceEnrolment(admin, subRows.map((s) => s.broker_id));
  const enrolledIds = Object.keys(enrolment).reduce((acc: string[], b) => acc.concat(enrolment[b].listingIds), []);
  const boatNames: Record<string, string> = {};
  if (enrolledIds.length) {
    const { data: ls } = await admin.from("listings").select("id, vessel_name, year, make, model, status").in("id", enrolledIds);
    ((ls ?? []) as { id: string; vessel_name: string | null; year: number | null; make: string | null; model: string | null; status: string }[])
      .filter((l) => l.status === "active")
      .forEach((l) => { boatNames[l.id] = l.vessel_name || [l.year, l.make, l.model].filter(Boolean).join(" ") || "Listing"; });
  }
  const boardSubs: BoardSub[] = subRows.map((s) => ({
    brokerId: s.broker_id,
    name: [s.profiles?.first_name, s.profiles?.last_name].filter(Boolean).join(" ") || s.profiles?.display_email || "Broker",
    enabled: s.enabled,
    reelsPerListing: s.reels_per_listing,
    note: s.note,
    boats: enrolment[s.broker_id]?.legacy
      ? null
      : (enrolment[s.broker_id]?.listingIds ?? []).filter((id) => boatNames[id]).map((id) => boatNames[id]).sort((a, b) => a.localeCompare(b)),
  }));

  const boardJobs = ((jobs ?? []) as unknown as BoardJob[]);

  // The videos on this month's listings: the footage badge ("Needs more
  // video") and "Measure videos" work from these, live.
  const listingIds = boardJobs.map((j) => j.listing_id).filter((x, i, a) => a.indexOf(x) === i);
  let boardVideos: BoardVideo[] = [];
  let shotsColumn = false;
  if (listingIds.length) {
    const { data: vids } = await admin.from("videos").select("id, listing_id, duration_sec, title").in("listing_id", listingIds);
    boardVideos = ((vids ?? []) as BoardVideo[]).map((v) => ({ ...v, shots: null }));
    // Detected edit points (videos.shot_cuts) — a separate read, so the page
    // still works if that column hasn't been added yet (shotsKnown false).
    const { data: shotRows, error: shotErr } = await admin.from("videos").select("id, shot_cuts").in("listing_id", listingIds);
    if (!shotErr && shotRows) {
      shotsColumn = true;
      const count: Record<string, number | null> = {};
      (shotRows as { id: string; shot_cuts: unknown }[]).forEach((r) => {
        const info = parseShotInfo(r.shot_cuts);
        count[r.id] = info ? info.shots.length : null;
      });
      boardVideos = boardVideos.map((v) => ({ ...v, shots: count[v.id] ?? null }));
    }
  }

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <h1 className="text-display text-ink-900">Reel Service</h1>
      <p className="text-ink-500 mt-1 text-sm max-w-2xl">
        Monthly social reels for the boats enrolled in the Reel Service. Enrol a broker, and choose their boats, on their broker page.
        Reels render in the browser, one at a time &mdash; leave the render station open to make every planned reel, or use Make here and keep this tab open and in front while they make.
      </p>
      {subErr && (
        <p className="mt-4 text-sm text-danger-700">
          Couldn&rsquo;t read the Reel Service tables ({subErr.message}). The migration <code>20261004_reel_service.sql</code> may not be applied yet.
        </p>
      )}
      <ReelServiceBoard period={period} subs={boardSubs} jobs={boardJobs} videos={boardVideos} shotsColumn={shotsColumn} socialEnabled={metaAppIdConfigured()} />
    </div>
  );
}
