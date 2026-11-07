import { NextRequest, NextResponse } from "next/server";
import { isMissingBillingTable, requireBillingStaff } from "@/lib/books/staff";
import { bad, dbError as baseDbError } from "@/lib/books/api";
import { cleanReminderDays, REMINDER_MAX_DAY, REMINDER_MAX_STEPS, REMINDERS_NOT_READY, type ReminderSchedule } from "@/lib/books/types";

export const runtime = "nodejs";

/**
 * Payment reminder schedules (20261108). Each login edits ONLY its own row;
 * the owner can also read the others' (view only).
 *
 * GET   → { mine: ReminderSchedule, others: (ReminderSchedule & { display_name })[] }
 * PATCH { days?: number[], enabled?: boolean } → saves the caller's own row.
 */
/** Missing table → "reminders not switched on yet" (503), else the usual. */
function dbError(err: { code?: string; message?: string }): NextResponse {
  if (isMissingBillingTable(err)) return NextResponse.json({ error: REMINDERS_NOT_READY, notReady: true }, { status: 503 });
  return baseDbError(err);
}

export async function GET() {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  let q = admin.from("billing_reminder_schedules").select("profile_id, days, enabled, updated_at");
  if (!staff.isOwner) q = q.eq("profile_id", staff.profileId);
  const { data, error } = await q;
  if (error) return dbError(error);
  const rows = ((data ?? []) as ReminderSchedule[]).map((r) => ({ ...r, days: cleanReminderDays(r.days) }));
  const mine = rows.filter((r) => r.profile_id === staff.profileId)[0] ?? { profile_id: staff.profileId, days: [], enabled: true };
  return NextResponse.json({ mine, others: staff.isOwner ? rows.filter((r) => r.profile_id !== staff.profileId) : [] });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  const body = (await req.json().catch(() => null)) as { days?: unknown; enabled?: unknown } | null;
  if (!body) return bad("Invalid request body");

  const row: Record<string, unknown> = { profile_id: staff.profileId, updated_at: new Date().toISOString() };
  if ("days" in body) {
    if (!Array.isArray(body.days)) return bad("Days must be a list of numbers.");
    const raw = body.days as unknown[];
    const bad1 = raw.filter((v) => { const n = Number(v); return !isFinite(n) || Math.floor(n) !== n || n < 1 || n > REMINDER_MAX_DAY; });
    if (bad1.length) return bad(`Each reminder is a whole number of days from 1 to ${REMINDER_MAX_DAY}.`);
    const days = cleanReminderDays(raw);
    if (raw.length > REMINDER_MAX_STEPS && days.length >= REMINDER_MAX_STEPS) return bad(`Up to ${REMINDER_MAX_STEPS} reminders.`);
    row.days = days;
  }
  if ("enabled" in body) row.enabled = body.enabled === true;

  // Upsert so a login added after the migration still gets a row.
  const { data, error } = await admin
    .from("billing_reminder_schedules")
    .upsert(row, { onConflict: "profile_id" })
    .select("profile_id, days, enabled, updated_at")
    .single();
  if (error) return dbError(error);
  const saved = data as ReminderSchedule;
  return NextResponse.json({ ok: true, schedule: { ...saved, days: cleanReminderDays(saved.days) } });
}
