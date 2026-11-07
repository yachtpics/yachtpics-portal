/**
 * Billing — payment reminders (migration 20261108). The daily job
 * `billing_reminders` (queued by /api/cron/billing-reminders from the daily
 * dispatcher, run by the jobs worker) calls runBillingReminders().
 *
 * For every login whose schedule is on (billing_reminder_schedules.enabled,
 * days not empty, billing_staff active), every invoice in THAT login's book
 * that is sent or part paid, not a test, not paused, has a due date, was
 * emailed (sent_to) and still has a balance: daysPast = today (ET) − due
 * date. The step due is the largest scheduled day ≤ daysPast; if neither it
 * nor a later step has gone yet, ONE reminder goes (so an invoice paused for
 * a while gets one catch-up, not three). It goes to everyone the invoice was
 * last sent to (sent_to_all, 20261108c), else sent_to — in one email.
 *
 * Safe to re-run the same day: a step is claimed by inserting its
 * billing_reminders_sent row (unique invoice_id + day) BEFORE the email goes;
 * a second run hits the unique key and skips. If the email fails the claim is
 * removed so tomorrow's run tries again.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingBillingTable } from "./staff";
import { loadInvoiceByToken } from "./invoices";
import { sendReminderEmail } from "./reminderEmail";
import { loadClientContacts } from "./contacts";
import { cleanReminderDays, daysBetween, greetingFirstName, invoiceRecipients, reminderStepDue, todayET } from "./types";

export type ReminderRunResult = {
  /** Logins with reminders on. */
  schedules: number;
  /** Open invoices looked at. */
  checked: number;
  sent: number;
  failed: number;
  /** Nothing due yet, or that step already went. */
  notDue: number;
  /** Stopped early to stay inside the time budget (the next batch carries on). */
  outOfTime: boolean;
  log: string[];
};

type OpenInvoice = {
  id: string;
  owner_id: string;
  number: string | null;
  public_token: string;
  due_date: string;
  sent_to: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class RemindersNotReadyError extends Error {
  constructor() {
    super("Payment reminders aren't switched on yet — the 20261108 billing migration hasn't been applied.");
    this.name = "RemindersNotReadyError";
    Object.setPrototypeOf(this, RemindersNotReadyError.prototype);
  }
}

export async function runBillingReminders(
  svc: SupabaseClient,
  opts: { deadlineMs?: number; today?: string } = {}
): Promise<ReminderRunResult> {
  const today = opts.today ?? todayET();
  const deadline = opts.deadlineMs ?? Date.now() + 240000;
  const out: ReminderRunResult = { schedules: 0, checked: 0, sent: 0, failed: 0, notDue: 0, outOfTime: false, log: [] };

  const { data: schedRows, error: sErr } = await svc.from("billing_reminder_schedules").select("profile_id, days, enabled").eq("enabled", true);
  if (sErr) {
    if (isMissingBillingTable(sErr)) throw new RemindersNotReadyError();
    throw new Error(`billing_reminder_schedules: ${sErr.message}`);
  }
  const { data: staffRows, error: stErr } = await svc.from("billing_staff").select("profile_id, display_name").eq("active", true);
  if (stErr) throw new Error(`billing_staff: ${stErr.message}`);
  const names: Record<string, string> = {};
  ((staffRows ?? []) as { profile_id: string; display_name: string }[]).forEach((s) => { names[s.profile_id] = s.display_name; });

  const schedules = ((schedRows ?? []) as { profile_id: string; days: unknown; enabled: boolean }[])
    .map((r) => ({ profileId: r.profile_id, days: cleanReminderDays(r.days) }))
    .filter((r) => r.days.length > 0 && !!names[r.profileId]);
  out.schedules = schedules.length;

  for (let si = 0; si < schedules.length; si++) {
    const sched = schedules[si];
    const who = names[sched.profileId];
    const { data: invRows, error: iErr } = await svc
      .from("billing_invoices")
      .select("id, owner_id, number, public_token, due_date, sent_to")
      .eq("owner_id", sched.profileId)
      .in("status", ["sent", "partial"])
      .eq("is_test", false)
      .eq("reminders_paused", false)
      .not("due_date", "is", null)
      .not("sent_to", "is", null)
      .gt("balance_due", 0)
      .order("due_date")
      .range(0, 4999);
    if (iErr) {
      if (isMissingBillingTable(iErr)) throw new RemindersNotReadyError();
      throw new Error(`billing_invoices: ${iErr.message}`);
    }
    const invs = (invRows ?? []) as OpenInvoice[];
    if (!invs.length) continue;

    // What has already gone for these invoices.
    const sentByInv: Record<string, number[]> = {};
    for (let i = 0; i < invs.length; i += 150) {
      const ids = invs.slice(i, i + 150).map((x) => x.id);
      const { data: sent, error: rErr } = await svc.from("billing_reminders_sent").select("invoice_id, day").in("invoice_id", ids);
      if (rErr) {
        if (isMissingBillingTable(rErr)) throw new RemindersNotReadyError();
        throw new Error(`billing_reminders_sent: ${rErr.message}`);
      }
      ((sent ?? []) as { invoice_id: string; day: number }[]).forEach((r) => {
        (sentByInv[r.invoice_id] = sentByInv[r.invoice_id] || []).push(Number(r.day));
      });
    }

    for (let ii = 0; ii < invs.length; ii++) {
      if (Date.now() > deadline - 10000) {
        out.outOfTime = true;
        out.log.push("Stopping for now to stay inside the time limit — the next batch carries on.");
        return out;
      }
      const inv = invs[ii];
      out.checked++;
      const to = (inv.sent_to ?? "").trim().toLowerCase();
      const daysPast = daysBetween(inv.due_date, today);
      const step = reminderStepDue(daysPast, sched.days, sentByInv[inv.id] || []);
      if (step === null || !EMAIL_RE.test(to)) { out.notDue++; continue; }

      // Claim the step first: a second run (or a second worker) hits the unique key.
      const { data: claim, error: cErr } = await svc
        .from("billing_reminders_sent")
        .insert({ invoice_id: inv.id, owner_id: inv.owner_id, day: step, sent_to: to })
        .select("id")
        .single();
      if (cErr) {
        if (cErr.code === "23505") { out.notDue++; continue; }
        out.failed++;
        out.log.push(`${inv.number ?? inv.id}: couldn't record the reminder (${cErr.message}) — nothing sent.`);
        continue;
      }
      const claimId = (claim as { id: string }).id;
      const release = async () => { await svc.from("billing_reminders_sent").delete().eq("id", claimId); };

      // Fresh copy (a payment may have landed since the list was read).
      const loaded = await loadInvoiceByToken(svc, inv.public_token);
      if (!("bundle" in loaded)) {
        await release();
        out.failed++;
        out.log.push(`${inv.number ?? inv.id}: couldn't load the invoice — nothing sent.`);
        continue;
      }
      const b = loaded.bundle;
      const cur = b.invoice;
      if ((cur.status !== "sent" && cur.status !== "partial") || cur.reminders_paused || cur.is_test || !(cur.balance_due > 0) || !cur.number) {
        await release();
        out.notDue++;
        continue;
      }

      // Everyone the invoice was last sent to (sent_to_all, else sent_to) — one email, all in To.
      const recipients = invoiceRecipients(cur);
      if (!recipients.length) {
        await release();
        out.notDue++;
        continue;
      }
      const contacts = await loadClientContacts(svc, cur.client_id);
      const r = await sendReminderEmail(b, recipients, step, greetingFirstName(recipients, b.client, contacts));
      if (!r.ok) {
        await release();
        out.failed++;
        out.log.push(`${cur.number}: the reminder didn't go (${r.error ?? "unknown error"}) — will try again tomorrow.`);
        continue;
      }
      const toText = recipients.join(", ");
      await svc.from("billing_reminders_sent").update({ email_log_id: r.emailLogId, resend_id: r.resendId, sent_to: toText }).eq("id", claimId);
      out.sent++;
      out.log.push(`${who}: reminder for ${cur.number} (${step} day${step === 1 ? "" : "s"} past due) sent to ${toText}.`);
    }
  }
  return out;
}
