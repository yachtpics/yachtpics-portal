"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Recipient = { key: string; kind: "broker" | "assistant"; name: string; email: string; brokers: string[]; boats: number; views: number; plan: boolean };
type Preview = { key: string; name: string; kind: "broker" | "assistant"; subject: string; html: string };
type Counts = { brokers: number; assistants: number; alreadySent: number; optedOut: number; bounced: number; noEmail: number; testSkipped: number; listings: number };

const card = "bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6";
const inkBtn = "bg-ink-950 hover:bg-ink-800 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors";
const quietBtn = "border border-hairline-strong text-ink-800 hover:bg-ink-50 disabled:opacity-40 text-sm font-medium px-4 py-2 rounded-ctl transition-colors";

export default function MonthlyReportControls({ month, monthLabel, months, autoOn, sentCount, counts, recipients, previews }: {
  month: string; monthLabel: string; months: { value: string; label: string }[]; autoOn: boolean; sentCount: number;
  counts: Counts; recipients: Recipient[]; previews: Preview[];
}) {
  const router = useRouter();
  const [sendTo, setSendTo] = useState<Set<string>>(() => new Set(recipients.map((r) => r.key)));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState("");
  const [preview, setPreview] = useState(0);
  const [auto, setAuto] = useState(autoOn);

  async function call(action: string, payload: Record<string, unknown>) {
    setBusy(action);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/monthly-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, month, ...payload }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: json.error ?? "Something went wrong." }); return null; }
      return json;
    } finally {
      setBusy(null);
    }
  }

  const toggle = (key: string) => {
    const next = new Set(sendTo);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSendTo(next);
  };

  return (
    <div className="mt-6">
      {msg && <div className={`mb-5 px-4 py-3 rounded-card border text-sm ${msg.ok ? "bg-success-50 border-success-200 text-success-700" : "bg-danger-50 border-danger-200 text-danger-700"}`}>{msg.text}</div>}

      {/* Schedule */}
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-xl">
            <h2 className="text-h2 text-ink-900">Schedule automatically</h2>
            <p className="text-sm text-ink-500 mt-1">
              When on, the daily job sends last month&rsquo;s email on the 1st of each month at about 9 AM Eastern, to everyone eligible
              that day. It skips a month you&rsquo;ve already sent by hand, and never sends anyone the same month twice.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={auto}
            disabled={!!busy}
            onClick={async () => {
              const want = !auto;
              if (want && !window.confirm("Send this email automatically on the 1st of every month, without asking?")) return;
              const r = await call("auto", { on: want });
              if (r) { setAuto(r.on); setMsg({ ok: true, text: r.on ? "Scheduled: it will go out on the 1st of each month at ~9 AM ET." : "Automatic sending is off." }); }
            }}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${auto ? "bg-success-600" : "bg-ink-200"}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${auto ? "translate-x-6" : "translate-x-1"}`} />
            <span className="sr-only">Schedule automatically</span>
          </button>
        </div>
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-h2 text-ink-900">{monthLabel}</h2>
            <select
              value={month}
              onChange={(e) => router.push(`/admin/announce/monthly-report?month=${e.target.value}`)}
              className="border border-hairline-strong rounded-ctl px-2 py-1 text-sm"
              aria-label="Month"
            >
              {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <p className="text-xs text-ink-500">
            {counts.brokers} brokers · {counts.assistants} assistants · {counts.listings} live boats
          </p>
        </div>
        <p className="text-xs text-ink-500 mt-2">
          Left out: {counts.alreadySent} already sent this month · {counts.optedOut} opted out · {counts.bounced} bounced
          {counts.noEmail ? ` · ${counts.noEmail} no address` : ""} · {counts.testSkipped} test accounts
          {sentCount > 0 && <span className="ml-1 font-semibold text-ink-700">· {sentCount} sent so far</span>}
        </p>

        {recipients.length > 0 && (
          <>
            <div className="flex gap-3 mt-4 mb-2 text-xs">
              <button className="text-accent-700 hover:underline" onClick={() => setSendTo(new Set(recipients.map((r) => r.key)))}>Tick all</button>
              <button className="text-accent-700 hover:underline" onClick={() => setSendTo(new Set())}>Untick all</button>
            </div>
            <div className="max-h-96 overflow-y-auto border border-hairline rounded-ctl mb-4">
              <table className="w-full text-sm">
                <thead className="bg-ink-50 text-left text-xs text-ink-500 sticky top-0">
                  <tr><th className="p-2 w-8" /><th className="p-2">Name</th><th className="p-2">Email</th><th className="p-2 text-right">Boats</th><th className="p-2 text-right">Views</th><th className="p-2">Plan</th></tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {recipients.map((r) => (
                    <tr key={r.key}>
                      <td className="p-2"><input type="checkbox" checked={sendTo.has(r.key)} onChange={() => toggle(r.key)} aria-label={`Send to ${r.name}`} /></td>
                      <td className="p-2">
                        {r.name}
                        {r.kind === "assistant" && (
                          <span className="block text-xs text-ink-400">Assistant · {r.brokers.slice(0, 3).join(", ")}{r.brokers.length > 3 ? ` +${r.brokers.length - 3}` : ""}</span>
                        )}
                      </td>
                      <td className="p-2 text-ink-500">{r.email}</td>
                      <td className="p-2 text-right tabular-nums">{r.boats}</td>
                      <td className="p-2 text-right tabular-nums">{r.views}</td>
                      <td className="p-2 text-xs text-ink-500">{r.plan ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {previews.length > 0 && (
          <div className="mb-4">
            <div className="flex flex-wrap gap-2 mb-2">
              {previews.map((p, i) => (
                <button key={p.key} onClick={() => setPreview(i)} className={`text-xs px-3 py-1.5 rounded-full border ${preview === i ? "border-ink-900 bg-ink-900 text-white" : "border-hairline-strong text-ink-700"}`}>
                  {p.name}{p.kind === "assistant" ? " (assistant)" : ""}
                </button>
              ))}
            </div>
            <p className="text-sm text-ink-700 mb-2"><span className="text-ink-400">Subject:</span> {previews[preview]?.subject}</p>
            <iframe title="Email preview" srcDoc={previews[preview]?.html} className="w-full h-[760px] border border-hairline rounded-ctl bg-ink-50" sandbox="" />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            className={quietBtn}
            disabled={!!busy || recipients.length === 0}
            onClick={async () => {
              const r = await call("test", { key: previews[preview]?.key });
              if (r) setMsg({ ok: true, text: `Test sent to ${r.to}.` });
            }}
          >
            {busy === "test" ? "Sending…" : "Send a test to me"}
          </button>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Type SEND"
            className="w-32 border border-hairline-strong rounded-ctl px-3 py-2 text-sm"
            aria-label="Type SEND to confirm"
          />
          <button
            className={inkBtn}
            disabled={!!busy || confirm !== "SEND" || sendTo.size === 0}
            onClick={async () => {
              const r = await call("send", { keys: Array.from(sendTo), confirm });
              if (r) {
                setMsg({ ok: true, text: `Sent ${r.sent}.${r.failed ? ` ${r.failed} failed.` : ""}${r.skipped ? ` ${r.skipped} skipped (already sent or no longer eligible).` : ""}` });
                setConfirm("");
                router.refresh();
              }
            }}
          >
            {busy === "send" ? "Sending…" : `Send to ${sendTo.size} ${sendTo.size === 1 ? "person" : "people"}`}
          </button>
        </div>
      </section>
    </div>
  );
}
