import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import { PLANS, REEL_SERVICE_FALLBACK_PLAN_PRICE, REEL_SERVICE_PRICE, REEL_SERVICE_REELS_PER_BOAT } from "@/lib/plans";
import { periodET, planReelServiceMonth, REEL_SERVICE_PAID_STATUSES, reelServiceRowInService } from "@/lib/reelService";
import { sendResendBatch } from "@/lib/sendEmailBatch";
import { logEmail } from "@/lib/logEmail";
import { getAccessStatus } from "@/lib/subscriptionAccess";
import { officePlanActive } from "@/lib/brokerAccess";

/**
 * Reel Service paid through the Portal (Oct 24, 2026)
 * ---------------------------------------------------
 * $179 per listing per month, up to 4 reels, paid by card at the moment of
 * ordering. Each paid boat is ONE Stripe subscription (metadata
 * kind = "reel_service", listing_id, broker_id), recorded on that boat's
 * reel_service_listings row. Nothing is written at checkout time; the row
 * appears when the webhook sees the paid checkout. Admin enrolment from the
 * broker page stays as a comp (billing_status 'comped').
 *
 * Everything here degrades before 20261024_reel_service_stripe.sql is
 * applied: reelServiceBillingReady() is false, the listing card says "not
 * available yet", checkout refuses, and the webhook logs and skips.
 */

export const REEL_SERVICE_KIND = "reel_service";
export const REEL_SERVICE_LOOKUP_KEY = "reel_service_monthly_179";
const PORTAL = "https://portal.yachtpics.com";
const FROM = "Charlie & Samantha at YachtPics <hello@yachtpics.com>";

export type ReelBillingStatus = "active" | "past_due" | "paused" | "canceled" | "comped";

export type ReelServiceListingRow = {
  listing_id: string;
  broker_id: string;
  enrolled_at: string;
  ended_at: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  billing_status: ReelBillingStatus;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  started_by: string | null;
  /** Start of the paid period (migration 20261024b; absent before). */
  current_period_start?: string | null;
  note?: string | null;
};

export const RS_ROW_SELECT =
  "listing_id, broker_id, enrolled_at, ended_at, stripe_subscription_id, stripe_customer_id, billing_status, current_period_end, cancel_at_period_end, started_by";

/** One boat's row, with the paid-period columns when 20261024b is applied. `error` = the table isn't ready. */
export async function readReelServiceRow(service: SupabaseClient, listingId: string): Promise<{ row: ReelServiceListingRow | null; error: string | null; periodColumns: boolean }> {
  const wide = await service.from("reel_service_listings").select(`${RS_ROW_SELECT}, current_period_start, note`).eq("listing_id", listingId).maybeSingle();
  if (!wide.error) return { row: (wide.data as ReelServiceListingRow | null) ?? null, error: null, periodColumns: true };
  const base = await service.from("reel_service_listings").select(RS_ROW_SELECT).eq("listing_id", listingId).maybeSingle();
  return { row: (base.data as ReelServiceListingRow | null) ?? null, error: base.error?.message ?? null, periodColumns: false };
}

/** A paid boat that is running and planned per paid period (start known). */
export function paidPeriodStart(row: ReelServiceListingRow | null): string | null {
  if (!row || row.ended_at || !row.stripe_subscription_id) return null;
  if (row.billing_status !== "active" && row.billing_status !== "past_due") return null;
  return row.current_period_start ?? null;
}

// ── Readiness ────────────────────────────────────────────────────────────────

/** True once reel_service_listings has the Stripe columns (migration 20261024). */
export async function reelServiceBillingReady(service: SupabaseClient): Promise<boolean> {
  const { error } = await service.from("reel_service_listings").select("billing_status").limit(1);
  return !error;
}

// ── The Stripe price ─────────────────────────────────────────────────────────

let cachedPriceId: string | null = null;

/**
 * The recurring $179/month price. STRIPE_REEL_SERVICE_PRICE_ID wins if set;
 * otherwise found by lookup_key, or created (with its product) the first
 * time. Cached in module memory for the life of the server instance.
 */
export async function ensureReelServicePrice(): Promise<string> {
  const fromEnv = process.env.STRIPE_REEL_SERVICE_PRICE_ID;
  if (fromEnv) return fromEnv;
  if (cachedPriceId) return cachedPriceId;
  const found = await stripe.prices.list({ lookup_keys: [REEL_SERVICE_LOOKUP_KEY], active: true, limit: 1 });
  if (found.data[0]) {
    cachedPriceId = found.data[0].id;
    return cachedPriceId;
  }
  const product = await stripe.products.create({
    name: "YachtPics Reel Service",
    description: `Up to ${REEL_SERVICE_REELS_PER_BOAT} social reels a month for one listing, made by YachtPics`,
    metadata: { kind: REEL_SERVICE_KIND },
  });
  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: REEL_SERVICE_PRICE * 100,
    recurring: { interval: "month" },
    lookup_key: REEL_SERVICE_LOOKUP_KEY,
    tax_behavior: "exclusive",
    nickname: "Reel Service — monthly",
    metadata: { kind: REEL_SERVICE_KIND },
  });
  cachedPriceId = price.id;
  return cachedPriceId;
}

// ── The broker's Stripe customer (same record the plan checkout uses) ────────

/**
 * The broker's Stripe customer id from subscriptions.stripe_customer_id —
 * the same lookup /api/stripe/checkout uses — created (and saved there) if
 * the broker has none yet.
 */
export async function ensureBrokerStripeCustomer(service: SupabaseClient, brokerId: string): Promise<string> {
  const { data: sub } = await service.from("subscriptions").select("stripe_customer_id").eq("broker_id", brokerId).maybeSingle();
  if (sub?.stripe_customer_id) return sub.stripe_customer_id as string;
  const { data: profile } = await service.from("profiles").select("first_name, last_name, display_email").eq("id", brokerId).maybeSingle();
  let email: string | undefined = (profile?.display_email as string | null) ?? undefined;
  if (!email) {
    try {
      const { data } = await service.auth.admin.getUserById(brokerId);
      email = data.user?.email ?? undefined;
    } catch { /* no email: Checkout asks for one */ }
  }
  const name = profile ? `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() : "";
  const customer = await stripe.customers.create({
    email,
    name: name || undefined,
    metadata: { supabase_user_id: brokerId },
  });
  await service.from("subscriptions").upsert({ broker_id: brokerId, stripe_customer_id: customer.id }, { onConflict: "broker_id" });
  return customer.id;
}

// ── Reading one listing's state ──────────────────────────────────────────────

export type ListingReelServiceState = {
  /** Migration 20261024 applied. */
  ready: boolean;
  row: ReelServiceListingRow | null;
  /** The broker is enrolled with no per-boat rows: every active boat is planned (comped). */
  legacy: boolean;
  /** Reels delivered for this listing this service month: the paid period for a paid boat, else the calendar month (Eastern). */
  deliveredThisMonth: number;
};

export async function loadListingReelService(service: SupabaseClient, listingId: string, brokerId: string): Promise<ListingReelServiceState> {
  const { row: data, error } = await readReelServiceRow(service, listingId);
  const start = paidPeriodStart(data);
  let q = service.from("reel_service_jobs").select("id", { count: "exact", head: true }).eq("listing_id", listingId).eq("status", "delivered");
  q = start ? q.eq("service_period_start", new Date(start).toISOString()) : q.eq("period", periodET());
  const { count } = await q;
  const deliveredThisMonth = count ?? 0;
  if (error) return { ready: false, row: null, legacy: false, deliveredThisMonth };
  let legacy = false;
  if (!data) {
    const [{ data: sub }, { count: rows }] = await Promise.all([
      service.from("reel_service_subscriptions").select("enabled").eq("broker_id", brokerId).maybeSingle(),
      service.from("reel_service_listings").select("listing_id", { count: "exact", head: true }).eq("broker_id", brokerId),
    ]);
    legacy = !!sub?.enabled && (rows ?? 0) === 0;
  }
  return { ready: true, row: (data as ReelServiceListingRow | null) ?? null, legacy, deliveredThisMonth };
}

/** A row that blocks a new checkout: a live Stripe subscription, or a comp still in service. */
export function rowBlocksCheckout(row: ReelServiceListingRow | null): boolean {
  if (!row) return false;
  if (row.stripe_subscription_id && (row.billing_status === "active" || row.billing_status === "past_due" || row.billing_status === "paused")) return true;
  return row.billing_status === "comped" && reelServiceRowInService(row);
}

// ── Webhook ──────────────────────────────────────────────────────────────────

export function isReelServiceSubscription(sub: Stripe.Subscription | null | undefined): boolean {
  return sub?.metadata?.kind === REEL_SERVICE_KIND;
}

function periodStartIso(subscription: Stripe.Subscription): string | null {
  const raw = (subscription as unknown as { current_period_start?: number }).current_period_start
    ?? (subscription as unknown as { items?: { data?: { current_period_start?: number }[] } }).items?.data?.[0]?.current_period_start
    ?? null;
  return raw ? new Date(raw * 1000).toISOString() : null;
}

function periodEndIso(subscription: Stripe.Subscription): string | null {
  const raw = (subscription as unknown as { current_period_end?: number }).current_period_end
    ?? (subscription as unknown as { items?: { data?: { current_period_end?: number }[] } }).items?.data?.[0]?.current_period_end
    ?? null;
  return raw ? new Date(raw * 1000).toISOString() : null;
}

/** Stripe status → our billing_status. null = not a state we record (e.g. incomplete). */
function mapStatus(status: Stripe.Subscription.Status): ReelBillingStatus | null {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "paused":
    case "unpaid":
      return "paused";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return null;
  }
}

function customerId(subscription: Stripe.Subscription): string | null {
  const c = subscription.customer;
  if (!c) return null;
  return typeof c === "string" ? c : c.id;
}

/** `advanced`: a (new) paid period started with this event — plan its reels. */
type SyncResult = { ok: boolean; listingId: string | null; brokerId: string | null; status: ReelBillingStatus | null; reason?: string; advanced?: boolean };

/**
 * Write a Reel Service subscription's current state onto its boat's row.
 * Idempotent: always takes the subscription as Stripe has it now. An event
 * for an older subscription of the same boat never overwrites a newer live
 * one.
 */
export async function syncReelServiceSubscription(
  service: SupabaseClient,
  subscription: Stripe.Subscription,
  opts: { deleted?: boolean; startedBy?: "broker" | "admin" } = {},
): Promise<SyncResult> {
  const listingId = subscription.metadata?.listing_id ?? null;
  const brokerId = subscription.metadata?.broker_id ?? null;
  if (!listingId || !brokerId) {
    console.warn(`[reel-service] subscription ${subscription.id} has no listing_id/broker_id metadata; skipped.`);
    return { ok: false, listingId, brokerId, status: null, reason: "metadata" };
  }
  const status: ReelBillingStatus | null = opts.deleted ? "canceled" : mapStatus(subscription.status);
  if (!status) return { ok: true, listingId, brokerId, status: null, reason: `ignored status ${subscription.status}` };

  const { row: existing, error: readErr } = await readReelServiceRow(service, listingId);
  if (readErr) {
    console.warn(`[reel-service] reel_service_listings not ready (${readErr}); Stripe event for ${subscription.id} skipped. Apply 20261024_reel_service_stripe.sql.`);
    return { ok: false, listingId, brokerId, status, reason: "not_ready" };
  }
  const row = existing;
  if (row && row.stripe_subscription_id !== subscription.id) {
    // The row is about something else: another (newer) subscription, or a
    // comp. Only a live subscription may take over a row that isn't live.
    const rowLive = (!!row.stripe_subscription_id && (row.billing_status === "active" || row.billing_status === "past_due" || row.billing_status === "paused"))
      || (row.billing_status === "comped" && !row.ended_at);
    const eventLive = status === "active" || status === "past_due" || status === "paused";
    if (rowLive || !eventLive) {
      return { ok: true, listingId, brokerId, status, reason: "older subscription" };
    }
  }

  const now = new Date().toISOString();
  const periodEnd = periodEndIso(subscription);
  let endedAt: string | null = null;
  if (status === "canceled") endedAt = opts.deleted ? now : (periodEnd ?? now);
  // A canceled boat keeps the first time it ended (event replays don't move it).
  if (status === "canceled" && row?.ended_at && row.stripe_subscription_id === subscription.id) endedAt = row.ended_at;

  const update: Record<string, unknown> = {
    listing_id: listingId,
    broker_id: brokerId,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: customerId(subscription),
    billing_status: status,
    current_period_end: periodEnd,
    cancel_at_period_end: !!subscription.cancel_at_period_end,
    ended_at: endedAt,
  };
  // The paid period. A "trialing" subscription here only comes from an admin
  // Extend (trial_end pushed out): that stretches the CURRENT period, so its
  // start stays put and no new reels are planned until the real renewal.
  const sameSub = !!row && row.stripe_subscription_id === subscription.id;
  let periodStart = periodStartIso(subscription);
  if (subscription.status === "trialing" && sameSub && row?.current_period_start) periodStart = row.current_period_start;
  update.current_period_start = periodStart;
  const advanced = (status === "active" || status === "past_due") && !!periodStart
    && (!sameSub || !row?.current_period_start || Date.parse(row.current_period_start) !== Date.parse(periodStart));
  const newlyLive = (status === "active" || status === "past_due") &&
    (!row || row.stripe_subscription_id !== subscription.id || !!row.ended_at);
  if (newlyLive) update.enrolled_at = now;
  if (!row || row.stripe_subscription_id !== subscription.id) update.started_by = opts.startedBy ?? "broker";

  let { error } = await service.from("reel_service_listings").upsert(update, { onConflict: "listing_id" });
  if (error && /current_period_start/.test(error.message)) {
    // 20261024b not applied yet: save without the period start (calendar-month planning).
    delete update.current_period_start;
    ({ error } = await service.from("reel_service_listings").upsert(update, { onConflict: "listing_id" }));
  }
  if (error) {
    console.warn(`[reel-service] couldn't save ${subscription.id} on listing ${listingId}: ${error.message}`);
    return { ok: false, listingId, brokerId, status, reason: error.message };
  }
  return { ok: true, listingId, brokerId, status, advanced: advanced && "current_period_start" in update };
}

async function vesselName(service: SupabaseClient, listingId: string): Promise<string> {
  const { data } = await service.from("listings").select("vessel_name, year, make, model").eq("id", listingId).maybeSingle();
  if (!data) return "your listing";
  return (data.vessel_name as string | null) || [data.year, data.make, data.model].filter(Boolean).join(" ") || "your listing";
}

/**
 * The broker has a reel_service_subscriptions row — created enabled on the
 * first purchase (an existing row's "enabled" is left as the admin set it). A broker enrolled before per-boat rows existed ("legacy", every
 * active boat planned) gets those boats recorded as comped first, so paying
 * for one boat doesn't quietly stop the others.
 */
async function ensureBrokerEnrolled(service: SupabaseClient, brokerId: string, paidListingId: string): Promise<void> {
  const { data: sub } = await service.from("reel_service_subscriptions").select("broker_id, enabled").eq("broker_id", brokerId).maybeSingle();
  const now = new Date().toISOString();
  if (!sub) {
    await service.from("reel_service_subscriptions").insert({ broker_id: brokerId, enabled: true, started_at: now, updated_at: now });
    return;
  }
  // A broker whose comped reels an admin switched off stays that way: the
  // switch governs comped boats only, and nothing paid depends on it (Oct 24).
  if (!sub.enabled) return;
  // Enabled already — legacy (no rows other than the one just written)?
  const { data: rows } = await service.from("reel_service_listings").select("listing_id").eq("broker_id", brokerId);
  const others = ((rows ?? []) as { listing_id: string }[]).filter((r) => r.listing_id !== paidListingId);
  if (others.length > 0) return;
  const { data: active } = await service.from("listings").select("id").eq("broker_id", brokerId).eq("status", "active").neq("id", paidListingId);
  const comps = ((active ?? []) as { id: string }[]).map((l) => ({
    listing_id: l.id, broker_id: brokerId, enrolled_at: now, billing_status: "comped", started_by: "admin",
  }));
  if (comps.length) await service.from("reel_service_listings").upsert(comps, { onConflict: "listing_id", ignoreDuplicates: true });
}

async function alreadyEmailed(service: SupabaseClient, emailType: string, subscriptionId: string): Promise<boolean> {
  const { data } = await service.from("email_log").select("id").eq("email_type", emailType).eq("status", "sent")
    .eq("metadata->>subscriptionId", subscriptionId).limit(1);
  return (data ?? []).length > 0;
}

function shell(title: string, body: string, button?: { href: string; label: string }): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">${title}</h1>
      ${body}
      ${button ? `<a href="${button.href}" style="display:inline-block;margin-top:8px;background:#c39e4e;color:#050b14;font-size:14px;font-weight:700;text-decoration:none;padding:10px 20px;border-radius:8px;">${button.label}</a>` : ""}
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">YachtPics &middot; Reel Service<br>Questions? Just reply to this email.</p>
    </div>
  </div>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Billing email to the broker (transactional: sent whatever their marketing opt-out). Deduped per subscription. */
async function sendBrokerEmail(service: SupabaseClient, opts: {
  brokerId: string; listingId: string; subscriptionId: string; emailType: string; subject: string; html: string; fallbackEmail?: string | null;
}): Promise<void> {
  try {
    if (await alreadyEmailed(service, opts.emailType, opts.subscriptionId)) return;
    const { data: p } = await service.from("profiles").select("display_email").eq("id", opts.brokerId).maybeSingle();
    const to = (p?.display_email as string | null) || opts.fallbackEmail || null;
    if (!to) return;
    const [r] = await sendResendBatch([{ from: FROM, to, subject: opts.subject, html: opts.html }]);
    await logEmail({
      emailType: opts.emailType,
      recipientEmail: to,
      recipientRole: "broker",
      recipientId: opts.brokerId,
      brokerId: opts.brokerId,
      listingId: opts.listingId,
      subject: opts.subject,
      status: r?.ok ? "sent" : "failed",
      error: r?.ok ? null : r?.error ?? null,
      sentBy: "stripe-webhook",
      metadata: { subscriptionId: opts.subscriptionId, resendId: r?.id ?? null },
    });
  } catch (e) {
    console.warn(`[reel-service] email ${opts.emailType} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** A short note to Charlie when a boat starts or stops (best effort). */
async function notifyCharlie(service: SupabaseClient, brokerId: string, vessel: string, kind: "new" | "ended"): Promise<void> {
  try {
    if (!process.env.RESEND_API_KEY) return;
    const { data: p } = await service.from("profiles").select("first_name, last_name, display_email").eq("id", brokerId).maybeSingle();
    const who = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || (p?.display_email as string | null) || "A broker";
    const subject = kind === "new"
      ? `New Reel Service: ${who} — ${vessel} ($${REEL_SERVICE_PRICE}/mo)`
      : `Reel Service ended: ${who} — ${vessel}`;
    const body = kind === "new"
      ? `<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;"><strong>${esc(who)}</strong> paid for the Reel Service on <strong>${esc(vessel)}</strong>. This month's reels are planned on the Reel Service board.</p>`
      : `<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">The Reel Service on <strong>${esc(vessel)}</strong> (${esc(who)}) has ended. No more reels are planned for it.</p>`;
    await sendResendBatch([{ from: "YachtPics Portal <hello@yachtpics.com>", to: "charlie@yachtpics.com", subject, html: shell(kind === "new" ? "New Reel Service" : "Reel Service ended", body, { href: `${PORTAL}/admin/reel-service`, label: "Open Reel Service" }) }]);
  } catch { /* never fail the webhook over a notification */ }
}

/**
 * checkout.session.completed for a Reel Service checkout: record the boat as
 * paid, make sure the broker is enrolled, plan this month's reels for the
 * boat now, and confirm by email. Safe to replay.
 */
export async function handleReelServiceCheckoutCompleted(service: SupabaseClient, session: Stripe.Checkout.Session): Promise<void> {
  if (!session.subscription) return;
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  const subscription = await stripe.subscriptions.retrieve(subId);
  // Metadata lives on both; the subscription's is what later events carry.
  if (!subscription.metadata?.listing_id && session.metadata?.listing_id) {
    subscription.metadata = { ...subscription.metadata, ...session.metadata };
  }
  const r = await syncReelServiceSubscription(service, subscription, { startedBy: "broker" });
  if (r.ok && r.reason === "older subscription" && (r.status === "active" || r.status === "past_due")) {
    // The boat already has a live subscription (or a comp): this checkout is a
    // duplicate (two tabs, a double click). Stop it charging again and tell
    // Charlie to refund the first payment in Stripe.
    try {
      await stripe.subscriptions.cancel(subscription.id);
      console.warn(`[reel-service] duplicate subscription ${subscription.id} on listing ${r.listingId} canceled; refund its first payment in Stripe.`);
      if (process.env.RESEND_API_KEY && r.listingId) {
        const vessel = await vesselName(service, r.listingId);
        await sendResendBatch([{
          from: "YachtPics Portal <hello@yachtpics.com>", to: "charlie@yachtpics.com",
          subject: `Refund needed: duplicate Reel Service on ${vessel}`,
          html: shell("Duplicate Reel Service checkout",
            `<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">${esc(vessel)} was already on the Reel Service, and a second checkout went through. The second subscription (${esc(subscription.id)}) has been canceled so it won&rsquo;t renew. Refund its first payment in the Stripe dashboard (Customers → the broker → Payments).</p>`),
        }]);
      }
    } catch (e) {
      console.error(`[reel-service] couldn't cancel duplicate ${subscription.id}:`, e);
    }
    return;
  }
  if (!r.ok || !r.listingId || !r.brokerId) return;
  if (r.status !== "active" && r.status !== "past_due") return;
  const listingId = r.listingId;
  const brokerId = r.brokerId;

  try { await ensureBrokerEnrolled(service, brokerId, listingId); } catch (e) {
    console.warn(`[reel-service] couldn't enrol broker ${brokerId}: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    await planReelServiceMonth(service, periodET(), { brokerIds: [brokerId], listingIds: [listingId] });
  } catch (e) {
    console.warn(`[reel-service] planning ${listingId} failed (the daily cron will fill it): ${e instanceof Error ? e.message : String(e)}`);
  }

  const vessel = await vesselName(service, listingId);
  const firstTime = !(await alreadyEmailed(service, "reel_service_started", subscription.id));
  await sendBrokerEmail(service, {
    brokerId, listingId, subscriptionId: subscription.id,
    emailType: "reel_service_started",
    subject: `Reel Service is on for ${vessel}`,
    html: shell(`Reel Service is on for ${esc(vessel)}`,
      `<p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">Reel Service is on for ${esc(vessel)}. Your first reels are being made; they&rsquo;ll land on Your Reels and in your inbox.</p>
       <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">$${REEL_SERVICE_PRICE} a month, up to ${REEL_SERVICE_REELS_PER_BOAT} reels a month. Cancel anytime from the boat&rsquo;s page in the Portal.</p>`,
      { href: `${PORTAL}/dashboard/reels`, label: "Open Your Reels" }),
    fallbackEmail: session.customer_details?.email ?? null,
  });
  if (firstTime) await notifyCharlie(service, brokerId, vessel, "new");
}

/** customer.subscription.created / updated (and invoice events) for a Reel Service subscription. */
export async function handleReelServiceSubscriptionChanged(service: SupabaseClient, subscriptionId: string): Promise<void> {
  // Always the subscription as it is now, so out-of-order events can't regress it.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (!isReelServiceSubscription(subscription)) return;
  const r = await syncReelServiceSubscription(service, subscription);
  // A new paid period began (renewal): plan its reels, due weekly from the start.
  if (r.ok && r.advanced && r.listingId && r.brokerId) {
    try {
      await planReelServiceMonth(service, periodET(), { brokerIds: [r.brokerId], listingIds: [r.listingId] });
    } catch (e) {
      console.warn(`[reel-service] planning the new period of ${r.listingId} failed (the daily cron will fill it): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/**
 * Admin "Extend by N days" (1–30): push the boat's next charge out by N days
 * without charging or crediting anything. Stripe's documented way to move the
 * next billing date of an active subscription is to give it a trial that ends
 * at the new date: subscriptions.update(id, { trial_end, proration_behavior:
 * "none" }). The subscription reads "trialing" until then (we keep it 'active'
 * and keep the period start, so no extra reels are planned); at trial_end
 * Stripe charges the normal $179 and the next paid period starts there.
 * Logged on the row's note.
 */
export async function extendReelService(service: SupabaseClient, listingId: string, days: number, adminName: string): Promise<{ ok: true; nextCharge: string } | { ok: false; error: string }> {
  if (!Number.isInteger(days) || days < 1 || days > 30) return { ok: false, error: "Extend by 1–30 days." };
  const { row, error } = await readReelServiceRow(service, listingId);
  if (error) return { ok: false, error: "Reel Service billing isn’t set up yet (migration)." };
  if (!row?.stripe_subscription_id || row.ended_at) return { ok: false, error: "This boat has no running paid Reel Service." };
  const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
  if (sub.status !== "active" && sub.status !== "trialing") {
    return { ok: false, error: `Stripe says this subscription is ${sub.status}; only a subscription in good standing can be extended.` };
  }
  const endRaw = (sub as unknown as { current_period_end?: number }).current_period_end
    ?? (sub as unknown as { items?: { data?: { current_period_end?: number }[] } }).items?.data?.[0]?.current_period_end;
  if (!endRaw) return { ok: false, error: "Stripe didn’t return the current period end." };
  const trialEnd = endRaw + days * 86400;
  const updated = await stripe.subscriptions.update(sub.id, { trial_end: trialEnd, proration_behavior: "none" });
  await syncReelServiceSubscription(service, updated);
  const nextCharge = new Date(trialEnd * 1000).toISOString();
  const line = `${new Date().toISOString().slice(0, 10)}: extended ${days} day${days === 1 ? "" : "s"} by ${adminName} — next charge ${nextCharge.slice(0, 10)}`;
  const note = row.note ? `${row.note}\n${line}` : line;
  await service.from("reel_service_listings").update({ note: note.slice(-2000) }).eq("listing_id", listingId);
  return { ok: true, nextCharge };
}

/** invoice.payment_failed: past due (Stripe keeps retrying; the boat stays in service until it gives up). */
export async function handleReelServicePaymentFailed(service: SupabaseClient, subscriptionId: string): Promise<void> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (!isReelServiceSubscription(subscription)) return;
  const r = await syncReelServiceSubscription(service, subscription);
  // Stripe may still say "active" for a moment after the first failure.
  if (r.ok && r.listingId && r.status === "active") {
    await service.from("reel_service_listings").update({ billing_status: "past_due" })
      .eq("listing_id", r.listingId).eq("stripe_subscription_id", subscription.id);
  }
}

/** Does the broker still have Portal access from something other than this boat? */
async function brokerPlanAfter(service: SupabaseClient, brokerId: string, endedListingId: string): Promise<{ kind: "own"; name: string; price: number } | { kind: "office" } | { kind: "reels" } | { kind: "none" }> {
  const { data: own } = await service.from("subscriptions").select("status, stripe_subscription_id, stripe_price_id, trial_ends_at").eq("broker_id", brokerId).maybeSingle();
  if (own && own.stripe_subscription_id && getAccessStatus(own) === "active") {
    const plan = PLANS.find((p) => p.priceId === own.stripe_price_id);
    return { kind: "own", name: plan?.name ?? "Portal", price: plan?.price ?? REEL_SERVICE_FALLBACK_PLAN_PRICE };
  }
  const { data: prof } = await service.from("profiles").select("brokerage_id").eq("id", brokerId).maybeSingle();
  if (prof?.brokerage_id) {
    const { data: office } = await service.from("brokerages").select("subscription_status").eq("id", prof.brokerage_id).maybeSingle();
    if (officePlanActive(office ?? null)) return { kind: "office" };
  }
  const { count } = await service.from("reel_service_listings").select("listing_id", { count: "exact", head: true })
    .eq("broker_id", brokerId).neq("listing_id", endedListingId).is("ended_at", null).in("billing_status", REEL_SERVICE_PAID_STATUSES);
  if ((count ?? 0) > 0) return { kind: "reels" };
  return { kind: "none" };
}

/** customer.subscription.deleted: the boat is off the service now; tell the broker where their Portal stands. */
export async function handleReelServiceDeleted(service: SupabaseClient, subscription: Stripe.Subscription): Promise<void> {
  const r = await syncReelServiceSubscription(service, subscription, { deleted: true });
  if (!r.ok || !r.listingId || !r.brokerId || r.reason === "older subscription") return;
  const vessel = await vesselName(service, r.listingId);
  const plan = await brokerPlanAfter(service, r.brokerId, r.listingId);
  const first = `Reel Service on ${esc(vessel)} has ended.`;
  let body: string;
  let button: { href: string; label: string } | undefined;
  if (plan.kind === "own") {
    body = `${first} Your Portal plan continues at $${plan.price}/mo.`;
  } else if (plan.kind === "office") {
    body = `${first} Your Portal access continues through your office plan.`;
  } else if (plan.kind === "reels") {
    body = `${first} Your other Reel Service boats keep your Portal access.`;
  } else {
    body = `${first} Keep your Portal on Starter for $${REEL_SERVICE_FALLBACK_PLAN_PRICE}/mo &mdash; your listings, slideshows and uploads carry on as they are.`;
    button = { href: `${PORTAL}/dashboard/billing`, label: `Keep the Portal — $${REEL_SERVICE_FALLBACK_PLAN_PRICE}/mo` };
  }
  await sendBrokerEmail(service, {
    brokerId: r.brokerId, listingId: r.listingId, subscriptionId: subscription.id,
    emailType: "reel_service_ended",
    subject: `Reel Service on ${vessel} has ended`,
    html: shell(`Reel Service on ${esc(vessel)} has ended`,
      `<p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">${body}</p>
       <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">The reels already delivered stay on Your Reels.</p>`,
      button ?? { href: `${PORTAL}/dashboard/reels`, label: "Open Your Reels" }),
  });
  await notifyCharlie(service, r.brokerId, vessel, "ended");
}

// ── Sold / archived boats ────────────────────────────────────────────────────

/**
 * Daily: a paid boat whose listing is no longer active (sold / archived)
 * stops renewing — cancel at the end of the paid month. Returns how many
 * were set to end.
 */
export async function endReelServiceForInactiveListings(service: SupabaseClient): Promise<{ ended: number; errors: string[] }> {
  const out = { ended: 0, errors: [] as string[] };
  const { data, error } = await service.from("reel_service_listings")
    .select("listing_id, stripe_subscription_id, listings:listing_id(status)")
    .not("stripe_subscription_id", "is", null)
    .in("billing_status", ["active", "past_due", "paused"])
    .eq("cancel_at_period_end", false);
  if (error) return out; // migration not applied: nothing to do
  const rows = (data ?? []) as unknown as { listing_id: string; stripe_subscription_id: string; listings: { status: string } | null }[];
  for (const r of rows) {
    if (!r.listings || r.listings.status === "active") continue;
    try {
      const sub = await stripe.subscriptions.update(r.stripe_subscription_id, { cancel_at_period_end: true });
      await syncReelServiceSubscription(service, sub);
      out.ended++;
    } catch (e) {
      out.errors.push(`${r.listing_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
