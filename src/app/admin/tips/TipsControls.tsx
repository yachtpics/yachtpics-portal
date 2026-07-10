"use client";

import { useState } from "react";

export type TipRow = {
  slug: string;
  subject: string;
  headline: string;
  approved: boolean;
  sentCount: number;
  previewHtml: string;
};

export default function TipsControls({ tips, recipients }: { tips: TipRow[]; recipients: number }) {
  const [rows, setRows] = useState(tips);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  async function call(mode: string, slug: string, extra: Record<string, unknown> = {}) {
    setBusy(`${mode}:${slug}`);
    setNote(null);
    try {
      const res = await fetch("/api/admin/tips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, slug, ...extra }),
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

  async function toggleApprove(row: TipRow) {
    const next = !row.approved;
    const data = await call(next ? "approve" : "unapprove", row.slug);
    if (data) {
      setRows((prev) => prev.map((r) => (r.slug === row.slug ? { ...r, approved: next } : r)));
      setNote({ kind: "ok", text: next ? `Approved “${row.headline}.”` : `“${row.headline}” held.` });
    }
  }

  async function sendTest(row: TipRow) {
    const data = await call("test", row.slug);
    if (data) setNote({ kind: "ok", text: `Test sent to ${data.to}.` });
  }

  async function sendCorrection() {
    if (!window.confirm(
      `Send the correction email (short apology + the cover-photo tip) to all ${recipients} opted-in recipients now?\n\nOne-time make-good — it bypasses the weekly pacing and resumes the series at tip #3 next Tuesday.`
    )) return;
    const data = await call("correction", "cover-photo", { confirm: true });
    if (data) setNote({ kind: "ok", text: `Correction sent — ${data.sent} delivered${data.failed ? `, ${data.failed} failed` : ""}. The series resumes at tip #3 next Tuesday.` });
  }

  const firstUnapproved = rows.find((r) => !r.approved);

  return (
    <div className="space-y-4">
      {note && (
        <div className={`px-4 py-3 rounded-ctl text-sm ${note.kind === "ok" ? "bg-success-50 border border-success-200 text-success-700" : "bg-danger-50 border border-danger-200 text-danger-700"}`}>
          {note.text}
        </div>
      )}

      <div className="bg-warn-50 border border-warn-200 rounded-card px-4 py-3 text-sm text-warn-800">
        Tips go out <strong>weekly, Tuesday 9:00 AM ET</strong>, one per person in order — but only the ones you&rsquo;ve approved.
        Each recipient gets the next tip they haven&rsquo;t seen yet. <strong>{recipients}</strong> opted-in recipient{recipients === 1 ? "" : "s"}.
        {firstUnapproved && <> Next up: <strong>{firstUnapproved.headline}</strong> — approve it to let it send.</>}
      </div>

      <div className="bg-white border border-hairline rounded-card shadow-elev-1 px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900">One-time correction send</p>
          <p className="text-xs text-ink-500 mt-0.5">
            A system bug re-sent the first tip instead of advancing. Send everyone a short apology plus the cover-photo tip, then the weekly series resumes at #3.
          </p>
        </div>
        <button
          onClick={sendCorrection}
          disabled={busy === "correction:cover-photo"}
          className="text-sm font-semibold px-4 py-2 rounded-ctl bg-ink-950 text-white hover:bg-ink-800 transition-colors duration-fast ease-quiet disabled:opacity-50 shrink-0"
        >
          {busy === "correction:cover-photo" ? "Sending…" : "Send correction"}
        </button>
      </div>

      {rows.map((row, i) => (
        <div key={row.slug} className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink-400 tabular-nums">#{i + 1}</span>
                <span className="font-semibold text-ink-900">{row.headline}</span>
                {row.approved
                  ? <span className="text-[11px] font-semibold text-success-700 bg-success-50 border border-success-200 rounded-full px-2 py-0.5">Approved</span>
                  : <span className="text-[11px] font-semibold text-ink-500 bg-ink-50 border border-hairline rounded-full px-2 py-0.5">On hold</span>}
              </div>
              <p className="text-xs text-ink-500 mt-0.5 truncate">{row.subject} · sent to {row.sentCount}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => setOpenSlug(openSlug === row.slug ? null : row.slug)}
                className="text-sm text-ink-600 border border-hairline-strong hover:border-ink-400 px-3 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet">
                {openSlug === row.slug ? "Hide" : "Preview"}
              </button>
              <button onClick={() => sendTest(row)} disabled={busy === `test:${row.slug}`}
                className="text-sm text-ink-600 border border-hairline-strong hover:border-ink-400 px-3 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet disabled:opacity-50">
                {busy === `test:${row.slug}` ? "Sending…" : "Test"}
              </button>
              <button onClick={() => toggleApprove(row)} disabled={busy === `approve:${row.slug}` || busy === `unapprove:${row.slug}`}
                className={`text-sm font-semibold px-3 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet disabled:opacity-50 ${
                  row.approved ? "bg-white border border-hairline-strong text-ink-600 hover:border-ink-400" : "bg-accent-500 hover:bg-accent-400 text-ink-950"
                }`}>
                {row.approved ? "Hold" : "Approve"}
              </button>
            </div>
          </div>
          {openSlug === row.slug && (
            <div className="border-t border-hairline bg-ink-50">
              <iframe srcDoc={row.previewHtml} title={row.headline} className="w-full" style={{ height: 520, border: "none", background: "#f8f9fa" }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
