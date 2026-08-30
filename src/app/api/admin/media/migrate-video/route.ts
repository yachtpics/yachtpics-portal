import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { R2_VIDEO_BUCKET, r2VideoConfigured, r2VideoSize } from "@/lib/r2";
import { startCopy, copyPart, finishCopy, abortCopy, partCount, partRange, type PartRef } from "@/lib/r2ChunkedCopy";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Moves the video library from Supabase to the private Cloudflare bucket.
 *
 * Same part-by-part machinery as the website copy — 64MB per request, driven
 * from the browser, resumable — but pointed at the PRIVATE bucket, keeping the
 * exact same storage path. That last part matters: because the key doesn't
 * change, a migrated row differs only in its storage_host, and every reader in
 * the app already honours that column.
 *
 * The order of operations is the whole safety story:
 *   1. copy the file to Cloudflare
 *   2. VERIFY it — byte size on Cloudflare must equal byte size at the source
 *   3. only then flip the row's storage_host to 'r2'
 *   4. Supabase's copy is NOT deleted here at all
 *
 * Step 4 is a separate `cleanup` action, meant to be run days later, after the
 * portal has been serving from Cloudflare with real use. Until then every
 * migrated video exists in both stores and flipping a row back is a one-word
 * change. Nothing in the move is destructive.
 *
 * Actions: list · start · part · finish · abort · cleanup
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  if (!r2VideoConfigured()) {
    return NextResponse.json({ error: "The private video bucket isn't configured." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  // ── list ─────────────────────────────────────────────────────────────────
  if (action === "list") {
    const { data: videos } = await svc
      .from("videos")
      .select("id, storage_path, storage_host, filename, listing_id, gallery_id")
      .order("created_at", { ascending: true });

    const pending = (videos ?? []).filter((v) => v.storage_host !== "r2");
    const done = (videos ?? []).filter((v) => v.storage_host === "r2");
    return NextResponse.json({
      pending: pending.map((v) => ({ id: v.id, filename: v.filename })),
      migrated: done.map((v) => ({ id: v.id, filename: v.filename })),
      doneCount: done.length,
      totalCount: (videos ?? []).length,
    });
  }

  const videoId = body?.videoId;
  if (!videoId) return NextResponse.json({ error: "Missing videoId" }, { status: 400 });

  const { data: video } = await svc
    .from("videos")
    .select("id, storage_path, storage_host, filename")
    .eq("id", videoId)
    .maybeSingle();
  if (!video) return NextResponse.json({ error: "Video not found" }, { status: 404 });

  const key = video.storage_path as string;
  const ext = (key.split(".").pop() || "mp4").toLowerCase();
  const contentType = ext === "mov" ? "video/quicktime" : "video/mp4";

  // ── start ────────────────────────────────────────────────────────────────
  if (action === "start") {
    if (video.storage_host === "r2") {
      return NextResponse.json({ alreadyMigrated: true });
    }

    const { data: signed } = await svc.storage
      .from("listing-videos")
      .createSignedUrl(key, 60 * 60 * 6);
    if (!signed?.signedUrl) {
      return NextResponse.json({ error: "Couldn't read the source video from Supabase." }, { status: 400 });
    }

    // Size from a one-byte range request — the same source the copy will read.
    let totalBytes = 0;
    try {
      const probe = await fetch(signed.signedUrl, { headers: { Range: "bytes=0-0" }, cache: "no-store" });
      totalBytes = Number(probe.headers.get("content-range")?.split("/")[1] ?? 0);
    } catch {
      /* handled below */
    }
    if (!totalBytes) {
      return NextResponse.json({ error: "Couldn't determine the file size." }, { status: 400 });
    }

    // A previous run may have finished this copy and died before flipping the
    // row. If Cloudflare already holds the right number of bytes, verify and
    // flip without copying anything again.
    const existing = await r2VideoSize(key);
    if (existing === totalBytes) {
      await svc.from("videos").update({ storage_host: "r2" }).eq("id", videoId);
      return NextResponse.json({ alreadyMigrated: true, verified: true });
    }

    const uploadId = await startCopy(R2_VIDEO_BUCKET, key, contentType);
    return NextResponse.json({
      uploadId,
      sourceUrl: signed.signedUrl,
      totalBytes,
      totalParts: partCount(totalBytes),
    });
  }

  // ── one part ─────────────────────────────────────────────────────────────
  if (action === "part") {
    const { uploadId, sourceUrl, partNumber, totalBytes } = body;
    if (!uploadId || !sourceUrl || !partNumber || !totalBytes) {
      return NextResponse.json({ error: "Missing part details" }, { status: 400 });
    }
    const { start, end } = partRange(Number(partNumber), Number(totalBytes));
    try {
      const part = await copyPart({
        bucket: R2_VIDEO_BUCKET,
        key,
        uploadId,
        sourceUrl,
        partNumber: Number(partNumber),
        start,
        end,
      });
      return NextResponse.json({ part });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "That part failed." }, { status: 502 });
    }
  }

  // ── finish: complete, verify, flip ───────────────────────────────────────
  if (action === "finish") {
    const { uploadId, parts, totalBytes } = body;
    if (!uploadId || !Array.isArray(parts) || !totalBytes) {
      return NextResponse.json({ error: "Missing upload details" }, { status: 400 });
    }
    try {
      await finishCopy(R2_VIDEO_BUCKET, key, uploadId, parts as PartRef[]);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't finish the copy." }, { status: 502 });
    }

    // The row flips ONLY if Cloudflare holds exactly the bytes the source has.
    // A mismatch means the copy is wrong, and pointing the portal at a wrong
    // file would be worse than not migrating — so it stays on Supabase and
    // says so.
    const size = await r2VideoSize(key);
    if (size !== Number(totalBytes)) {
      return NextResponse.json({
        error: `Verification failed — Cloudflare has ${size ?? 0} bytes, the source has ${totalBytes}. The row was NOT flipped; this video still serves from Supabase.`,
      }, { status: 502 });
    }

    const { error } = await svc.from("videos").update({ storage_host: "r2" }).eq("id", videoId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ done: true, verified: true });
  }

  // ── abort ────────────────────────────────────────────────────────────────
  if (action === "abort") {
    const { uploadId } = body;
    if (uploadId) await abortCopy(R2_VIDEO_BUCKET, key, uploadId).catch(() => {});
    return NextResponse.json({ aborted: true });
  }

  // ── cleanup: delete the Supabase copy of ONE migrated video ─────────────
  // Meant for days after the move, once the portal has served from Cloudflare
  // with real brokers using it. Re-verifies the Cloudflare copy immediately
  // before deleting — the last look before the only irreversible step.
  if (action === "cleanup") {
    if (video.storage_host !== "r2") {
      return NextResponse.json({ error: "This video hasn't been migrated — nothing to clean up." }, { status: 400 });
    }
    const size = await r2VideoSize(key);
    if (!size) {
      return NextResponse.json({
        error: "Cloudflare doesn't have this file — refusing to delete the Supabase copy.",
      }, { status: 502 });
    }
    const { error } = await svc.storage.from("listing-videos").remove([key]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ cleaned: true, freedBytes: size });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
