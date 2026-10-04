"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadListingReelSource } from "@/lib/listingReelSource";
import { uploadVideoToPrivateBucket } from "@/lib/uploadListingVideo";
import { probeClip, type ClipLength } from "@/lib/reelClips";
import { REEL_STYLES, type StyleKey } from "@/lib/reelStyles";
import ReelMaker, { type ReelAutoConfig, type ReelAutoItem, type ReelAutoProgress, type ReelSource } from "@/components/ReelMaker";
import type { ReelServiceSettings } from "@/lib/reelService";

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
        const clipItems: (ReelAutoItem | null)[] = [];
        const clips = Array.isArray(st.clips) ? st.clips : [];
        for (let i = 0; i < clips.length; i++) {
          const c = clips[i];
          onProgress(`Measuring clip ${i + 1} of ${clips.length}`, 0);
          const v = (source.videos ?? []).find((x) => x.id === c.videoId);
          if (!v) { clipItems.push(null); notes.push(`Clip ${i + 1}: the video is no longer on the listing.`); continue; }
          try {
            const src = await v.open();
            const probe = await probeClip(src, 0);
            const len = (c.lengthSec ?? 3) as ClipLength;
            const dur = probe.durationSec ?? 0;
            if (dur > 0 && dur < len + 0.3) { clipItems.push(null); notes.push(`Clip ${i + 1}: the video is shorter than ${len}s.`); continue; }
            const span = Math.max(0, dur - len - 0.2);
            const frac = Math.min(1, Math.max(0, Number(c.inFrac) || 0.35));
            const inSec = dur > 0 ? Math.round(frac * span * 10) / 10 : 0;
            clipItems.push({ videoId: v.id, inSec, lengthSec: len });
          } catch (e) {
            clipItems.push(null);
            notes.push(`Clip ${i + 1}: ${e instanceof Error ? e.message : "couldn’t be read"} (left out).`);
          }
        }

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
          },
          notes,
        });
      } catch (e) {
        await fail(e instanceof Error ? e.message : "Couldn’t prepare the reel.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onDone(r: { blob: Blob; seconds: number; clipNote: string }) {
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
      const notes = (prepared?.notes ?? []).concat(r.clipNote ? [r.clipNote] : []);
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
