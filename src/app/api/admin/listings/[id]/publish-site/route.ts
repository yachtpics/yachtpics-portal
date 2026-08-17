import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { buildListingFiles, renderSitePage, resolveSitePage } from "@/lib/sitePublish";
import { ftpConfigured, uploadFiles, deleteFiles } from "@/lib/siteFtp";
import { r2Configured, r2Delete } from "@/lib/r2";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/admin/listings/[id]/publish-site  { publish: boolean, dryRun?: boolean }
//   → publish (or unpublish) a listing on yachtpics.com.
// Admin only. The broker's pocket-listing veto is enforced in buildListingFiles.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const publish = body?.publish === true;
  const dryRun = body?.dryRun === true;

  await svc
    .from("listings")
    .update({ publish_to_site: publish, ...(publish ? {} : { published_at: null }) })
    .eq("id", params.id);

  // Unpublishing means OFF the website — not merely unlinked.
  //
  // It used to leave the boat page sitting on the server, on the reasoning that
  // old links should keep resolving. Two problems with that. It quietly builds
  // up pages that lead nowhere, which is the same mess the retired brokerage
  // pages caused. And it doesn't do what the switch appears to do: if an owner
  // asks for their boat to come down, "still reachable by anyone with the link"
  // isn't down.
  //
  // So: delete the boat page, delete its video from the public media host, and
  // rewrite the brokerage page. Photos stay in the portal, video stays in the
  // portal — the broker loses nothing, and the boat can go back up later.
  if (!publish) {
    if (dryRun) return NextResponse.json({ success: true, published: false, previewOnly: true });

    const { data: l } = await svc
      .from("listings")
      .select("site_page, site_slug")
      .eq("id", params.id)
      .maybeSingle();

    const sitePage = (l?.site_page as string | null) ?? (await resolveSitePage(params.id));
    const slug = l?.site_slug as string | null;
    const warnings: string[] = [];

    // Deletes ONLY from the public website bucket (yachtpics-media).
    //
    // This is worth being explicit about, because "delete it from Cloudflare"
    // sounds like it would take the video away from the broker too. It can't:
    // there are two separate buckets, and they are not interchangeable.
    //
    //   yachtpics-media  — public. Website copies. Anyone with the address can
    //                      watch. This is what unpublishing removes.
    //   yachtpics-video  — private. The portal's own copy, reached only through
    //                      a short-lived signed link. Never touched here.
    //
    // So after unpublishing: gone from the website, still in the portal for the
    // broker to watch, download and send. That holds true once video has moved
    // off Supabase entirely, because the portal will be reading from the private
    // bucket by then — a different bucket from the one this line empties.
    //
    // Public video goes first: it shouldn't be watchable a moment longer than
    // necessary. Photos in the public bucket are left alone — orphaned but
    // harmless, and keeping them makes re-publishing quick.
    if (sitePage && slug && r2Configured()) {
      const { data: vids } = await svc
        .from("videos")
        .select("id, storage_path")
        .eq("listing_id", params.id);
      for (const v of vids ?? []) {
        const ext = ((v.storage_path as string).split(".").pop() || "mp4").toLowerCase();
        await r2Delete(`${sitePage}/${slug}/${v.id}.${ext}`).catch(() => {
          warnings.push("A video couldn't be removed from the media host.");
        });
        await r2Delete(`${sitePage}/${slug}/poster-${v.id}.jpg`).catch(() => {});
      }
    }

    if (ftpConfigured()) {
      // Remove the boat's own page, then refresh the brokerage page it was
      // listed on so the link goes with it.
      if (sitePage && slug) {
        const res = await deleteFiles([`${sitePage}/${slug}/index.html`]);
        if (res.error) warnings.push(`The boat page couldn't be deleted: ${res.error}`);
      }
      if (sitePage) {
        const page = await renderSitePage(sitePage);
        if (page) {
          const res = await uploadFiles([page]);
          if (res.error) return NextResponse.json({ error: res.error }, { status: 502 });
        }
      }
    }

    return NextResponse.json({
      success: true,
      published: false,
      removedFromSite: true,
      ...(warnings.length ? { warning: warnings.join(" ") } : {}),
    });
  }

  const built = await buildListingFiles(params.id);
  if ("error" in built) return NextResponse.json({ error: built.error }, { status: 400 });

  // Preview mode, or FTP not wired up yet: hand back what WOULD ship.
  if (dryRun || !ftpConfigured()) {
    return NextResponse.json({
      success: true,
      published: false,
      previewOnly: true,
      reason: dryRun ? "Dry run" : "FTP is not configured — nothing was uploaded.",
      slug: built.slug,
      label: built.label,
      files: built.files.map((f) => ({ path: f.path, bytes: f.content.length })),
      html: built.files[0]?.content ?? null,
    });
  }

  const res = await uploadFiles(built.files);
  if (res.error) {
    // The upload failed after we'd already flipped publish_to_site on (the
    // publisher requires it set to build). Roll it back so the boat doesn't
    // read as "on the website" while it isn't — the toggle stays "Add to
    // website" and a retry re-publishes cleanly.
    await svc
      .from("listings")
      .update({ publish_to_site: false, published_at: null })
      .eq("id", params.id);
    return NextResponse.json({ error: res.error, uploaded: res.uploaded }, { status: 502 });
  }

  return NextResponse.json({
    success: true,
    published: true,
    slug: built.slug,
    label: built.label,
    uploaded: res.uploaded,
    url: `https://www.yachtpics.com/${built.files[0].path}`,
  });
}
