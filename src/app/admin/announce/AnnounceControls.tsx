"use client";

import { useState } from "react";

export default function AnnounceControls({
  eligible,
  alreadySent,
  initialApproved,
  scheduleLabel,
}: {
  eligible: number;
  alreadySent: number;
  initialApproved: boolean;
  scheduleLabel: string;
}) {
  const [approved, setApproved] = useState(initialApproved);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [confirmText, setConfirmText] = useState("");

  const remaining = Math.max(0, eligible - alreadySent);

  async function call(mode: string, extra: Record<string, unknown> = {}) {
    setBusy(mode);
    setNote(null);
    try {
      const res = await fetch("/api/admin/announce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      return data;
    } catch (e) {
      setNote({ kind: "err", text: e instanceof Error ? e.message : "Something went wrong" });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    const data = await call("test", testEmail ? { testEmail } : {});
    if (data) setNote({ kind: "ok", text: `Test sent to ${data.to}. Check your inbox.` });
  }

  async function toggleApprove() {
    const next = !approved;
    const data = await call(next ? "approve" : "unapprove");
    if (data) {
      setApproved(next);
      setNote({ kind: "ok", text: next ? "Approved — the scheduled send is armed." : "Held — the scheduled send is paused." });
    }
  }

  async function sendNow() {
    if (confirmText !== "SEND") return;
    const data = await call("live", { confirm: true });
    if (data) setNote({ kind: "ok", text: `Sent to ${data.sent} of ${data.eligible} (skipped ${data.skipped}, failed ${data.failed}).` });
    setConfirmText("");
  }

  return (
    <div className="space-y-5">
      {note && (
        <div className={`px-4 py-3 rounded-ctl text-sm ${note.kind === "ok" ? "bg-success-50 border border-success-200 text-success-700" : "bg-danger-50 border border-danger-200 text-danger-700"}`}>
          {note.text}
        </div>
      )}

      {/* Audience */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
        <h2 className="label-caps mb-1">Audience</h2>
        <p className="text-sm text-ink-500">
          <strong className="text-ink-900 tabular-nums">{eligible}</strong> opted-in recipient{eligible === 1 ? "" : "s"} (brokers &amp; assistants).
          {alreadySent > 0 && <> {alreadySent} already received it — <strong className="text-ink-900 tabular-nums">{remaining}</strong> would send.</>}
        </p>
      </div>

      {/* Test */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
        <h2 className="text-h2 text-ink-900 mb-1">1 · Send yourself a test</h2>
        <p className="text-sm text-ink-500 mb-3">Delivers one copy so you can read it in a real inbox. Not counted toward the campaign.</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="defaults to your contact email"
            className="flex-1 min-w-[220px] text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
          />
          <button onClick={sendTest} disabled={busy === "test"}
            className="bg-ink-950 hover:bg-ink-800 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet disabled:opacity-50">
            {busy === "test" ? "Sending…" : "Send test"}
          </button>
        </div>
      </div>

      {/* Approve */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
        <h2 className="text-h2 text-ink-900 mb-1">2 · Approve the scheduled send</h2>
        <p className="text-sm text-ink-500 mb-3">
          When approved, the announcement sends automatically on <strong className="text-ink-900">{scheduleLabel}</strong>. Until then it stays on hold — nothing goes out.
        </p>
        <div className="flex items-center justify-between gap-4">
          <span className={`text-sm font-medium ${approved ? "text-success-700" : "text-ink-500"}`}>
            {approved ? "✓ Approved — armed for the scheduled send" : "On hold — not approved"}
          </span>
          <button onClick={toggleApprove} disabled={busy === "approve" || busy === "unapprove"}
            className={`text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet disabled:opacity-50 ${
              approved ? "bg-white border border-hairline-strong text-ink-600 hover:border-ink-400" : "bg-accent-500 hover:bg-accent-400 text-ink-950"
            }`}>
            {approved ? "Hold / un-approve" : "Approve for Monday"}
          </button>
        </div>
      </div>

      {/* Manual send */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
        <h2 className="text-h2 text-ink-900 mb-1">Send now (optional)</h2>
        <p className="text-sm text-ink-500 mb-3">Skip the schedule and send immediately. Type <strong className="text-ink-900">SEND</strong> to confirm.</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type SEND"
            className="w-32 text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-danger-300 focus:ring-1 focus:ring-danger-300"
          />
          <button onClick={sendNow} disabled={confirmText !== "SEND" || busy === "live"}
            className="bg-danger-600 hover:bg-danger-500 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet disabled:opacity-50">
            {busy === "live" ? "Sending…" : `Send to all ${remaining} now`}
          </button>
        </div>
      </div>
    </div>
  );
}
