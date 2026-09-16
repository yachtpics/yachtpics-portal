"use client";

import { useState } from "react";

type Key = "week1" | "lastcall";

export default function FollowUpControls({
  cards,
}: {
  cards: {
    key: Key;
    title: string;
    blurb: string;
    subject: string;
    windowOpen: boolean;
    windowLabel: string;
    alreadySent: number;
    remaining: number;
    proof: boolean;
  }[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirmText, setConfirmText] = useState<Record<string, string>>({});

  async function call(key: Key, mode: string, extra: Record<string, unknown> = {}) {
    setBusy(`${key}:${mode}`);
    setNote(null);
    try {
      const res = await fetch("/api/admin/reel-followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, mode, ...extra }),
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

  return (
    <div className="space-y-4">
      {note && (
        <div className={`px-4 py-3 rounded-ctl text-sm ${note.kind === "ok" ? "bg-success-50 border border-success-200 text-success-700" : "bg-danger-50 border border-danger-200 text-danger-700"}`}>
          {note.text}
        </div>
      )}

      {cards.map((c) => (
        <div key={c.key} className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
            <h3 className="text-h2 text-ink-900">{c.title}</h3>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              c.alreadySent > 0
                ? "bg-ink-100 text-ink-600"
                : c.windowOpen
                  ? "bg-success-50 text-success-600"
                  : "bg-ink-100 text-ink-500"
            }`}>
              {c.alreadySent > 0 ? `Sent to ${c.alreadySent}` : c.windowOpen ? "Window open" : "Window closed"}
            </span>
          </div>
          <p className="text-sm text-ink-500 mb-1">{c.blurb}</p>
          <p className="text-xs text-ink-400 mb-3">{c.windowLabel}</p>

          <div className="mb-3 px-3 py-2 bg-ink-50 border border-hairline rounded-ctl">
            <p className="label-caps mb-0.5">Subject as it stands</p>
            <p className="text-sm text-ink-800">{c.subject}</p>
            {c.key === "week1" && (
              <p className="text-xs text-ink-400 mt-1">
                {c.proof
                  ? "The numbers are strong enough to lead with — this send will quote them."
                  : "Too quiet to lead with numbers — this send falls back to the version that makes the case on the tool. Re-check nearer the day; it switches on its own."}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={async () => {
                const data = await call(c.key, "test");
                if (data) setNote({ kind: "ok", text: `Test sent to ${data.to}. Check your inbox.` });
              }}
              disabled={busy === `${c.key}:test`}
              className="bg-ink-950 hover:bg-ink-800 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet disabled:opacity-50"
            >
              {busy === `${c.key}:test` ? "Sending…" : "Send test"}
            </button>

            <input
              value={confirmText[c.key] ?? ""}
              onChange={(e) => setConfirmText({ ...confirmText, [c.key]: e.target.value })}
              placeholder="Type SEND"
              disabled={!c.windowOpen || c.remaining === 0}
              className="w-32 text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-danger-300 focus:ring-1 focus:ring-danger-300 disabled:bg-ink-50 disabled:text-ink-300"
            />
            <button
              onClick={async () => {
                const data = await call(c.key, "live", { confirm: true });
                if (data) setNote({ kind: "ok", text: `Sent to ${data.sent} of ${data.eligible} (skipped ${data.skipped}, failed ${data.failed}).` });
                setConfirmText({ ...confirmText, [c.key]: "" });
              }}
              disabled={(confirmText[c.key] ?? "") !== "SEND" || !c.windowOpen || c.remaining === 0 || busy === `${c.key}:live`}
              className="bg-danger-600 hover:bg-danger-500 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet disabled:opacity-50"
            >
              {busy === `${c.key}:live` ? "Sending…" : `Send to ${c.remaining}`}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
