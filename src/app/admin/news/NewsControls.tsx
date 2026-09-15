"use client";

import { useState, type FormEvent } from "react";
import { NEWS_CATEGORIES, NEWS_CATEGORY_LABELS, isNewsCategory, type NewsCategory } from "@/lib/newsSources";

export type NewsAdminRow = {
  id: string;
  url: string;
  source: string;
  title: string;
  summary: string;
  category: string;
  published_at: string | null;
  fetched_at: string | null;
  featured: boolean;
  hidden: boolean;
  native: boolean;
};

const MAX_TITLE = 90;
const MAX_SUMMARY = 260;

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function categoryLabel(value: string): string {
  return isNewsCategory(value) ? NEWS_CATEGORY_LABELS[value] : value;
}

const smallButton =
  "text-sm text-ink-600 border border-hairline-strong hover:border-ink-400 px-3 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet disabled:opacity-50";

const fieldClass =
  "w-full text-sm bg-white border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500";

export default function NewsControls({ rows: initial }: { rows: NewsAdminRow[] }) {
  const [rows, setRows] = useState<NewsAdminRow[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState<NewsCategory>("brokerage");

  async function patch(row: NewsAdminRow, change: { hidden?: boolean; featured?: boolean }, label: string) {
    setBusy(`${label}:${row.id}`);
    setNote(null);
    try {
      const res = await fetch("/api/admin/news", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, ...change }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...change } : r)));
    } catch (e) {
      setNote({ kind: "err", text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusy(null);
    }
  }

  async function addItem(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), summary: summary.trim(), url: url.trim(), category }),
      });
      const data = (await res.json()) as { error?: string; item?: { id?: string } };
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      // Without the real id, Feature/Hide on the new row would fail — reload
      // instead of showing a row we can't act on.
      if (!data.item?.id) { window.location.reload(); return; }
      const now = new Date().toISOString();
      const created: NewsAdminRow = {
        id: data.item.id,
        url: url.trim(),
        source: "YachtPics",
        title: title.trim(),
        summary: summary.trim(),
        category,
        published_at: now,
        fetched_at: now,
        featured: false,
        hidden: false,
        native: true,
      };
      setRows((prev) => [created, ...prev]);
      setTitle("");
      setSummary("");
      setUrl("");
      setAdding(false);
      setNote({ kind: "ok", text: "Added to the feed." });
    } catch (e) {
      setNote({ kind: "err", text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setSaving(false);
    }
  }

  const visible = rows.filter((r) => !r.hidden).length;

  return (
    <div className="space-y-4">
      {note && (
        <div
          className={`px-4 py-3 rounded-ctl text-sm ${
            note.kind === "ok"
              ? "bg-success-50 border border-success-200 text-success-700"
              : "bg-danger-50 border border-danger-200 text-danger-700"
          }`}
        >
          {note.text}
        </div>
      )}

      <div className="bg-white border border-hairline rounded-card shadow-elev-1 px-5 py-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-900">Add a YachtPics item</p>
            <p className="text-xs text-ink-500 mt-0.5">
              A boat on Recently Photographed, a broker&rsquo;s reel, a show we&rsquo;re shooting. It appears in the
              broker feed marked as ours.
            </p>
          </div>
          <button type="button" onClick={() => setAdding(!adding)} className={`${smallButton} shrink-0`}>
            {adding ? "Cancel" : "Add item"}
          </button>
        </div>

        {adding && (
          <form onSubmit={addItem} className="mt-4 pt-4 border-t border-hairline space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-ink-500 mb-1">
                Headline <span className="text-ink-400">({title.length}/{MAX_TITLE})</span>
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={MAX_TITLE}
                required
                placeholder="Sentence case, no source name"
                className={fieldClass}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-ink-500 mb-1">
                Summary <span className="text-ink-400">({summary.length}/{MAX_SUMMARY})</span>
              </label>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                maxLength={MAX_SUMMARY}
                required
                rows={3}
                placeholder="Two sentences: what happened, and why a broker would care."
                className={fieldClass}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="flex-1 min-w-[220px]">
                <label className="block text-[11px] font-medium text-ink-500 mb-1">Link</label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                  placeholder="https://"
                  className={fieldClass}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-ink-500 mb-1">Category</label>
                <select
                  value={category}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (isNewsCategory(next)) setCategory(next);
                  }}
                  className={fieldClass}
                >
                  {NEWS_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {NEWS_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add to the feed"}
            </button>
          </form>
        )}
      </div>

      <p className="text-xs text-ink-500">
        {rows.length} item{rows.length === 1 ? "" : "s"} in the last 14 days &middot; {visible} visible to brokers
      </p>

      <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-hidden">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-400 p-6">
            Nothing yet. The daily job runs at 13:00 UTC; items appear here the same morning.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {rows.map((row) => (
              <li key={row.id} className={`px-5 py-4 ${row.hidden ? "bg-ink-50/60" : ""}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="label-caps">{categoryLabel(row.category)}</span>
                      {row.featured && (
                        <span className="text-[11px] font-semibold text-accent-700 bg-accent-50 border border-accent-200 rounded-full px-2 py-0.5">
                          Featured
                        </span>
                      )}
                      {row.native && (
                        <span className="text-[11px] font-semibold text-ink-600 bg-ink-50 border border-hairline rounded-full px-2 py-0.5">
                          YachtPics
                        </span>
                      )}
                      {row.hidden && (
                        <span className="text-[11px] font-semibold text-ink-500 bg-ink-100 border border-hairline rounded-full px-2 py-0.5">
                          Hidden
                        </span>
                      )}
                    </div>
                    <p className={`text-sm font-semibold mt-1 ${row.hidden ? "text-ink-500" : "text-ink-900"}`}>
                      <a href={row.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent-700 transition-colors duration-fast">
                        {row.title}
                      </a>
                    </p>
                    <p className="text-xs text-ink-500 mt-1 leading-relaxed">{row.summary}</p>
                    <p className="text-xs text-ink-400 mt-1.5">
                      {row.source} &middot; {fmt(row.published_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => patch(row, { featured: !row.featured }, "feature")}
                      disabled={busy === `feature:${row.id}`}
                      className={smallButton}
                    >
                      {row.featured ? "Unfeature" : "Feature"}
                    </button>
                    <button
                      type="button"
                      onClick={() => patch(row, { hidden: !row.hidden }, "hide")}
                      disabled={busy === `hide:${row.id}`}
                      className={smallButton}
                    >
                      {row.hidden ? "Unhide" : "Hide"}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
