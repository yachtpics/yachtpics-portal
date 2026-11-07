import { NextRequest, NextResponse } from "next/server";
import { isMissingBillingTable, requireBillingStaff } from "@/lib/books/staff";
import { hasHeaders, parseCsv } from "@/lib/books/zohoCsv";
import { CONTACT_PERSON_HEADERS, importZohoContactPersons } from "@/lib/books/zohoContactsCsv";
import { CONTACTS_NOT_READY } from "@/lib/books/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * "Import Zoho contacts (CSV)" (owner only). The CSV comes as a form file
 * field `contacts` (same pattern as /api/admin/books/import) or as JSON
 * { csv: "<text>" }. Header: zoho_contact_id, contact_person_id,
 * is_primary_contact, first_name, last_name, email, phone, mobile,
 * designation, department. See src/lib/books/zohoContactsCsv.ts for the rules.
 */
export async function POST(req: NextRequest) {
  const auth = await requireBillingStaff({ ownerOnly: true });
  if (auth.error) return auth.error;
  const { admin } = auth;

  let text = "";
  const type = req.headers.get("content-type") || "";
  if (type.indexOf("application/json") !== -1) {
    const body = (await req.json().catch(() => null)) as { csv?: unknown } | null;
    if (!body || typeof body.csv !== "string" || !body.csv.trim()) return NextResponse.json({ error: "Attach a CSV file." }, { status: 400 });
    text = body.csv;
  } else {
    const form = await req.formData().catch(() => null);
    const f = form ? form.get("contacts") : null;
    if (!f || typeof f === "string" || f.size === 0) return NextResponse.json({ error: "Attach a CSV file." }, { status: 400 });
    if (f.size > 5_000_000) return NextResponse.json({ error: "The contacts file is too big." }, { status: 400 });
    text = await f.text();
  }
  if (text.length > 5_000_000) return NextResponse.json({ error: "The contacts file is too big." }, { status: 400 });

  const rows = parseCsv(text);
  if (!hasHeaders(rows, CONTACT_PERSON_HEADERS)) {
    return NextResponse.json({ error: "The file needs the columns: " + CONTACT_PERSON_HEADERS.join(", ") + " (plus is_primary_contact, first_name, last_name, phone, mobile, designation, department)." }, { status: 400 });
  }
  try {
    const result = await importZohoContactPersons(admin, rows);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (isMissingBillingTable(err)) return NextResponse.json({ error: CONTACTS_NOT_READY, notReady: true }, { status: 503 });
    return NextResponse.json({ error: err.message ?? "Import failed." }, { status: 500 });
  }
}
