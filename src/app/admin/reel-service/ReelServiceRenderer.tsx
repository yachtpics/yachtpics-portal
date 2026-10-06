"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadListingReelSource } from "@/lib/listingReelSource";
import { uploadVideoToPrivateBucket } from "@/lib/uploadListingVideo";
import { detectShots, parseShotInfo, probeClip, rememberShots, rememberedShots, type ClipLength, type ShotInfo } from "@/lib/reelClips";
import { REEL_STYLES, type StyleKey } from "@/lib/reelStyles";
import ReelMaker, { type ReelAutoConfig, type ReelAutoItem, type ReelAutoProgress, type ReelSource } from "@/components/ReelMaker";
import { jobMusic, type ReelServiceSettings } from "@/lib/reelService";

export type RenderJob = { id: string; listing_id: string; look: string; settings: ReelServiceSettings | null };
export type RenderOutcome = { ok: true; note: string } | { ok: false; error: string };

async function postJob(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/admin/reel-service/jobs/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error ?? `Request failed (${res.status}).`);
}

/**
 * Renders ONE Reel Service job, headless:
 *   1. builds the listing's ReelSource exactly as the Listing Reel page does;
 *   2. measures each planned clip's video and turns its planned position
 *      (a fraction of the video) into an in-point — a clip that can't be read
 *      is dropped with a note rather than failing the reel;
 *   3. mounts <ReelMaker auto=…>, which renders once and hands back the MP4;
 *   4. uploads it to R2 (reel-service/{broker}/{period}/{job}.mp4) and marks
 *      the job ready.
 * Any failure marks the job failed and reports back; the batch moves on.
 */
export default function ReelServiceRenderer({
  job,
  onProgress,
  onFinished,
}: {
  job: RenderJob;
  onProgress: (text: string, pct: number) => void;
  onFinished: (o: RenderOutcome) => void;
}) {
  const [prepared, setPrepared] = useState<{ source: ReelSource; config: ReelAutoConfig; notes: string[] } | null>(null);
  const finishedRef = useRef(false);

  function finish(o: RenderOutcome) {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinished(o);
  }

  async function fail(message: string) {
    try { await postJob(job.id, { action: "failed", error: message }); } catch { /* reported below anyway */ }
    finish({ ok: false, error: message });
  }

  useEffect(() => {
    (async () => {
      try {
        const st = job.settings;
        if (!st || !Array.isArray(st.order) || st.order.length === 0) throw new Error("This job has no plan. Re-plan it.");
        const look = job.look as StyleKey;
        if (!REEL_STYLES[look]) throw new Error(`Unknown look “${job.look}”.`);
        await postJob(job.id, { action: "rendering" });
        onProgress("Loading listing", 0);
        const supabase = createClient();
        const source = await loadListingReelSource(supabase, job.listing_id);
        if (!source) throw new Error("The listing couldn’t be loaded.");
        if (!source.isAdmin) throw new Error("Only an admin can render Reel Service reels.");

        const notes: string[] = [];
        // Segments: measure each source video once (its length turns the
        // planned position into seconds), then lay each video's segments out
        // in time order without overlaps. A video that can't be read drops
        // its segments with a note; the reel still renders.
        const segs = Array.isArray(st.segments) ? st.segments : [];
        const durations: Record<string, number | null> = {};
        const measured: Record<string, number> = {};
        const vids = segs.map((x) => x.videoId).filter((v, i, a) => a.indexOf(v) === i);
        for (let i = 0; i < vids.length; i++) {
          onProgress(`Measuring video ${i + 1} of ${vids.length}`, 0);
          const v = (source.videos ?? []).find((x) => x.id === vids[i]);
          if (!v) { durations[vids[i]] = null; notes.push("A planned video is no longer on the listing."); continue; }
          try {
            const probe = await probeClip(await v.open(), 0);
            durations[vids[i]] = probe.durationSec ?? null;
            if (probe.durationSec) measured[v.id] = Math.round(probe.durationSec * 10) / 10;
          } catch (e) {
            durations[vids[i]] = null;
            notes.push(`${v.title}: ${e instanceof Error ? e.message : "couldn’t be read"} (its segments were left out).`);
          }
        }
        // Remember the lengths for the planner (best effort).
        if (Object.keys(measured).length) {
          void fetch("/api/admin/reel-service", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "durations", durations: measured }),
          }).catch(() => {});
        }
        // Shots (edit points) of each video, so no segment crosses an edit:
        // stored on the video (videos.shot_cuts) → found earlier this session
        // → found now (decodes the whole video once at low resolution) and
        // stored for next time. Without them the plan is used as is.
        const shotsBy: Record<string, [number, number][] | null> = {};
        try {
          const { data, error } = await supabase.from("videos").select("id, shot_cuts").in("id", vids);
          if (!error && data) (data as { id: string; shot_cuts: unknown }[]).forEach((r) => {
            const info = parseShotInfo(r.shot_cuts);
            if (info) { shotsBy[r.id] = info.shots; rememberShots(r.id, info); }
          });
        } catch { /* column not there yet: detect below */ }
        const found: Record<string, ShotInfo> = {};
        for (let i = 0; i < vids.length; i++) {
          const id = vids[i];
          if (shotsBy[id] || !durations[id]) continue;
          const cached = rememberedShots(id);
          if (cached) { shotsBy[id] = cached.shots; continue; }
          const v = (source.videos ?? []).find((x) => x.id === id);
          if (!v) continue;
          try {
            onProgress(`Finding the edits in video ${i + 1} of ${vids.length}`, 0);
            const info = await detectShots(await v.open(), (pct) => onProgress(`Finding the edits in video ${i + 1} of ${vids.length}`, pct));
            shotsBy[id] = info.shots;
            rememberShots(id, info);
            found[id] = info;
          } catch (e) {
            notes.push(`Couldn’t find the edits in ${v.title} (${e instanceof Error ? e.message : "error"}); segments used as planned.`);
          }
        }
        if (Object.keys(found).length) {
          void fetch("/api/admin/reel-service", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "shots", shots: found }),
          }).catch(() => {});
        }

        const resolved: (ReelAutoItem | null)[] = segs.map(() => null);
        const lastEnd: Record<string, number> = {};
        // Walk each video's segments in time order so a later one never overlaps an earlier one.
        const byTime = segs.map((x, i) => ({ x, i })).sort((a, b) => (a.x.videoId === b.x.videoId ? a.x.inFrac - b.x.inFrac : a.x.videoId < b.x.videoId ? -1 : 1));
        let dropped = 0;
        // Video-led: each segment keeps playing through its crossfade out, so
        // it needs that much more footage after it.
        const tail = st.videoLed && st.clipJoinSec ? st.clipJoinSec : 0;
        let moved = 0;
        byTime.forEach(({ x, i }) => {
          const d = durations[x.videoId];
          if (d === undefined || d === null) { if (d === null) dropped++; return; }
          let len = (x.durSec ?? 3) as ClipLength;
          const lo = Math.max(d * 0.03, lastEnd[x.videoId] ?? 0);
          const hi = d * 0.97 - len - tail;
          // The planner's seconds when it knew the length; otherwise its fraction.
          const planned = typeof x.inSec === "number" ? x.inSec : Math.min(1, Math.max(0, Number(x.inFrac) || 0)) * d;
          let start = Math.max(lo, planned);
          const shots = shotsBy[x.videoId];
          if (shots && shots.length) {
            // Keep the segment (and the tail it plays through its fade out)
            // inside ONE shot, 0.3 s clear of each edit: the shot it starts
            // in if it fits, else the nearest shot with room (shortened to
            // whole seconds, not under 3, if the shot is short).
            const M = 0.3;
            const stretches = shots
              .map((sh) => [Math.max(sh[0] + M, d * 0.03, lo), Math.min(sh[1] - M, d * 0.97)] as [number, number])
              .filter((r) => r[1] - r[0] >= 3 + tail);
            const dist = (r: [number, number]) => (start < r[0] ? r[0] - start : start > r[1] ? start - r[1] : 0);
            const full = stretches.filter((r) => r[1] - r[0] >= len + tail).sort((a, b) => dist(a) - dist(b));
            const any = stretches.slice().sort((a, b) => dist(a) - dist(b));
            const pickFull = full[0];
            const pickAny = any[0];
            // Prefer a full-length fit unless it is much farther than a shorter one.
            const r = pickFull && (!pickAny || dist(pickFull) <= dist(pickAny) + 10) ? pickFull : pickAny;
            if (!r) { dropped++; return; }
            const room = r[1] - r[0];
            if (room < len + tail) len = Math.max(3, Math.floor(room - tail)) as ClipLength;
            const fixed = Math.min(Math.max(start, r[0]), r[1] - len - tail);
            if (Math.abs(fixed - start) > 0.05 || len !== x.durSec) moved++;
            start = fixed;
          } else if (start > hi) { dropped++; return; }
          start = Math.round(start * 100) / 100;
          lastEnd[x.videoId] = start + len + tail + 0.2;
          resolved[i] = { videoId: x.videoId, inSec: start, lengthSec: len };
        });
        if (moved) notes.push(`${moved} segment${moved === 1 ? "" : "s"} moved or shortened to stay inside one shot.`);
        if (dropped) notes.push(`${dropped} segment${dropped === 1 ? "" : "s"} left out (video too short or unreadable).`);
        const clipItems = resolved;

        const order: ReelAutoItem[] = [];
        st.order.forEach((it) => {
          if (typeof it !== "string") return;
          if (it.indexOf("clip:") === 0) {
            const k = Number(it.slice(5));
            const ci = clipItems[k];
            if (ci) order.push(ci);
          } else {
            order.push(it);
          }
        });
        setPrepared({
          source,
          config: {
            styleKey: look,
            length: st.length ?? "full",
            fit: st.fit ?? "whole",
            order,
            showPrice: st.showPrice !== false,
            showLocation: st.showLocation !== false,
            videoFirst: st.videoLed === true,
            clipFill: st.videoLed === true,
            ...(st.videoLed && st.photoHoldSec ? { photoHold: st.photoHoldSec } : {}),
            ...(st.videoLed && st.clipJoinSec ? { clipJoin: st.clipJoinSec } : {}),
            // Music is ON by default for Reel Service (jobs planned before it
            // existed play "auto"); "off" renders silent.
            music: (() => { const m = jobMusic(st, job.id); return m.mood === "off" ? null : m; })(),
          },
          notes,
        });
      } catch (e) {
        await fail(e instanceof Error ? e.message : "Couldn’t prepare the reel.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onDone(r: { blob: Blob; seconds: number; clipNote: string; musicNote?: string }) {
    try {
      onProgress("Uploading", 0);
      const file = new File([r.blob], `${job.id}.mp4`, { type: "video/mp4" });
      const up = await uploadVideoToPrivateBucket({
        file,
        target: { reelServiceJobId: job.id },
        onProgress: (pct) => onProgress("Uploading", pct),
      });
      if (!up.ok) throw new Error(up.error);
      await postJob(job.id, { action: "rendered", path: up.path });
      const notes = (prepared?.notes ?? []).concat(r.clipNote ? [r.clipNote] : []).concat(r.musicNote ? [r.musicNote] : []);
      finish({ ok: true, note: [`${r.seconds}s`, ...notes].join(" · ") });
    } catch (e) {
      await fail(e instanceof Error ? e.message : "Upload failed.");
    }
  }

  function onAutoProgress(p: ReelAutoProgress) {
    onProgress(p.phase === "rendering" ? "Encoding" : p.phase === "depth" ? "Reading depth" : "Loading photos", p.pct);
  }

  if (!prepared) return <p className="text-xs text-ink-400">Preparing&hellip;</p>;
  return (
    <ReelMaker
      source={prepared.source}
      auto={prepared.config}
      onAutoProgress={onAutoProgress}
      onAutoDone={(r) => void onDone(r)}
      onAutoError={(m) => void fail(m)}
    />
  );
}
