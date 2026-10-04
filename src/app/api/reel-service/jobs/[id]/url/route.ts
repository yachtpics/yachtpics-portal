import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { r2SignedGetUrl, r2VideoConfigured } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reel-service/jobs/[id]/url → { url, downloadUrl, filename }
 *
 * Fresh signed R2 links to one Reel Service reel. The viewer must be the
 * broker, an assistant linked to the broker (broker_assistants), or an admin.
 * Brokers and assistants only see delivered reels; admins also see ready ones.
 * `url` plays inline; `downloadUrl` saves as a file.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!r2VideoConfigured()) return NextResponse.json({ error: "Video storage isn't configured." }, { status: 500 });

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: job } = await svc.from("reel_service_jobs")
    .select("id, broker_id, status, video_path, period, slot, listings:listing_id(vessel_name)")
    .eq("id", params.id).maybeSingle();
  if (!job || !job.video_path) return NextResponse.json({ error: "Reel not found." }, { status: 404 });

  const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const isAdmin = me?.role === "admin";
  if (!isAdmin) {
    if (job.status !== "delivered") return NextResponse.json({ error: "Reel not found." }, { status: 404 });
    let allowed = job.broker_id === user.id;
    if (!allowed) {
      const { data: link } = await svc.from("broker_assistants").select("id")
        .eq("broker_id", job.broker_id).eq("assistant_id", user.id).maybeSingle();
      allowed = !!link;
    }
    if (!allowed) return NextResponse.json({ error: "Reel not found." }, { status: 404 });
  }

  const listing = job.listings as unknown as { vessel_name: string | null } | null;
  const base = (listing?.vessel_name ?? "reel").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "reel";
  const filename = `${base}-reel-${job.period}-${job.slot}.mp4`;
  const [url, downloadUrl] = await Promise.all([
    r2SignedGetUrl(job.video_path, { expiresIn: 60 * 60 * 6 }),
    r2SignedGetUrl(job.video_path, { expiresIn: 60 * 60 * 6, downloadAs: filename }),
  ]);
  return NextResponse.json({ url, downloadUrl, filename });
}
