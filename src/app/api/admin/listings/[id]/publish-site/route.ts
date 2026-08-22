import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { buildListingFiles, unpublishFromSite } from "@/lib/sitePublish";
import { ftpConfigured, uploadFiles } from "@/lib/siteFtp";

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

  // Unpublishing means OFF the website — not merely unlinked. The takedown
  // itself lives in unpublishFromSite() so that the broker's pocket-listing
  // veto can run exactly the same steps.
  if (!publish) {
    if (dryRun) {
      await svc
        .from("listings")
        .update({ publish_to_site: false, published_at: null })
        .eq("id", params.id);
      return NextResponse.json({ success: true, published: false, previewOnly: true });
    }

    const { warnings, error } = await unpublishFromSite(params.id);
    if (error) return NextResponse.json({ error }, { status: 502 });

    return NextResponse.json({
      success: true,
      published: false,
      removedFromSite: true,
      ...(warnings.length ? { warning: warnings.join(" ") } : {}),
    });
  }

  await svc
    .from("listings")
    .update({ publish_to_site: true })
    .eq("id", params.id);

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
