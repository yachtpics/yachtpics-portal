import { NextRequest, NextResponse } from "next/server";
import { requireBillingStaff } from "@/lib/books/staff";
import { dateET } from "@/lib/books/types";
import { cleanBoatYear } from "@/lib/books/invoiceInput";

export const runtime = "nodejs";

/**
 * GET ?q= — boat picker for YachtPics invoices: listings by vessel name,
 * with length, vessel type and broker, plus the billing client linked to that broker
 * (billing_clients.broker_profile_id, matched by email) as a suggestion,
 * the shoot date (listings.photographed_at, as an ET date) so a draft's
 * invoice date can default to it, and make / model / year for the invoice's
 * boat snapshot.
 */
export async function GET(req: NextRequest) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin } = auth;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().replace(/[%_,()]/g, " ").slice(0, 60);
  if (q.length < 2) return NextResponse.json({ listings: [] });

  const { data, error } = await admin
    .from("listings")
    .select("id, vessel_name, length_ft, year, make, model, vessel_type, broker_id, photographed_at")
    .ilike("vessel_name", `%${q}%`)
    .order("updated_at", { ascending: false })
    .limit(15);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as { id: string; vessel_name: string | null; length_ft: number | string | null; year: number | null; make: string | null; model: string | null; vessel_type: string | null; broker_id: string | null; photographed_at: string | null }[];

  const brokerIds: string[] = [];
  rows.forEach((r) => { if (r.broker_id && brokerIds.indexOf(r.broker_id) === -1) brokerIds.push(r.broker_id); });
  const brokers: Record<string, string> = {};
  const clients: Record<string, { id: string; display_name: string }> = {};
  if (brokerIds.length) {
    const [{ data: ps }, { data: cs }] = await Promise.all([
      admin.from("profiles").select("id, first_name, last_name").in("id", brokerIds),
      admin.from("billing_clients").select("id, display_name, broker_profile_id, status").in("broker_profile_id", brokerIds),
    ]);
    (ps ?? []).forEach((p: { id: string; first_name: string | null; last_name: string | null }) => {
      brokers[p.id] = [p.first_name, p.last_name].filter(Boolean).join(" ");
    });
    (cs ?? []).forEach((c: { id: string; display_name: string; broker_profile_id: string; status: string }) => {
      const cur = clients[c.broker_profile_id];
      if (!cur || c.status === "active") clients[c.broker_profile_id] = { id: c.id, display_name: c.display_name };
    });
  }
  return NextResponse.json({
    listings: rows.map((r) => ({
      id: r.id,
      name: r.vessel_name || "Untitled listing",
      lengthFt: r.length_ft == null || r.length_ft === "" ? null : Number(r.length_ft),
      detail: [r.year, r.make, r.model].filter(Boolean).join(" "),
      // Stored on the invoice when picked (boat_make / boat_model / boat_year).
      make: r.make && r.make.trim() ? r.make.trim() : null,
      model: r.model && r.model.trim() ? r.model.trim() : null,
      year: cleanBoatYear(r.year) ?? null,
      broker: r.broker_id ? brokers[r.broker_id] || null : null,
      vesselType: r.vessel_type && r.vessel_type.trim() ? r.vessel_type.trim() : null,
      suggestedClient: r.broker_id ? clients[r.broker_id] ?? null : null,
      shootDate: dateET(r.photographed_at),
    })),
  });
}
