import { NextRequest, NextResponse } from "next/server";
import { requireBillingStaff } from "@/lib/books/staff";
import { bad, dbError } from "@/lib/books/api";
import { loadInvoice, pdfFileName } from "@/lib/books/invoices";
import { buildInvoicePdf } from "@/lib/books/invoicePdf";

export const runtime = "nodejs";

// GET — the PDF, for the invoice's own login (drafts included: "Preview PDF").
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const r = await loadInvoice(auth.admin, auth.staff, params.id);
  if ("notReady" in r) return dbError({ code: "42P01" });
  if ("notFound" in r) return bad("Invoice not found.", 404);
  if ("error" in r) return bad(r.error, 500);
  const pdf = await buildInvoicePdf(r.bundle);
  const name = pdfFileName(r.bundle.invoice, r.bundle.brand);
  const disp = req.nextUrl.searchParams.get("download") ? "attachment" : "inline";
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disp}; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
