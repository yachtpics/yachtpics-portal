"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import JobProgress, { fetchActiveJob, startJob } from "@/components/admin/JobProgress";
import type { JobRow } from "@/lib/jobs/types";
import { customMetaDescription } from "@/lib/siteAltText";

type Row = {
  id: string;
  name: string;
  sitePage: string | null;
  pageUrl: string | null;
  /** Has website text (listings.site_description — not the broker's description). */
  hasDescription: boolean;
  hasLocation: boolean;
  location: string | null;
  draft: string | null;
  draftedAt: string | null;
  locationSuggestion: string | null;
};

const TEXT_MIN = 250;
const TEXT_MAX = 420;
const PAGE = 20;

// "Boat page text" (Admin dashboard → Website maintenance). The yachtpics.com
// boat pages use YachtPics' own website text (listings.site_description),
// never the broker's description. This card:
//   - counts live boats missing website text / a location, and drafts waiting;
//   - "Draft all missing" runs the `site_text_drafts` background job (AI
//     drafts + locations read from photo metadata; nothing is published);
//   - lists every waiting draft / location suggestion for review — edit,
//     Approve & publish, Approve, Skip, Use location.
export default function BoatPageTextGaps() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [job, setJob] = useState<JobRow | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  // Review list: fixed at load so a row stays on screen (with its result)
  // after it's approved or skipped.
  const [reviewIds, setReviewIds] = useState<string[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [approvedUnpublished, setApprovedUnpublished] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/site/published-listings", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Couldn't load the live boats.");
      const list = (d.listings ?? []) as Row[];
      setRows(list);
      setReviewIds(list.filter((x) => x.draft || x.locationSuggestion).map((x) => x.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the live boats.");
    }
  }, []);

  useEffect(() => {
    load();
    fetchActiveJob("site_text_drafts").then((j) => {
      if (j) setJob(j);
    });
  }, [load]);

  const byId = useMemo(() => {
    const m: Record<string, Row> = {};
    (rows ?? []).forEach((r) => (m[r.id] = r));
    return m;
  }, [rows]);

  const noText = rows ? rows.filter((r) => !r.hasDescription).length : 0;
  const noLoc = rows ? rows.filter((r) => !r.hasLocation).length : 0;
  const drafts = rows ? rows.filter((r) => r.draft).length : 0;
  const suggestions = rows ? rows.filter((r) => r.locationSuggestion).length : 0;
  const toDraft = rows ? rows.filter((r) => !r.hasDescription && !r.draft).length : 0;
  const toLocate = rows ? rows.filter((r) => !r.hasLocation && !r.locationSuggestion).length : 0;
  const listed = rows ? (showAll ? rows : rows.filter((r) => !r.hasDescription || !r.hasLocation)) : [];
  const jobActive = !!job && (job.status === "queued" || job.status === "running");

  function patchRow(id: string, patch: Partial<Row>) {
    setRows((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, ...patch } : r)) : prev));
  }

  async function startDrafts() {
    if (starting || jobActive) return;
    setStarting(true);
    setJobError(null);
    const r = await startJob("site_text_drafts", {});
    setStarting(false);
    setConfirming(false);
    if (r.job) setJob(r.job);
    else setJobError(r.notReady ? "Background jobs aren't set up on this database yet." : r.error ?? "Couldn't start the job.");
  }

  const badge = (ok: boolean, waiting?: boolean) =>
    ok ? (
      <span className="text-xs text-success-700">✓</span>
    ) : waiting ? (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent-50 border border-accent-500/40 text-accent-700">To review</span>
    ) : (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-warn-50 border border-warn-200 text-warn-700">Missing</span>
    );

  const reviewRows = reviewIds.map((id) => byId[id]).filter(Boolean) as Row[];

  return (
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink-900 mb-1">Boat page text</h3>
          {error ? (
            <p className="text-sm text-danger-700">{error}</p>
          ) : (
            <p className="text-ink-500 text-sm">
              {rows === null
                ? "Checking the boats on yachtpics.com…"
                : `${rows.length} live boat${rows.length === 1 ? "" : "s"} · ${noText} without website text · ${noLoc} without a location · ${drafts} draft${drafts === 1 ? "" : "s"} waiting${suggestions ? ` · ${suggestions} location${suggestions === 1 ? "" : "s"} to check` : ""}.`}
            </p>
          )}
          <p className="text-ink-400 text-xs mt-1">
            The website text is YachtPics&rsquo; own intro for the page and its Google description — the broker&rsquo;s description is never used on yachtpics.com. The location goes in the page&rsquo;s specs. Approve drafts below or edit any boat&rsquo;s Website page block, then re-publish.
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {rows && rows.length > 0 && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="bg-white hover:border-ink-400 hover:text-ink-900 text-ink-700 text-sm font-medium px-4 py-2 rounded-ctl border border-hairline-strong transition-colors duration-fast ease-quiet"
            >
              {open ? "Hide list" : "Show list"}
            </button>
          )}
          {rows && (
            <button
              onClick={() => setConfirming(true)}
              disabled={jobActive || starting || confirming || (toDraft === 0 && toLocate === 0)}
              className="bg-ink-950 hover:bg-ink-800 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
            >
              {jobActive || starting ? "Drafting…" : "Draft all missing"}
            </button>
          )}
        </div>
      </div>

      {confirming && (
        <div className="mt-4 bg-ink-50 border border-hairline rounded-ctl px-4 py-3 text-sm">
          <p className="text-ink-800">
            Draft website text for {toDraft} boat{toDraft === 1 ? "" : "s"} with AI (one request per boat, up to six photos each)
            {toLocate ? ` and read the location from the photos for ${toLocate}` : ""}. Drafts wait here for you to approve — nothing is published, and boats that already have text are left alone. Runs in the background; you can close this tab.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={startDrafts}
              disabled={starting}
              className="bg-ink-950 hover:bg-ink-800 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
            >
              {starting ? "Starting…" : "Start drafting"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={starting}
              className="bg-white hover:border-ink-400 text-ink-700 text-sm font-medium px-4 py-2 rounded-ctl border border-hairline-strong transition-colors duration-fast ease-quiet"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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

      {reviewRows.length > 0 && (
        <div className="mt-4 border-t border-hairline pt-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
            <h4 className="text-sm font-semibold text-ink-900">To review ({reviewRows.length})</h4>
            <p className="text-xs text-ink-400">Edit if needed. Approve saves it as the boat&rsquo;s website text; Approve &amp; publish also updates its yachtpics.com page.</p>
          </div>
          {approvedUnpublished > 0 && (
            <p className="mb-3 text-sm text-accent-700 bg-accent-50 border border-accent-500/40 rounded-ctl px-3 py-2">
              {approvedUnpublished} approved but not yet on yachtpics.com. When you&rsquo;re done, use <strong>Re-publish all</strong> on &ldquo;Re-publish live boats&rdquo; above to update every page at once.
            </p>
          )}
          <div className="space-y-3">
            {reviewRows.slice(0, shown).map((r) => (
              <ReviewRow
                key={r.id}
                row={r}
                onChange={(patch) => patchRow(r.id, patch)}
                onApproved={(published) => {
                  if (!published) setApprovedUnpublished((n) => n + 1);
                }}
              />
            ))}
          </div>
          {reviewRows.length > shown && (
            <button
              onClick={() => setShown((n) => n + PAGE)}
              className="mt-3 bg-white hover:border-ink-400 hover:text-ink-900 text-ink-700 text-sm font-medium px-4 py-2 rounded-ctl border border-hairline-strong transition-colors duration-fast ease-quiet"
            >
              Show {Math.min(PAGE, reviewRows.length - shown)} more ({reviewRows.length - shown} left)
            </button>
          )}
        </div>
      )}

      {open && rows && (
        <div className="mt-4 border-t border-hairline pt-4">
          <label className="inline-flex items-center gap-2 text-xs text-ink-500 mb-3">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show every live boat (not only the ones missing something)
          </label>
          {listed.length === 0 ? (
            <p className="text-sm text-success-700">Every live boat has website text and a location.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="pb-2 pr-4 label-caps">Boat</th>
                    <th className="pb-2 pr-4 label-caps">Website page</th>
                    <th className="pb-2 pr-4 label-caps">Website text</th>
                    <th className="pb-2 pr-4 label-caps">Location</th>
                    <th className="pb-2 label-caps" />
                  </tr>
                </thead>
                <tbody>
                  {listed.map((r) => (
                    <tr key={r.id} className="border-t border-hairline">
                      <td className="py-2 pr-4 text-ink-900">{r.name}</td>
                      <td className="py-2 pr-4 text-ink-500">{r.sitePage ?? "—"}</td>
                      <td className="py-2 pr-4">{badge(r.hasDescription, !!r.draft)}</td>
                      <td className="py-2 pr-4">{badge(r.hasLocation, !!r.locationSuggestion)}</td>
                      <td className="py-2 text-right">
                        <Link
                          href={`/admin/listings/${r.id}#website-page`}
                          className="text-xs font-medium text-accent-700 hover:text-accent-600 transition-colors duration-fast"
                        >
                          Edit →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One boat waiting for review: its draft (editable) and/or a location read from its photos. */
function ReviewRow({
  row,
  onChange,
  onApproved,
}: {
  row: Row;
  onChange: (patch: Partial<Row>) => void;
  onApproved: (published: boolean) => void;
}) {
  const [text, setText] = useState(row.draft ?? "");
  const [busy, setBusy] = useState<"" | "approve" | "publish" | "skip" | "loc" | "dismiss">("");
  const [error, setError] = useState<string | null>(null);
  const [textDone, setTextDone] = useState<string | null>(null);
  const [locDone, setLocDone] = useState<string | null>(null);

  const trimmed = text.trim();
  const lengthOk = trimmed.length >= TEXT_MIN && trimmed.length <= TEXT_MAX;

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/listings/${row.id}/site-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    return data as { published?: boolean; publishError?: string; previewOnly?: string };
  }

  async function approve(publish: boolean) {
    if (busy || !trimmed) return;
    setBusy(publish ? "publish" : "approve");
    setError(null);
    try {
      const d = await post({ action: "approve", siteDescription: trimmed, publish });
      onChange({ hasDescription: true, draft: null });
      if (publish && d.published) {
        setTextDone("Approved and published — the yachtpics.com page is updated.");
        onApproved(true);
      } else if (publish && d.previewOnly) {
        setTextDone(`Approved. Not uploaded — ${d.previewOnly}`);
        onApproved(false);
      } else if (publish && d.publishError) {
        setTextDone("Approved (saved).");
        setError(`Re-publishing failed: ${d.publishError}`);
        onApproved(false);
      } else {
        setTextDone("Approved — goes on the page at the next re-publish.");
        onApproved(false);
      }
    } catch (e) {
      setError(e instanceof Error ? `Couldn't approve: ${e.message}` : "Couldn't approve.");
    } finally {
      setBusy("");
    }
  }

  async function skip() {
    if (busy) return;
    setBusy("skip");
    setError(null);
    try {
      await post({ action: "discard" });
      onChange({ draft: null });
      setTextDone("Skipped — draft discarded.");
    } catch (e) {
      setError(e instanceof Error ? `Couldn't skip: ${e.message}` : "Couldn't skip.");
    } finally {
      setBusy("");
    }
  }

  async function location(accept: boolean) {
    if (busy) return;
    setBusy(accept ? "loc" : "dismiss");
    setError(null);
    try {
      await post({ action: accept ? "acceptLocation" : "dismissLocation" });
      if (accept) {
        onChange({ hasLocation: true, location: row.locationSuggestion, locationSuggestion: null });
        setLocDone(`Location set to ${row.locationSuggestion}.`);
      } else {
        onChange({ locationSuggestion: null });
        setLocDone("Location suggestion dismissed.");
      }
    } catch (e) {
      setError(e instanceof Error ? `Couldn't update the location: ${e.message}` : "Couldn't update the location.");
    } finally {
      setBusy("");
    }
  }

  const btn =
    "bg-white hover:border-ink-400 hover:text-ink-900 disabled:opacity-50 text-ink-700 text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong transition-colors duration-fast ease-quiet";
  const showDraft = row.draft !== null || textDone !== null;
  const showLoc = row.locationSuggestion !== null || locDone !== null;
  if (!showDraft && !showLoc) return null;

  return (
    <div className="border border-hairline rounded-ctl p-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-sm font-semibold text-ink-900">
          {row.name}
          {row.sitePage && <span className="ml-2 text-xs font-normal text-ink-400">{row.sitePage}</span>}
        </p>
        <div className="flex items-center gap-3 text-xs">
          {row.pageUrl && (
            <a href={row.pageUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-700 hover:text-accent-600">
              Website page ↗
            </a>
          )}
          <Link href={`/admin/listings/${row.id}#website-page`} className="font-medium text-accent-700 hover:text-accent-600">
            Listing →
          </Link>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-2 flex items-start justify-between gap-3 bg-danger-50 border border-danger-200 text-danger-700 text-xs rounded-ctl px-3 py-2">
          <p>{error}</p>
          <button onClick={() => setError(null)} className="shrink-0 font-bold leading-none" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {showDraft &&
        (textDone ? (
          <p className="mt-2 text-xs text-success-700">{textDone}</p>
        ) : (
          <div className="mt-2">
            <textarea
              className="w-full bg-white border border-hairline-strong text-ink-900 rounded-ctl px-3 py-2 text-sm resize-y focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/40"
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!!busy}
              aria-label={`Website text for ${row.name}`}
            />
            <div className="mt-1 flex items-start justify-between gap-3 text-xs">
              <p className="text-ink-500 min-w-0">
                <span className="text-ink-400">Google shows: </span>
                {trimmed ? customMetaDescription(trimmed, row.location) : "—"}
              </p>
              <span className={`shrink-0 tabular-nums ${trimmed && !lengthOk ? "text-warn-700" : "text-ink-400"}`}>
                {trimmed.length} characters
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <button
                onClick={() => approve(true)}
                disabled={!!busy || !trimmed}
                className="bg-ink-950 hover:bg-ink-800 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet"
              >
                {busy === "publish" ? "Publishing…" : "Approve & publish"}
              </button>
              <button onClick={() => approve(false)} disabled={!!busy || !trimmed} className={btn}>
                {busy === "approve" ? "Saving…" : "Approve"}
              </button>
              <button onClick={skip} disabled={!!busy} className={btn}>
                {busy === "skip" ? "Skipping…" : "Skip"}
              </button>
            </div>
          </div>
        ))}

      {showLoc &&
        (locDone ? (
          <p className="mt-2 text-xs text-success-700">{locDone}</p>
        ) : (
          <div className="mt-2 flex items-center gap-2 flex-wrap text-sm">
            <span className="text-ink-700">
              <span className="text-ink-500">Photos say: </span>
              <span className="font-semibold text-ink-900">{row.locationSuggestion}</span>
              {row.location ? <span className="text-ink-400 text-xs"> (now: {row.location})</span> : null}
            </span>
            <button onClick={() => location(true)} disabled={!!busy} className={btn}>
              {busy === "loc" ? "Saving…" : "Use location"}
            </button>
            <button onClick={() => location(false)} disabled={!!busy} className={btn}>
              {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
            </button>
          </div>
        ))}
    </div>
  );
}
