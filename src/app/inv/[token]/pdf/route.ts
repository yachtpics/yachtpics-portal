import { NextResponse } from "next/server";
import { booksServiceClient } from "@/lib/books/staff";
import { loadInvoiceByToken, pdfFileName } from "@/lib/books/invoices";
import { buildInvoicePdf } from "@/lib/books/invoicePdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /inv/[token]/pdf — the client's PDF (no login; drafts never served).
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const r = await loadInvoiceByToken(booksServiceClient(), params.token);
  if (!("bundle" in r)) return new NextResponse("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex" } });
  const pdf = await buildInvoicePdf(r.bundle);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdfFileName(r.bundle.invoice, r.bundle.brand)}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
