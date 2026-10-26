import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/requireAdmin";
import { ensureSiteRow, readSiteBilling, websiteEntitlement } from "@/lib/websiteAddon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/website { brokerId, comp: boolean } — admin "Comp website".
 * comp: true → billing_status 'comped' (creates the site row from the broker's
 * name if needed). comp: false → back to 'none', only from 'comped' (the next
 * plan-subscription webhook re-mirrors the plan status). A paid website line
 * on the broker's plan is never touched here.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const svc = auth.admin;
  const body = (await req.json().catch(() => ({}))) as { brokerId?: unknown; comp?: unknown };
  const brokerId = typeof body.brokerId === "string" && /^[0-9a-f-]{36}$/i.test(body.brokerId) ? body.brokerId : null;
  if (!brokerId) return NextResponse.json({ error: "Missing broker." }, { status: 400 });

  const { ready, row } = await readSiteBilling(svc, brokerId);
  if (!ready) return NextResponse.json({ error: "Website billing isn’t set up yet (migration 20261026b)." }, { status: 503 });
  // Paying for the website line on their plan → never touched from here.
  const paid = !!row?.website_item_id && (row.billing_status === "active" || row.billing_status === "past_due");
  if (paid) return NextResponse.json({ error: "This broker pays for the website on their plan — nothing to change here." }, { status: 409 });

  let slug = row?.slug ?? null;
  if (body.comp === true) {
    slug = slug ?? (await ensureSiteRow(svc, brokerId));
    if (!slug) return NextResponse.json({ error: "Couldn’t create the broker’s website." }, { status: 500 });
    const { error } = await svc.from("broker_sites").update({ billing_status: "comped", updated_at: new Date().toISOString() }).eq("broker_id", brokerId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    if (row?.billing_status === "comped") {
      const { error } = await svc.from("broker_sites").update({ billing_status: "none", updated_at: new Date().toISOString() }).eq("broker_id", brokerId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  if (slug) { try { revalidatePath(`/b/${slug}`, "layout"); } catch { /* not fatal */ } }
  const ent = await websiteEntitlement(svc, brokerId);
  return NextResponse.json({ ok: true, slug, entitlement: ent });
}
