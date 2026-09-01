import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { logMediaDeletion, listingDisplayName, profileDisplayName } from "@/lib/mediaDeletionLog";

/**
 * POST /api/photos/delete
 *   { photoId }              — one photo
 *   { photoIds: [...] }      — a batch (select-and-delete, or Delete All)
 *
 * The single door every photo deletion goes through, for two reasons:
 *
 * 1. The storage path deleted is the one recorded on the row, never one the
 *    caller sends — a caller entitled to delete one photo must not be able to
 *    name any other file in the bucket. (The old version trusted the client's
 *    path; that's why this route reads the rows first.)
 * 2. Every deletion lands in the media_deletions log — one row per action,
 *    snapshotting who, what, and which boat — so "were there ever photos on
 *    this listing?" is a lookup, not an archaeology dig.
 *
 * Access mirrors the video delete: the listing's own rule (owner, assistants,
 * co-brokers, admin); gallery photos are admin-only.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body?.photoIds)
      ? body.photoIds.filter((x: unknown) => typeof x === "string")
      : typeof body?.photoId === "string"
        ? [body.photoId]
        : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "Missing photoId(s)" }, { status: 400 });
    }

    const supabaseUser = await createServerClient();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: photos } = await svc
      .from("photos")
      .select("id, listing_id, gallery_id, storage_path, filename")
      .in("id", ids);
    if (!photos || photos.length === 0) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    // One request deletes from ONE place. A batch that mixes listings would
    // make the access check ambiguous, and no real caller does that.
    const listingIds = new Set(photos.map((p) => p.listing_id).filter(Boolean));
    const galleryIds = new Set(photos.map((p) => p.gallery_id).filter(Boolean));
    if (listingIds.size > 1 || (listingIds.size === 1 && galleryIds.size > 0)) {
      return NextResponse.json({ error: "Those photos belong to different places." }, { status: 400 });
    }

    const listingId = (photos[0].listing_id as string | null) ?? null;
    const galleryId = (photos[0].gallery_id as string | null) ?? null;

    if (listingId) {
      const access = await assertListingAccess(svc, listingId, user.id, { includeCoBroker: true });
      if (access instanceof NextResponse) return access;
    } else {
      const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
    }

    // Row-recorded paths only. Best effort on storage — a file already gone
    // must not stop the record from being cleaned up.
    const paths = photos.map((p) => p.storage_path as string).filter(Boolean);
    if (paths.length > 0) {
      await svc.storage.from("listing-photos").remove(paths).catch(() => {});
    }
    const { error: dbError } = await svc.from("photos").delete().in("id", photos.map((p) => p.id));
    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

    // One log row for the whole action — 100 photos deleted at once is one
    // decision by one person, not 100 events.
    let contextName: string | null = null;
    let brokerName: string | null = null;
    if (listingId) {
      const { data: l } = await svc
        .from("listings").select("vessel_name, make, model, broker_id").eq("id", listingId).maybeSingle();
      contextName = listingDisplayName(l);
      if (l?.broker_id) {
        const { data: b } = await svc
          .from("profiles").select("first_name, last_name").eq("id", l.broker_id).maybeSingle();
        brokerName = profileDisplayName(b);
      }
    } else if (galleryId) {
      const { data: g } = await svc.from("galleries").select("title").eq("id", galleryId).maybeSingle();
      contextName = (g?.title as string | null) ?? null;
    }
    await logMediaDeletion(svc, {
      mediaType: "photo",
      actorId: user.id,
      listingId,
      galleryId,
      contextName,
      brokerName,
      photoCount: photos.length,
      filename: photos.length === 1 ? (photos[0].filename as string | null) : null,
      storagePath: photos.length === 1 ? (photos[0].storage_path as string) : null,
      storageHost: "supabase",
      extra: photos.length > 1
        ? { filenames: photos.slice(0, 25).map((p) => p.filename ?? p.storage_path) }
        : {},
    });

    return NextResponse.json({ success: true, deleted: photos.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
