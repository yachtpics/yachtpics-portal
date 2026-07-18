"use client";

import { useState } from "react";

type Phase = "idle" | "running" | "done";

// Re-publishes every boat currently live on yachtpics.com, one at a time from
// the browser. Each boat is its own request to the normal publish pipeline, so
// there's no serverless time limit to hit and a single boat failing doesn't
// stop the rest. Used to roll out a change to how pages are generated — e.g.
// refreshing photo order after the ordering rules changed.
export default function RepublishLiveBoats() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [current, setCurrent] = useState("");
  const [failed, setFailed] = useState<string[]>([]);

  async function run() {
    if (phase === "running") return;
    if (
      !confirm(
        "Re-publish every boat currently on yachtpics.com? This refreshes each page (e.g. photo order). Boats you've hand-arranged keep their order."
      )
    )
      return;

    setPhase("running");
    setDone(0);
    setFailed([]);
    setCurrent("");

    let list: { id: string; name: string }[] = [];
    try {
      const res = await fetch("/api/admin/site/published-listings");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load the list.");
      list = data.listings ?? [];
    } catch (e) {
      setCurrent(e instanceof Error ? e.message : "Couldn't load the list.");
      setPhase("done");
      return;
    }

    setTotal(list.length);
    const fails: string[] = [];

    for (let i = 0; i < list.length; i++) {
      const boat = list[i];
      setCurrent(boat.name);
      try {
        const res = await fetch(`/api/admin/listings/${boat.id}/publish-site`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publish: true }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "failed");
        }
      } catch {
        fails.push(boat.name);
      }
      setDone(i + 1);
    }

    setFailed(fails);
    setCurrent("");
    setPhase("done");
  }

  return (
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-ink-900 mb-1">Re-publish live boats</h3>
          <p className="text-ink-500 text-sm">
            Refresh every boat on yachtpics.com — e.g. to apply the standard photo order.
            Hand-arranged boats keep their order.
          </p>
        </div>
        <button
          onClick={run}
          disabled={phase === "running"}
          className="shrink-0 bg-ink-950 hover:bg-ink-800 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
        >
          {phase === "running" ? "Working…" : "Re-publish all"}
        </button>
      </div>

      {phase === "running" && (
        <div className="mt-4">
          <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-500 rounded-full transition-all"
              style={{ width: total ? `${(done / total) * 100}%` : "0%" }}
            />
          </div>
          <p className="text-xs text-ink-500 mt-2 tabular-nums">
            {done}/{total}
            {current ? ` · publishing ${current}…` : ""}
          </p>
        </div>
      )}

      {phase === "done" && (
        <div className="mt-4 text-sm">
          {failed.length === 0 ? (
            <p className="text-success-700">
              Done — re-published {total} boat{total !== 1 ? "s" : ""}.
            </p>
          ) : (
            <div className="text-warn-700">
              <p>
                Re-published {total - failed.length} of {total}. These didn&apos;t go —
                try them again individually:
              </p>
              <p className="text-ink-600 mt-1">{failed.join(", ")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
