import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { isPeriod, periodET, planReelServiceMonth, replanListingMonth, replanUnmade } from "@/lib/reelService";
import { deliverReelServiceJobs } from "@/lib/reelServiceEmail";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/admin/reel-service — admin only.
 *   { action: "subscription", brokerId, enabled, reelsPerListing?, note? } → enrol / update / pause
 *   { action: "plan", period?, brokerIds? }                              → fill the month's missing jobs
 *   { action: "deliver", jobIds }                                        → mark delivered + email
 *   { action: "durations", durations: { videoId: seconds } }             → record measured video lengths
 *   { action: "replan_unmade", period, listingIds }                      → re-plan those listings' planned/failed jobs
 *   { action: "replan_listing", period, listingId }                      → re-plan ALL of a listing's reels that month (delivered too)
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin, userId } = auth;
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === "subscription") {
    const brokerId = typeof body?.brokerId === "string" ? body.brokerId : null;
    if (!brokerId) return NextResponse.json({ error: "Missing brokerId" }, { status: 400 });
    const rpm = Math.round(Number(body?.reelsPerListing ?? 4));
    if (!Number.isFinite(rpm) || rpm < 1 || rpm > 10) return NextResponse.json({ error: "Reels per listing must be 1–10." }, { status: 400 });
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) || null : null;
    const enabled = body?.enabled === true;
    const { data: existing } = await admin.from("reel_service_subscriptions").select("broker_id, enabled").eq("broker_id", brokerId).maybeSingle();
    const row: Record<string, unknown> = { broker_id: brokerId, enabled, reels_per_listing: rpm, note, updated_at: new Date().toISOString() };
    // Re-enabling a paused broker restarts the clock.
    if (!existing || (!existing.enabled && enabled)) row.started_at = new Date().toISOString();
    const { data, error } = await admin.from("reel_service_subscriptions").upsert(row, { onConflict: "broker_id" }).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Enrolling mid-month plans the rest of this month straight away.
    let planned = 0;
    if (enabled) {
      try { planned = (await planReelServiceMonth(admin, periodET(), { brokerIds: [brokerId] })).created; } catch { /* the daily cron fills it */ }
    }
    return NextResponse.json({ ok: true, subscription: data, planned });
  }

  if (action === "plan") {
    const period = isPeriod(body?.period) ? body.period : periodET();
    const brokerIds = Array.isArray(body?.brokerIds) ? body.brokerIds.filter((x: unknown) => typeof x === "string") : undefined;
    try {
      const result = await planReelServiceMonth(admin, period, { brokerIds });
      return NextResponse.json({ ok: true, period, ...result });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Planning failed." }, { status: 500 });
    }
  }

  if (action === "deliver") {
    const jobIds: string[] = Array.isArray(body?.jobIds) ? body.jobIds.filter((x: unknown) => typeof x === "string").slice(0, 200) : [];
    if (jobIds.length === 0) return NextResponse.json({ error: "No reels chosen." }, { status: 400 });
    const result = await deliverReelServiceJobs(admin, jobIds, userId);
    return NextResponse.json({ ok: true, ...result });
  }

  if (action === "durations") {
    // Video lengths measured in the admin's browser (Reel Service), for the planner.
    const d = body?.durations && typeof body.durations === "object" ? body.durations as Record<string, unknown> : {};
    const ids = Object.keys(d).slice(0, 200);
    let saved = 0;
    for (const id of ids) {
      const sec = Number(d[id]);
      if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isFinite(sec) || sec <= 0 || sec > 6 * 3600) continue;
      const { error } = await admin.from("videos").update({ duration_sec: Math.round(sec * 10) / 10 }).eq("id", id);
      if (!error) saved++;
    }
    return NextResponse.json({ ok: true, saved });
  }

  if (action === "replan_unmade") {
    const period = isPeriod(body?.period) ? body.period : periodET();
    const listingIds: string[] = Array.isArray(body?.listingIds) ? body.listingIds.filter((x: unknown) => typeof x === "string").slice(0, 200) : [];
    try {
      const r = await replanUnmade(admin, period, listingIds);
      return NextResponse.json({ ok: true, period, ...r });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Re-planning failed." }, { status: 500 });
    }
  }

  if (action === "replan_listing") {
    const period = isPeriod(body?.period) ? body.period : periodET();
    const listingId = typeof body?.listingId === "string" ? body.listingId : "";
    if (!listingId) return NextResponse.json({ error: "Missing listingId" }, { status: 400 });
    const r = await replanListingMonth(admin, period, listingId);
    return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: 400 });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
