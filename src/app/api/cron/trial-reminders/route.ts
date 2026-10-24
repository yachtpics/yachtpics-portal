import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logEmail } from "@/lib/logEmail";
import {
  LEGACY_TRIAL_EMAIL_TYPE,
  TRIAL_EMAIL_TYPE,
  trialDay7Email,
  trialEndedEmail,
  trialEndingEmail,
  type TrialEmail,
  type WeekRow,
} from "@/lib/trialEmails";
import { unsubscribeHeaders } from "@/lib/unsubscribe";
import { trialDaysFor } from "@/lib/subscriptionAccess";
import { officePlanActive, paidReelServiceBrokerIds } from "@/lib/brokerAccess";
import { listingPeriodTotals } from "@/lib/engagement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The free-trial email sequence (Oct 24 2026), run once a day by
 * /api/cron/daily (13:00 UTC = 9am ET). Offsets are counted in Eastern
 * calendar days from each broker's own trial, whose length is 14 days (30
 * for accounts opened before Oct 24 2026 — trialDaysFor):
 *
 *   trial_day7    day 7 of the trial (catch-up through day 9 if a run was
 *                 missed), only while 3+ days are left
 *   trial_ending  2 days left (1 if a run was missed)  → 14-day: day 12, 30-day: day 28
 *   trial_ended   first run after trial_ends_at has passed (up to 3 days
 *                 late)                                 → 14-day: day 14/15, 30-day: day 30/31
 *
 * Who: role broker only (no assistants, admins, clients), in-app trial only
 * (no Stripe subscription, status not 'active' — comped accounts are
 * 'active'), trial started (trial_ends_at set), not opted out of marketing
 * email, and not covered by an Office plan or a paid Reel Service boat.
 * Dedup: email_log, per type, since this trial started. The pre-Oct 24
 * reminders' types (trial_expiring / trial_lapsed) count as already sent for
 * trial_ending / trial_ended, so nobody mid-trial gets both versions.
 */

const FROM = "YachtPics <hello@yachtpics.com>";
const DAY = 86_400_000;

type ProfileLite = {
  first_name: string | null;
  display_email: string | null;
  role: string | null;
  email_opt_out: boolean | null;
  unsubscribe_token: string | null;
  brokerage_id: string | null;
};

/** YYYY-MM-DD in America/New_York. */
function easternDate(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.filter((x) => x.type === t)[0]?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Whole calendar days from date a to date b (both YYYY-MM-DD). */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

/** "Friday, November 7" in Eastern time. */
function longDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" });
}

async function sendEmail(to: string, subject: string, html: string, headers?: Record<string, string>): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to, subject, html, ...(headers ? { headers } : {}) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Last 7 days per published listing (max 20 looked at), busiest first. */
async function weekRows(service: SupabaseClient, brokerId: string): Promise<{ rows: WeekRow[]; firstListingId: string | null }> {
  const { data: listings } = await service
    .from("listings")
    .select("id, vessel_name, slideshow_published, slideshow_slug, updated_at")
    .eq("broker_id", brokerId)
    .order("updated_at", { ascending: false })
    .limit(50);
  const all = (listings ?? []) as { id: string; vessel_name: string | null; slideshow_published: boolean | null; slideshow_slug: string | null }[];
  const published = all.filter((l) => l.slideshow_published && l.slideshow_slug).slice(0, 20);
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  const totals = await Promise.all(published.map((l) => listingPeriodTotals(service, l.id, since)));
  const rows: WeekRow[] = published.map((l, i) => ({
    listingId: l.id,
    vesselName: l.vessel_name,
    views: totals[i].views,
    uniqueVisitors: totals[i].uniqueVisitors,
    photoLooks: totals[i].photoLooks,
    sends: totals[i].sends,
  }));
  rows.sort((a, b) => b.views - a.views || b.sends - a.sends || b.photoLooks - a.photoLooks);
  return { rows, firstListingId: all[0]?.id ?? null };
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ?dry=1 → report who would get what, send nothing, log nothing.
  const dry = req.nextUrl.searchParams.get("dry") === "1";

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // In-app trial brokers only: no Stripe subscription, a trial end date set, not paying.
  const { data: subs } = await supabase
    .from("subscriptions")
    .select("broker_id, status, trial_ends_at, created_at, stripe_subscription_id, profiles:broker_id(first_name, display_email, role, email_opt_out, unsubscribe_token, brokerage_id)")
    .is("stripe_subscription_id", null)
    .not("trial_ends_at", "is", null);

  const now = Date.now();
  let candidates = (subs ?? []).filter((s) => {
    const p = s.profiles as unknown as ProfileLite | null;
    if (s.status === "active" || !p || p.role !== "broker" || !p.display_email || p.email_opt_out === true) return false;
    // Only trials that can still be in one of the three windows.
    const endMs = new Date(s.trial_ends_at as string).getTime();
    const startMs = endMs - trialDaysFor(s) * DAY;
    return now >= startMs + 6 * DAY && now <= endMs + 4 * DAY;
  });

  // Office plan coverage → skip.
  const brokerageIds = candidates
    .map((s) => (s.profiles as unknown as ProfileLite).brokerage_id)
    .filter((b): b is string => !!b)
    .filter((b, i, a) => a.indexOf(b) === i);
  if (brokerageIds.length > 0) {
    const { data: offices } = await supabase.from("brokerages").select("id, subscription_status").in("id", brokerageIds);
    const covered: Record<string, true> = {};
    for (const o of (offices ?? []) as { id: string; subscription_status: string | null }[]) {
      if (officePlanActive(o)) covered[o.id] = true;
    }
    candidates = candidates.filter((s) => {
      const b = (s.profiles as unknown as ProfileLite).brokerage_id;
      return !(b && covered[b]);
    });
  }
  // Paid Reel Service boat (includes Starter-level access) → skip.
  const reelPaid = await paidReelServiceBrokerIds(supabase, candidates.map((s) => s.broker_id));
  if (reelPaid.length > 0) candidates = candidates.filter((s) => reelPaid.indexOf(s.broker_id) === -1);

  // Pull this sequence's logs once, for in-memory dedup.
  const brokerIds = candidates.map((s) => s.broker_id);
  let logs: { recipient_id: string | null; email_type: string; sent_at: string }[] = [];
  if (brokerIds.length > 0) {
    const { data } = await supabase
      .from("email_log")
      .select("recipient_id, email_type, sent_at")
      .in("recipient_id", brokerIds)
      .in("email_type", [
        TRIAL_EMAIL_TYPE.day7, TRIAL_EMAIL_TYPE.ending, TRIAL_EMAIL_TYPE.ended,
        LEGACY_TRIAL_EMAIL_TYPE.ending, LEGACY_TRIAL_EMAIL_TYPE.ended,
      ])
      .eq("status", "sent");
    logs = data ?? [];
  }
  const alreadySent = (brokerId: string, types: string[], sinceMs: number) =>
    logs.some(
      (l) => l.recipient_id === brokerId && types.indexOf(l.email_type) !== -1 && new Date(l.sent_at).getTime() >= sinceMs
    );

  const todayET = easternDate(now);
  const sent = { day7: 0, ending: 0, ended: 0 };
  const plan: { brokerId: string; type: string; subject: string }[] = [];

  for (const s of candidates) {
    const p = s.profiles as unknown as ProfileLite;
    const firstName = p.first_name ?? "there";
    const email = p.display_email as string;
    const unsubToken = p.unsubscribe_token ?? undefined;
    const unsubHeaders = unsubToken ? unsubscribeHeaders(unsubToken) : undefined;

    const trialDays = trialDaysFor(s);
    const endMs = new Date(s.trial_ends_at as string).getTime();
    const startMs = endMs - trialDays * DAY;
    const dayIndex = dayDiff(easternDate(startMs), todayET); // 0 = the day the trial started
    const daysLeft = dayDiff(todayET, easternDate(endMs)); // calendar days until the end date
    const since = startMs - DAY; // this trial's window, for dedup

    let type: string | null = null;
    let msg: TrialEmail | null = null;

    if (endMs <= now) {
      // Ended: the first run after the trial ran out, up to 3 days late.
      if (now - endMs <= 3 * DAY && !alreadySent(s.broker_id, [TRIAL_EMAIL_TYPE.ended, LEGACY_TRIAL_EMAIL_TYPE.ended], since)) {
        type = TRIAL_EMAIL_TYPE.ended;
        msg = trialEndedEmail({ firstName, endedOn: longDate(endMs), unsubToken });
      }
    } else if (daysLeft >= 1 && daysLeft <= 2) {
      if (!alreadySent(s.broker_id, [TRIAL_EMAIL_TYPE.ending, LEGACY_TRIAL_EMAIL_TYPE.ending], since)) {
        type = TRIAL_EMAIL_TYPE.ending;
        msg = trialEndingEmail({ firstName, endsOn: longDate(endMs), daysLeft, unsubToken });
      }
    } else if (dayIndex >= 7 && dayIndex <= 9 && daysLeft >= 3) {
      if (!alreadySent(s.broker_id, [TRIAL_EMAIL_TYPE.day7], since)) {
        const { rows, firstListingId } = await weekRows(supabase, s.broker_id);
        type = TRIAL_EMAIL_TYPE.day7;
        msg = trialDay7Email({ firstName, endsOn: longDate(endMs), rows, firstListingId, unsubToken });
      }
    }

    if (!type || !msg) continue;
    plan.push({ brokerId: s.broker_id, type, subject: msg.subject });
    if (dry) continue;

    const ok = await sendEmail(email, msg.subject, msg.html, unsubHeaders);
    await logEmail({
      emailType: type,
      recipientEmail: email,
      recipientRole: "broker",
      recipientId: s.broker_id,
      brokerId: s.broker_id,
      subject: msg.subject,
      status: ok ? "sent" : "failed",
      sentBy: "cron",
      metadata: { trialDays, dayIndex, daysLeft, trialEndsAt: s.trial_ends_at },
    });
    if (ok) {
      if (type === TRIAL_EMAIL_TYPE.day7) sent.day7++;
      else if (type === TRIAL_EMAIL_TYPE.ending) sent.ending++;
      else sent.ended++;
    }
  }

  return NextResponse.json({ scanned: candidates.length, dry, sent, plan });
}
