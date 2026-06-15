import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = randomBytes(3).toString("hex");
  return base ? `${base}-${suffix}` : suffix;
}

// POST /api/admin/galleries  → create a gallery
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin, userId } = auth;

  let body: { title?: string; galleryType?: string; expiryDays?: number | null; expiryDate?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const title = (body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "A title is required." }, { status: 400 });

  const galleryType = ["event", "owner", "other"].includes(body.galleryType ?? "")
    ? body.galleryType
    : "event";

  let expires_at: string | null = null;
  if (typeof body.expiryDays === "number" && body.expiryDays > 0) {
    expires_at = new Date(Date.now() + body.expiryDays * 86400000).toISOString();
  } else if (body.expiryDate) {
    const d = new Date(body.expiryDate);
    if (!isNaN(d.getTime())) expires_at = d.toISOString();
  }

  // Generate a unique slug (retry a couple times on the unlikely collision)
  let slug = slugify(title);
  for (let i = 0; i < 3; i++) {
    const { data: existing } = await admin.from("galleries").select("id").eq("slug", slug).maybeSingle();
    if (!existing) break;
    slug = slugify(title);
  }

  const { data: created, error } = await admin
    .from("galleries")
    .insert({
      title,
      gallery_type: galleryType,
      slug,
      expires_at,
      created_by: userId,
    })
    .select("id, slug")
    .single();

  if (error || !created) {
    return NextResponse.json({ error: error?.message ?? "Failed to create gallery" }, { status: 500 });
  }

  return NextResponse.json({ gallery: created });
}
