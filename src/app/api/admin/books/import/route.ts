import { NextRequest, NextResponse } from "next/server";
import { requireBillingStaff } from "@/lib/books/staff";
import { CLIENT_HEADERS, ITEM_HEADERS, hasHeaders, mapClients, mapItems, parseCsv } from "@/lib/books/zohoCsv";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * "Re-pull from Zoho CSV" (owner only). Accepts the same two exports the
 * first seed used — zoho-rate-items.csv and/or zoho-clients.csv — as form
 * fields `items` and `clients`, and runs the same upsert functions
 * (billing_import_items / billing_import_clients). Re-run rule: rows edited
 * in the Portal keep their values; a confirmed brand stays; merged Zoho ids
 * stay merged; the Zoho open balance always refreshes.
 */
export async function POST(req: NextRequest) {
  const auth = await requireBillingStaff({ ownerOnly: true });
  if (auth.error) return auth.error;
  const { admin, staff } = auth;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Attach a CSV file." }, { status: 400 });
  const itemsFile = form.get("items");
  const clientsFile = form.get("clients");
  const isFile = (f: FormDataEntryValue | null): f is File => !!f && typeof f !== "string" && f.size > 0;
  if (!isFile(itemsFile) && !isFile(clientsFile)) return NextResponse.json({ error: "Attach a CSV file." }, { status: 400 });

  const out: Record<string, unknown> = {};
  if (isFile(itemsFile)) {
    if (itemsFile.size > 2_000_000) return NextResponse.json({ error: "The items file is too big." }, { status: 400 });
    const rows = parseCsv(await itemsFile.text());
    if (!hasHeaders(rows, ITEM_HEADERS)) {
      return NextResponse.json({ error: "The items file needs the columns: " + ITEM_HEADERS.join(", ") + "." }, { status: 400 });
    }
    const { data, error } = await admin.rpc("billing_import_items", { payload: mapItems(rows), actor: staff.profileId });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    out.items = data;
  }
  if (isFile(clientsFile)) {
    if (clientsFile.size > 5_000_000) return NextResponse.json({ error: "The clients file is too big." }, { status: 400 });
    const rows = parseCsv(await clientsFile.text());
    if (!hasHeaders(rows, CLIENT_HEADERS)) {
      return NextResponse.json({ error: "The clients file needs the columns: " + CLIENT_HEADERS.join(", ") + "." }, { status: 400 });
    }
    const { clients, merged } = mapClients(rows);
    const { data, error } = await admin.rpc("billing_import_clients", { payload: clients, actor: staff.profileId });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    out.clients = { ...(data as Record<string, unknown>), exact_duplicates_merged: merged };
  }
  return NextResponse.json({ ok: true, ...out });
}
