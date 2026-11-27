import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { cancelJob } from "@/lib/jobs/queue";
import { googleFetch } from "@/lib/youtube/google";
import { PUBLIC_UPLOAD_COLUMNS, isMissingYouTubeSchema, toPublicUpload, type UploadRow } from "@/lib/youtube/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/youtube/uploads/[id] — stop an upload. Admin only.
 * Marks it cancelled first (the job checks before every chunk and stops),
 * cancels its job, and asks YouTube to drop the half-sent session (best
 * effort). A video YouTube has already received stays on YouTube; this
 * never deletes anything there.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: "Unknown upload." }, { status: 400 });
  const svc = auth.admin;

  const { data, error } = await svc.from("youtube_uploads").select("*").eq("id", params.id).maybeSingle();
  if (error) {
    if (isMissingYouTubeSchema(error)) return NextResponse.json({ error: "YouTube isn't set up yet." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Upload not found." }, { status: 404 });
  const row = data as UploadRow;
  if (["queued", "uploading", "processing"].indexOf(row.status) < 0) {
    return NextResponse.json({ upload: toPublicUpload(row) });
  }

  const now = new Date().toISOString();
  const { data: upd, error: updErr } = await svc
    .from("youtube_uploads")
    .update({ status: "cancelled", error: null, finished_at: now, updated_at: now, upload_session_url: null })
    .eq("id", row.id)
    .in("status", ["queued", "uploading", "processing"])
    .select(PUBLIC_UPLOAD_COLUMNS)
    .maybeSingle();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  if (row.job_id) await cancelJob(row.job_id, svc).catch(() => null);
  // Google: "DELETE on the session URI" ends an unfinished resumable upload (best effort, no auth needed beyond the URI).
  if (row.upload_session_url) {
    await googleFetch(row.upload_session_url, { method: "DELETE", timeoutMs: 8_000 });
  }
  return NextResponse.json({ upload: toPublicUpload(((upd ?? { ...row, status: "cancelled", finished_at: now }) as unknown) as UploadRow) });
}

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
