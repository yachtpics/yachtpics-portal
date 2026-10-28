import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import {
  abortR2OriginalMultipart,
  completeR2OriginalMultipart,
  ORIGINAL_PART_SIZE,
  presignR2OriginalPart,
  startR2OriginalMultipart,
  deleteR2Original,
  headR2Original,
  MAX_ORIGINAL_BYTES,
  newOriginalsBackend,
  noteR2PhotoExists,
  originalPathInScope,
  presignR2OriginalPut,
} from "@/lib/photoStore";
import { originalContentType } from "@/lib/photoStoreShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/photos/upload-target
 *   { listingId | galleryId, path, contentType?, size? }
 *     → { backend: "supabase" }                      upload with supabase.storage as before
 *     → { backend: "r2", url, contentType }           PUT the file to `url` with that Content-Type
 *   { listingId | galleryId, path, action: "discard" } → { ok }
 *     removes ONLY the R2 object of an upload whose photos row was never
 *     written (no row on the path, object written in the last 3 h). Never
 *     touches Supabase.
 *
 * An R2 link is only issued for a NEW key (no photos row, no R2 object) and a
 * declared size ≤ MAX_ORIGINAL_BYTES, signed into the link.
 *
 * Where NEW photo originals go is decided here (newOriginalsBackend — the
 * switch in src/lib/photoStore.ts). The file itself goes straight from the
 * browser to storage, never through this function.
 *
 * Access mirrors the storage insert rule: listing photos — the listing's
 * owner, assistants, co-brokers, brokerage admins and admins; gallery photos —
 * admins. The path must be inside that listing's / gallery's folder.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const path = typeof body?.path === "string" ? body.path : "";
  const listingId = typeof body?.listingId === "string" ? body.listingId : null;
  const galleryId = typeof body?.galleryId === "string" ? body.galleryId : null;
  if (!path || (!listingId && !galleryId)) {
    return NextResponse.json({ error: "Missing path or listing." }, { status: 400 });
  }
  if (!originalPathInScope(path, { listing_id: listingId, gallery_id: galleryId })) {
    return NextResponse.json({ error: "That path isn't inside this listing." }, { status: 400 });
  }

  const userClient = await createServerClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  if (listingId) {
    const access = await assertListingAccess(svc, listingId, user.id, { includeCoBroker: true, includeBrokerageAdmin: true });
    if (access instanceof NextResponse) return access;
  } else {
    const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  if (body?.action === "discard") {
    // Removes ONLY the R2 object an upload just created — never anything in
    // Supabase (deck plans, video stills and older originals live there).
    // Refused if any photos row uses the path, or the object isn't a fresh
    // upload (written in the last 3 hours).
    const { count } = await svc.from("photos").select("id", { count: "exact", head: true }).eq("storage_path", path);
    if ((count ?? 0) > 0) return NextResponse.json({ ok: false, error: "A photo still uses that file." }, { status: 409 });
    const head = await headR2Original(path).catch(() => null);
    if (!head) return NextResponse.json({ ok: true });
    const age = head.lastModified ? Date.now() - head.lastModified.getTime() : Infinity;
    if (!(age >= 0 && age < 3 * 60 * 60 * 1000)) {
      return NextResponse.json({ ok: false, error: "That file isn't a fresh upload." }, { status: 409 });
    }
    await deleteR2Original(path).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  // Multipart finish / abort (big originals — see MULTIPART_THRESHOLD).
  if (body?.action === "multipart_complete" || body?.action === "multipart_abort") {
    const uploadId = typeof body?.uploadId === "string" ? body.uploadId : "";
    if (!uploadId) return NextResponse.json({ error: "Missing upload id." }, { status: 400 });
    // Only for a key no photos row uses yet (the row is written after).
    const { count: usedNow } = await svc.from("photos").select("id", { count: "exact", head: true }).eq("storage_path", path);
    if ((usedNow ?? 0) > 0) return NextResponse.json({ error: "A photo already uses that file." }, { status: 409 });
    if (body.action === "multipart_abort") {
      await abortR2OriginalMultipart(path, uploadId).catch(() => {});
      return NextResponse.json({ aborted: true });
    }
    const parts = Array.isArray(body?.parts)
      ? (body.parts as unknown[])
          .map((p) => p as { PartNumber?: unknown; ETag?: unknown })
          .filter((p) => Number.isInteger(p.PartNumber) && typeof p.ETag === "string")
          .map((p) => ({ PartNumber: p.PartNumber as number, ETag: p.ETag as string }))
      : [];
    if (parts.length === 0 || parts.length > 10_000) return NextResponse.json({ error: "Missing parts." }, { status: 400 });
    try {
      await completeR2OriginalMultipart(path, uploadId, parts);
    } catch (e) {
      console.error(`[upload-target] multipart complete failed for ${path}: ${e instanceof Error ? e.message : String(e)}`);
      return NextResponse.json({ error: "Couldn't finish the upload." }, { status: 502 });
    }
    // Counts only if R2 holds exactly the bytes the browser sent.
    const head = await headR2Original(path);
    const want = Number(body?.size);
    if (!head || (Number.isFinite(want) && want > 0 && head.size !== want)) {
      console.error(`[upload-target] multipart size mismatch for ${path}: R2 ${head?.size ?? 0} vs ${want}`);
      await deleteR2Original(path).catch(() => {});
      return NextResponse.json({ error: "The upload didn't assemble correctly." }, { status: 502 });
    }
    noteR2PhotoExists();
    return NextResponse.json({ done: true });
  }

  if (newOriginalsBackend() !== "r2") return NextResponse.json({ backend: "supabase" });

  // Size: declared by the browser, capped here, and signed into the link so
  // a different-sized body is refused by R2.
  const size = Number(body?.size);
  if (!Number.isFinite(size) || size <= 0) return NextResponse.json({ backend: "supabase" });
  if (size > MAX_ORIGINAL_BYTES) {
    console.warn(`[upload-target] refused ${path}: ${size} bytes is over the cap`);
    return NextResponse.json({ error: `That file is over ${Math.round(MAX_ORIGINAL_BYTES / 1024 / 1024)} MB.` }, { status: 413 });
  }

  // Never overwrite: the key must be new — no photos row and no R2 object on it.
  const { count: used } = await svc.from("photos").select("id", { count: "exact", head: true }).eq("storage_path", path);
  if ((used ?? 0) > 0 || (await headR2Original(path))) {
    console.warn(`[upload-target] refused ${path}: key already in use`);
    return NextResponse.json({ error: "That file name is already in use — try again." }, { status: 409 });
  }

  const requested = typeof body?.contentType === "string" ? body.contentType.trim().toLowerCase() : "";
  const contentType = /^image\/[a-z0-9.+-]+$/.test(requested) ? requested : originalContentType(path, "image/jpeg");
  if (body?.action === "multipart_start") {
    try {
      const uploadId = await startR2OriginalMultipart(path, contentType);
      const partCount = Math.ceil(size / ORIGINAL_PART_SIZE);
      const partUrls = await Promise.all(
        Array.from({ length: partCount }, (_, i) => presignR2OriginalPart(path, uploadId, i + 1))
      );
      noteR2PhotoExists();
      return NextResponse.json({ backend: "r2", multipart: true, uploadId, partSize: ORIGINAL_PART_SIZE, partUrls, contentType });
    } catch (e) {
      console.error(`[upload-target] multipart start failed for ${path}: ${e instanceof Error ? e.message : String(e)}`);
      return NextResponse.json({ backend: "supabase" });
    }
  }

  try {
    const url = await presignR2OriginalPut(path, contentType, Math.round(size));
    noteR2PhotoExists();
    return NextResponse.json({ backend: "r2", url, contentType });
  } catch (e) {
    // R2 unreachable for signing → the old path still works (logged).
    console.error(`[upload-target] presign failed for ${path}: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ backend: "supabase" });
  }
}
