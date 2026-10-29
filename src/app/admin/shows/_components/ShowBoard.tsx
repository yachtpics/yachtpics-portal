"use client";

import { useState } from "react";
import Link from "next/link";
import { openZipTarget, writeZip } from "@/lib/zipDownload";

export type ShowRow = {
  listingId: string;
  boat: string;
  specs: string;
  broker: string;
  brokerId: string;
  brokerage: string;
  location: string;
  note: string;
  markedAt: string;
  /** Set when someone other than the broker (an assistant, an admin) marked it. */
  markedBy: string;
  published: boolean;
};

export type UnmarkedRow = {
  listingId: string;
  boat: string;
  specs: string;
  broker: string;
  brokerage: string;
  updatedAt: string;
};

type ShowInfo = { key: string; name: string; short: string; dates: string; city: string };

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim() || "boat";

export default function ShowBoard({
  shows,
  rowsByShow,
  unmarked,
}: {
  shows: ShowInfo[];
  rowsByShow: Record<string, ShowRow[]>;
  unmarked: UnmarkedRow[];
}) {
  const [size, setSize] = useState<"5x7" | "letter">("5x7");
  const [zipping, setZipping] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function exportCsv(show: ShowInfo, rows: ShowRow[]) {
    const head = ["Boat", "Specs", "Broker", "Brokerage", "Dock / slip", "Note", "Marked (ET)", "Marked by", "Slideshow published", "Listing"];
    const lines = [head.join(",")].concat(
      rows.map((r) =>
        [r.boat, r.specs, r.broker, r.brokerage, r.location, r.note, fmtDate(r.markedAt), r.markedBy || r.broker, r.published ? "yes" : "no",
          `https://portal.yachtpics.com/admin/listings/${r.listingId}`].map(csvCell).join(",")
      )
    );
    saveBlob(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `${show.short} marked boats.csv`);
  }

  async function zipAll(show: ShowInfo, rows: ShowRow[]) {
    const todo = rows.filter((r) => r.published);
    if (todo.length === 0) return;
    // Streaming zip (src/lib/zipDownload.ts): Save dialog first, while the
    // click still counts; the cards stream into it one by one.
    const zipBase = `${show.short} dock cards${size === "letter" ? " (letter)" : ""}`;
    const target = await openZipTarget(`${zipBase}.zip`);
    if (target.kind === "cancelled") return;
    setZipping(show.key);
    setNote(null);
    const failed: string[] = [];
    try {
      const used = new Set<string>();
      const entries = todo.map((r) => {
        let base = safeName(`${r.brokerage ? r.brokerage + " - " : ""}${r.boat}`);
        while (used.has(base)) base += " (2)";
        used.add(base);
        return { name: `${base}.pdf`, url: `/api/listings/${r.listingId}/show-card?show=${encodeURIComponent(show.key)}&size=${size}`, boat: r.boat };
      });
      setProgress(`0 / ${todo.length}`);
      const result = await writeZip(target, entries, {
        baseName: zipBase,
        onProgress: (p) => setProgress(`${p.done} / ${p.total}`),
      });
      if (!result.ok) throw new Error(result.error);
      for (let k = 0; k < result.failed; k++) failed.push("?");
      const skipped = rows.length - todo.length;
      const parts = [`${todo.length - failed.length} dock card${todo.length - failed.length === 1 ? "" : "s"} saved.`];
      if (skipped) parts.push(`${skipped} skipped (slideshow not published).`);
      if (failed.length) parts.push(`${failed.length} card${failed.length === 1 ? "" : "s"} couldn't be made — download those one by one.`);
      setNote({ kind: failed.length ? "err" : "ok", text: parts.join(" ") });
    } catch {
      setNote({ kind: "err", text: "Couldn't build the zip. Try the cards one by one." });
    } finally {
      setZipping(null);
      setProgress("");
    }
  }

  return (
    <div className="space-y-10">
      {note && (
        <div className={`px-4 py-3 rounded-ctl text-sm ${note.kind === "ok" ? "bg-success-50 border border-success-200 text-success-700" : "bg-danger-50 border border-danger-200 text-danger-700"}`}>
          {note.text}
        </div>
      )}

      {shows.map((show) => {
        const rows = rowsByShow[show.key] ?? [];
        const publishedCount = rows.filter((r) => r.published).length;
        return (
          <section key={show.key}>
            <div className="mb-3 flex items-end justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-h2 text-ink-900">{show.name}</h2>
                <p className="text-ink-500 text-sm mt-0.5">
                  {[show.city, show.dates].filter(Boolean).join(" · ")} · <span className="tabular-nums font-medium text-ink-800">{rows.length}</span> marked
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={size}
                  onChange={(e) => setSize(e.target.value === "letter" ? "letter" : "5x7")}
                  aria-label="Dock card size"
                  className="text-xs border border-hairline-strong rounded-ctl px-2 py-1.5 bg-white text-ink-700"
                >
                  <option value="5x7">5 &times; 7 in</option>
                  <option value="letter">Letter</option>
                </select>
                <button
                  type="button"
                  onClick={() => exportCsv(show, rows)}
                  disabled={rows.length === 0}
                  className="text-xs font-semibold px-3 py-1.5 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400 transition-colors duration-fast disabled:opacity-40"
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={() => zipAll(show, rows)}
                  disabled={publishedCount === 0 || zipping !== null}
                  className="text-xs font-semibold px-3 py-1.5 rounded-ctl bg-ink-950 hover:bg-ink-800 text-white transition-colors duration-fast disabled:opacity-40"
                  title={publishedCount === 0 ? "No marked boat has a published slideshow yet" : "Every marked boat's dock card in one zip"}
                >
                  {zipping === show.key ? `Zipping… ${progress}` : `All dock cards (${publishedCount})`}
                </button>
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="bg-white border border-hairline rounded-card shadow-elev-1 py-10 text-center">
                <p className="text-ink-500 text-sm">No boats marked yet.</p>
              </div>
            ) : (
              <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-hairline">
                      {["Boat", "Broker", "Brokerage", "Dock / slip", "Note", "Marked", ""].map((h) => (
                        <th key={h} className="label-caps text-ink-500 font-medium px-4 py-2.5 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {rows.map((r) => (
                      <tr key={r.listingId} className="align-top">
                        <td className="px-4 py-3 min-w-[12rem]">
                          <Link href={`/admin/listings/${r.listingId}`} className="font-medium text-ink-900 hover:text-accent-700">{r.boat}</Link>
                          {r.specs && <p className="text-xs text-ink-500 mt-0.5">{r.specs}</p>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <Link href={`/admin/brokers/${r.brokerId}`} className="text-ink-700 hover:text-accent-700">{r.broker || "—"}</Link>
                        </td>
                        <td className="px-4 py-3 text-ink-700">{r.brokerage || "—"}</td>
                        <td className="px-4 py-3 text-ink-900">{r.location || <span className="text-warn-700">Not given</span>}</td>
                        <td className="px-4 py-3 text-ink-600 max-w-[16rem]">{r.note || "—"}</td>
                        <td className="px-4 py-3 text-xs text-ink-500 whitespace-nowrap">
                          {fmtDate(r.markedAt)}
                          {r.markedBy && <p className="mt-0.5">by {r.markedBy}</p>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right">
                          {r.published ? (
                            <a
                              href={`/api/listings/${r.listingId}/show-card?show=${encodeURIComponent(show.key)}&size=${size}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-semibold text-accent-700 hover:text-accent-600"
                            >
                              Dock card
                            </a>
                          ) : (
                            <span className="text-xs text-ink-400" title="Publish the slideshow first">Not published</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      <section>
        <h2 className="text-h2 text-ink-900">Unmarked recent listings</h2>
        <p className="text-ink-500 text-sm mt-0.5 mb-3">
          Active listings updated in the last 60 days that aren&rsquo;t marked for a show — <span className="tabular-nums">{unmarked.length}</span>. Worth a nudge if they&rsquo;re going.
        </p>
        {unmarked.length > 0 && (
          <details className="bg-white border border-hairline rounded-card shadow-elev-1">
            <summary className="px-4 py-3 text-sm font-medium text-ink-700 cursor-pointer">Show the list</summary>
            <ul className="divide-y divide-hairline border-t border-hairline">
              {unmarked.map((u) => (
                <li key={u.listingId} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <Link href={`/admin/listings/${u.listingId}`} className="font-medium text-ink-900 hover:text-accent-700">{u.boat}</Link>
                    {u.specs && <span className="text-ink-500"> · {u.specs}</span>}
                    <span className="block text-xs text-ink-500">{[u.broker, u.brokerage].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="text-xs text-ink-400 whitespace-nowrap">updated {fmtDate(u.updatedAt)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
