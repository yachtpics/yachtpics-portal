"use client";

import { useState } from "react";

type Page = { label: string; filename: string };

// Lists brokerage pages that have been deactivated but may still have a stale
// .html sitting on the server. Deleting one removes the file and refreshes the
// Boats index so it's gone for good.
export default function RetiredPages({ pages }: { pages: Page[] }) {
  const [rows, setRows] = useState<Page[]>(pages);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  if (rows.length === 0) return null;

  async function del(page: Page) {
    if (busy) return;
    if (!confirm(`Permanently delete "${page.label}" from the website (${page.filename}.html)?`)) return;

    setBusy(page.filename);
    try {
      const res = await fetch("/api/admin/site/delete-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: page.filename }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setRows((prev) => prev.filter((p) => p.filename !== page.filename));
      setMsg(data.warning ?? `Deleted "${page.label}" from the website.`);
      setTimeout(() => setMsg(""), 6000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't delete the page.");
      setTimeout(() => setMsg(""), 6000);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
      <h3 className="font-semibold text-ink-900 mb-1">Retired brokerage pages</h3>
      <p className="text-ink-500 text-sm mb-3">
        Deactivated pages that may still have a file on the server. Delete removes the page
        and refreshes the Boats list.
      </p>

      {msg && (
        <div className="mb-3 text-xs bg-accent-50 border border-accent-200 rounded-ctl px-3 py-2 text-accent-800">
          {msg}
        </div>
      )}

      <ul className="divide-y divide-hairline">
        {rows.map((p) => (
          <li key={p.filename} className="py-2.5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-900 truncate">{p.label}</p>
              <p className="text-xs text-ink-400">{p.filename}.html</p>
            </div>
            <button
              onClick={() => del(p)}
              disabled={busy === p.filename}
              className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-ctl border border-danger-200 text-danger-700 hover:bg-danger-50 disabled:opacity-50 transition-colors duration-fast ease-quiet"
            >
              {busy === p.filename ? "Deleting…" : "Delete from website"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
