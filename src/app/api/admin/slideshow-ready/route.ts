import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { prepareSlideshows, sendSlideshowReady, sendSlideshowReadyTest, planSlideshowReady } from "@/lib/slideshowReadyCampaign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Looks up ~150 brokers' access, then renders and batches the emails.
export const maxDuration = 60;

/**
 * POST /api/admin/slideshow-ready — the "Slideshow ready" campaign's actions
 * (admins only; driven from /admin/announce/slideshow-ready).
 *   { action: "prepare", listingIds }          Step 1: create the slideshows
 *   { action: "test", brokerId? }               a test copy to the signed-in admin
 *   { action: "send", brokerIds, confirm: "SEND" }  Step 2: send (deduped)
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const svc = auth.admin;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; listingIds?: unknown; brokerIds?: unknown; brokerId?: unknown; confirm?: unknown };
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)) : []);

  try {
    if (body.action === "prepare") {
      const listingIds = ids(body.listingIds);
      if (listingIds.length === 0) return NextResponse.json({ error: "Tick at least one listing." }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await prepareSlideshows(svc, listingIds, auth.userId)) });
    }

    if (body.action === "test") {
      const { data: me } = await svc.from("profiles").select("display_email").eq("id", auth.userId).maybeSingle();
      let to = (me?.display_email as string | null) ?? null;
      if (!to) {
        const { data } = await svc.auth.admin.getUserById(auth.userId);
        to = data.user?.email ?? null;
      }
      if (!to) return NextResponse.json({ error: "Your account has no email address." }, { status: 400 });
      const plan = await planSlideshowReady(svc);
      const sample = typeof body.brokerId === "string" ? plan.recipients.find((r) => r.brokerId === body.brokerId) : plan.recipients[0];
      const r = await sendSlideshowReadyTest(svc, to, auth.userId, sample);
      return r.ok ? NextResponse.json({ ok: true, to }) : NextResponse.json({ error: r.error }, { status: 500 });
    }

    if (body.action === "send") {
      if (body.confirm !== "SEND") return NextResponse.json({ error: "Type SEND to confirm." }, { status: 400 });
      const brokerIds = ids(body.brokerIds);
      if (brokerIds.length === 0) return NextResponse.json({ error: "No recipients ticked." }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await sendSlideshowReady(svc, brokerIds, auth.userId)) });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }
}
