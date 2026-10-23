import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { rewriteReelServiceCaption } from "@/lib/reelServiceCaption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/reel-service/jobs/[id]/caption  { action: "rewrite" } → { caption }
 *
 * A fresh caption for one delivered Reel Service reel, saved on the job. Same
 * access as the url route: the broker, an assistant linked to the broker
 * (broker_assistants), or an admin. Brokers and assistants only reach
 * delivered reels, and are held to the per-reel rewrite limit.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (body?.action !== "rewrite") return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: job } = await svc.from("reel_service_jobs").select("id, broker_id, status").eq("id", params.id).maybeSingle();
  if (!job) return NextResponse.json({ error: "Reel not found." }, { status: 404 });

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

  const r = await rewriteReelServiceCaption(svc, job.id, { enforceLimit: !isAdmin });
  return r.ok ? NextResponse.json({ caption: r.caption }) : NextResponse.json({ error: r.error }, { status: r.status });
}
