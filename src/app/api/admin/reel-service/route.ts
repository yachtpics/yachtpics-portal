import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { isPeriod, loadReelServiceEnrolment, periodET, planReelServiceMonth, previousPeriod, replanListingMonth, replanUnmade } from "@/lib/reelService";
import { REEL_SERVICE_PRICE } from "@/lib/plans";
import { deliverReelServiceJobs } from "@/lib/reelServiceEmail";
import { parseShotInfo } from "@/lib/reelClips";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reel-service?planned=1[&period=YYYY-MM] — admin only.
 *   → { jobs, periods }: the planned reels of that month (default: this month,
 *   Eastern) and the month before, oldest first. The render station
 *   (/admin/reel-service/render) polls this and renders them one at a time.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;
  const sp = req.nextUrl.searchParams;
  if (sp.get("planned") !== "1") return NextResponse.json({ error: "Use ?planned=1" }, { status: 400 });
  const p = sp.get("period");
  const period = isPeriod(p) ? p : periodET();
  const periods = [period, previousPeriod(period)];
  const { data, error } = await admin.from("reel_service_jobs")
    .select("id, broker_id, listing_id, period, slot, angle, look, settings, status, created_at, listings:listing_id(vessel_name, year, make, model)")
    .in("period", periods)
    .eq("status", "planned")
    .order("created_at", { ascending: true })
    .order("slot", { ascending: true })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobs: data ?? [], periods }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/admin/reel-service — admin only.
 *   { action: "subscription", brokerId, enabled, reelsPerListing?, note?, pricePerListing? } → enrol / update / pause
 *   { action: "listings", brokerId, listingIds }                          → which boats are in the service (per-boat pricing)
 *   { action: "billing", period? }                                       → the month's billing summary (for Zoho)
 *   { action: "plan", period?, brokerIds? }                              → fill the month's missing jobs
 *   { action: "deliver", jobIds }                                        → mark delivered + email
 *   { action: "durations", durations: { videoId: seconds } }             → record measured video lengths
 *   { action: "replan_unmade", period, listingIds }                      → re-plan those listings' planned/failed jobs
 *   { action: "shots", shots: { videoId: ShotInfo } }                    → store detected edit points (videos.shot_cuts)
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
    // Per-boat monthly price in dollars (a special deal overrides the $149 default).
    if (body?.pricePerListing !== undefined && body?.pricePerListing !== null && body?.pricePerListing !== "") {
      const dollars = Number(body.pricePerListing);
      if (!Number.isFinite(dollars) || dollars < 0 || dollars > 10000) return NextResponse.json({ error: "Price per boat must be $0–$10,000." }, { status: 400 });
      row.price_per_listing_cents = Math.round(dollars * 100);
    }
    let { data, error } = await admin.from("reel_service_subscriptions").upsert(row, { onConflict: "broker_id" }).select("*").single();
    if (error && /price_per_listing_cents/.test(error.message)) {
      // 20261023_reel_service_listings.sql not applied yet: save the rest.
      delete row.price_per_listing_cents;
      ({ data, error } = await admin.from("reel_service_subscriptions").upsert(row, { onConflict: "broker_id" }).select("*").single());
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Enrolling mid-month plans the rest of this month straight away.
    let planned = 0;
    if (enabled) {
      try { planned = (await planReelServiceMonth(admin, periodET(), { brokerIds: [brokerId] })).created; } catch { /* the daily cron fills it */ }
    }
    return NextResponse.json({ ok: true, subscription: data, planned });
  }

  if (action === "listings") {
    // The boats in the service. Unchecking sets ended_at (the row is kept, so
    // the broker stays on per-boat enrolment and history shows when); jobs
    // already planned this month are untouched. Re-checking clears ended_at
    // and restarts enrolled_at.
    const brokerId = typeof body?.brokerId === "string" ? body.brokerId : null;
    if (!brokerId) return NextResponse.json({ error: "Missing brokerId" }, { status: 400 });
    const wanted: string[] = Array.isArray(body?.listingIds) ? body.listingIds.filter((x: unknown) => typeof x === "string").slice(0, 500) : [];
    const { data: own } = await admin.from("listings").select("id").eq("broker_id", brokerId).in("id", wanted.length ? wanted : ["00000000-0000-0000-0000-000000000000"]);
    const ownIds = new Set(((own ?? []) as { id: string }[]).map((l) => l.id));
    const keep = wanted.filter((id) => ownIds.has(id));
    const { data: rows, error: readErr } = await admin.from("reel_service_listings").select("listing_id, ended_at").eq("broker_id", brokerId);
    if (readErr) return NextResponse.json({ error: `Couldn’t read the boats in the service (${readErr.message}). Is 20261023_reel_service_listings.sql applied?` }, { status: 500 });
    const existing = (rows ?? []) as { listing_id: string; ended_at: string | null }[];
    const now = new Date().toISOString();
    const toInsert = keep.filter((id) => !existing.some((r) => r.listing_id === id));
    const toRestart = existing.filter((r) => r.ended_at && keep.indexOf(r.listing_id) >= 0).map((r) => r.listing_id);
    const toEnd = existing.filter((r) => !r.ended_at && keep.indexOf(r.listing_id) < 0).map((r) => r.listing_id);
    if (toInsert.length) {
      const { error } = await admin.from("reel_service_listings").insert(toInsert.map((id) => ({ listing_id: id, broker_id: brokerId, enrolled_at: now })));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (toRestart.length) {
      const { error } = await admin.from("reel_service_listings").update({ ended_at: null, enrolled_at: now }).in("listing_id", toRestart);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (toEnd.length) {
      const { error } = await admin.from("reel_service_listings").update({ ended_at: now }).in("listing_id", toEnd);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    // A legacy broker (no rows: every boat planned) saved with nothing
    // checked: record the boats shown as off the service, so the planner
    // sees per-boat enrolment with zero boats instead of "all boats".
    if (existing.length === 0 && keep.length === 0) {
      const shown: string[] = Array.isArray(body?.shownListingIds) ? body.shownListingIds.filter((x: unknown) => typeof x === "string").slice(0, 500) : [];
      const { data: shownOwn } = shown.length ? await admin.from("listings").select("id").eq("broker_id", brokerId).in("id", shown) : { data: [] };
      const off = ((shownOwn ?? []) as { id: string }[]).map((l) => ({ listing_id: l.id, broker_id: brokerId, enrolled_at: now, ended_at: now }));
      if (off.length) {
        const { error } = await admin.from("reel_service_listings").insert(off);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true, enrolled: keep.length, added: toInsert.length + toRestart.length, ended: toEnd.length });
  }

  if (action === "billing") {
    const period = isPeriod(body?.period) ? body.period : periodET();
    try {
      return NextResponse.json({ ok: true, period, ...(await billingSummary(admin, period)) });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn’t build the billing summary." }, { status: 500 });
    }
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

  if (action === "shots") {
    // Edit points found in the admin's browser (Reel Service). If the
    // videos.shot_cuts column isn't there yet, nothing is stored and the
    // renderer keeps detecting per session.
    const src = body?.shots && typeof body.shots === "object" ? body.shots as Record<string, unknown> : {};
    let saved = 0;
    let missing = false;
    for (const id of Object.keys(src).slice(0, 100)) {
      const info = parseShotInfo(src[id]);
      if (!/^[0-9a-f-]{36}$/i.test(id) || !info || info.shots.length > 2000) continue;
      const { error } = await admin.from("videos").update({ shot_cuts: info }).eq("id", id);
      if (error) { missing = /shot_cuts/.test(error.message); if (missing) break; continue; }
      saved++;
    }
    return NextResponse.json({ ok: true, saved, columnMissing: missing });
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

type Admin = Parameters<typeof planReelServiceMonth>[0];

type BillingBoat = { listingId: string; boat: string; delivered: number };
type BillingBroker = { brokerId: string; name: string; legacy: boolean; priceCents: number; boats: BillingBoat[]; delivered: number; amountCents: number };

/**
 * One month's Reel Service billing, for invoicing in Zoho: each enabled
 * broker's boats in the service that month, reels delivered for the month's
 * plan, and boats × that broker's price. A boat counts for a month if it was
 * enrolled at any point in it. Legacy brokers (no per-boat rows) count the
 * boats that had reels planned that month.
 */
async function billingSummary(admin: Admin, period: string): Promise<{ brokers: BillingBroker[]; totalCents: number }> {
  const [y, m] = period.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString();
  const end = new Date(Date.UTC(y, m, 1)).toISOString();
  const defaultCents = REEL_SERVICE_PRICE * 100;

  let subs: { broker_id: string; price_per_listing_cents?: number | null; profiles: { first_name: string | null; last_name: string | null; display_email: string | null } | null }[] = [];
  const withPrice = await admin.from("reel_service_subscriptions")
    .select("broker_id, price_per_listing_cents, profiles:broker_id(first_name, last_name, display_email)").eq("enabled", true);
  if (withPrice.error) {
    // Price column not there yet: everyone at the default.
    const plain = await admin.from("reel_service_subscriptions")
      .select("broker_id, profiles:broker_id(first_name, last_name, display_email)").eq("enabled", true);
    if (plain.error) throw new Error(plain.error.message);
    subs = (plain.data ?? []) as unknown as typeof subs;
  } else {
    subs = (withPrice.data ?? []) as unknown as typeof subs;
  }
  const brokerIds = subs.map((s) => s.broker_id);
  if (brokerIds.length === 0) return { brokers: [], totalCents: 0 };

  const enrolment = await loadReelServiceEnrolment(admin, brokerIds);
  const [{ data: enrolRows }, { data: jobs }] = await Promise.all([
    admin.from("reel_service_listings").select("listing_id, broker_id, enrolled_at, ended_at").in("broker_id", brokerIds),
    admin.from("reel_service_jobs").select("listing_id, broker_id, status").eq("period", period).in("broker_id", brokerIds),
  ]);
  const jobRows = (jobs ?? []) as { listing_id: string; broker_id: string; status: string }[];
  const inMonth = ((enrolRows ?? []) as { listing_id: string; broker_id: string; enrolled_at: string; ended_at: string | null }[])
    // ended_at <= enrolled_at = never actually in the service (a boat
    // recorded as off when a legacy broker was saved with nothing checked).
    .filter((r) => Date.parse(r.enrolled_at) < Date.parse(end)
      && (!r.ended_at || (Date.parse(r.ended_at) >= Date.parse(start) && Date.parse(r.ended_at) > Date.parse(r.enrolled_at))));

  const boatIds = new Set<string>();
  const perBroker: Record<string, string[]> = {};
  brokerIds.forEach((b) => {
    const ids = enrolment[b]?.legacy
      ? jobRows.filter((j) => j.broker_id === b).map((j) => j.listing_id)
      : inMonth.filter((r) => r.broker_id === b).map((r) => r.listing_id);
    perBroker[b] = ids.filter((x, i, a) => a.indexOf(x) === i);
    perBroker[b].forEach((id) => boatIds.add(id));
  });
  const names: Record<string, string> = {};
  if (boatIds.size) {
    const { data: ls } = await admin.from("listings").select("id, vessel_name, year, make, model").in("id", Array.from(boatIds));
    ((ls ?? []) as { id: string; vessel_name: string | null; year: number | null; make: string | null; model: string | null }[]).forEach((l) => {
      names[l.id] = l.vessel_name || [l.year, l.make, l.model].filter(Boolean).join(" ") || "Listing";
    });
  }

  const brokers: BillingBroker[] = subs.map((s) => {
    const priceCents = typeof s.price_per_listing_cents === "number" ? s.price_per_listing_cents : defaultCents;
    const boats = perBroker[s.broker_id].map((id) => ({
      listingId: id,
      boat: names[id] ?? "Listing",
      delivered: jobRows.filter((j) => j.listing_id === id && j.status === "delivered").length,
    })).sort((a, b) => a.boat.localeCompare(b.boat));
    return {
      brokerId: s.broker_id,
      name: [s.profiles?.first_name, s.profiles?.last_name].filter(Boolean).join(" ") || s.profiles?.display_email || "Broker",
      legacy: enrolment[s.broker_id]?.legacy ?? true,
      priceCents,
      boats,
      delivered: boats.reduce((a, b) => a + b.delivered, 0),
      amountCents: boats.length * priceCents,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { brokers, totalCents: brokers.reduce((a, b) => a + b.amountCents, 0) };
}
