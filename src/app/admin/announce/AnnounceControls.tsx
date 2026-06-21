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
        <div className={`px-4 py-3 rounded-lg text-sm ${note.kind === "ok" ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
          {note.text}
        </div>
      )}

      {/* Audience */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Audience</h2>
        <p className="text-sm text-gray-500">
          <strong className="text-gray-900">{eligible}</strong> opted-in recipient{eligible === 1 ? "" : "s"} (brokers &amp; assistants).
          {alreadySent > 0 && <> {alreadySent} already received it — <strong className="text-gray-900">{remaining}</strong> would send.</>}
        </p>
      </div>

      {/* Test */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-semibold text-gray-900 mb-1">1 · Send yourself a test</h2>
        <p className="text-sm text-gray-500 mb-3">Delivers one copy so you can read it in a real inbox. Not counted toward the campaign.</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="defaults to your contact email"
            className="flex-1 min-w-[220px] text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#d4a843]"
          />
          <button onClick={sendTest} disabled={busy === "test"}
            className="bg-[#050b14] hover:bg-[#0a1628] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
            {busy === "test" ? "Sending…" : "Send test"}
          </button>
        </div>
      </div>

      {/* Approve */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-semibold text-gray-900 mb-1">2 · Approve the scheduled send</h2>
        <p className="text-sm text-gray-500 mb-3">
          When approved, the announcement sends automatically on <strong className="text-gray-900">{scheduleLabel}</strong>. Until then it stays on hold — nothing goes out.
        </p>
        <div className="flex items-center justify-between gap-4">
          <span className={`text-sm font-medium ${approved ? "text-green-700" : "text-gray-500"}`}>
            {approved ? "✓ Approved — armed for the scheduled send" : "On hold — not approved"}
          </span>
          <button onClick={toggleApprove} disabled={busy === "approve" || busy === "unapprove"}
            className={`text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50 ${
              approved ? "bg-white border border-gray-200 text-gray-600 hover:border-gray-300" : "bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14]"
            }`}>
            {approved ? "Hold / un-approve" : "Approve for Monday"}
          </button>
        </div>
      </div>

      {/* Manual send */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Send now (optional)</h2>
        <p className="text-sm text-gray-500 mb-3">Skip the schedule and send immediately. Type <strong className="text-gray-900">SEND</strong> to confirm.</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type SEND"
            className="w-32 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-red-300"
          />
          <button onClick={sendNow} disabled={confirmText !== "SEND" || busy === "live"}
            className="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
            {busy === "live" ? "Sending…" : `Send to all ${remaining} now`}
          </button>
        </div>
      </div>
    </div>
  );
}
