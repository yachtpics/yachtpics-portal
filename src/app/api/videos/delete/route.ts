import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { r2Configured, r2Delete, r2VideoDelete } from "@/lib/r2";
import { buildListingFiles } from "@/lib/sitePublish";
import { ftpConfigured, uploadFiles } from "@/lib/siteFtp";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    // storagePath is still accepted for compatibility with callers that send
    // it, but is deliberately ignored — the row is the authority on where the
    // file actually lives.
    const { videoId } = await req.json();
    if (!videoId) {
      return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
    }

    const supabaseUser = await createServerClient();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Use service role for all permission checks — avoids RLS blocking the join read
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: video } = await supabaseAdmin
      .from("videos")
      .select("id, listing_id, storage_path, storage_host, thumbnail_path")
      .eq("id", videoId)
      .single();

    if (!video) return NextResponse.json({ error: "Video not found" }, { status: 404 });

    // Listing videos: the listing's own access rule. Gallery videos have no
    // listing — they're admin-managed, so admin is the requirement.
    if (video.listing_id) {
      const access = await assertListingAccess(supabaseAdmin, video.listing_id, user.id);
      if (access instanceof NextResponse) return access;
    } else {
      const { data: me } = await supabaseAdmin.from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
    }

    // Delete the path recorded against the row, NOT the one the caller sent.
    // Access is checked per listing, but the path arrived in the request body
    // and this runs with the service role — so a caller entitled to delete one
    // video could have named any file in the bucket and had it removed.
    //
    // The file lives in whichever store the row says it does. During the
    // migration a video that's been moved has its bytes on Cloudflare and
    // nothing in Supabase — removing from the wrong one would silently leave
    // the real file behind, paid for and orphaned.
    // During the migration a video can exist in BOTH stores at once — moved to
    // Cloudflare, Supabase copy kept as the safety net until cleanup. Deleting
    // a video must clear both, or the row disappears while one copy stays
    // behind, paid for and unfindable. Removing a path that isn't there is a
    // harmless no-op in either store.
    if (video.storage_host === "r2") {
      await r2VideoDelete(video.storage_path).catch(() => {});
    }
    await supabaseAdmin.storage.from("listing-videos").remove([video.storage_path]);

    // The still captured from this video lives in the photos bucket. Remove it
    // too — it's useless without the video, and orphaned files would quietly
    // accumulate against the storage bill.
    if (video.thumbnail_path) {
      await supabaseAdmin.storage.from("listing-photos").remove([video.thumbnail_path]);
    }

    const { error: dbError } = await supabaseAdmin
      .from("videos")
      .delete()
      .eq("id", videoId);

    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

    // If this video was published to yachtpics.com there is a second copy on
    // the public media host, and the live boat page points straight at it.
    //
    // Without this, deleting a video in the portal would leave it playing on the
    // public website — the worst version of this bug, because the broker
    // believes it's gone. Remove the public copy first (that alone stops it
    // being watchable), then rewrite the page so the player disappears too.
    const siteResult = video.listing_id
      ? await removeFromWebsite(supabaseAdmin, video.listing_id, videoId, video.storage_path)
      : {};

    return NextResponse.json({ success: true, ...siteResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Take a deleted video off the public website.
 *
 * Two steps, in this order on purpose:
 *   1. delete the file from the public bucket — the moment that's done nobody
 *      can watch it, even with the direct address
 *   2. rebuild and re-upload the boat page so the player is gone too
 *
 * Doing it the other way round would leave a window where the page was updated
 * but the file still sat there, publicly readable to anyone who had the URL.
 *
 * Never throws: the video IS deleted from the portal by this point, and a
 * failure to tidy the website shouldn't turn a successful delete into an error
 * the broker has to interpret. It reports instead, so the caller can say the
 * page needs re-publishing.
 */
async function removeFromWebsite(
  svc: SupabaseClient,
  listingId: string,
  videoId: string,
  storagePath: string
): Promise<{ siteUpdated?: boolean; siteWarning?: string }> {
  try {
    if (!r2Configured()) return {};

    const { data: listing } = await svc
      .from("listings")
      .select("site_page, site_slug, publish_to_site")
      .eq("id", listingId)
      .maybeSingle();

    const sitePage = listing?.site_page as string | null;
    const slug = listing?.site_slug as string | null;
    if (!sitePage || !slug) return {};

    const ext = (storagePath.split(".").pop() || "mp4").toLowerCase();
    await r2Delete(`${sitePage}/${slug}/${videoId}.${ext}`).catch(() => {});
    await r2Delete(`${sitePage}/${slug}/poster-${videoId}.jpg`).catch(() => {});

    // Only worth rewriting the page if the boat is actually live.
    if (listing?.publish_to_site !== true) return { siteUpdated: false };

    const built = await buildListingFiles(listingId);
    if ("error" in built) {
      return { siteUpdated: false, siteWarning: `The video is gone, but the website page couldn't be rebuilt: ${built.error}` };
    }
    if (!ftpConfigured()) {
      return { siteUpdated: false, siteWarning: "The video is gone from the media host, but the website page wasn't updated." };
    }

    const res = await uploadFiles(built.files);
    if (res.error) {
      return { siteUpdated: false, siteWarning: `The video is gone, but the website page couldn't be updated: ${res.error}` };
    }

    return { siteUpdated: true };
  } catch (e) {
    return {
      siteUpdated: false,
      siteWarning: `The video is gone, but the website page may still show it: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}
