import { NextRequest, NextResponse } from "next/server";
import { resolveActingBroker, serviceClient } from "@/lib/brokerSiteServer";
import { isMissingSchema } from "@/lib/brokerSite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Website inquiries (Oct 26).
 *   GET   ?brokerId=          newest 100 leads, with the boat's name
 *   PATCH {id, handled}       mark handled / not handled
 */

export async function GET(req: NextRequest) {
  const who = await resolveActingBroker(req.nextUrl.searchParams.get("brokerId"));
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  const { data, error } = await serviceClient()
    .from("site_leads")
    .select("id, kind, name, email, phone, contact_pref, inquiry_type, message, boat, created_at, handled_at, listing_id, listings:listing_id(vessel_name, year, make, model, length_ft)")
    .eq("broker_id", who.brokerId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    if (isMissingSchema(error)) return NextResponse.json({ ready: false, leads: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ready: true, leads: data ?? [] });
}

export async function PATCH(req: NextRequest) {
  const who = await resolveActingBroker(req.nextUrl.searchParams.get("brokerId"));
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  const body = (await req.json().catch(() => ({}))) as { id?: unknown; handled?: unknown };
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ error: "Inquiry not found." }, { status: 400 });
  const handledAt = body.handled === false ? null : new Date().toISOString();
  const { data, error } = await serviceClient()
    .from("site_leads")
    .update({ handled_at: handledAt })
    .eq("id", id)
    .eq("broker_id", who.brokerId)
    .select("id, handled_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: isMissingSchema(error) ? 503 : 500 });
  if (!data) return NextResponse.json({ error: "Inquiry not found." }, { status: 404 });
  return NextResponse.json({ ok: true, handledAt: data.handled_at });
}
