import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logEmail } from "@/lib/logEmail";
import { trialExpiringHtml, trialLapsedHtml } from "@/lib/trialEmails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FROM = "YachtPics <hello@yachtpics.com>";
const DAY = 86_400_000;

type ProfileLite = { first_name: string | null; display_email: string | null; role: string | null };

function daysLeft(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / DAY);
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  // Same auth pattern as the storage-report cron.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    const querySecret = req.nextUrl.searchParams.get("secret");
    if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // DB-trial brokers only: no Stripe subscription, a trial end date set, not paying.
  const { data: subs } = await supabase
    .from("subscriptions")
    .select("broker_id, status, trial_ends_at, stripe_subscription_id, profiles:broker_id(first_name, display_email, role)")
    .is("stripe_subscription_id", null)
    .not("trial_ends_at", "is", null);

  const candidates = (subs ?? []).filter((s) => {
    const p = s.profiles as unknown as ProfileLite | null;
    return s.status !== "active" && !!p && p.role === "broker" && !!p.display_email;
  });

  // Pull recent reminder logs once, for in-memory dedup.
  const brokerIds = candidates.map((s) => s.broker_id);
  let logs: { recipient_id: string | null; email_type: string; sent_at: string }[] = [];
  if (brokerIds.length > 0) {
    const { data } = await supabase
      .from("email_log")
      .select("recipient_id, email_type, sent_at")
      .in("recipient_id", brokerIds)
      .in("email_type", ["trial_expiring", "trial_lapsed"]);
    logs = data ?? [];
  }
  const alreadySent = (brokerId: string, type: string, sinceMs: number) =>
    logs.some(
      (l) => l.recipient_id === brokerId && l.email_type === type && new Date(l.sent_at).getTime() >= sinceMs
    );

  let expiringSent = 0;
  let lapsedSent = 0;

  for (const s of candidates) {
    const p = s.profiles as unknown as ProfileLite;
    const firstName = p.first_name ?? "there";
    const email = p.display_email as string;
    const endMs = new Date(s.trial_ends_at as string).getTime();
    const dl = daysLeft(s.trial_ends_at as string);

    // Expiring: in the final 1–3 days, sent once per trial window.
    if (dl >= 1 && dl <= 3 && !alreadySent(s.broker_id, "trial_expiring", endMs - 31 * DAY)) {
      const subject = dl <= 1 ? "Your YachtPics trial ends tomorrow" : `${dl} days left on your YachtPics trial`;
      const ok = await sendEmail(email, subject, trialExpiringHtml({ firstName, daysLeft: dl }));
      await logEmail({
        emailType: "trial_expiring",
        recipientEmail: email,
        recipientRole: "broker",
        recipientId: s.broker_id,
        brokerId: s.broker_id,
        subject,
        status: ok ? "sent" : "failed",
        metadata: { daysLeft: dl },
      });
      if (ok) expiringSent++;
    }

    // Lapsed: ended within the last 3 days, sent once.
    if (endMs <= Date.now() && endMs >= Date.now() - 3 * DAY && !alreadySent(s.broker_id, "trial_lapsed", endMs - DAY)) {
      const subject = "Your YachtPics trial has ended";
      const ok = await sendEmail(email, subject, trialLapsedHtml({ firstName }));
      await logEmail({
        emailType: "trial_lapsed",
        recipientEmail: email,
        recipientRole: "broker",
        recipientId: s.broker_id,
        brokerId: s.broker_id,
        subject,
        status: ok ? "sent" : "failed",
      });
      if (ok) lapsedSent++;
    }
  }

  return NextResponse.json({ scanned: candidates.length, expiringSent, lapsedSent });
}
