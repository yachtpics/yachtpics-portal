import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/requireAdmin";
import { cancelJob, enqueueJob, getJob, jobsBaseUrl, kickWorker, listJobs, retryJob } from "@/lib/jobs/queue";
import { isLabelCandidate } from "@/lib/labelPhotos";
import { isJobKind, type JobKind } from "@/lib/jobs/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/jobs                    → { jobs }  newest 20 + anything queued/running
 * GET  /api/admin/jobs?kind=X&active=1    → { jobs }  that kind's queued/running jobs
 * GET  /api/admin/jobs?id=…               → { job }
 * POST /api/admin/jobs { action: "enqueue", kind, params } → { job, existing }
 * POST /api/admin/jobs { action: "cancel", id }            → { job }
 * POST /api/admin/jobs { action: "retry", id }             → { job }
 *
 * Background job queue (src/lib/jobs/). Admin only. Before the jobs table
 * exists every call answers 503 { notReady: true } so the pages can fall back
 * to their old in-tab behaviour.
 */
function fail(r: { error?: string; notReady?: boolean }) {
  return NextResponse.json({ error: r.error, notReady: !!r.notReady }, { status: r.notReady ? 503 : 400 });
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const sp = req.nextUrl.searchParams;

  const id = sp.get("id");
  if (id) {
    const r = await getJob(id, auth.admin);
    if (r.error) return fail(r);
    if (!r.job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json({ job: r.job });
  }

  const kindParam = sp.get("kind");
  const kind = isJobKind(kindParam) ? kindParam : undefined;
  const r = await listJobs({ kind, activeOnly: sp.get("active") === "1" }, auth.admin);
  if (r.error) return fail(r);
  return NextResponse.json({ jobs: r.jobs });
}

const MAX_RELABEL_LISTINGS = 500;

/** Active listings that still have photos the labeller would consider. */
async function unlabelledListingIds(svc: SupabaseClient): Promise<string[]> {
  const ids = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; from < 200_000; from += PAGE) {
    const { data, error } = await svc
      .from("photos")
      .select("listing_id, category, category_source")
      .or("category.is.null,category.eq.Other")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    (data ?? []).forEach((p) => {
      if (p.listing_id && isLabelCandidate(p as { category: string | null; category_source: string | null })) ids.add(p.listing_id as string);
    });
    if ((data ?? []).length < PAGE) break;
  }
  if (ids.size === 0) return [];
  const all = Array.from(ids);
  const active: string[] = [];
  for (let i = 0; i < all.length; i += 200) {
    const { data } = await svc.from("listings").select("id").eq("status", "active").in("id", all.slice(i, i + 200));
    (data ?? []).forEach((l) => active.push(l.id as string));
  }
  return active.sort();
}

/** Validate and normalise params per kind. */
async function normaliseParams(
  kind: JobKind,
  raw: unknown,
  svc: SupabaseClient
): Promise<{ params: Record<string, unknown> } | { error: string }> {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (kind === "republish_site" || kind === "derivatives_backfill") return { params: {} };

  // relabel_photos: explicit listingIds, or scope "unlabelled" = every active
  // listing that still has photos marked Other / blank (resolved now, so the
  // job's list is fixed when it starts).
  let listingIds: string[];
  if (p.scope === "unlabelled") {
    listingIds = await unlabelledListingIds(svc);
    if (listingIds.length === 0) return { error: "No active listing has photos still waiting for a label." };
  } else {
    listingIds = Array.isArray(p.listingIds) ? (p.listingIds as unknown[]).filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)) : [];
    listingIds = Array.from(new Set(listingIds)).sort();
    if (listingIds.length === 0) return { error: "No listings given." };
  }
  if (listingIds.length > MAX_RELABEL_LISTINGS) {
    return { error: `That's ${listingIds.length} listings — the limit is ${MAX_RELABEL_LISTINGS} per job.` };
  }
  // Re-labelling photos the model already labelled costs money again; only
  // explicit lists may ask for it.
  const force = p.scope !== "unlabelled" && p.force === true;
  return { params: force ? { listingIds, force } : { listingIds } };
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  let body: { action?: string; kind?: string; params?: unknown; id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  const baseUrl = jobsBaseUrl(req);

  if (body.action === "enqueue") {
    if (!isJobKind(body.kind)) return NextResponse.json({ error: "Unknown job kind" }, { status: 400 });
    let norm: { params: Record<string, unknown> } | { error: string };
    try {
      norm = await normaliseParams(body.kind, body.params, auth.admin);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
    if ("error" in norm) return NextResponse.json({ error: norm.error }, { status: 400 });
    const r = await enqueueJob(body.kind, norm.params, auth.userId, auth.admin);
    if (r.error !== undefined) return fail(r);
    // Wake the worker now rather than waiting for the daily safety net.
    kickWorker(baseUrl);
    return NextResponse.json({ job: r.job, existing: r.existing });
  }

  if (body.action === "cancel" || body.action === "retry") {
    if (!body.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const r = body.action === "cancel" ? await cancelJob(body.id, auth.admin) : await retryJob(body.id, auth.admin);
    if (r.error) return fail(r);
    if (body.action === "retry") kickWorker(baseUrl);
    return NextResponse.json({ job: r.job });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
