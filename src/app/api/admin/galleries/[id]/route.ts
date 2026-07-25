import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";

// PATCH /api/admin/galleries/[id]  → update title / expiry / slideshow toggle
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  let body: {
    title?: string;
    expiry?: { days?: number | null; date?: string | null; clear?: boolean } | null;
    slideshowPublished?: boolean;
    downloadsEnabled?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) update.title = body.title.trim();
  if (typeof body.slideshowPublished === "boolean") update.slideshow_published = body.slideshowPublished;
  if (typeof body.downloadsEnabled === "boolean") update.downloads_enabled = body.downloadsEnabled;

  if (body.expiry !== undefined) {
    const e = body.expiry;
    if (e === null || e?.clear) {
      update.expires_at = null;
    } else if (typeof e?.days === "number" && e.days > 0) {
      update.expires_at = new Date(Date.now() + e.days * 86400000).toISOString();
    } else if (e?.date) {
      const d = new Date(e.date);
      if (!isNaN(d.getTime())) update.expires_at = d.toISOString();
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await admin.from("galleries").update(update).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// DELETE /api/admin/galleries/[id]  → delete gallery + its storage files
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  const { data: photos } = await admin.from("photos").select("storage_path").eq("gallery_id", params.id);
  if (photos && photos.length > 0) {
    await admin.storage.from("listing-photos").remove(photos.map((p) => p.storage_path));
  }
  const { data: videos } = await admin.from("videos").select("storage_path").eq("gallery_id", params.id);
  if (videos && videos.length > 0) {
    await admin.storage.from("listing-videos").remove(videos.map((v) => v.storage_path));
  }

  // Cascades remove photo/video rows, gallery_access, views, downloads
  const { error } = await admin.from("galleries").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
