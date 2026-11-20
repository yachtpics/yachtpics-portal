"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import JobProgress, { fetchActiveJob, startJob } from "@/components/admin/JobProgress";
import type { JobRow } from "@/lib/jobs/types";
import { codecLabel } from "@/lib/videoCodec";
import { formatDateET } from "@/lib/datetime";

type Counts = { total: number; checked: number; unchecked: number; h265: number; prores: number; unknown: number };
type Risky = {
  id: string;
  listingId: string | null;
  vesselName: string;
  filename: string;
  codec: string;
  width: number | null;
  height: number | null;
  createdAt: string;
};

// "Video formats" (Admin dashboard → Website maintenance). A listing video in
// H.265 can play as sound with a black picture on some Windows laptops, and
// ProRes plays in no browser. This card counts stored videos by format, runs
// the `video_codec_scan` job (reads two small slices of each original; never
// changes a file) and lists the risky ones with a link to their listing.
export default function VideoFormats() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [risky, setRisky] = useState<Risky[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [job, setJob] = useState<JobRow | null>(null);
  const [starting, setStarting] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/videos/codecs", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (d.notReady) {
        setNotReady(true);
        setError(String(d.error ?? "The video format columns aren't in the database yet."));
        return;
      }
      if (!r.ok) throw new Error(d.error ?? "Couldn't load the video formats.");
      setNotReady(false);
      setCounts(d.counts as Counts);
      setRisky((d.risky ?? []) as Risky[]);
      setTruncated(!!d.truncated);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the video formats.");
    }
  }, []);

  useEffect(() => {
    load();
    fetchActiveJob("video_codec_scan").then((j) => {
      if (j) setJob(j);
    });
  }, [load]);

  const jobActive = !!job && (job.status === "queued" || job.status === "running");

  async function startScan(recheckUnknown: boolean) {
    if (starting || jobActive) return;
    setStarting(true);
    setJobError(null);
    const r = await startJob("video_codec_scan", recheckUnknown ? { recheckUnknown: true } : {});
    setStarting(false);
    if (r.job) setJob(r.job);
    else setJobError(r.notReady ? "Background jobs aren't set up on this database yet." : r.error ?? "Couldn't start the check.");
  }

  const size = (v: Risky) => (v.width && v.height ? `${v.width}×${v.height}` : "—");

  return (
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink-900 mb-1">Video formats</h3>
          {error ? (
            <p className={`text-sm ${notReady ? "text-warn-700" : "text-danger-700"}`}>{error}</p>
          ) : (
            <p className="text-ink-500 text-sm">
              {counts === null
                ? "Counting the stored videos…"
                : `${counts.checked} checked · ${counts.unchecked} not yet checked · ${counts.h265} H.265 · ${counts.prores} ProRes · ${counts.unknown} unknown.`}
            </p>
          )}
          <p className="text-ink-400 text-xs mt-1">
            H.265 (HEVC) can play as sound with a black picture on some Windows laptops; ProRes doesn&rsquo;t play in a browser at all. The check reads a small part of each file and never changes it. To fix one, export it as H.264 and replace it on the listing.
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {counts && counts.unknown > 0 && counts.unchecked === 0 && (
            <button
              onClick={() => startScan(true)}
              disabled={jobActive || starting || notReady}
              className="bg-white hover:border-ink-400 hover:text-ink-900 disabled:opacity-50 text-ink-700 text-sm font-medium px-4 py-2 rounded-ctl border border-hairline-strong transition-colors duration-fast ease-quiet"
            >
              Re-check unknown
            </button>
          )}
          <button
            onClick={() => startScan(false)}
            disabled={jobActive || starting || notReady || (counts !== null && counts.unchecked === 0)}
            className="bg-ink-950 hover:bg-ink-800 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
          >
            {jobActive || starting ? "Checking…" : "Check stored videos"}
          </button>
        </div>
      </div>

      {jobError && (
        <div role="alert" className="mt-4 flex items-start justify-between gap-3 bg-danger-50 border border-danger-200 text-danger-700 text-sm rounded-ctl px-3 py-2">
          <p>{jobError}</p>
          <button onClick={() => setJobError(null)} className="shrink-0 font-bold leading-none" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {job && (
        <div className="mt-4 border-t border-hairline pt-4">
          <JobProgress
            job={job}
            compact
            onFinished={(j) => {
              setJob(j);
              load();
            }}
          />
        </div>
      )}

      {risky.length > 0 && (
        <div className="mt-4 border-t border-hairline pt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-400 text-xs">
                <th className="font-medium pb-2 pr-3">Boat</th>
                <th className="font-medium pb-2 pr-3">File</th>
                <th className="font-medium pb-2 pr-3">Format</th>
                <th className="font-medium pb-2 pr-3">Size</th>
                <th className="font-medium pb-2 pr-3">Uploaded</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {risky.map((v) => (
                <tr key={v.id} className="border-t border-hairline">
                  <td className="py-2 pr-3 text-ink-900">{v.vesselName}</td>
                  <td className="py-2 pr-3 text-ink-700 break-all">{v.filename}</td>
                  <td className="py-2 pr-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-warn-50 border border-warn-200 text-warn-700 whitespace-nowrap">
                      {codecLabel(v.codec)}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-ink-500 tabular-nums whitespace-nowrap">{size(v)}</td>
                  <td className="py-2 pr-3 text-ink-500 whitespace-nowrap">{formatDateET(v.createdAt)}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {v.listingId && (
                      <Link href={`/admin/listings/${v.listingId}`} className="text-accent-700 hover:text-accent-600 text-xs font-medium">
                        Open listing →
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {truncated && <p className="text-xs text-ink-400 mt-2">Showing the newest 200.</p>}
        </div>
      )}
    </div>
  );
}
