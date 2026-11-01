"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * "YachtPics share link — always live" (Nov 1, src/lib/ypShare.ts). Admin
 * listing page only. The listing's slideshow at /yp/{token}: live whatever
 * the broker's plan while the slideshow is published and this switch is on.
 * Brokers never see it — they keep their own (plan-gated) /s/ link.
 *
 * Copy gives the bare link; the two small buttons tag it for where it's
 * going (?via=social for our posts, ?via=site for yachtpics.com) so the
 * Seller Report can say where the views came from.
 */
type State = {
  available: boolean;
  enabled?: boolean;
  published?: boolean;
  live: boolean;
  url: string | null;
  siteUrl: string | null;
  socialUrl: string | null;
};

export default function YpShareCard({ listingId, published }: { listingId: string; published: boolean }) {
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    fetch(`/api/admin/listings/${listingId}/yp-share`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: State) => setS(d))
      .catch(() => setErr("Couldn't load the YachtPics link."));
  }, [listingId]);

  // Re-read when the slideshow is published / unpublished on this page.
  useEffect(() => { load(); }, [load, published]);

  async function toggle() {
    if (!s || busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/admin/listings/${listingId}/yp-share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Couldn't update the link.");
      setS(d as State);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't update the link.");
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string | null, key: string) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(""), 2000);
    }).catch(() => {});
  }

  const enabled = s?.enabled === true;
  const btn = "text-sm text-ink-600 border border-hairline-strong hover:border-ink-400 px-3 py-2 rounded-ctl transition-colors duration-fast ease-quiet";
  const small = "text-xs text-ink-500 hover:text-ink-900 underline underline-offset-2";

  return (
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="max-w-xl">
          <h2 className="text-h2 text-ink-900">YachtPics share link — always live</h2>
          <p className="text-xs text-ink-500 mt-0.5">
            The same buyer slideshow, live whatever the broker&rsquo;s plan. Used on this boat&rsquo;s yachtpics.com page and in the reels we post.
            The broker doesn&rsquo;t see it.
          </p>
        </div>
        {s?.available && (
          <button
            role="switch"
            aria-checked={enabled}
            disabled={busy}
            onClick={toggle}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${enabled ? "bg-success-600" : "bg-ink-200"}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
            <span className="sr-only">YachtPics share link — always live</span>
          </button>
        )}
      </div>

      {s && !s.available && (
        <p className="text-xs text-warn-800 mt-3">Not set up yet — migration 20261101b_yp_share_link.sql needs to be applied.</p>
      )}
      {s?.available && !s.published && (
        <p className="text-xs text-ink-500 mt-3">Publish the Client Slideshow above and this link goes live.</p>
      )}
      {s?.available && s.published && !enabled && (
        <p className="text-xs text-ink-500 mt-3">Switched off — the link shows &ldquo;temporarily unavailable&rdquo; and yachtpics.com / new reel captions leave it out.</p>
      )}
      {s?.live && s.url && (
        <div className="mt-3">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-xs text-ink-700 bg-ink-50 border border-hairline px-2 py-1.5 rounded-ctl break-all">{s.url}</code>
            <button onClick={() => copy(s.url, "plain")} className={btn}>{copied === "plain" ? "Copied ✓" : "Copy"}</button>
            <a href={s.url} target="_blank" rel="noopener noreferrer" className={btn}>Open</a>
          </div>
          <div className="mt-2 flex gap-4 flex-wrap">
            <button onClick={() => copy(s.socialUrl, "social")} className={small}>{copied === "social" ? "Copied ✓" : "Copy for a post (?via=social)"}</button>
            <button onClick={() => copy(s.siteUrl, "site")} className={small}>{copied === "site" ? "Copied ✓" : "Copy for yachtpics.com (?via=site)"}</button>
          </div>
        </div>
      )}
      {err && <p className="text-xs text-danger-700 mt-2">{err}</p>}
    </div>
  );
}
