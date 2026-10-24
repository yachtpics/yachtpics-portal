import { requireAdminPage } from "@/lib/requireAdminPage";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { isPeriod, loadReelServiceEnrolment, periodET, periodLabel, plannedListingIds } from "@/lib/reelService";
import { parseShotInfo } from "@/lib/reelClips";
import { metaAppIdConfigured } from "@/lib/meta/config";
import ReelServiceBoard, { type BoardJob, type BoardSub, type BoardVideo } from "./ReelServiceBoard";
import ReelServiceQueue, { type QueueRow, type QueueStatus } from "./ReelServiceQueue";

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
  // "Enabled" governs comped boats only (Oct 24): a disabled broker's paid boats still count.
  const scopedFor = (s: { broker_id: string; enabled: boolean }) => plannedListingIds(enrolment[s.broker_id] ?? { legacy: true, listingIds: [] }, s.enabled);
  const enrolledIds = subRows.reduce((acc: string[], s) => acc.concat(scopedFor(s).listingIds), []);
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
    boats: scopedFor(s).legacy
      ? null
      : scopedFor(s).listingIds.filter((id) => boatNames[id]).map((id) => boatNames[id]).sort((a, b) => a.localeCompare(b)),
    paidBoats: (enrolment[s.broker_id]?.paidListingIds ?? []).filter((id) => boatNames[id]).length,
  }));

  let boardJobs = ((jobs ?? []) as unknown as BoardJob[]);
  // Due dates of paid boats' reels (Oct 24b) — a separate read so the board
  // works before 20261024b_reel_service_period.sql is applied.
  {
    const { data: dues, error: dueErr } = await admin.from("reel_service_jobs").select("id, due_at").eq("period", period).not("due_at", "is", null);
    if (!dueErr && dues && dues.length) {
      const byId: Record<string, string> = {};
      (dues as { id: string; due_at: string }[]).forEach((d) => { byId[d.id] = d.due_at; });
      boardJobs = boardJobs.map((j) => ({ ...j, due_at: byId[j.id] ?? null }));
    }
  }

  // ── Queue (Oct 24): every boat on the service this month, paid + comped,
  // plus paid boats that are past due or paused. Billing columns come from
  // 20261024_reel_service_stripe.sql; before it, every row reads as comped.
  const thisPeriod = periodET();
  type RsRow = { listing_id: string; broker_id: string; ended_at: string | null; billing_status?: string | null; current_period_end?: string | null; cancel_at_period_end?: boolean | null; current_period_start?: string | null; stripe_subscription_id?: string | null };
  let billingReady = true;
  let rsRows: RsRow[] = [];
  const brokerIdsAll = subRows.map((s) => s.broker_id);
  if (brokerIdsAll.length) {
    let r = await admin.from("reel_service_listings")
      .select("listing_id, broker_id, ended_at, billing_status, current_period_end, cancel_at_period_end, current_period_start, stripe_subscription_id").in("broker_id", brokerIdsAll);
    if (r.error) {
      // 20261024b not applied: no paid periods yet.
      r = await admin.from("reel_service_listings")
        .select("listing_id, broker_id, ended_at, billing_status, current_period_end, cancel_at_period_end").in("broker_id", brokerIdsAll) as typeof r;
    }
    if (r.error) {
      billingReady = false;
      r = await admin.from("reel_service_listings").select("listing_id, broker_id, ended_at").in("broker_id", brokerIdsAll) as typeof r;
    }
    rsRows = ((r.data ?? []) as RsRow[]);
  }
  const statusOf = (row: RsRow | undefined): QueueStatus | null => {
    if (!row) return null;
    const b = row.billing_status ?? "comped";
    if (b === "paused") return "paused";
    if (row.ended_at || b === "canceled") return null;
    if (b === "active") return "paid";
    if (b === "past_due") return "past_due";
    return "comped";
  };
  // listing id → status, for the chips on the board and the queue.
  const boatStatus: Record<string, QueueStatus> = {};
  const enabledIds = subRows.filter((s) => s.enabled).map((s) => s.broker_id);
  rsRows.forEach((row) => {
    const st = statusOf(row);
    if (!st) return;
    // A comp only counts while the broker is enabled; paid boats always show.
    if (st === "comped" && enabledIds.indexOf(row.broker_id) < 0) return;
    boatStatus[row.listing_id] = st;
  });
  // Legacy brokers (no per-boat rows): their boats with reels this month count as comped.
  const { data: monthJobs } = await admin.from("reel_service_jobs")
    .select("listing_id, broker_id, status").eq("period", thisPeriod);
  ((monthJobs ?? []) as { listing_id: string; broker_id: string }[]).forEach((j) => {
    if (enrolment[j.broker_id]?.legacy && enabledIds.indexOf(j.broker_id) >= 0 && !boatStatus[j.listing_id]) boatStatus[j.listing_id] = "comped";
  });
  const queueIds = Object.keys(boatStatus);
  let queueRows: QueueRow[] = [];
  if (queueIds.length) {
    // Paid boats count their reels per PAID period (Oct 24b), with due dates.
    const { data: paidJobs } = await admin.from("reel_service_jobs")
      .select("listing_id, status, due_at, service_period_start").in("listing_id", queueIds).not("service_period_start", "is", null);
    const pj = ((paidJobs ?? []) as { listing_id: string; status: string; due_at: string | null; service_period_start: string }[]);
    const [{ data: qListings }, { data: lastJobs }] = await Promise.all([
      admin.from("listings").select("id, broker_id, vessel_name, year, make, model, status").in("id", queueIds),
      admin.from("reel_service_jobs").select("listing_id, delivered_at").in("listing_id", queueIds).eq("status", "delivered")
        .not("delivered_at", "is", null).order("delivered_at", { ascending: false }).limit(5000),
    ]);
    const last: Record<string, string> = {};
    ((lastJobs ?? []) as { listing_id: string; delivered_at: string }[]).forEach((j) => { if (!last[j.listing_id]) last[j.listing_id] = j.delivered_at; });
    const brokerName: Record<string, string> = {};
    boardSubs.forEach((b) => { brokerName[b.brokerId] = b.name; });
    const mj = (monthJobs ?? []) as { listing_id: string; status: string }[];
    queueRows = ((qListings ?? []) as { id: string; broker_id: string; vessel_name: string | null; year: number | null; make: string | null; model: string | null; status: string }[])
      .filter((l) => l.status === "active" || boatStatus[l.id] !== "comped")
      .map((l): QueueRow => {
        const row = rsRows.find((x) => x.listing_id === l.id);
        const start = row?.stripe_subscription_id && row.current_period_start && (boatStatus[l.id] === "paid" || boatStatus[l.id] === "past_due")
          ? Date.parse(row.current_period_start) : null;
        const inPeriod = start !== null ? pj.filter((j) => j.listing_id === l.id && Date.parse(j.service_period_start) === start) : [];
        const nextDue = inPeriod.filter((j) => j.status !== "delivered" && j.due_at).map((j) => j.due_at as string)
          .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
        return {
          listingId: l.id,
          boat: l.vessel_name || [l.year, l.make, l.model].filter(Boolean).join(" ") || "Listing",
          brokerId: l.broker_id,
          broker: brokerName[l.broker_id] ?? "Broker",
          status: boatStatus[l.id],
          delivered: start !== null
            ? inPeriod.filter((j) => j.status === "delivered").length
            : mj.filter((j) => j.listing_id === l.id && j.status === "delivered").length,
          paidPeriod: start !== null,
          nextDueAt: nextDue,
          perBoat: subRows.find((x) => x.broker_id === l.broker_id)?.reels_per_listing ?? undefined,
          canExtend: !!row?.stripe_subscription_id && boatStatus[l.id] === "paid" && !row?.cancel_at_period_end,
          renewsAt: row?.current_period_end ?? null,
          cancelAtPeriodEnd: !!row?.cancel_at_period_end,
          lastDeliveredAt: last[l.id] ?? null,
        };
      });
  }

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
      {!subErr && <ReelServiceQueue rows={queueRows} monthLabel={periodLabel(thisPeriod)} billingReady={billingReady} />}
      <ReelServiceBoard period={period} subs={boardSubs} jobs={boardJobs} videos={boardVideos} shotsColumn={shotsColumn} socialEnabled={metaAppIdConfigured()} boatStatus={boatStatus} />
    </div>
  );
}
