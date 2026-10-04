"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { REEL_STYLES, STYLE_ORDER, type StyleKey } from "@/lib/reelStyles";
import { ANGLE_LABEL, VIDEO_LED_LOOKS, VIDEO_LED_MIN_FOOTAGE, footageOf, periodLabel, type ReelServiceAngle, type ReelServiceSettings } from "@/lib/reelService";
import { probeClip } from "@/lib/reelClips";
import ReelServiceRenderer, { type RenderOutcome } from "./ReelServiceRenderer";

/** A listing video, for the footage badge and "Measure videos". */
export type BoardVideo = { id: string; listing_id: string; duration_sec: number | null; title: string | null };

export type BoardSub = { brokerId: string; name: string; enabled: boolean; reelsPerListing: number; note: string | null };
export type BoardJob = {
  id: string; broker_id: string; listing_id: string; period: string; slot: number; angle: string; look: string;
  settings: ReelServiceSettings | null; status: string; video_path: string | null; caption: string | null; error: string | null;
  rendered_at: string | null; delivered_at: string | null;
  listings: { vessel_name: string | null; year: number | null; make: string | null; model: string | null } | null;
};

const STATUS_STYLE: Record<string, string> = {
  planned: "bg-ink-100 text-ink-600",
  rendering: "bg-accent-200 text-accent-800",
  ready: "bg-success-50 text-success-700",
  delivered: "bg-ink-900 text-white",
  failed: "bg-danger-50 text-danger-700",
};

function boatName(j: BoardJob) {
  const l = j.listings;
  return l?.vessel_name || [l?.year, l?.make, l?.model].filter(Boolean).join(" ") || "Listing";
}

/**
 * "Next round": for each listing, its lowest-slot reel that is ready — so a
 * broker can be sent one reel per listing at a time (e.g. one a week).
 */
function nextRound(list: BoardJob[]): string[] {
  const best: Record<string, BoardJob> = {};
  list.forEach((j) => {
    if (j.status !== "ready") return;
    const b = best[j.listing_id];
    if (!b || j.slot < b.slot) best[j.listing_id] = j;
  });
  return Object.keys(best).map((k) => best[k].id);
}

/** Jobs grouped by listing, listings in name order, slots in order. */
function byListing(list: BoardJob[]): { listingId: string; boat: string; jobs: BoardJob[] }[] {
  const groups: { listingId: string; boat: string; jobs: BoardJob[] }[] = [];
  list.forEach((j) => {
    let g = groups.find((x) => x.listingId === j.listing_id);
    if (!g) { g = { listingId: j.listing_id, boat: boatName(j), jobs: [] }; groups.push(g); }
    g.jobs.push(j);
  });
  groups.forEach((g) => g.jobs.sort((a, b) => a.slot - b.slot));
  return groups.sort((a, b) => a.boat.localeCompare(b.boat));
}

/** Planned, failed, or stuck "rendering" from a closed tab: these can be made. */
const renderable = (s: string) => s === "planned" || s === "failed" || s === "rendering";

export default function ReelServiceBoard({ period, subs, jobs, videos }: { period: string; subs: BoardSub[]; jobs: BoardJob[]; videos: BoardVideo[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [queue, setQueue] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, { text: string; pct: number }>>({});
  const [outcomes, setOutcomes] = useState<Record<string, RenderOutcome>>({});

  const jobById = useMemo(() => {
    const m: Record<string, BoardJob> = {};
    jobs.forEach((j) => { m[j.id] = j; });
    return m;
  }, [jobs]);

  // One at a time: when nothing is rendering, take the next job off the queue.
  useEffect(() => {
    if (current || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    if (jobById[next]) setCurrent(next);
  }, [current, queue, jobById]);

  // Warn before closing the tab mid-batch.
  const rendering = !!current || queue.length > 0;
  useEffect(() => {
    if (!rendering) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [rendering]);

  async function call(label: string, url: string, body: Record<string, unknown>) {
    setBusy(label);
    setMsg("");
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error ?? `Failed (${res.status}).`);
      router.refresh();
      return d;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Something went wrong.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function plan() {
    const d = await call("plan", "/api/admin/reel-service", { action: "plan", period });
    if (d) {
      const skipped = (d.skipped ?? []) as { brokerId: string; reason: string }[];
      const names = skipped.map((s) => `${subs.find((x) => x.brokerId === s.brokerId)?.name ?? s.brokerId}: ${s.reason}`);
      setMsg(`Planned ${d.created} new reel${d.created === 1 ? "" : "s"} across ${d.listings ?? 0} listing${d.listings === 1 ? "" : "s"} for ${d.brokers} broker${d.brokers === 1 ? "" : "s"}.${names.length ? ` Skipped — ${names.join("; ")}` : ""}`);
    }
  }

  async function deliver(ids: string[]) {
    if (ids.length === 0) return;
    if (!window.confirm(`Deliver ${ids.length} reel${ids.length === 1 ? "" : "s"}? The broker (and their assistants) will be emailed.`)) return;
    const d = await call("deliver", "/api/admin/reel-service", { action: "deliver", jobIds: ids });
    if (d) setMsg(`Delivered ${d.delivered}. Emails sent: ${d.emailed}, skipped ${d.skipped} (opted out, no email, or already told), failed ${d.failed}.${d.errors?.length ? ` ${d.errors[0]}` : ""}`);
  }

  async function preview(id: string) {
    try {
      const res = await fetch(`/api/reel-service/jobs/${id}/url`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) throw new Error(d?.error ?? "No link.");
      window.open(d.url, "_blank", "noopener");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn’t open the reel.");
    }
  }

  function make(ids: string[]) {
    const fresh = ids.filter((id) => id !== current && queue.indexOf(id) < 0);
    if (fresh.length === 0) return;
    setOutcomes((o) => {
      const n = { ...o };
      fresh.forEach((id) => { delete n[id]; });
      return n;
    });
    setQueue((q) => [...q, ...fresh]);
  }

  function onFinished(id: string, o: RenderOutcome) {
    setOutcomes((prev) => ({ ...prev, [id]: o }));
    setProgress((prev) => { const n = { ...prev }; delete n[id]; return n; });
    setCurrent(null);
    router.refresh();
  }

  const allRenderable = jobs.filter((j) => renderable(j.status)).map((j) => j.id);
  const allReady = jobs.filter((j) => j.status === "ready").map((j) => j.id);
  const allNextRound = nextRound(jobs);
  const unmeasured = videos.filter((v) => !(v.duration_sec && v.duration_sec > 0));

  /**
   * Measure the listing videos whose length isn't known (in this browser,
   * reading only the file's header), save the lengths, then re-plan those
   * listings' not-yet-made reels so their segments use the real footage.
   */
  async function measureVideos() {
    if (unmeasured.length === 0) return;
    setBusy("measure");
    setMsg("");
    const durations: Record<string, number> = {};
    const failed: string[] = [];
    for (let i = 0; i < unmeasured.length; i++) {
      const v = unmeasured[i];
      setMsg(`Measuring video ${i + 1} of ${unmeasured.length}…`);
      try {
        const res = await fetch("/api/videos/signed-urls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId: v.id }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || typeof d?.url !== "string") throw new Error(d?.error ?? "no link");
        const probe = await probeClip({ url: d.url as string }, 0);
        if (probe.durationSec) durations[v.id] = Math.round(probe.durationSec * 10) / 10;
        else failed.push(v.title ?? v.id);
      } catch {
        failed.push(v.title ?? v.id);
      }
    }
    setBusy("");
    if (Object.keys(durations).length) {
      await call("measure", "/api/admin/reel-service", { action: "durations", durations });
      const listingIds = unmeasured.filter((v) => durations[v.id]).map((v) => v.listing_id).filter((x, i, a) => a.indexOf(x) === i);
      const r = await call("measure", "/api/admin/reel-service", { action: "replan_unmade", period, listingIds });
      setMsg(`Measured ${Object.keys(durations).length} video${Object.keys(durations).length === 1 ? "" : "s"}; re-planned ${r?.created ?? 0} unmade reel${r?.created === 1 ? "" : "s"}.${failed.length ? ` Couldn’t read: ${failed.join(", ")}.` : ""}`);
    } else {
      setMsg(`Couldn’t read: ${failed.join(", ")}.`);
    }
  }

  const shownSubs = subs.filter((s) => s.enabled || jobs.some((j) => j.broker_id === s.brokerId));
  const currentJob = current ? jobById[current] : null;

  return (
    <div className="mt-6">
      <div className="flex items-end gap-3 flex-wrap">
        <label className="text-xs text-ink-500">
          Month
          <input type="month" value={period} onChange={(e) => e.target.value && router.push(`/admin/reel-service?period=${e.target.value}`)}
            className="block mt-1 border border-hairline-strong rounded-ctl px-2 py-1.5 text-sm text-ink-900" />
        </label>
        <button onClick={() => void plan()} disabled={!!busy}
          className="text-sm font-medium px-4 py-2 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400 disabled:opacity-40">
          {busy === "plan" ? "Planning…" : `Plan ${periodLabel(period)}`}
        </button>
        {unmeasured.length > 0 && (
          <button onClick={() => void measureVideos()} disabled={!!busy || rendering}
            title="Read the length of each listing video (header only), then re-plan the reels not yet made so their segments use the real footage."
            className="text-sm font-medium px-4 py-2 rounded-ctl border border-warn-300 bg-warn-50 text-warn-800 disabled:opacity-40">
            {busy === "measure" ? "Measuring…" : `Measure videos (${unmeasured.length})`}
          </button>
        )}
        <button onClick={() => make(allRenderable)} disabled={allRenderable.length === 0 || !!busy}
          className="bg-accent-500 hover:bg-accent-400 disabled:opacity-40 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl">
          Make all ready-to-render ({allRenderable.length})
        </button>
        <button onClick={() => void deliver(allReady)} disabled={allReady.length === 0 || !!busy || rendering}
          className="text-sm font-semibold px-4 py-2 rounded-ctl bg-ink-950 text-white disabled:opacity-40">
          {busy === "deliver" ? "Delivering…" : `Deliver all ready (${allReady.length})`}
        </button>
        <button onClick={() => void deliver(allNextRound)} disabled={allNextRound.length === 0 || !!busy || rendering}
          title="For each listing, deliver its lowest-numbered ready reel — one per listing at a time."
          className="text-sm font-medium px-4 py-2 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400 disabled:opacity-40">
          Deliver next round ({allNextRound.length})
        </button>
        {rendering && (
          <button onClick={() => setQueue([])} className="text-xs font-semibold text-ink-500 hover:underline">
            Stop after this one{queue.length ? ` (${queue.length} waiting)` : ""}
          </button>
        )}
      </div>
      {msg && <p className="mt-3 text-sm text-ink-700">{msg}</p>}

      {currentJob && (
        <div className="mt-5 bg-white border border-hairline rounded-card shadow-elev-1 p-4 flex gap-4 items-start">
          <div className="w-[135px] shrink-0">
            <ReelServiceRenderer
              key={currentJob.id}
              job={currentJob}
              onProgress={(text, pct) => setProgress((p) => ({ ...p, [currentJob.id]: { text, pct } }))}
              onFinished={(o) => onFinished(currentJob.id, o)}
            />
          </div>
          <div className="text-sm">
            <p className="font-semibold text-ink-900">Making: {boatName(currentJob)} &middot; {ANGLE_LABEL[currentJob.angle as ReelServiceAngle] ?? currentJob.angle} &middot; {REEL_STYLES[currentJob.look as StyleKey]?.name ?? currentJob.look}</p>
            <p className="text-xs text-ink-500 mt-1">{progress[currentJob.id]?.text ?? "Starting"} &middot; {progress[currentJob.id]?.pct ?? 0}%</p>
            <p className="text-xs text-ink-400 mt-2">Keep this tab open and in front &mdash; a background tab renders very slowly.</p>
          </div>
        </div>
      )}

      {shownSubs.length === 0 && (
        <p className="mt-8 text-sm text-ink-500">No brokers enrolled yet. Turn Reel Service on from a broker&rsquo;s page.</p>
      )}

      {shownSubs.map((s) => {
        const mine = jobs.filter((j) => j.broker_id === s.brokerId);
        return (
          <div key={s.brokerId} className="mt-6 bg-white border border-hairline rounded-card shadow-elev-1">
            <div className="px-5 py-4 border-b border-hairline flex items-center justify-between gap-3 flex-wrap">
              <div>
                <a href={`/admin/brokers/${s.brokerId}`} className="text-h2 text-ink-900 hover:underline">{s.name}</a>
                <p className="text-xs text-ink-500 mt-0.5">
                  {s.enabled ? `${s.reelsPerListing} reels per listing a month` : "Paused"} &middot; {mine.length} planned for {periodLabel(period)} &middot; {mine.filter((j) => j.status === "ready" || j.status === "delivered").length} made{s.note ? ` · ${s.note}` : ""}
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => void deliver(nextRound(mine))}
                  disabled={nextRound(mine).length === 0 || !!busy || rendering}
                  className="text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong text-ink-700 disabled:opacity-40">
                  Deliver next round
                </button>
                <button onClick={() => void deliver(mine.filter((j) => j.status === "ready").map((j) => j.id))}
                  disabled={!mine.some((j) => j.status === "ready") || !!busy || rendering}
                  className="text-xs font-semibold px-3 py-1.5 rounded-ctl border border-hairline-strong text-ink-700 disabled:opacity-40">
                  Deliver all ready
                </button>
              </div>
            </div>
            {mine.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-400">Nothing planned for this month yet.</p>
            ) : (
              byListing(mine).map((g) => (
              <div key={g.listingId} className="border-t border-hairline first:border-t-0">
                <div className="px-5 pt-3 pb-2 flex items-center justify-between gap-3 bg-ink-50">
                  <p className="text-sm font-semibold text-ink-900 flex items-center gap-2 flex-wrap">
                    {g.boat}
                    <FootageBadge videos={videos.filter((v) => v.listing_id === g.listingId)} />
                  </p>
                  <p className="text-xs text-ink-500 tabular-nums">
                    {g.jobs.filter((j) => j.status === "ready" || j.status === "delivered").length} of {g.jobs.length} made
                    {" · "}{g.jobs.filter((j) => j.status === "delivered").length} delivered
                  </p>
                </div>
              <ul className="divide-y divide-hairline">
                {g.jobs.map((j) => {
                  const st = j.settings;
                  const look = j.look as StyleKey;
                  const segs = st?.segments ?? [];
                  const vSec = st?.estVideoSec ?? segs.reduce((a, x) => a + (x.durSec ?? 0), 0);
                  const pSec = st?.estPhotoSec ?? 0;
                  const pct = vSec + pSec > 0 ? Math.round((vSec / (vSec + pSec + 3)) * 100) : 0;
                  const lookOptions = st?.videoLed ? VIDEO_LED_LOOKS.concat(VIDEO_LED_LOOKS.indexOf(look) < 0 ? [look] : []) : STYLE_ORDER;
                  const out = outcomes[j.id];
                  const waiting = queue.indexOf(j.id) >= 0;
                  const isCurrent = current === j.id;
                  return (
                    <li key={j.id} className="px-5 py-3 flex items-start gap-4 flex-wrap">
                      <div className="flex-1 min-w-[14rem]">
                        <p className="text-sm font-semibold text-ink-900">
                          #{j.slot} {ANGLE_LABEL[j.angle as ReelServiceAngle] ?? j.angle}{st?.launch ? <span className="font-normal text-accent-700"> &middot; launch</span> : null}
                        </p>
                        <p className="text-xs text-ink-500 mt-0.5">
                          <span className={st?.videoLed ? "font-semibold text-ink-700" : ""}>{st?.videoLed ? "Video-led" : "Photo-led"}</span>
                          {" · "}video {Math.round(vSec)} s ({segs.length} segment{segs.length === 1 ? "" : "s"}) / {st?.photoIds?.length ?? 0} photos
                          {" · "}~{pct}% video{" · "}~{Math.round(vSec + pSec + 3)} s
                        </p>
                        {j.error && j.status === "failed" && <p className="text-xs text-danger-700 mt-1">{j.error}</p>}
                        {out && out.ok && <p className="text-xs text-success-700 mt-1">Made &middot; {out.note}</p>}
                        {out && !out.ok && <p className="text-xs text-danger-700 mt-1">{out.error}</p>}
                        {waiting && <p className="text-xs text-ink-400 mt-1">Waiting to render&hellip;</p>}
                        {isCurrent && <p className="text-xs text-accent-800 mt-1">{progress[j.id]?.text ?? "Starting"} &middot; {progress[j.id]?.pct ?? 0}%</p>}
                      </div>
                      <select value={look} disabled={j.status === "delivered" || isCurrent || waiting || !!busy}
                        onChange={(e) => void call("look", `/api/admin/reel-service/jobs/${j.id}`, { action: "look", look: e.target.value })}
                        className="text-xs border border-hairline-strong rounded-ctl px-2 py-1.5 text-ink-800">
                        {lookOptions.map((k) => <option key={k} value={k}>{REEL_STYLES[k].name}</option>)}
                      </select>
                      <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${STATUS_STYLE[j.status] ?? "bg-ink-100 text-ink-600"}`}>{j.status}</span>
                      <div className="flex gap-2 flex-wrap">
                        {j.status !== "delivered" && (
                          <button onClick={() => make([j.id])} disabled={isCurrent || waiting}
                            className="text-xs font-semibold px-3 py-1.5 rounded-ctl bg-accent-500 hover:bg-accent-400 text-ink-950 disabled:opacity-40">
                            {j.status === "ready" ? "Make again" : "Make"}
                          </button>
                        )}
                        {j.status !== "delivered" && (
                          <button onClick={() => void call("replan", `/api/admin/reel-service/jobs/${j.id}`, { action: "replan" })}
                            disabled={isCurrent || waiting || !!busy}
                            className="text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong text-ink-700 disabled:opacity-40">
                            Re-plan
                          </button>
                        )}
                        {j.video_path && (
                          <button onClick={() => void preview(j.id)} className="text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong text-ink-700">
                            Preview
                          </button>
                        )}
                        {j.status === "ready" && (
                          <button onClick={() => void deliver([j.id])} disabled={!!busy || rendering}
                            className="text-xs font-semibold px-3 py-1.5 rounded-ctl bg-ink-950 text-white disabled:opacity-40">
                            Deliver
                          </button>
                        )}
                      </div>
                      {j.caption && (
                        <details className="w-full">
                          <summary className="text-xs text-ink-500 cursor-pointer">Caption</summary>
                          <p className="text-xs text-ink-700 whitespace-pre-line mt-1">{j.caption}</p>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
              </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Footage on a listing: "Needs more video" (with the seconds) when there's
 * under VIDEO_LED_MIN_FOOTAGE of usable video, "not measured" when some
 * video's length isn't known yet, otherwise the footage it has.
 */
function FootageBadge({ videos }: { videos: BoardVideo[] }) {
  const f = footageOf(videos.map((v) => ({ id: v.id, display_order: null, duration_sec: v.duration_sec, title: v.title })));
  const secs = f.measuredSec ?? 0;
  if (videos.length === 0 || (f.unmeasured === 0 && f.usableSec < VIDEO_LED_MIN_FOOTAGE)) {
    return (
      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-danger-50 text-danger-700">
        Needs more video &middot; {videos.length === 0 ? "no video" : `${secs} s footage`}
      </span>
    );
  }
  if (f.unmeasured > 0) {
    return (
      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-warn-50 text-warn-800">
        {f.unmeasured} video{f.unmeasured === 1 ? "" : "s"} not measured{secs ? ` · ${secs} s measured` : ""}
      </span>
    );
  }
  return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-success-50 text-success-700">{secs} s footage</span>;
}
