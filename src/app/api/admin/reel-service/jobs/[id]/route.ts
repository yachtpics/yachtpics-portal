import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { replanReelServiceJob, setReelServiceJobLook, setReelServiceJobMusic } from "@/lib/reelService";
import { isMusicChoice } from "@/lib/reelMusic";
import { REEL_STYLES, type StyleKey } from "@/lib/reelStyles";
import { REEL_SERVICE_PREFIX } from "@/lib/videoUploadTarget";

export const runtime = "nodejs";

/**
 * POST /api/admin/reel-service/jobs/[id] — admin only.
 *   { action: "replan" }                 → new angle/photos/look (not if delivered)
 *   { action: "look", look }             → change only the look
 *   { action: "music", mood?, reroll? }  → music mood (off/auto/calm/…) and/or a new track
 *   { action: "rendering" }              → the browser has started rendering it
 *   { action: "rendered", path }         → MP4 uploaded to R2 at `path`: status 'ready'
 *   { action: "failed", error }          → status 'failed' with the reason
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const id = params.id;

  if (action === "replan") {
    const r = await replanReelServiceJob(admin, id);
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 });
  }

  if (action === "look") {
    const look = body?.look as StyleKey;
    if (typeof look !== "string" || !REEL_STYLES[look]) return NextResponse.json({ error: "Unknown look." }, { status: 400 });
    const r = await setReelServiceJobLook(admin, id, look);
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 });
  }

  if (action === "music") {
    const mood = body?.mood;
    if (mood !== undefined && !isMusicChoice(mood)) return NextResponse.json({ error: "Unknown music mood." }, { status: 400 });
    const r = await setReelServiceJobMusic(admin, id, { mood, reroll: body?.reroll === true });
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 });
  }

  const { data: job } = await admin.from("reel_service_jobs").select("id, broker_id, period, status").eq("id", id).maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  if (action === "rendering") {
    if (job.status === "delivered") return NextResponse.json({ error: "Already delivered." }, { status: 400 });
    await admin.from("reel_service_jobs").update({ status: "rendering", error: null }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  if (action === "rendered") {
    const path = typeof body?.path === "string" ? body.path : "";
    // Only the key the upload route hands out for this job.
    if (path !== `${REEL_SERVICE_PREFIX}${job.broker_id}/${job.period}/${job.id}.mp4`) {
      return NextResponse.json({ error: "That file doesn't belong to this reel." }, { status: 400 });
    }
    const { error } = await admin.from("reel_service_jobs").update({
      status: job.status === "delivered" ? "delivered" : "ready",
      video_path: path,
      storage_host: "r2",
      rendered_at: new Date().toISOString(),
      error: null,
    }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "failed") {
    const msg = typeof body?.error === "string" ? body.error.slice(0, 500) : "Render failed.";
    if (job.status !== "delivered") await admin.from("reel_service_jobs").update({ status: "failed", error: msg }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
