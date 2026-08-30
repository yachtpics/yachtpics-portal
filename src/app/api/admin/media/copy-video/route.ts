import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { R2_BUCKET, r2Configured, r2Exists } from "@/lib/r2";
import { startCopy, copyPart, finishCopy, abortCopy, partCount, partRange, type PartRef } from "@/lib/r2ChunkedCopy";
import { boatSlug } from "@/lib/siteTemplates";
import { signVideoUrl } from "@/lib/videoUrls";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Copy one video from Supabase to the public media host, one part per request.
 *
 * The browser drives this: `start` to begin, `part` repeatedly, `finish` at the
 * end. Each call handles a fixed 64MB slice, so memory and time are the same
 * whether the file is 20MB or 2GB — which matters, because the first real one we
 * tried was 1.2GB and the previous all-at-once version crashed the function.
 *
 * Admin only: this writes to the bucket the public website serves from.
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

  if (!r2Configured()) {
    return NextResponse.json({ error: "The media host isn't configured yet." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const { action, videoId } = body ?? {};
  if (!videoId) return NextResponse.json({ error: "Missing videoId" }, { status: 400 });

  const { data: video } = await svc
    .from("videos")
    .select("id, storage_path, storage_host, filename, listing_id")
    .eq("id", videoId)
    .maybeSingle();
  if (!video?.listing_id) return NextResponse.json({ error: "Video not found" }, { status: 404 });

  // Where the file lands is worked out here, not sent by the browser — it has to
  // match exactly what the publisher will look for, and a boat that has never
  // been published has no slug stored yet.
  const { data: listing } = await svc
    .from("listings")
    .select("site_page, site_slug, vessel_name, make, length_ft")
    .eq("id", video.listing_id)
    .maybeSingle();

  const sitePage = listing?.site_page as string | null;
  if (!sitePage) {
    return NextResponse.json({ error: "Pick a website page for this boat first." }, { status: 400 });
  }
  const slug =
    (listing?.site_slug as string | null) ||
    boatSlug({
      lengthFt: listing?.length_ft as string | null,
      make: listing?.make as string | null,
      vesselName: listing?.vessel_name as string | null,
    });
  if (!slug) {
    return NextResponse.json({ error: "This boat needs at least a name or make before it can go on the website." }, { status: 400 });
  }

  const src = video.storage_path as string;
  const ext = (src.split(".").pop() || "mp4").toLowerCase();
  const key = `${sitePage}/${slug}/${videoId}.${ext}`;
  const contentType = ext === "mov" ? "video/quicktime" : "video/mp4";

  // ── start ────────────────────────────────────────────────────────────────
  if (action === "start") {
    // Already copied by an earlier publish. The key is the video's id, so the
    // bytes can't be stale — nothing to redo.
    if (await r2Exists(key)) {
      return NextResponse.json({ alreadyThere: true, key });
    }

    // A 6-hour signed link outlives the copy comfortably, even on a slow one.
    // Signed from whichever store holds the file — after the migration the
    // source is the private Cloudflare bucket, not Supabase.
    const sourceUrl = await signVideoUrl(svc, video, { expiresIn: 60 * 60 * 6 });
    if (!sourceUrl) {
      return NextResponse.json({ error: "Couldn't read the source video." }, { status: 400 });
    }
    const signed = { signedUrl: sourceUrl };

    // Ask the file how big it is, by requesting a single byte and reading the
    // total out of the Content-Range header.
    //
    // The obvious approach — reading `size` from Supabase's storage.objects
    // table — doesn't work: that schema isn't exposed through the API even to
    // the service key, so the lookup came back empty and the copy refused to
    // start. This asks the same source the copy will actually read from, which
    // is the honest thing to measure anyway, and it doubles as a check that the
    // signed link works and supports ranges before we commit to a multipart
    // upload.
    let totalBytes = 0;
    try {
      const probe = await fetch(signed.signedUrl, {
        headers: { Range: "bytes=0-0" },
        cache: "no-store",
      });
      const range = probe.headers.get("content-range"); // "bytes 0-0/1302545678"
      const total = range?.split("/")[1];
      totalBytes = Number(total ?? 0);

      if (!totalBytes) {
        // No Content-Range means ranges aren't supported, which would make the
        // part-by-part copy impossible — better to say so than to half-try.
        const len = probe.headers.get("content-length");
        if (probe.status === 200 && len) {
          return NextResponse.json({
            error: "The source didn't accept a partial request, so this file can't be copied in parts.",
          }, { status: 400 });
        }
      }
    } catch (e) {
      return NextResponse.json({
        error: `Couldn't reach the video file: ${e instanceof Error ? e.message : "unknown error"}`,
      }, { status: 502 });
    }

    if (!totalBytes) {
      return NextResponse.json({ error: "Couldn't determine the file size." }, { status: 400 });
    }

    const uploadId = await startCopy(R2_BUCKET, key, contentType);

    return NextResponse.json({
      uploadId,
      key,
      sourceUrl: signed.signedUrl,
      totalBytes,
      totalParts: partCount(totalBytes),
      filename: video.filename ?? null,
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
        bucket: R2_BUCKET,
        key,
        uploadId,
        sourceUrl,
        partNumber: Number(partNumber),
        start,
        end,
      });
      return NextResponse.json({ part });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "That part failed." },
        { status: 502 }
      );
    }
  }

  // ── finish ───────────────────────────────────────────────────────────────
  if (action === "finish") {
    const { uploadId, parts } = body;
    if (!uploadId || !Array.isArray(parts)) {
      return NextResponse.json({ error: "Missing upload details" }, { status: 400 });
    }
    try {
      await finishCopy(R2_BUCKET, key, uploadId, parts as PartRef[]);
      return NextResponse.json({ done: true, key });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Couldn't finish the copy." },
        { status: 502 }
      );
    }
  }

  // ── abandon ──────────────────────────────────────────────────────────────
  // Half-finished uploads keep their parts in the bucket and are billed for,
  // while being invisible in the file list. Always worth tidying.
  if (action === "abort") {
    const { uploadId } = body;
    if (uploadId) await abortCopy(R2_BUCKET, key, uploadId).catch(() => {});
    return NextResponse.json({ aborted: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
