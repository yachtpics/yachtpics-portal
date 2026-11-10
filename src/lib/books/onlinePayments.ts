/**
 * Billing phase 3 — online payment ("Pay online" on /inv/[token]).
 *
 * Each login's online payments go to the processor in its
 * billing_payment_processors row (a setting, not hard-coded):
 *  - 'stripe_platform' — the Portal's own Stripe account (src/lib/stripe.ts).
 *    Charlie's. Checkout Session (card + US bank account, instant
 *    verification); the payment is recorded by the Stripe webhook
 *    (checkout.session.completed, or async_payment_succeeded when a bank
 *    payment clears days later).
 *  - 'paypal' — the login's OWN PayPal business account (client id + secret,
 *    the secret AES-GCM encrypted by secrets.ts). Samantha's. An Order is
 *    created, the buyer approves it on PayPal, and the return route captures
 *    it and records the payment. No PayPal webhooks yet.
 *
 * Replay safety: every online payment is a billing_payments row with
 * source 'stripe' | 'paypal' and external_id = the PaymentIntent / capture
 * id. The unique index on (source, external_id) turns a second insert into a
 * no-op (23505), so a replayed webhook or a reloaded return page never
 * double-counts; only the FIRST insert sends the receipt or writes a note.
 * The amount charged is always the invoice's balance_due at that moment —
 * nothing is added or removed here (a card fee, if wanted, is a line).
 */
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import { loadInvoiceById, PORTAL_ORIGIN, type InvoiceBundle } from "./invoices";
import { postBillingEmail, emailShellHtml, esc } from "./invoiceEmail";
import { sendReceiptEmail } from "./receiptEmail";
import { loadClientContacts } from "./contacts";
import { decryptSecret, secretsKeyConfigured } from "./secrets";
import { approveLink, capturePaypalOrder, createPaypalOrder, firstCapture, getPaypalOrder, type PaypalCreds, type PaypalOrder } from "./paypal";
import { fmtMoney, greetingFirstName, invoiceRecipients, paymentSourceLabel, todayET, type BillingInvoice, type PaymentMethod, type ProcessorKind, type ProcessorView } from "./types";

export const BILLING_INVOICE_KIND = "billing_invoice";

// The row type, loader and the Pay-online rule live in processor.ts (no
// Stripe/PayPal imports, so invoices.ts and invoicePdf.ts can use them).
export { loadProcessor, onlinePayState, payViaLabel, type ProcessorLookup, type ProcessorRow } from "./processor";
import type { ProcessorRow } from "./processor";

/** The browser's view: never the secret, only whether one is saved. */
export function processorView(row: ProcessorRow | null, fallback: ProcessorKind): ProcessorView {
  return {
    processor: row?.processor ?? fallback,
    enabled: !!row?.enabled,
    paypalClientId: row?.paypal_client_id ?? null,
    paypalEnv: row?.paypal_env === "sandbox" ? "sandbox" : "live",
    secretSaved: !!row?.paypal_secret_enc,
    keyConfigured: secretsKeyConfigured(),
  };
}

export function paypalCredsOf(row: ProcessorRow | null): PaypalCreds | null {
  if (!row || row.processor !== "paypal" || !row.paypal_client_id) return null;
  const secret = decryptSecret(row.paypal_secret_enc);
  if (!secret) return null;
  return { clientId: row.paypal_client_id, secret, env: row.paypal_env === "sandbox" ? "sandbox" : "live" };
}

export function payDescription(b: InvoiceBundle): string {
  return `Invoice ${b.invoice.number ?? ""} — ${b.brand.display_name}`.replace(/\s+/g, " ").trim();
}

const looksLikeEmail = (v: string | null | undefined) => !!v && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v);

/** Add one line to the invoice's internal note (staff-only). Best-effort. */
async function appendInternalNote(admin: SupabaseClient, invoiceId: string, line: string): Promise<void> {
  try {
    const { data } = await admin.from("billing_invoices").select("internal_note").eq("id", invoiceId).maybeSingle();
    const cur = ((data as { internal_note: string | null } | null)?.internal_note ?? "").trim();
    const stamped = `[${todayET()}] ${line}`;
    await admin.from("billing_invoices").update({ internal_note: cur ? `${cur}\n${stamped}` : stamped }).eq("id", invoiceId);
  } catch (e) {
    console.warn(`[billing-pay] internal note on ${invoiceId} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── Recording a payment (shared by Stripe and PayPal) ────────────────────

export type RecordResult = { duplicate: boolean };

/**
 * Insert the payment, recalculate, and — on the first insert only — send the
 * receipt and note any amount mismatch. Throws on a database error (the
 * Stripe webhook answers 500 so Stripe retries; the replay is then a no-op
 * insert followed by the same recalc).
 */
export async function recordOnlinePayment(
  admin: SupabaseClient,
  p: {
    invoice: BillingInvoice;
    method: PaymentMethod;
    amount: number;
    source: "stripe" | "paypal";
    externalId: string;
    reference: string | null;
    /** Where the receipt goes when the invoice has no sent_to (e.g. the Stripe payer's email). */
    payerEmail?: string | null;
  }
): Promise<RecordResult> {
  const inv = p.invoice;
  const amount = Math.round(p.amount * 100) / 100;
  const balanceBefore = inv.balance_due;
  const { error } = await admin.from("billing_payments").insert({
    invoice_id: inv.id,
    owner_id: inv.owner_id,
    method: p.method,
    amount,
    paid_on: todayET(),
    reference: p.reference,
    note: null,
    source: p.source,
    external_id: p.externalId,
    created_by: null,
  });
  const duplicate = !!error && error.code === "23505";
  if (error && !duplicate) throw new Error(`billing_payments insert: ${error.message}`);

  const { error: rcErr } = await admin.rpc("billing_recalc_invoice", { inv: inv.id });
  if (rcErr) throw new Error(`billing_recalc_invoice: ${rcErr.message}`);
  if (duplicate) return { duplicate: true };

  const via = paymentSourceLabel(p.source);
  if (Math.abs(amount - balanceBefore) > 0.01) {
    await appendInternalNote(admin, inv.id, `Online payment ${via}: ${fmtMoney(amount)} received but the balance was ${fmtMoney(balanceBefore)} (${p.externalId}). Check the invoice.`);
  }
  if (inv.status !== "sent" && inv.status !== "partial") {
    await appendInternalNote(admin, inv.id, `Online payment ${via} of ${fmtMoney(amount)} arrived while the invoice was ${inv.status} (${p.externalId}). Refund or re-apply it.`);
  }

  // Receipt (best-effort — a failed email never un-records the payment).
  const fresh = await loadInvoiceById(admin, inv.id);
  // Same people the invoice went to (sent_to_all, else sent_to), else the payer.
  const sentTo = invoiceRecipients("bundle" in fresh ? fresh.bundle.invoice : inv);
  const to = sentTo.length ? sentTo : looksLikeEmail(p.payerEmail) ? [(p.payerEmail as string).trim().toLowerCase()] : [];
  if ("bundle" in fresh && to.length) {
    const contacts = await loadClientContacts(admin, fresh.bundle.invoice.client_id);
    const greet = greetingFirstName(to, fresh.bundle.client, contacts);
    const err = await sendReceiptEmail(fresh.bundle, to, { amount, paidOn: todayET(), method: p.method, via, source: p.source }, greet);
    if (err) console.warn(`[billing-pay] receipt for ${inv.id} failed: ${err}`);
  }
  return { duplicate: false };
}

// ─── Stripe (the Portal's own account) ────────────────────────────────────

export type StartResult = { url: string } | { error: "processing" | "failed" | "unavailable"; message: string };

/**
 * Open (or re-open) a Checkout Session for the invoice's current balance.
 * A still-open session for the same amount is reused, so a double click
 * doesn't make two; a bank payment that's still clearing blocks a second one.
 */
export async function startStripeCheckout(admin: SupabaseClient, b: InvoiceBundle): Promise<StartResult> {
  const inv = b.invoice;
  const cents = Math.round(inv.balance_due * 100);
  const invUrl = `${PORTAL_ORIGIN}/inv/${inv.public_token}`;

  if (inv.stripe_checkout_session_id) {
    try {
      const prev = await stripe.checkout.sessions.retrieve(inv.stripe_checkout_session_id);
      if (prev.status === "open" && prev.amount_total === cents && prev.url) return { url: prev.url };
      if (prev.status === "complete" && prev.payment_status === "unpaid") {
        return { error: "processing", message: "A bank payment for this invoice is already on its way." };
      }
      if (prev.status === "open") {
        try { await stripe.checkout.sessions.expire(prev.id); } catch { /* it may have just closed */ }
      }
    } catch (e) {
      console.warn(`[billing-pay] previous session for ${inv.id} unreadable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const metadata = { kind: BILLING_INVOICE_KIND, invoice_id: inv.id, owner_id: inv.owner_id };
  const description = payDescription(b);
  const base: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: cents, product_data: { name: description } } }],
    ...(looksLikeEmail(inv.sent_to) ? { customer_email: inv.sent_to as string } : {}),
    metadata,
    payment_intent_data: { metadata, description },
    success_url: `${invUrl}?paid=1`,
    cancel_url: invUrl,
  };
  let session: Stripe.Checkout.Session;
  try {
    try {
      session = await stripe.checkout.sessions.create({
        ...base,
        payment_method_types: ["card", "us_bank_account"],
        payment_method_options: { us_bank_account: { verification_method: "instant" } },
      });
    } catch (e) {
      // e.g. US bank account not activated on the Stripe account: card only.
      console.warn(`[billing-pay] card + bank checkout refused for ${inv.id}, falling back to card only: ${e instanceof Error ? e.message : String(e)}`);
      session = await stripe.checkout.sessions.create({ ...base, payment_method_types: ["card"] });
    }
  } catch (e) {
    console.error(`[billing-pay] checkout for ${inv.id} failed: ${e instanceof Error ? e.message : String(e)}`);
    return { error: "failed", message: "Stripe couldn't open checkout." };
  }
  if (!session.url) return { error: "failed", message: "Stripe didn't return a checkout link." };
  const { error } = await admin.from("billing_invoices").update({ stripe_checkout_session_id: session.id }).eq("id", inv.id);
  if (error) console.warn(`[billing-pay] storing session id on ${inv.id} failed: ${error.message}`);
  return { url: session.url };
}

/**
 * A sent invoice was edited (20261109b): the amount due may have changed, so
 * an open Stripe Checkout Session for the old amount is expired and the
 * stored ids are cleared. Best-effort — logs and never throws. A session
 * that completed with a bank payment still clearing keeps its id, so
 * startStripeCheckout still refuses a second payment while it clears. The
 * PayPal order id is cleared: an order the buyer hasn't come back from can
 * then no longer be captured (PayPal only charges on capture), and the next
 * Pay click starts a fresh order at the current balance.
 */
export async function cancelOpenCheckouts(admin: SupabaseClient, inv: BillingInvoice): Promise<void> {
  const clear: Record<string, null> = {};
  if (inv.stripe_checkout_session_id) {
    let keep = false;
    try {
      const s = await stripe.checkout.sessions.retrieve(inv.stripe_checkout_session_id);
      if (s.status === "open") await stripe.checkout.sessions.expire(s.id);
      else if (s.status === "complete" && s.payment_status === "unpaid") keep = true;
    } catch (e) {
      console.warn(`[billing-pay] expiring checkout ${inv.stripe_checkout_session_id} after edit of ${inv.id} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!keep) clear.stripe_checkout_session_id = null;
  }
  if (inv.paypal_order_id) clear.paypal_order_id = null;
  if (!Object.keys(clear).length) return;
  const { error } = await admin.from("billing_invoices").update(clear).eq("id", inv.id);
  if (error) console.warn(`[billing-pay] clearing checkout ids on ${inv.id} after edit failed: ${error.message}`);
}

/** card / bank from the PaymentIntent's payment method (falls back to the session's types). */
async function stripeMethodOf(session: Stripe.Checkout.Session, piId: string): Promise<PaymentMethod> {
  try {
    const pi = await stripe.paymentIntents.retrieve(piId, { expand: ["payment_method"] });
    const pm = pi.payment_method;
    const type = typeof pm === "string" || !pm ? (pi.payment_method_types ?? [])[0] : pm.type;
    return type === "us_bank_account" ? "bank" : "card";
  } catch {
    // An async (bank) payment is the only kind that completes "unpaid" first.
    const types = session.payment_method_types ?? [];
    return types.length === 1 && types[0] === "us_bank_account" ? "bank" : "card";
  }
}

/**
 * Webhook entry for Checkout Sessions with metadata.kind 'billing_invoice'.
 * Throws on anything retryable (the route answers 500 and Stripe retries).
 */
export async function handleBillingCheckoutEvent(admin: SupabaseClient, event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const invoiceId = session.metadata?.invoice_id ?? "";
  const ownerId = session.metadata?.owner_id ?? "";
  const loaded = await loadInvoiceById(admin, invoiceId);
  if ("notReady" in loaded) throw new Error("billing tables not ready");
  if ("error" in loaded) throw new Error(loaded.error);
  if ("notFound" in loaded) { console.warn(`[billing-pay] ${event.type} ${event.id}: invoice ${invoiceId} not found — ignored`); return; }
  const b = loaded.bundle;
  if (b.invoice.owner_id !== ownerId) { console.warn(`[billing-pay] ${event.type} ${event.id}: owner mismatch on ${invoiceId} — ignored`); return; }

  if (event.type === "checkout.session.async_payment_failed") {
    await notifyOwnerBankFailed(b);
    return;
  }
  // completed (card, or bank still clearing) / async_payment_succeeded (bank cleared)
  if (session.payment_status !== "paid") return; // bank still clearing: recorded when it succeeds
  if ((session.currency ?? "usd").toLowerCase() !== "usd") { console.warn(`[billing-pay] ${event.id}: non-USD session ignored`); return; }
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!piId) throw new Error(`session ${session.id} has no payment_intent`);
  const method = await stripeMethodOf(session, piId);
  await recordOnlinePayment(admin, {
    invoice: b.invoice,
    method,
    amount: (session.amount_total ?? 0) / 100,
    source: "stripe",
    externalId: piId,
    reference: piId,
    payerEmail: session.customer_details?.email ?? null,
  });
}

/** A bank (ACH) payment bounced: nothing is recorded; tell the invoice's login. Best-effort. */
async function notifyOwnerBankFailed(b: InvoiceBundle): Promise<void> {
  const to = looksLikeEmail(b.settings.replyTo) ? (b.settings.replyTo as string) : looksLikeEmail(b.brand.email) ? (b.brand.email as string) : "charlie@yachtpics.com";
  const n = b.invoice.number ?? "(unnumbered)";
  const html = emailShellHtml(b, `<p style="margin:0 0 14px;font-size:18px;font-weight:600;color:#111827;">Bank payment failed — Invoice ${esc(n)}</p>
<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">A US bank account payment of ${esc(fmtMoney(b.invoice.balance_due))} for invoice ${esc(n)}${b.invoice.boat_name ? ` (${esc(b.invoice.boat_name)})` : ""} didn&rsquo;t go through. Nothing was recorded; the invoice is still open and the client can pay again from the invoice link.</p>
<p style="margin:0;font-size:13px;color:#6b7280;">Details are in the Stripe dashboard under Payments.</p>`);
  const r = await postBillingEmail(b, { to, subject: `Bank payment failed — Invoice ${n}`, html, pdf: null });
  if (!r.ok) console.warn(`[billing-pay] bank-failed notice for ${b.invoice.id} failed: ${r.message}`);
}

// ─── PayPal (the login's own account) ─────────────────────────────────────

export async function startPaypalOrder(admin: SupabaseClient, b: InvoiceBundle, row: ProcessorRow): Promise<StartResult> {
  const creds = paypalCredsOf(row);
  if (!creds) return { error: "unavailable", message: "PayPal isn't set up for this invoice." };
  const inv = b.invoice;
  const r = await createPaypalOrder(creds, {
    invoiceId: inv.id,
    amount: inv.balance_due,
    description: payDescription(b),
    brandName: b.brand.display_name,
    returnUrl: `${PORTAL_ORIGIN}/api/inv/${inv.public_token}/paypal/return`,
    cancelUrl: `${PORTAL_ORIGIN}/inv/${inv.public_token}`,
  });
  if (!r.ok) {
    console.error(`[billing-pay] PayPal order for ${inv.id} failed (${r.status}${r.issue ? " " + r.issue : ""}): ${r.message}`);
    return { error: "failed", message: "PayPal couldn't start the payment." };
  }
  const link = approveLink(r.data);
  if (!link) return { error: "failed", message: "PayPal didn't return an approve link." };
  const { error } = await admin.from("billing_invoices").update({ paypal_order_id: r.data.id }).eq("id", inv.id);
  if (error) {
    // Without the stored id the return route can't match the order — don't send the buyer off.
    console.error(`[billing-pay] storing PayPal order on ${inv.id} failed: ${error.message}`);
    return { error: "failed", message: "Couldn't start the payment." };
  }
  return { url: link };
}

/**
 * The buyer came back from PayPal. Capture the order with the invoice
 * login's credentials and record it. A reloaded page (already captured) reads
 * the order back and records nothing new (unique key).
 * Returns 'paid' | 'pending' | 'fail'.
 */
export async function completePaypalReturn(admin: SupabaseClient, b: InvoiceBundle, row: ProcessorRow | null, orderId: string): Promise<"paid" | "pending" | "fail"> {
  const inv = b.invoice;
  if (!orderId || !inv.paypal_order_id || orderId !== inv.paypal_order_id) return "fail";
  const creds = paypalCredsOf(row);
  if (!creds) return "fail";

  let order: PaypalOrder | null = null;
  const cap = await capturePaypalOrder(creds, orderId);
  if (cap.ok) order = cap.data;
  else {
    const again = await getPaypalOrder(creds, orderId);
    if (again.ok && again.data.status === "COMPLETED") order = again.data;
    else {
      console.warn(`[billing-pay] PayPal capture ${orderId} for ${inv.id} failed (${cap.status}${cap.issue ? " " + cap.issue : ""}): ${cap.message}`);
      return "fail";
    }
  }
  const pu = (order.purchase_units ?? [])[0];
  if (pu?.reference_id && pu.reference_id !== inv.id) {
    console.error(`[billing-pay] PayPal order ${orderId} belongs to ${pu.reference_id}, not ${inv.id}`);
    return "fail";
  }
  const c = firstCapture(order);
  if (!c) return "fail";
  if (c.status === "PENDING") {
    await appendInternalNote(admin, inv.id, `PayPal payment pending (capture ${c.id}, ${c.amount?.value ?? "?"} ${c.amount?.currency_code ?? ""}). Record it by hand when it clears in PayPal.`);
    return "pending";
  }
  if (c.status !== "COMPLETED") return "fail";
  if ((c.amount?.currency_code ?? "USD") !== "USD") {
    await appendInternalNote(admin, inv.id, `PayPal capture ${c.id} was in ${c.amount?.currency_code}, not USD — not recorded. Check PayPal.`);
    return "pending";
  }
  const amount = Number(c.amount?.value);
  if (!isFinite(amount) || amount <= 0) return "fail";
  // recordOnlinePayment notes a mismatch against balance_due (> $0.01) and records what was captured.
  await recordOnlinePayment(admin, {
    invoice: inv,
    method: "paypal",
    amount,
    source: "paypal",
    externalId: c.id,
    reference: c.id,
  });
  return "paid";
}

/** For the Settings card's method line. */
export function processorLabel(kind: ProcessorKind): string {
  return kind === "stripe_platform" ? "Stripe (YachtPics account)" : "PayPal";
}

