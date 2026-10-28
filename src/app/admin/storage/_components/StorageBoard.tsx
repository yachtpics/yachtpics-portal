"use client";

import { useCallback, useEffect, useState } from "react";
import JobProgress, { fetchActiveJob, startJob } from "@/components/admin/JobProgress";
import type { JobKind, JobRow } from "@/lib/jobs/types";

type Stats = {
  supabase_count: number;
  supabase_bytes: number;
  supabase_missing: number;
  r2_count: number;
  r2_bytes: number;
  r2_with_supabase_copy_count: number;
  r2_with_supabase_copy_bytes: number;
  orphan_count: number;
  orphan_bytes: number;
  derivative_bytes: number;
  site_count: number;
  site_bytes: number;
  site_switched_count: number;
  site_switched_bytes: number;
};
type Config = { newUploads: string; websitePhotos: string; r2Photos: boolean; r2PhotoBucket: string; r2Public: boolean };

const gb = (b: number) => `${(Number(b || 0) / 1e9).toFixed(1)} GB`;
const n = (x: number) => Number(x || 0).toLocaleString("en-US");

function Row({ label, count, bytes, hint }: { label: string; count: number; bytes: number; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-hairline last:border-0">
      <div className="min-w-0">
        <p className="text-sm text-ink-900">{label}</p>
        {hint && <p className="text-xs text-ink-500 mt-0.5">{hint}</p>}
      </div>
      <p className="text-sm text-ink-900 tabular-nums shrink-0">
        {n(count)} · {gb(bytes)}
      </p>
    </div>
  );
}

/** Start/Pause for one job kind, with its live progress card. */
function JobControl({
  kind,
  startLabel,
  params,
  confirmText,
  disabled,
  onChange,
}: {
  kind: JobKind;
  startLabel: string;
  params?: Record<string, unknown>;
  confirmText?: string;
  disabled?: boolean;
  onChange: () => void;
}) {
  const [job, setJob] = useState<JobRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    fetchActiveJob(kind).then((j) => { if (j) setJob(j); });
  }, [kind]);

  async function start() {
    if (busy || disabled) return;
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setNote(null);
    const r = await startJob(kind, params ?? {});
    setBusy(false);
    if (r.job) setJob(r.job);
    else setNote(r.error);
  }

  const active = job && (job.status === "queued" || job.status === "running");
  return (
    <div className="space-y-3">
      {!active && (
        <button
          onClick={start}
          disabled={busy || disabled}
          className="bg-ink-900 hover:bg-ink-800 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
        >
          {busy ? "Starting…" : startLabel}
        </button>
      )}
      {job && <JobProgress key={job.id} job={job} onFinished={() => onChange()} />}
      {note && <p className="text-xs text-danger-700">{note}</p>}
    </div>
  );
}

/** A cleanup that deletes files: the admin types the phrase before the button wakes up. */
function GatedCleanup({
  kind,
  title,
  body,
  phrase,
  ready,
  onChange,
}: {
  kind: JobKind;
  title: string;
  body: string;
  phrase: string;
  ready: boolean;
  onChange: () => void;
}) {
  const [typed, setTyped] = useState("");
  const ok = typed.trim() === phrase;
  return (
    <div className="bg-white border border-danger-200 rounded-card p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-ink-900">{title}</p>
        <p className="text-xs text-ink-600 mt-1">{body}</p>
      </div>
      <label className="block text-xs text-ink-600">
        Type <span className="font-mono font-semibold text-ink-900">{phrase}</span> to allow it:
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="mt-1 block w-full max-w-sm border border-hairline rounded-ctl px-3 py-1.5 text-sm font-mono"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <JobControl
        kind={kind}
        startLabel="Remove now"
        params={{ confirm: phrase }}
        confirmText={`${title}?\n\nFiles are removed from Supabase for good. Each one is checked on Cloudflare R2 first.`}
        disabled={!ok || !ready}
        onChange={onChange}
      />
    </div>
  );
}

export default function StorageBoard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/storage", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`);
      setStats(d.stats as Stats);
      setConfig(d.config as Config);
      setPhrase(d.confirmPhrase as string);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load storage figures.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Figures refresh every 30 s while the page is open (a copy job moves them).
  useEffect(() => {
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <p className="text-sm text-danger-700">{error}</p>;
  if (!stats || !config) return <p className="text-sm text-ink-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <section className="bg-white border border-hairline rounded-card shadow-elev-1 p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-ink-900">Photo originals</h2>
          <button onClick={load} className="text-xs text-ink-500 hover:text-ink-900">Refresh</button>
        </div>
        <Row label="Still on Supabase" count={stats.supabase_count} bytes={stats.supabase_bytes}
          hint={stats.supabase_missing ? `${n(stats.supabase_missing)} of these have no file in Supabase — they'll show as failed in the copy.` : undefined} />
        <Row label="On Cloudflare R2" count={stats.r2_count} bytes={stats.r2_bytes} />
        <Row label="…of which still have a Supabase copy" count={stats.r2_with_supabase_copy_count} bytes={stats.r2_with_supabase_copy_bytes}
          hint="Freed by “Remove Supabase copies” below." />
        <Row label="Orphans (files with no photo record)" count={stats.orphan_count} bytes={stats.orphan_bytes}
          hint="Counted only — nothing here touches them." />
        <p className="text-xs text-ink-500 mt-3">
          Thumbnails &amp; slide copies (stay in Supabase): {gb(stats.derivative_bytes)}. New uploads go to{" "}
          <strong>{config.newUploads === "r2" ? "Cloudflare R2" : "Supabase"}</strong>
          {config.newUploads === "r2" ? "" : " (set PHOTO_ORIGINALS_BACKEND=r2 in Vercel to switch)"}
          {!config.r2Photos ? " — R2 isn't configured" : ""}.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-900">1 · Copy originals to R2</h2>
        <p className="text-xs text-ink-600">
          Copies each original, checks the copy on R2 (same size and type), then switches the photo over. Nothing is
          deleted. Cancel pauses it; start again to carry on — photos already moved are skipped and failed ones are
          retried.
        </p>
        <JobControl
          kind="photo_originals_copy"
          startLabel={stats.r2_count > 0 ? "Start / carry on copying" : "Start copying"}
          confirmText={`Copy ${n(stats.supabase_count)} originals (${gb(stats.supabase_bytes)}) to Cloudflare R2? Nothing is deleted.`}
          disabled={!config.r2Photos || stats.supabase_count === 0}
          onChange={load}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-900">2 · Website photos (yachtpics.com)</h2>
        <p className="text-xs text-ink-600">
          {n(stats.site_count)} files · {gb(stats.site_bytes)} in the <span className="font-mono">site-photos</span> bucket — copies
          of listing originals made when a boat is published. Publishing currently puts them in{" "}
          <strong>{config.websitePhotos === "r2" ? "the R2 media host" : "Supabase (site-photos)"}</strong>
          {config.websitePhotos === "r2" ? "" : " — set SITE_PHOTOS_BACKEND=r2 in Vercel to switch"}. Once switched, use{" "}
          <a href="/admin/jobs" className="underline">Re-publish live boats</a> after step 1 to move the live pages over
          (a big boat may need publishing twice — finished photos are skipped).
          {" "}{n(stats.site_switched_count)} files ({gb(stats.site_switched_bytes)}) belong to boats whose page already points at R2.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-900">3 · Free the Supabase space (confirm first)</h2>
        <GatedCleanup
          kind="photo_originals_cleanup"
          title="Remove Supabase copies of moved originals"
          body={`Removes the Supabase copy of photos already on R2 (${n(stats.r2_with_supabase_copy_count)} files, ${gb(stats.r2_with_supabase_copy_bytes)}). Each photo's R2 copy is checked again first; any that fail are kept.`}
          phrase={phrase}
          ready={stats.r2_with_supabase_copy_count > 0}
          onChange={load}
        />
        <GatedCleanup
          kind="site_photos_cleanup"
          title="Remove old website photo copies"
          body={`Removes site-photos files of boats whose live page now loads its photos from R2 (${n(stats.site_switched_count)} files, ${gb(stats.site_switched_bytes)}). A photo still on the page is only removed if its R2 copy is there.`}
          phrase={phrase}
          ready={stats.site_switched_count > 0}
          onChange={load}
        />
      </section>
    </div>
  );
}
