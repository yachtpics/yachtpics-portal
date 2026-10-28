import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { logMediaDeletion, listingDisplayName, profileDisplayName } from "@/lib/mediaDeletionLog";
import { removeDerivatives } from "@/lib/photoDerivatives";
import { deleteOriginals, headR2Original, noteR2PhotoExists, signOriginalUrl, signResizedPath } from "@/lib/photoStore";

export const runtime = "nodejs";

const BUCKET = "listing-photos";

/**
 * POST /api/listings/[id]/photos/[photoId]/replace  { newPath, filename }
 *   → { photo: { id, storage_path, filename, thumbUrl, originalUrl } }
 *
 * Swap the file behind a photo without losing anything about it. The browser
 * has already uploaded the new file to a NEW path (see replaceListingPhoto in
 * src/lib/uploadListingPhoto.ts); this repoints the row and removes the old
 * file. The row keeps its id — so display_order, category, visibility and the
 * listing's hero_photo_id (which points at the id) all survive.
 *
 * Access is the photo-delete rule (owner, linked assistant, co-broker, admin;
 * not brokerage admins): replacing removes a file, so it's a destructive action.
 *
 * The new path is checked, not trusted: it must sit in this listing's folder
 * (`{broker or caller}/{listingId}/{file}`), exist in storage, and not already
 * belong to another photo — otherwise deleting one later would take the other's
 * file with it.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; photoId: string } }
) {
  try {
    const listingId = params.id;
    const photoId = params.photoId;
    const body = await req.json().catch(() => ({}));
    const newPath = typeof body?.newPath === "string" ? body.newPath : "";
    const filename = typeof body?.filename === "string" ? body.filename.slice(0, 255) : null;
    // Where the browser put the new file (src/lib/photoStoreClient.ts uploadOriginal).
    const newBackend: "supabase" | "r2" = body?.backend === "r2" ? "r2" : "supabase";
    if (!listingId || !photoId || !newPath) {
      return NextResponse.json({ error: "Missing listing, photo or file." }, { status: 400 });
    }

    const supabaseUser = await createServerClient();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const access = await assertListingAccess(svc, listingId, user.id, { includeCoBroker: true });
    if (access instanceof NextResponse) return access;

    const { data: photo } = await svc
      .from("photos")
      .select("id, listing_id, storage_path, storage_backend, filename")
      .eq("id", photoId)
      .maybeSingle();
    if (!photo || photo.listing_id !== listingId) {
      return NextResponse.json({ error: "Photo not found on this listing." }, { status: 404 });
    }

    // {owner}/{listingId}/{file} — owner is the listing's broker (admin
    // uploads) or the caller (broker / assistant uploads), as normal uploads do.
    const parts = newPath.split("/");
    if (
      parts.length !== 3 ||
      parts.some((s: string) => !s || s === "." || s === ".." || s.includes("\\")) ||
      parts[1] !== listingId ||
      (parts[0] !== access.brokerId && parts[0] !== user.id) ||
      newPath === photo.storage_path
    ) {
      return NextResponse.json({ error: "That upload isn't in this listing's folder." }, { status: 400 });
    }

    let newBytes: number | null = null;
    if (newBackend === "r2") {
      const head = await headR2Original(newPath);
      if (!head || head.size <= 0) {
        return NextResponse.json({ error: "The new file didn't reach storage — try again." }, { status: 400 });
      }
      newBytes = head.size;
      noteR2PhotoExists();
    } else {
      const { data: listed, error: listError } = await svc.storage
        .from(BUCKET)
        .list(`${parts[0]}/${parts[1]}`, { search: parts[2], limit: 10 });
      if (listError || !(listed ?? []).some((o) => o.name === parts[2])) {
        return NextResponse.json({ error: "The new file didn't reach storage — try again." }, { status: 400 });
      }
    }

    const { data: clash } = await svc
      .from("photos")
      .select("id")
      .eq("storage_path", newPath)
      .limit(1);
    if ((clash ?? []).length > 0) {
      return NextResponse.json({ error: "That file already belongs to another photo." }, { status: 409 });
    }

    const oldPath = photo.storage_path as string;
    const { data: updated, error: updateError } = await svc
      .from("photos")
      // derivatives_at cleared: the stored thumbnails belong to the old file.
      // The browser asks for new ones right after (replaceListingPhoto).
      .update({
        storage_path: newPath,
        filename: filename ?? photo.filename,
        derivatives_at: null,
        storage_backend: newBackend,
        original_bytes: newBytes,
        r2_verified_at: null,
        r2_copy_error: null,
        supabase_removed_at: null,
      })
      .eq("id", photoId)
      .eq("listing_id", listingId)
      .select("id, storage_path, filename")
      .single();
    if (updateError || !updated) {
      return NextResponse.json({ error: updateError?.message ?? "Couldn't update the photo." }, { status: 500 });
    }

    // Old file goes only once the row no longer points at it, and only if no
    // other row still does. Best effort: a leftover file is harmless, a row
    // pointing at nothing is not.
    if (oldPath) {
      // The old file's stored thumbnails ({dir}/_d/{photoId}-{hash of old path}-…).
      await removeDerivatives(svc, [{ id: photoId, storage_path: oldPath }]);
      const { data: stillUsed } = await svc.from("photos").select("id").eq("storage_path", oldPath).limit(1);
      if (!(stillUsed ?? []).length) {
        // Wherever it lives (Supabase, R2, or both mid-migration).
        await deleteOriginals(svc, [oldPath]);
      }
    }

    // Fresh links for the new path, so the page can swap the tile right away.
    // Same thumbnail shape as /api/thumbs.
    // (An R2 original has no derivatives yet, so its "thumbnail" is the
    // original until they're made a moment later — never a broken tile.)
    const [thumbUrl, originalUrl] = await Promise.all([
      signResizedPath(svc, newPath, 60 * 60 * 6, { width: 400, height: 400, resize: "contain", quality: 72 }),
      signOriginalUrl(svc, newPath, 3600),
    ]);

    // The old file left storage, so it goes in the deletion log like any
    // other photo removal — marked as a replacement.
    const { data: l } = await svc
      .from("listings").select("vessel_name, make, model, broker_id").eq("id", listingId).maybeSingle();
    let brokerName: string | null = null;
    if (l?.broker_id) {
      const { data: b } = await svc.from("profiles").select("first_name, last_name").eq("id", l.broker_id).maybeSingle();
      brokerName = profileDisplayName(b);
    }
    await logMediaDeletion(svc, {
      mediaType: "photo",
      actorId: user.id,
      listingId,
      galleryId: null,
      contextName: listingDisplayName(l),
      brokerName,
      photoCount: 1,
      filename: (photo.filename as string | null) ?? null,
      storagePath: oldPath,
      storageHost: (photo as { storage_backend?: string | null }).storage_backend === "r2" ? "r2" : "supabase",
      extra: { replaced: true, replaced_with: filename ?? newPath, photo_id: photoId },
    });

    return NextResponse.json({
      photo: {
        id: updated.id,
        storage_path: updated.storage_path,
        filename: updated.filename,
        thumbUrl,
        originalUrl,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
