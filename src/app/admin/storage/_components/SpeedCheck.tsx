"use client";

import { useEffect, useState } from "react";

/**
 * Speed check (Admin → Storage): times, in this browser, what a broker or
 * buyer waits for on one listing — so the Supabase and R2 paths can be
 * compared before and after the switch. Downloads are timed to their first
 * byte and then stopped (nothing is saved). Nothing is written anywhere.
 */

type Result = { label: string; ms: number | null; note?: string };
type Info = { photos: { id: string; backend: string }[]; counts: { supabase: number; r2: number }; slideFull: string | null; signMs: number };

const now = () => performance.now();

function loadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image failed"));
    img.src = url;
  });
}

/** Time from request to response headers (TTFB), then abort the body. */
async function ttfb(url: string): Promise<number> {
  const ctl = new AbortController();
  const t0 = now();
  const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
  const ms = now() - t0;
  ctl.abort();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ms;
}

async function signDownload(listingId: string, ids: string[], size: string): Promise<{ urls: Record<string, string>; ms: number }> {
  const t0 = now();
  const res = await fetch(`/api/listings/${listingId}/photos/download-urls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photoIds: ids, size }),
  });
  const d = await res.json().catch(() => ({}));
  return { urls: (d?.urls ?? {}) as Record<string, string>, ms: now() - t0 };
}

export default function SpeedCheck() {
  const [listings, setListings] = useState<{ id: string; name: string }[]>([]);
  const [listingId, setListingId] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [backendNote, setBackendNote] = useState("");

  useEffect(() => {
    fetch("/api/admin/storage/speed", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setListings(d.listings ?? []))
      .catch(() => {});
  }, []);

  async function run() {
    if (!listingId || running) return;
    setRunning(true);
    setResults([]);
    const out: Result[] = [];
    const push = (r: Result) => { out.push(r); setResults([...out]); };
    try {
      const info = (await fetch(`/api/admin/storage/speed?listingId=${listingId}`, { cache: "no-store" }).then((r) => r.json())) as Info;
      setBackendNote(`${info.counts?.supabase ?? 0} photos on Supabase · ${info.counts?.r2 ?? 0} on R2 · tested photo: ${info.photos?.[0]?.backend ?? "—"}`);

      // 1. Tile grid: the thumbnails route, then the first 12 tiles loaded.
      let t0 = now();
      const thumbs = await fetch("/api/thumbs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, width: 400 }),
      }).then((r) => r.json());
      const routeMs = now() - t0;
      const tileUrls = Object.values((thumbs?.urls ?? {}) as Record<string, string>).slice(0, 12);
      await Promise.allSettled(tileUrls.map(loadImage));
      push({ label: "Tile grid (thumb links + first 12 tiles)", ms: now() - t0, note: `links ${Math.round(routeMs)} ms` });

      // 2. Slideshow opening slide.
      if (info.slideFull) {
        t0 = now();
        try {
          await loadImage(info.slideFull);
          push({ label: "Slideshow first image (2000 px)", ms: now() - t0, note: `signing on the server ${info.signMs} ms` });
        } catch {
          push({ label: "Slideshow first image (2000 px)", ms: null, note: "didn't load" });
        }
      } else {
        push({ label: "Slideshow first image (2000 px)", ms: null, note: "no link (photo not ready?)" });
      }

      // 3. Single downloads, time to first byte.
      const firstId = info.photos?.[0]?.id;
      for (const [size, label] of [["full", "Full"], ["web", "Web & MLS"], ["social", "Social"]] as const) {
        if (!firstId) break;
        try {
          const s = await signDownload(listingId, [firstId], size);
          const url = s.urls[firstId];
          if (!url) {
            push({ label: `Download start — ${label}`, ms: null, note: "no link" });
            continue;
          }
          const b = await ttfb(url);
          push({ label: `Download start — ${label}`, ms: s.ms + b, note: `link ${Math.round(s.ms)} ms + first byte ${Math.round(b)} ms` });
        } catch (e) {
          push({ label: `Download start — ${label}`, ms: null, note: e instanceof Error ? e.message : "failed" });
        }
      }

      // 4. Zip start: links for up to 5 photos, then their first bytes.
      const ids = (info.photos ?? []).map((p) => p.id);
      if (ids.length) {
        try {
          const s = await signDownload(listingId, ids, "full");
          const urls = ids.map((id) => s.urls[id]).filter(Boolean);
          t0 = now();
          const firsts = await Promise.allSettled(urls.map(ttfb));
          const firstDone = Math.min(...firsts.map((f) => (f.status === "fulfilled" ? f.value : Infinity)));
          push({
            label: `Zip start (${urls.length} full-size photos)`,
            ms: Number.isFinite(firstDone) ? s.ms + firstDone : null,
            note: `links ${Math.round(s.ms)} ms · all ${urls.length} started in ${Math.round(now() - t0)} ms`,
          });
        } catch (e) {
          push({ label: "Zip start", ms: null, note: e instanceof Error ? e.message : "failed" });
        }
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-ink-900">Speed check</h2>
      <p className="text-xs text-ink-600">
        Times what a broker or buyer waits for on one listing, from this browser. Downloads are stopped after their
        first byte; nothing is saved. Run it twice — the first run includes cold caches.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={listingId}
          onChange={(e) => setListingId(e.target.value)}
          className="border border-hairline rounded-ctl px-3 py-1.5 text-sm max-w-xs"
        >
          <option value="">Pick a listing…</option>
          {listings.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <button
          onClick={run}
          disabled={!listingId || running}
          className="bg-ink-900 hover:bg-ink-800 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-ctl"
        >
          {running ? "Timing…" : "Run"}
        </button>
      </div>
      {backendNote && <p className="text-xs text-ink-500">{backendNote}</p>}
      {results.length > 0 && (
        <div className="bg-white border border-hairline rounded-card p-4">
          {results.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-4 py-1.5 border-b border-hairline last:border-0">
              <div className="min-w-0">
                <p className="text-sm text-ink-900">{r.label}</p>
                {r.note && <p className="text-xs text-ink-500">{r.note}</p>}
              </div>
              <p className="text-sm tabular-nums text-ink-900 shrink-0">{r.ms == null ? "—" : `${Math.round(r.ms)} ms`}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
