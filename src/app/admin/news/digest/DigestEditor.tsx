"use client";

import { useState } from "react";
import { renderDigestHtml, digestWeekLabel, type DigestRow } from "@/lib/newsDigest";

const MAX_TITLE = 80;
const MAX_INTRO = 600;

const fieldClass =
  "w-full text-sm bg-white border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500";

const quietButton =
  "text-sm text-ink-600 bg-white border border-hairline-strong hover:border-ink-400 px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet disabled:opacity-50";

type ApiReply = {
  error?: string;
  digest?: DigestRow;
  sent?: number;
  failed?: number;
  eligible?: number;
  skipped?: number;
  to?: string;
  warning?: string;
};

function StatusBadge({ status }: { status: string }) {
  const look =
    status === "sent"
      ? "text-success-700 bg-success-50 border-success-200"
      : status === "approved"
        ? "text-accent-700 bg-accent-50 border-accent-200"
        : "text-ink-600 bg-ink-50 border-hairline";
  const label = status === "sent" ? "Sent" : status === "approved" ? "Approved" : "Draft";
  return (
    <span className={`text-[11px] font-semibold border rounded-full px-2.5 py-0.5 ${look}`}>{label}</span>
  );
}

/**
 * The one place the weekly piece is read, edited and released.
 *
 * Nothing on this page happens by itself: the draft arrived from Monday's job,
 * and it stays a draft until one of these buttons is pressed. Send asks twice —
 * once in the dialog, once as the confirm flag the route insists on.
 */
export default function DigestEditor({
  digest,
  eligible,
  alreadySent,
}: {
  digest: DigestRow;
  eligible: number;
  alreadySent: number;
}) {
  const [title, setTitle] = useState(digest.title);
  const [intro, setIntro] = useState(digest.intro);
  const [bodyMd, setBodyMd] = useState(digest.body_md);
  const [status, setStatus] = useState(digest.status);
  const [saved, setSaved] = useState({ title: digest.title, intro: digest.intro, body_md: digest.body_md });
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const dirty = title !== saved.title || intro !== saved.intro || bodyMd !== saved.body_md;
  const locked = status === "sent";
  const remaining = Math.max(0, eligible - alreadySent);
  const previewHtml = renderDigestHtml({ body_md: bodyMd });

  async function post(url: string, payload: Record<string, unknown>, method: "POST" | "PATCH"): Promise<ApiReply | null> {
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: digest.id, ...payload }),
      });
      const data = (await res.json()) as ApiReply;
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      return data;
    } catch (e) {
      setNote({ kind: "err", text: e instanceof Error ? e.message : "Something went wrong" });
      return null;
    }
  }

  /** Saves any unsaved edits first, so what goes out is what's on screen. */
  async function ensureSaved(): Promise<boolean> {
    if (!dirty) return true;
    const data = await post("/api/admin/news/digest", { title, intro, body_md: bodyMd }, "PATCH");
    if (!data) return false;
    setSaved({ title, intro, body_md: bodyMd });
    return true;
  }

  async function save() {
    setBusy("save");
    setNote(null);
    const ok = await ensureSaved();
    setBusy(null);
    if (ok) setNote({ kind: "ok", text: "Saved." });
  }

  async function approve() {
    setBusy("approve");
    setNote(null);
    if (await ensureSaved()) {
      const data = await post("/api/admin/news/digest/approve", {}, "POST");
      if (data) {
        setStatus(data.digest?.status ?? "approved");
        setNote({ kind: "ok", text: "Approved. It's live in the portal and on yachtpics.com within half an hour." });
      }
    }
    setBusy(null);
  }

  async function sendTest() {
    setBusy("test");
    setNote(null);
    if (await ensureSaved()) {
      const data = await post("/api/admin/news/digest/send", { testOnly: true }, "POST");
      if (data) setNote({ kind: "ok", text: `Test sent to ${data.to}. Read it in a real inbox before you send it to anyone else.` });
    }
    setBusy(null);
  }

  async function sendLive() {
    const ok = window.confirm(
      `Send "${title}" to ${remaining} broker${remaining === 1 ? "" : "s"} and assistant${remaining === 1 ? "" : "s"}?\n\n` +
        "This approves the piece and emails it. It can't be unsent."
    );
    if (!ok) return;
    setBusy("send");
    setNote(null);
    if (await ensureSaved()) {
      const data = await post("/api/admin/news/digest/send", { confirm: true }, "POST");
      if (data) {
        setStatus(data.digest?.status ?? "sent");
        setNote({
          kind: "ok",
          text:
            data.warning ??
            `Sent to ${data.sent ?? 0} of ${data.eligible ?? 0} (skipped ${data.skipped ?? 0}, failed ${data.failed ?? 0}).`,
        });
      }
    }
    setBusy(null);
  }

  return (
    <div className="space-y-5">
      {note && (
        <div
          className={`px-4 py-3 rounded-ctl text-sm ${
            note.kind === "ok"
              ? "bg-success-50 border border-success-200 text-success-700"
              : "bg-danger-50 border border-danger-200 text-danger-700"
          }`}
        >
          {note.text}
        </div>
      )}

      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="label-caps">Week of {digestWeekLabel(digest.week_start)}</p>
            <p className="text-sm text-ink-500 mt-1">
              {status === "sent" ? (
                <>Sent to brokers. This piece is closed to edits.</>
              ) : (
                <>
                  <strong className="text-ink-900 tabular-nums">{remaining}</strong> opted-in recipient
                  {remaining === 1 ? "" : "s"} would receive it
                  {alreadySent > 0 && <> ({alreadySent} already have)</>}.
                </>
              )}
            </p>
          </div>
          <StatusBadge status={status} />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Edit */}
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 space-y-4">
          <h2 className="text-h2 text-ink-900">The piece</h2>

          <div>
            <label className="block text-[11px] font-medium text-ink-500 mb-1">
              Title <span className="text-ink-400">({title.length}/{MAX_TITLE})</span>
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={MAX_TITLE}
              disabled={locked}
              className={fieldClass}
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-ink-500 mb-1">
              Intro <span className="text-ink-400">({intro.length}/{MAX_INTRO})</span>
            </label>
            <textarea
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              maxLength={MAX_INTRO}
              rows={3}
              disabled={locked}
              className={fieldClass}
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-ink-500 mb-1">
              Body <span className="text-ink-400">(a blank line starts a new paragraph; *italic* and **bold** only)</span>
            </label>
            <textarea
              value={bodyMd}
              onChange={(e) => setBodyMd(e.target.value)}
              rows={20}
              disabled={locked}
              className={`${fieldClass} font-mono text-[13px] leading-relaxed`}
            />
          </div>

          {!locked && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="button" onClick={save} disabled={!dirty || busy !== null} className={quietButton}>
                {busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}
              </button>
              <button
                type="button"
                onClick={approve}
                disabled={busy !== null}
                className="bg-ink-950 hover:bg-ink-800 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet disabled:opacity-50"
              >
                {busy === "approve" ? "Publishing…" : "Approve & publish"}
              </button>
              <button
                type="button"
                onClick={sendLive}
                disabled={busy !== null || remaining === 0}
                className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet disabled:opacity-50"
              >
                {busy === "send" ? "Sending…" : `Approve & send to ${remaining}`}
              </button>
              <button type="button" onClick={sendTest} disabled={busy !== null} className={quietButton}>
                {busy === "test" ? "Sending…" : "Send test to me"}
              </button>
            </div>
          )}

          <p className="text-xs text-ink-400">
            Approve &amp; publish puts it in front of brokers and on yachtpics.com. Approve &amp; send does that and
            emails it. Send yourself a test first.
          </p>
        </div>

        {/* Read */}
        <div>
          <p className="label-caps mb-2">As brokers will read it</p>
          <div className="bg-white border border-hairline rounded-card shadow-elev-1 px-6 py-6">
            <h3 className="text-h1 text-ink-900">{title || "(no title)"}</h3>
            <p className="text-sm text-ink-500 leading-relaxed mt-2 mb-4">{intro}</p>
            <div className="border-t border-hairline pt-4" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </div>
      </div>
    </div>
  );
}
