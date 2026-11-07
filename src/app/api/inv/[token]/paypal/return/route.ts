import { NextRequest, NextResponse } from "next/server";
import { booksServiceClient } from "@/lib/books/staff";
import { loadInvoiceByToken, PORTAL_ORIGIN } from "@/lib/books/invoices";
import { completePaypalReturn, loadProcessor } from "@/lib/books/onlinePayments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/inv/[token]/paypal/return?token=ORDERID&PayerID=… — PayPal sends
 * the buyer here after they approve. The order is captured with the invoice
 * login's own PayPal credentials and recorded (once — a reload is a no-op),
 * then the buyer lands back on the invoice: ?paid=1, or ?payfail=1.
 * (The path's [token] is the invoice token; PayPal's ?token= is the order id.)
 */
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token;
  const back = (q: string) => NextResponse.redirect(`${PORTAL_ORIGIN}/inv/${encodeURIComponent(token)}${q}`, 303);
  if (!/^[0-9a-f]{20,64}$/i.test(token)) return new NextResponse("Not found", { status: 404 });
  const orderId = (req.nextUrl.searchParams.get("token") ?? "").trim();
  if (!/^[A-Z0-9]{6,40}$/i.test(orderId)) return back("?payfail=1");

  const admin = booksServiceClient();
  const r = await loadInvoiceByToken(admin, token);
  if (!("bundle" in r)) return back("?payfail=1");
  const proc = await loadProcessor(admin, r.bundle.invoice.owner_id);
  try {
    const out = await completePaypalReturn(admin, r.bundle, proc.state === "ok" ? proc.row : null, orderId);
    return back(out === "fail" ? "?payfail=1" : "?paid=1");
  } catch (e) {
    console.error(`[billing-pay] PayPal return for ${r.bundle.invoice.id} failed: ${e instanceof Error ? e.message : String(e)}`);
    return back("?payfail=1");
  }
}
