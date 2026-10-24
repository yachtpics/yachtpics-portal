"use client";

import { useEffect, useState } from "react";

/**
 * "Delivered by YachtPics" — on a listing's Reel page, the Reel Service reels
 * delivered for THIS listing (Oct 24), newest first, each with Play and
 * Download. Links are fetched fresh from /api/reel-service/jobs/[id]/url
 * (the same route Your Reels uses). Renders nothing when there are none.
 */

type Delivered = { id: string; angle: string; caption: string; deliveredAt: string | null };

async function links(id: string): Promise<{ url: string; downloadUrl: string }> {
  const res = await fetch(`/api/reel-service/jobs/${id}/url`, { cache: "no-store" });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.url) throw new Error(d?.error ?? "Couldn’t get a link to this reel.");
  return d;
}

function Item({ reel }: { reel: Delivered }) {
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function play() {
    setErr(""); setBusy(true);
    try { setSrc((await links(reel.id)).url); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn’t play it."); } finally { setBusy(false); }
  }
  async function download() {
    setErr("");
    try {
      const l = await links(reel.id);
      const a = document.createElement("a");
      a.href = l.downloadUrl; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { setErr(e instanceof Error ? e.message : "Download failed."); }
  }

  return (
    <div className="w-40 shrink-0">
      <div className="aspect-[9/16] rounded-lg overflow-hidden bg-ink-900 flex items-center justify-center">
        {src ? (
          <video src={src} controls autoPlay playsInline className="w-full h-full object-cover" />
        ) : (
          <button type="button" onClick={play} disabled={busy} className="text-white text-sm font-semibold px-3 py-2 rounded-ctl bg-white/10 hover:bg-white/20 disabled:opacity-50">
            {busy ? "Loading…" : "▶ Play"}
          </button>
        )}
      </div>
      <p className="mt-1.5 text-xs font-medium text-ink-900">{reel.angle}</p>
      {reel.deliveredAt && (
        <p className="text-[11px] text-ink-500">{new Date(reel.deliveredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}</p>
      )}
      <button type="button" onClick={download} className="mt-1 text-xs font-semibold text-accent-700 hover:underline">Download</button>
      {err && <p className="text-[11px] text-danger-700 mt-1">{err}</p>}
    </div>
  );
}

export default function DeliveredReelStrip({ listingId }: { listingId: string }) {
  const [reels, setReels] = useState<Delivered[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/reel-service/listing?listingId=${encodeURIComponent(listingId)}&delivered=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { delivered?: Delivered[] } | null) => { if (!cancelled && d?.delivered) setReels(d.delivered); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [listingId]);

  if (reels.length === 0) return null;
  return (
    <div className="px-6 pt-8 max-w-3xl mx-auto">
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <p className="label-caps text-ink-500">Delivered by YachtPics</p>
          <a href="/dashboard/reels" className="text-xs font-medium text-accent-700 hover:underline">All your reels, with captions &rarr;</a>
        </div>
        <div className="mt-3 flex gap-4 overflow-x-auto pb-1">
          {reels.map((r) => <Item key={r.id} reel={r} />)}
        </div>
      </div>
    </div>
  );
}
