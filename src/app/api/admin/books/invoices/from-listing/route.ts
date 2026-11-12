import { NextRequest, NextResponse } from "next/server";
import { requireBillingStaff } from "@/lib/books/staff";
import { bad, dbError, isUuid } from "@/lib/books/api";
import { isMissingColumn, recalcInvoice } from "@/lib/books/invoices";
import { cleanBoatYear } from "@/lib/books/invoiceInput";
import { prepareInvoiceLines } from "@/lib/books/invoiceLines";
import { pickDefaultItem } from "@/lib/books/defaultLine";
import { dateET, todayET, type BillingItem } from "@/lib/books/types";

export const runtime = "nodejs";

type ListingRow = {
  id: string;
  broker_id: string | null;
  vessel_name: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  length_ft: number | string | null;
  vessel_type: string | null;
  photographed_at: string | null;
};

const NO_CLIENT = "No billing client is linked to this broker yet — open Billing → Clients and link or add them.";

/**
 * POST { listing_id } — "Bill for this boat" on the admin listing page.
 *
 * Makes a YachtPics draft in the CALLER's own book (owner_id = this login),
 * the same way POST /api/admin/books/invoices does (due on receipt: terms 0,
 * no due date; the login's card-fee rate and default note; the default tax
 * rate; "Offer Pay online" from the client), billed to the broker's linked
 * billing client (billing_clients.broker_profile_id = listings.broker_id,
 * first active one), with the boat snapshot (name, length, make, model,
 * year) and the invoice date = the shoot date (ET) when there is one, else
 * today (ET). Then adds the default line the editor would
 * (src/lib/books/defaultLine.ts — quantity = length for per-foot items, 1
 * for flat) through the same line logic as the lines PUT, and recalculates.
 *
 * If this login already has a DRAFT for this listing, its id is returned
 * instead of making a second one ({ id, existing: true }).
 */
export async function POST(req: NextRequest) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  if (staff.brands.indexOf("yachtpics") === -1) return bad("You don't bill under YachtPics.", 403);

  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (!isUuid(body.listing_id)) return bad("Bad listing.");
  const listingId = body.listing_id as string;

  // Already a draft for this boat in this login's book → open that one.
  const { data: existing, error: exErr } = await admin
    .from("billing_invoices")
    .select("id")
    .eq("owner_id", staff.profileId)
    .eq("listing_id", listingId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1);
  if (exErr) return dbError(exErr);
  if (existing && existing.length) return NextResponse.json({ ok: true, id: (existing[0] as { id: string }).id, existing: true });

  const { data: lr, error: lErr } = await admin
    .from("listings")
    .select("id, broker_id, vessel_name, make, model, year, length_ft, vessel_type, photographed_at")
    .eq("id", listingId)
    .maybeSingle();
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  if (!lr) return bad("Listing not found.", 404);
  const listing = lr as ListingRow;
  if (!listing.broker_id) return bad(NO_CLIENT);

  // select("*"): works before 20261109 too (then online_pay is just absent).
  const { data: cls, error: cErr } = await admin
    .from("billing_clients")
    .select("*")
    .eq("broker_profile_id", listing.broker_id)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1);
  if (cErr) return dbError(cErr);
  const client = (cls ?? [])[0] as { id: string; online_pay?: unknown } | undefined;
  if (!client) return bad(NO_CLIENT);

  const [{ data: s, error: sErr }, { data: tax }, { data: itemRows, error: iErr }] = await Promise.all([
    admin.from("billing_staff").select("*").eq("profile_id", staff.profileId).maybeSingle(),
    admin.from("billing_tax_rates").select("rate").eq("is_default", true).eq("active", true).maybeSingle(),
    admin.from("billing_items").select("*").eq("active", true).in("brand", ["yachtpics", "both"]),
  ]);
  if (sErr) return dbError(sErr);
  if (iErr) return dbError(iErr);
  const sx = (s ?? {}) as Record<string, unknown>;

  const lengthFt = listing.length_ft == null || listing.length_ft === "" ? null : Number(listing.length_ft);
  const ft = lengthFt != null && isFinite(lengthFt) && lengthFt > 0 && lengthFt <= 1000 ? Math.round(lengthFt * 100) / 100 : null;
  const make = listing.make && listing.make.trim() ? listing.make.trim().slice(0, 120) : null;
  const model = listing.model && listing.model.trim() ? listing.model.trim().slice(0, 120) : null;
  const year = cleanBoatYear(listing.year) ?? null;
  const clientPay = client.online_pay;
  const onlinePay = typeof clientPay === "boolean" ? clientPay : true;
  const now = new Date().toISOString();

  const row: Record<string, unknown> = {
    owner_id: staff.profileId,
    brand: "yachtpics",
    status: "draft",
    client_id: client.id,
    ...(typeof clientPay === "boolean" ? { online_pay: clientPay } : {}),
    listing_id: listing.id,
    boat_name: (listing.vessel_name && listing.vessel_name.trim() ? listing.vessel_name.trim() : "Untitled listing").slice(0, 120),
    boat_length_ft: ft,
    issue_date: dateET(listing.photographed_at) ?? todayET(),
    terms_days: 0,
    due_date: null,
    tax_rate: tax ? Number((tax as { rate: number }).rate) : 0.065,
    card_fee_rate: staff.cardFeeRate,
    note: (sx.default_note as string | null) ?? null,
    created_by: staff.profileId,
    updated_by: staff.profileId,
    created_at: now,
    updated_at: now,
  };
  const boatDetails = { boat_make: make, boat_model: model, boat_year: year };

  let ins = await admin.from("billing_invoices").insert({ ...row, ...boatDetails }).select("id").single();
  // Before 20261112_billing_boat_details: save without make / model / year.
  if (ins.error && isMissingColumn(ins.error)) ins = await admin.from("billing_invoices").insert(row).select("id").single();
  if (ins.error) return dbError(ins.error);
  const id = (ins.data as { id: string }).id;

  // The default line, by the same rule as the editor's boat pick.
  const items: BillingItem[] = ((itemRows ?? []) as BillingItem[]).map((i) => ({ ...i, rate: Number(i.rate) }));
  const pick = pickDefaultItem(items, listing.vessel_type, ft);
  let lineError: string | null = null;
  if (pick) {
    const prepared = await prepareInvoiceLines(admin, staff, { online_pay: onlinePay, card_fee_rate: staff.cardFeeRate }, [
      {
        item_id: pick.id,
        kind: pick.kind,
        name: pick.name,
        description: pick.description,
        quantity: pick.unit === "ft" && ft ? ft : 1,
        unit: pick.unit,
        unit_price: pick.rate,
        discount_type: null,
        discount_value: null,
        taxable: pick.taxable,
      },
    ]);
    if (prepared.error) lineError = prepared.error;
    else if (prepared.lines.length) {
      const { error: lineErr } = await admin.from("billing_invoice_lines").insert(prepared.lines.map((l) => ({ ...l, invoice_id: id })));
      if (lineErr) lineError = lineErr.message;
    }
  }
  const rc = await recalcInvoice(admin, id);
  // The draft exists either way; the editor opens it and the line can be added by hand.
  if (lineError || rc) console.warn(`[billing] from-listing ${id}: ${lineError ?? rc}`);
  return NextResponse.json({ ok: true, id, existing: false, ...(lineError ? { lineError } : {}) });
}
