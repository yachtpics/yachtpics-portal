"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import { REMINDER_MAX_DAY, REMINDER_MAX_STEPS, cleanReminderDays, type ReminderSchedule } from "@/lib/books/types";
import { booksCall, fieldClass } from "./booksApi";

/**
 * Settings → Payment reminders. Every login edits ONLY its own schedule; the
 * owner also sees the other logins' schedules, read-only. `ready` = false
 * until migration 20261108 is applied.
 */
export default function ReminderSettings({
  ready,
  mine,
  others,
}: {
  ready: boolean;
  mine: ReminderSchedule;
  others: (ReminderSchedule & { display_name: string })[];
}) {
  const router = useRouter();
  const [days, setDays] = useState<number[]>(cleanReminderDays(mine.days));
  const [enabled, setEnabled] = useState(mine.enabled);
  const [add, setAdd] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = days.join(",") !== cleanReminderDays(mine.days).join(",") || enabled !== mine.enabled;

  const addDay = () => {
    const n = Number(add.trim());
    if (!isFinite(n) || Math.floor(n) !== n || n < 1 || n > REMINDER_MAX_DAY) {
      setMsg({ ok: false, text: `Enter a whole number of days from 1 to ${REMINDER_MAX_DAY}.` });
      return;
    }
    if (days.indexOf(n) !== -1) { setAdd(""); return; }
    if (days.length >= REMINDER_MAX_STEPS) { setMsg({ ok: false, text: `Up to ${REMINDER_MAX_STEPS} reminders.` }); return; }
    setDays(cleanReminderDays(days.concat([n])));
    setAdd("");
    setMsg(null);
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const r = await booksCall("/api/admin/books/reminders", "PATCH", { days, enabled });
    setBusy(false);
    if (r.error) { setMsg({ ok: false, text: r.error }); return; }
    setMsg({ ok: true, text: "Saved." });
    router.refresh();
  };

  const summary = (s: { days: number[]; enabled: boolean }) =>
    !s.enabled ? "Off" : !s.days.length ? "No reminders set" : `${s.days.join(", ")} day${s.days.length === 1 && s.days[0] === 1 ? "" : "s"} after the due date`;

  return (
    <Card>
      <CardHeader
        title="Payment reminders"
        kicker="Your schedule"
        description="Reminders go out this many days after the due date. They stop as soon as an invoice is paid or voided."
      />
      <CardBody className="space-y-4">
        {!ready ? (
          <p className="text-sm text-ink-600">Payment reminders aren&apos;t switched on yet — the 20261108 billing migration hasn&apos;t been added to the database.</p>
        ) : (
          <>
            <label className="inline-flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" className="h-4 w-4 accent-[#c39e4e]" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Send payment reminders on my invoices
            </label>
            <div className={enabled ? "" : "opacity-50"}>
              <span className="label-caps">Days after the due date</span>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {days.length === 0 && <span className="text-sm text-ink-500">None yet.</span>}
                {days.map((d) => (
                  <span key={d} className="inline-flex items-center gap-1 rounded-ctl border border-hairline-strong bg-white pl-3 pr-1 py-1 text-sm tabular-nums text-ink-900">
                    {d} day{d === 1 ? "" : "s"}
                    <button type="button" className="h-6 w-6 rounded-ctl text-ink-400 hover:text-danger-700 hover:bg-danger-50" aria-label={`Remove ${d} days`}
                      onClick={() => setDays(days.filter((x) => x !== d))}>×</button>
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3 max-w-xs">
                <input className={fieldClass + " tabular-nums"} inputMode="numeric" placeholder="e.g. 12" value={add}
                  onChange={(e) => setAdd(e.target.value.replace(/[^\d]/g, ""))}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDay(); } }} />
                <Button size="sm" variant="secondary" onClick={addDay} disabled={!add}>Add</Button>
              </div>
            </div>
            <p className="text-small text-ink-500">
              One reminder per day you list. If an invoice was paused and several days have passed, it gets one reminder, not several.
              Test invoices, paused invoices and invoices marked as sent without an email never get reminders.
            </p>
            {msg && <p className={`text-sm ${msg.ok ? "text-success-700" : "text-danger-700"}`}>{msg.text}</p>}
            <Button size="sm" onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : dirty ? "Save reminders" : "Saved"}</Button>

            {others.length > 0 && (
              <div className="border-t border-hairline pt-4 space-y-1">
                <p className="label-caps">Other logins (view only)</p>
                {others.map((o) => (
                  <p key={o.profile_id} className="text-sm text-ink-700">
                    {o.display_name}: <span className="text-ink-500">{summary({ days: cleanReminderDays(o.days), enabled: o.enabled })}</span>
                  </p>
                ))}
                <p className="text-small text-ink-400">Each login sets its own reminders.</p>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
