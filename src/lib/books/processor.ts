/**
 * A login's online-payment processor row and the one rule for when "Pay
 * online" is offered. Kept free of Stripe / PayPal / email imports so the
 * invoice loader (invoices.ts) and the PDF (invoicePdf.ts) can use it without
 * an import cycle. Re-exported from onlinePayments.ts, where the rest lives.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingBillingTable } from "./staff";
import type { BillingInvoice, PaypalEnv, ProcessorKind } from "./types";

export type ProcessorRow = {
  profile_id: string;
  processor: ProcessorKind;
  paypal_client_id: string | null;
  paypal_secret_enc: string | null;
  paypal_env: PaypalEnv;
  paypal_webhook_id: string | null;
  enabled: boolean;
  updated_at: string;
};

export type ProcessorLookup = { state: "ok"; row: ProcessorRow | null } | { state: "not_ready" } | { state: "error"; message: string };

/** A login's processor row (service role). Missing table = not_ready; no row = null. */
export async function loadProcessor(admin: SupabaseClient, profileId: string): Promise<ProcessorLookup> {
  const { data, error } = await admin.from("billing_payment_processors").select("*").eq("profile_id", profileId).maybeSingle();
  if (error) return isMissingBillingTable(error) ? { state: "not_ready" } : { state: "error", message: error.message };
  return { state: "ok", row: (data as ProcessorRow | null) ?? null };
}

/** Stripe's minimum charge is $0.50; below that there's no Pay button. */
const MIN_ONLINE = 0.5;

/**
 * What the Pay slot on /inv shows: 'ok' (Pay online), 'test' (the "Test
 * invoice — online payment disabled" line) or 'hidden'. The invoice PDF draws
 * its "Pay online" link only on 'ok'.
 */
export function onlinePayState(inv: BillingInvoice, row: ProcessorRow | null): "ok" | "test" | "hidden" {
  if (!row || !row.enabled) return "hidden";
  if (row.processor === "paypal" && (!row.paypal_client_id || !row.paypal_secret_enc)) return "hidden";
  if (inv.status !== "sent" && inv.status !== "partial") return "hidden";
  if (!(inv.balance_due >= MIN_ONLINE)) return "hidden";
  if (inv.is_test) return "test";
  return "ok";
}

/** The grey line under the Pay button / PDF link. */
export function payViaLabel(row: ProcessorRow | null): string {
  return row?.processor === "paypal" ? "PayPal or card" : "Card or US bank account";
}
