"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Candidate = { listingId: string; brokerId: string; brokerName: string; brokerEmail: string | null; vessel: string; photos: number; suggested: boolean; testLike: boolean };
type Recipient = { brokerId: string; name: string; email: string; vessel: string; readyCount: number; testLike: boolean };
type Preview = { brokerId: string; name: string; subject: string; html: string };

const card = "bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6";
const inkBtn = "bg-ink-950 hover:bg-ink-800 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors";
const quietBtn = "border border-hairline-strong text-ink-800 hover:bg-ink-50 disabled:opacity-40 text-sm font-medium px-4 py-2 rounded-ctl transition-colors";

export default function SlideshowReadyControls({ candidates, recipients, alreadySent, optedOut, previews }: {
  candidates: Candidate[]; recipients: Recipient[]; alreadySent: number; optedOut: number; previews: Preview[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates.filter((c) => c.suggested).map((c) => c.listingId)));
  const [sendTo, setSendTo] = useState<Set<string>>(() => new Set(recipients.filter((r) => !r.testLike).map((r) => r.brokerId)));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState("");
  const [preview, setPreview] = useState(0);

  const brokersPicked = useMemo(() => new Set(candidates.filter((c) => picked.has(c.listingId)).map((c) => c.brokerId)).size, [candidates, picked]);

  async function call(action: string, payload: Record<string, unknown>) {
    setBusy(action);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/slideshow-ready", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: json.error ?? "Something went wrong." }); return null; }
      return json;
    } finally {
      setBusy(null);
    }
  }

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  return (
    <div className="mt-6">
      {msg && <div className={`mb-5 px-4 py-3 rounded-card border text-sm ${msg.ok ? "bg-success-50 border-success-200 text-success-700" : "bg-danger-50 border-danger-200 text-danger-700"}`}>{msg.text}</div>}

      {/* Step 1 */}
      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-h2 text-ink-900">Step 1 · Prepare slideshows</h2>
          <p className="text-xs text-ink-500">{candidates.length} listings · {new Set(candidates.map((c) => c.brokerId)).size} brokers</p>
        </div>
        <p className="text-sm text-ink-500 mt-1 mb-4">
          Active, unsold listings with photos and no slideshow yet, of brokers without a plan. Preparing makes exactly the change the
          broker&rsquo;s own Create Slideshow makes, and records that YachtPics did it. No email, push, website or showcase change.
          Accounts that look like tests start unticked.
        </p>
        {candidates.length === 0 ? (
          <p className="text-sm text-ink-500">Nothing to prepare.</p>
        ) : (
          <>
            <div className="flex gap-3 mb-2 text-xs">
              <button className="text-accent-700 hover:underline" onClick={() => setPicked(new Set(candidates.map((c) => c.listingId)))}>Tick all</button>
              <button className="text-accent-700 hover:underline" onClick={() => setPicked(new Set())}>Untick all</button>
            </div>
            <div className="max-h-96 overflow-y-auto border border-hairline rounded-ctl">
              <table className="w-full text-sm">
                <thead className="bg-ink-50 text-left text-xs text-ink-500 sticky top-0">
                  <tr><th className="p-2 w-8" /><th className="p-2">Broker</th><th className="p-2">Vessel</th><th className="p-2 text-right">Photos</th></tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {candidates.map((c) => (
                    <tr key={c.listingId} className={c.testLike ? "bg-warn-50/50" : ""}>
                      <td className="p-2"><input type="checkbox" checked={picked.has(c.listingId)} onChange={() => toggle(picked, c.listingId, setPicked)} aria-label={`Prepare ${c.vessel}`} /></td>
                      <td className="p-2">{c.brokerName}{c.testLike && <span className="ml-2 text-[10px] uppercase tracking-caps text-warn-800">test?</span>}<span className="block text-xs text-ink-400">{c.brokerEmail}</span></td>
                      <td className="p-2">{c.vessel}</td>
                      <td className="p-2 text-right tabular-nums">{c.photos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className={inkBtn + " mt-4"}
              disabled={!!busy || picked.size === 0}
              onClick={async () => {
                if (!window.confirm(`Prepare ${picked.size} slideshows for ${brokersPicked} brokers? Nothing is emailed.`)) return;
                const r = await call("prepare", { listingIds: Array.from(picked) });
                if (r) { setMsg({ ok: true, text: `Prepared ${r.prepared}.${r.skipped ? ` ${r.skipped} skipped (no longer eligible).` : ""}${r.failed?.length ? ` ${r.failed.length} failed.` : ""}` }); router.refresh(); }
              }}
            >
              {busy === "prepare" ? "Preparing…" : `Prepare ${picked.size} slideshows`}
            </button>
          </>
        )}
      </section>

      {/* Step 2 */}
      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-h2 text-ink-900">Step 2 · &ldquo;Slideshow ready&rdquo; email</h2>
          <p className="text-xs text-ink-500">{recipients.length} eligible · {alreadySent} already sent · {optedOut} opted out</p>
        </div>
        <p className="text-sm text-ink-500 mt-1 mb-4">
          One email per broker without a plan who has a published slideshow, featuring their most recently photographed boat. The button
          opens that listing in the Portal at Client Slideshow (after sign-in if needed). Sent once per broker, ever.
        </p>

        {recipients.length > 0 && (
          <div className="max-h-80 overflow-y-auto border border-hairline rounded-ctl mb-4">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-xs text-ink-500 sticky top-0">
                <tr><th className="p-2 w-8" /><th className="p-2">Broker</th><th className="p-2">Email</th><th className="p-2">Featured</th><th className="p-2 text-right">Ready</th></tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {recipients.map((r) => (
                  <tr key={r.brokerId} className={r.testLike ? "bg-warn-50/50" : ""}>
                    <td className="p-2"><input type="checkbox" checked={sendTo.has(r.brokerId)} onChange={() => toggle(sendTo, r.brokerId, setSendTo)} aria-label={`Send to ${r.name}`} /></td>
                    <td className="p-2">{r.name}{r.testLike && <span className="ml-2 text-[10px] uppercase tracking-caps text-warn-800">test?</span>}</td>
                    <td className="p-2 text-ink-500">{r.email}</td>
                    <td className="p-2">{r.vessel}</td>
                    <td className="p-2 text-right tabular-nums">{r.readyCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {previews.length > 0 && (
          <div className="mb-4">
            <div className="flex flex-wrap gap-2 mb-2">
              {previews.map((p, i) => (
                <button key={p.brokerId} onClick={() => setPreview(i)} className={`text-xs px-3 py-1.5 rounded-full border ${preview === i ? "border-ink-900 bg-ink-900 text-white" : "border-hairline-strong text-ink-700"}`}>{p.name}</button>
              ))}
            </div>
            <p className="text-sm text-ink-700 mb-2"><span className="text-ink-400">Subject:</span> {previews[preview]?.subject}</p>
            <iframe title="Email preview" srcDoc={previews[preview]?.html} className="w-full h-[720px] border border-hairline rounded-ctl bg-ink-50" sandbox="" />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            className={quietBtn}
            disabled={!!busy || recipients.length === 0}
            onClick={async () => {
              const r = await call("test", { brokerId: previews[preview]?.brokerId });
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
              const r = await call("send", { brokerIds: Array.from(sendTo), confirm });
              if (r) { setMsg({ ok: true, text: `Sent ${r.sent}.${r.failed ? ` ${r.failed} failed.` : ""}${r.skipped ? ` ${r.skipped} skipped (already sent or no longer eligible).` : ""}` }); setConfirm(""); router.refresh(); }
            }}
          >
            {busy === "send" ? "Sending…" : `Send to ${sendTo.size} brokers`}
          </button>
        </div>
      </section>
    </div>
  );
}
