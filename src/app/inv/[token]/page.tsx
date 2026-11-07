import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { booksServiceClient } from "@/lib/books/staff";
import { loadInvoiceByToken } from "@/lib/books/invoices";
import { isBotUa } from "@/lib/emailTracking";
import { CARD_FEE_NOTE } from "@/lib/books/invoicePdf";
import { loadProcessor, onlinePayState } from "@/lib/books/onlinePayments";
import { stripe } from "@/lib/stripe";
import { dateET, fmtDate, fmtMoney, fmtPct, invoiceFooter, invoiceLabel, isOverdue, splitPaymentLines } from "@/lib/books/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Invoice",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * /inv/[token] — the client's view of an invoice (no login). The token is a
 * random 32-hex value per invoice. Drafts are never shown. Each visit by a
 * person (not a link scanner, not the invoice's own login) counts a view:
 * view_count / first_viewed_at / last_viewed_at — the trustworthy
 * replacement for Zoho's "viewed".
 *
 * Phase 3 (20261108b): "Pay online" — Stripe Checkout (card / US bank) for a
 * login on the YachtPics Stripe account, PayPal for a login with their own
 * PayPal. Shown only for sent / part-paid invoices with a balance, not tests,
 * when the invoice login's processor is on. ?paid=1 / ?payfail=1 come back
 * from the processor (see /api/inv/[token]/pay and …/paypal/return).
 */
export default async function PublicInvoicePage({ params, searchParams }: { params: { token: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const admin = booksServiceClient();
  const r = await loadInvoiceByToken(admin, params.token);
  if (!("bundle" in r)) notFound();
  const { invoice: inv, lines, client, brand, settings } = r.bundle;

  // Count the view — unless it's a scanner or the invoice's own login looking.
  const ua = headers().get("user-agent");
  let self = false;
  try {
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    self = !!user && user.id === inv.owner_id;
  } catch {
    self = false;
  }
  if (!self && !isBotUa(ua)) await admin.rpc("billing_record_invoice_view", { p_token: params.token });

  const overdue = isOverdue(inv);
  const badge =
    inv.status === "paid" ? { text: "Paid", cls: "bg-success-50 text-success-700 border-success-200" }
    : inv.status === "void" ? { text: "Void", cls: "bg-ink-100 text-ink-600 border-hairline" }
    : overdue ? { text: `Overdue · was due ${fmtDate(inv.due_date)}`, cls: "bg-danger-50 text-danger-700 border-danger-200" }
    : { text: inv.due_date_manual && inv.due_date ? `Due ${fmtDate(inv.due_date)}` : "Due on receipt", cls: "bg-ink-100 text-ink-700 border-hairline" };
  // Online payment (20261108b). No processor table yet → no button.
  const proc = await loadProcessor(admin, inv.owner_id);
  const procRow = proc.state === "ok" ? proc.row : null;
  const payState = onlinePayState(inv, procRow);
  const payVia = procRow?.processor === "paypal" ? "PayPal or card" : "Card or US bank account";

  // Back from the processor: re-read state; for Stripe, a bank payment shows "unpaid" until it clears.
  const qp = (k: string) => { const v = searchParams?.[k]; return Array.isArray(v) ? v[0] : v; };
  let returned: "paid" | "pending" | "bank" | "fail" | "processing" | null = null;
  if (qp("paid") === "1") {
    returned = inv.status === "paid" ? "paid" : "pending";
    if (inv.status !== "paid" && procRow?.processor === "stripe_platform" && inv.stripe_checkout_session_id) {
      try {
        const sess = await stripe.checkout.sessions.retrieve(inv.stripe_checkout_session_id);
        const pi = typeof sess.payment_intent === "string" ? sess.payment_intent : sess.payment_intent?.id;
        if (sess.status === "complete" && sess.payment_status === "unpaid") returned = "bank";
        else if (pi && r.bundle.payments.some((p) => p.source === "stripe" && p.external_id === pi)) returned = "paid";
      } catch {
        returned = "pending";
      }
    } else if (inv.status !== "paid" && procRow?.processor === "paypal" && r.bundle.payments.some((p) => p.source === "paypal")) {
      returned = "paid"; // the return route records before it redirects here
    }
  } else if (qp("payfail") === "processing") returned = "processing";
  else if (qp("payfail")) returned = "fail";
  const sentOn = dateET(inv.sent_at);
  const footer = invoiceFooter(brand, settings.paymentInstructions);
  const pdfHref = `/inv/${params.token}/pdf`;

  return (
    <div className="min-h-screen bg-ink-50 py-8 sm:py-14 px-4">
      <div className="max-w-3xl mx-auto">
        {returned === "paid" && (
          <p className="mb-4 rounded-card border border-success-200 bg-success-50 px-4 py-2.5 text-sm font-semibold text-success-700 text-center">
            Payment received, thank you.
          </p>
        )}
        {returned === "pending" && (
          <p className="mb-4 rounded-card border border-success-200 bg-success-50 px-4 py-2.5 text-sm font-semibold text-success-700 text-center">
            Payment received — your invoice will update shortly.
          </p>
        )}
        {returned === "bank" && (
          <p className="mb-4 rounded-card border border-success-200 bg-success-50 px-4 py-2.5 text-sm font-semibold text-success-700 text-center">
            Bank payment started, thank you. It takes a few business days to clear; the invoice updates when it does.
          </p>
        )}
        {returned === "processing" && (
          <p className="mb-4 rounded-card border border-hairline bg-white px-4 py-2.5 text-sm text-ink-700 text-center">
            A bank payment for this invoice is already on its way. It takes a few business days to clear.
          </p>
        )}
        {returned === "fail" && (
          <p className="mb-4 rounded-card border border-hairline bg-white px-4 py-2.5 text-sm text-ink-700 text-center">
            The payment didn&apos;t go through. You can try again or pay by check, Zelle or Venmo.
          </p>
        )}
        {inv.is_test && (
          <p className="mb-4 rounded-card border border-warn-200 bg-warn-50 px-4 py-2.5 text-sm font-semibold text-warn-700 text-center">
            Test invoice — not a real invoice. Nothing is owed.
          </p>
        )}
        <div className="bg-white rounded-card border border-hairline shadow-elev-1 px-5 py-7 sm:px-10 sm:py-10">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-5">
            <div>
              {brand.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.logo_url} alt={brand.display_name} className="h-10 sm:h-12 w-auto max-w-[220px] object-contain object-left" />
              ) : (
                <p className="text-h1 text-ink-900">{brand.display_name}</p>
              )}
            </div>
            <div className="sm:text-right">
              <p className="label-caps">{inv.is_test ? "Test invoice" : "Invoice"}</p>
              <p className="text-h1 text-ink-900 tabular-nums">{invoiceLabel(inv)}</p>
              <p className="text-small text-ink-500 mt-1">Invoice date {fmtDate(inv.issue_date)}</p>
              {sentOn && <p className="text-small text-ink-500">Sent {fmtDate(sentOn)}</p>}
              <span className={`inline-flex mt-2 rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.text}</span>
            </div>
          </div>

          <div className="mt-6 h-px" style={{ background: brand.accent_color || "rgba(5,11,20,0.14)" }} />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mt-6 text-sm">
            <div>
              <p className="label-caps mb-1">From</p>
              <p className="font-medium text-ink-900">{brand.legal_name}</p>
              {[settings.address, settings.phone, settings.replyTo].filter(Boolean).map((x) => (
                <p key={x as string} className="text-ink-600 break-words">{x}</p>
              ))}
            </div>
            <div>
              <p className="label-caps mb-1">Bill to</p>
              <p className="font-medium text-ink-900">{client?.display_name ?? "—"}</p>
              {client?.company_name && client.company_name !== client.display_name && <p className="text-ink-600">{client.company_name}</p>}
              {client?.email && <p className="text-ink-600 break-words">{client.email}</p>}
            </div>
            {inv.boat_name && (
              <div>
                <p className="label-caps mb-1">Boat</p>
                <p className="font-medium text-ink-900">{inv.boat_name}</p>
                {inv.boat_length_ft ? <p className="text-ink-600">{Math.round(inv.boat_length_ft * 10) / 10} ft</p> : null}
              </div>
            )}
          </div>

          <div className="mt-8 border-t border-hairline">
            {lines.map((l) => (
              <div key={l.id ?? l.position} className="py-3 border-b border-hairline flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">{l.name}</p>
                  {l.description && <p className="text-small text-ink-500 whitespace-pre-line">{l.description.replace(/ \| /g, "\n")}</p>}
                  {l.kind === "card_fee" ? (
                    <p className="text-small text-ink-500">{CARD_FEE_NOTE}</p>
                  ) : (
                    <p className="text-small text-ink-500 tabular-nums">
                      {Math.round(l.quantity * 1000) / 1000} {l.unit === "ft" ? "ft" : "×"} {fmtMoney(l.kind === "discount" ? -Math.abs(l.unit_price) : l.unit_price)}
                      {l.line_discount ? ` · less ${fmtMoney(l.line_discount)}` : ""}
                    </p>
                  )}
                </div>
                <p className="text-sm tabular-nums text-ink-900 shrink-0">{fmtMoney(l.line_total)}</p>
              </div>
            ))}
          </div>

          <dl className="mt-5 ml-auto max-w-xs text-sm space-y-1.5 tabular-nums">
            <Row k="Subtotal" v={fmtMoney(inv.subtotal)} />
            {inv.discount_total ? <Row k="Discounts" v={"-" + fmtMoney(inv.discount_total)} /> : null}
            {inv.tax_total ? <Row k={`Sales tax ${fmtPct(inv.tax_rate)}`} v={fmtMoney(inv.tax_total)} /> : null}
            {inv.card_fee_total ? <Row k={`Card fee ${fmtPct(inv.card_fee_rate)}`} v={fmtMoney(inv.card_fee_total)} /> : null}
            <Row k="Total" v={fmtMoney(inv.total)} strong />
            {inv.amount_paid ? <Row k="Paid" v={"-" + fmtMoney(inv.amount_paid)} /> : null}
            {inv.card_fee_waived ? <Row k="Card fee not charged" v={"-" + fmtMoney(inv.card_fee_waived)} /> : null}
            <Row k="Balance due" v={fmtMoney(inv.status === "void" ? 0 : inv.balance_due)} strong />
          </dl>

          {inv.note && <p className="mt-8 text-sm text-ink-700 whitespace-pre-line">{inv.note}</p>}

          {payState === "ok" && returned !== "bank" && returned !== "processing" && (
            <form method="post" action={`/api/inv/${params.token}/pay`} className="mt-8 flex flex-col sm:flex-row sm:items-center gap-3">
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-ctl bg-accent-500 text-ink-950 text-sm font-semibold px-6 py-3 hover:bg-accent-400 transition-colors duration-fast ease-quiet"
              >
                Pay online · {fmtMoney(inv.balance_due)}
              </button>
              <p className="text-small text-ink-500">{payVia}</p>
            </form>
          )}
          {payState === "test" && (
            <p className="mt-8 text-small text-ink-500">Test invoice — online payment disabled.</p>
          )}

          {settings.paymentInstructions && inv.status !== "paid" && inv.status !== "void" && (
            <div className="mt-8 rounded-card border border-hairline bg-ink-50 px-5 py-4">
              <p className="label-caps mb-1.5">How to pay</p>
              {splitPaymentLines(settings.paymentInstructions).map((ln) => (
                <p key={ln} className="text-sm text-ink-800">{ln}</p>
              ))}
            </div>
          )}

          <div className="mt-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <a
              href={pdfHref}
              className="inline-flex items-center justify-center rounded-ctl bg-ink-950 text-white text-sm font-semibold px-4 py-2.5 hover:bg-ink-800 transition-colors duration-fast ease-quiet"
            >
              Download PDF
            </a>
            <p className="text-small text-ink-500">Questions? {settings.replyTo ? <a className="underline" href={`mailto:${settings.replyTo}`}>{settings.replyTo}</a> : null}{settings.phone ? ` · ${settings.phone}` : ""}</p>
          </div>

          {(footer.notes.length > 0 || footer.terms.length > 0) && (
            <div className="mt-8 pt-6 border-t border-hairline space-y-4 text-small text-ink-500">
              {footer.notes.length > 0 && (
                <div>
                  <p className="label-caps mb-1">Notes</p>
                  {footer.notes.map((ln, i) => <p key={i}>{ln}</p>)}
                </div>
              )}
              <div>
                <p className="label-caps mb-1">Terms &amp; Conditions</p>
                {footer.terms.map((ln, i) => <p key={i}>{ln}</p>)}
              </div>
            </div>
          )}
        </div>
        <p className="text-center text-small text-ink-400 mt-5">{brand.legal_name}{brand.website ? ` · ${brand.website}` : ""}</p>
      </div>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-6 ${strong ? "pt-1.5 border-t border-hairline font-semibold text-ink-900" : "text-ink-600"}`}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
