import { NextRequest, NextResponse } from "next/server";
import { booksServiceClient } from "@/lib/books/staff";
import { loadInvoiceByToken, PORTAL_ORIGIN } from "@/lib/books/invoices";
import { loadProcessor, onlinePayState, startPaypalOrder, startStripeCheckout } from "@/lib/books/onlinePayments";
import { rateLimited } from "@/lib/simpleRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/inv/[token]/pay — the "Pay online" button on /inv/[token] (a
 * plain form post, no login; the invoice token is the credential).
 * Answers 303 to Stripe Checkout or the PayPal approve page, depending on the
 * invoice login's processor; on any problem, 303 back to the invoice with
 * ?payfail=1 (or ?payfail=processing when a bank payment is still clearing).
 * The amount is always the invoice's current balance_due.
 */
export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token;
  const back = (q: string) => NextResponse.redirect(`${PORTAL_ORIGIN}/inv/${encodeURIComponent(token)}${q}`, 303);
  if (!/^[0-9a-f]{20,64}$/i.test(token)) return new NextResponse("Not found", { status: 404 });
  if (rateLimited(`inv-pay:${token}`, 10, 10 * 60 * 1000)) return back("?payfail=1");

  const admin = booksServiceClient();
  const r = await loadInvoiceByToken(admin, token);
  if (!("bundle" in r)) return "notFound" in r ? new NextResponse("Not found", { status: 404 }) : back("?payfail=1");
  const b = r.bundle;

  const proc = await loadProcessor(admin, b.invoice.owner_id);
  const row = proc.state === "ok" ? proc.row : null;
  if (onlinePayState(b.invoice, row) !== "ok" || !row) return back(b.invoice.status === "paid" ? "?paid=1" : "?payfail=1");

  const res = row.processor === "paypal" ? await startPaypalOrder(admin, b, row) : await startStripeCheckout(admin, b);
  if ("url" in res) return NextResponse.redirect(res.url, 303);
  return back(res.error === "processing" ? "?payfail=processing" : "?payfail=1");
}
