"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pagePicture } from "./SocialAccounts";

/**
 * "Post to Facebook / Instagram" for one finished reel — a Reel Service reel
 * (Admin → Reel Service) or a listing reel just made in the listing's Reel
 * Maker (admin only), which is uploaded first, on Post, with a progress bar.
 *
 * Pick the Page (admin: any connected Page), tick Facebook and/or Instagram,
 * edit the caption, then Post now or schedule. Below: this reel's posts with
 * status, link, and Cancel for scheduled ones. While an Instagram reel is
 * still processing the dialog keeps nudging it until it's live.
 */

type Connection = { id: string; page_id: string; page_name: string | null; ig_user_id: string | null; ig_username: string | null; broker_id: string; broker_name?: string };
type Post = {
  id: string; platform: "facebook" | "instagram"; status: "scheduled" | "posting" | "posted" | "failed" | "cancelled";
  scheduled_for: string | null; permalink: string | null; error: string | null; created_at: string; posted_at: string | null; page_name: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-accent-100 text-accent-800",
  posting: "bg-warn-50 text-warn-800",
  posted: "bg-success-50 text-success-700",
  failed: "bg-danger-50 text-danger-700",
  cancelled: "bg-ink-100 text-ink-500",
};
const MAX_CAPTION = 2200;

/**
 * What's being posted.
 *  - reel_service_job: a stored Reel Service reel (`id` = job id).
 *  - listing_reel: a reel rendered in the browser for listing `id`. `upload`
 *    puts the MP4 in the private bucket and resolves to its key (it may
 *    remember the key per render, so a second post doesn't upload again);
 *    the duration and frame size go to the server for its own check.
 */
export type SocialSource =
  | { kind: "reel_service_job"; id: string }
  | {
      kind: "listing_reel"; id: string;
      upload: (onProgress: (pct: number) => void) => Promise<string>;
      durationSec: number; width: number; height: number;
    };

/** "2026-10-20T09:00" in the viewer's local time, for <input type="datetime-local">. */
function localInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SocialPostDialog({ source, title, defaultCaption, brokerId, onClose }: {
  source: SocialSource; title: string; defaultCaption: string; brokerId?: string; onClose: () => void;
}) {
  const sourceId = source.id;
  const isListing = source.kind === "listing_reel";
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [connId, setConnId] = useState("");
  const [fb, setFb] = useState(true);
  const [ig, setIg] = useState(true);
  const [caption, setCaption] = useState(defaultCaption);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState(() => {
    const d = new Date(Date.now() + 24 * 3600 * 1000);
    d.setHours(9, 0, 0, 0);
    return localInputValue(d);
  });
  const [posts, setPosts] = useState<Post[]>([]);
  const [busy, setBusy] = useState("");
  const [uploadPct, setUploadPct] = useState(0);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const checking = useRef(false);
  const [scope, setScope] = useState<"reel" | "all">("reel");

  const loadPosts = useCallback(async () => {
    const url = scope === "reel"
      ? `/api/social/posts?${source.kind === "reel_service_job" ? "jobId" : "sourceId"}=${encodeURIComponent(sourceId)}`
      : "/api/social/posts";
    const res = await fetch(url, { cache: "no-store" }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setPosts((d?.posts ?? []) as Post[]);
  }, [source.kind, sourceId, scope]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/social/connections?all=1", { cache: "no-store" }).catch(() => null);
      const d = res ? await res.json().catch(() => ({})) : {};
      const list = (d?.connections ?? []) as Connection[];
      setConfigured(!!d?.configured);
      setConns(list);
      // Prefer the reel's broker's own Page (no broker given: the viewer's
      // own — "You"), else the first one.
      const own = brokerId ? list.find((c) => c.broker_id === brokerId) : list.find((c) => c.broker_name === "You");
      setConnId((own ?? list[0])?.id ?? "");
      if (d?.error) setMsg({ type: "error", text: d.error });
    })();
    void loadPosts();
  }, [brokerId, loadPosts]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape" && !busy) onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // Instagram processing: nudge any 'posting' rows every ~8 s while open.
  useEffect(() => {
    const waiting = posts.filter((p) => p.status === "posting");
    if (waiting.length === 0) return;
    const t = setTimeout(async () => {
      if (checking.current) return;
      checking.current = true;
      try {
        for (let i = 0; i < waiting.length; i++) {
          await fetch("/api/social/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check", id: waiting[i].id }) }).catch(() => null);
        }
        await loadPosts();
      } finally { checking.current = false; }
    }, 8000);
    return () => clearTimeout(t);
  }, [posts, loadPosts]);

  const conn = conns?.find((c) => c.id === connId) ?? null;
  const igAvailable = !!conn?.ig_user_id;
  const wantIg = ig && igAvailable;

  async function submit() {
    if (!conn) return;
    const platforms = [fb ? "facebook" : null, wantIg ? "instagram" : null].filter(Boolean);
    if (platforms.length === 0) { setMsg({ type: "error", text: "Tick Facebook, Instagram, or both." }); return; }
    let scheduledFor: string | undefined;
    if (when === "later") {
      const d = new Date(at);
      if (isNaN(d.getTime())) { setMsg({ type: "error", text: "Pick a date and time." }); return; }
      scheduledFor = d.toISOString();
    }
    setMsg(null);
    try {
      let body: Record<string, unknown>;
      if (source.kind === "listing_reel") {
        // Upload first (the browser holds the only copy), then post from the stored file.
        setBusy("upload"); setUploadPct(0);
        const videoPath = await source.upload(setUploadPct);
        body = {
          sourceKind: "listing_reel", listingId: source.id, videoPath,
          durationSec: source.durationSec, width: source.width, height: source.height,
        };
      } else {
        body = { jobId: source.id };
      }
      setBusy("post");
      const res = await fetch("/api/social/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, connectionId: conn.id, platforms, caption, scheduledFor }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error ?? `Failed (${res.status}).`);
      const out = (d.posts ?? []) as Post[];
      const failed = out.filter((p) => p.status === "failed");
      const processing = out.some((p) => p.status === "posting");
      if (failed.length) setMsg({ type: "error", text: failed.map((p) => `${p.platform === "facebook" ? "Facebook" : "Instagram"}: ${p.error ?? "failed"}`).join(" · ") });
      else if (when === "later") setMsg({ type: "success", text: "Scheduled." });
      else if (processing) setMsg({ type: "success", text: "Sent. Instagram is still processing the video — keep this open and it will go live in a minute or two (or at the next daily run)." });
      else setMsg({ type: "success", text: "Posted." });
      await loadPosts();
    } catch (e) {
      setMsg({ type: "error", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally { setBusy(""); }
  }

  async function cancel(p: Post) {
    if (!window.confirm(`Cancel the scheduled ${p.platform === "facebook" ? "Facebook" : "Instagram"} post?`)) return;
    setBusy(p.id); setMsg(null);
    try {
      const res = await fetch("/api/social/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", id: p.id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error ?? "Couldn’t cancel.");
      await loadPosts();
    } catch (e) {
      setMsg({ type: "error", text: e instanceof Error ? e.message : "Couldn’t cancel." });
    } finally { setBusy(""); }
  }

  const box = "w-full border border-hairline-strong rounded-ctl px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-500";

  return (
    <div className="fixed inset-0 z-50 bg-ink-950/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Post to Facebook / Instagram"
      onClick={() => { if (!busy) onClose(); }}>
      <div className="bg-white rounded-card p-6 max-w-lg w-full shadow-elev-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-h2 text-ink-900">Post to Facebook / Instagram</h3>
        <p className="text-xs text-ink-500 mt-0.5 mb-4">{title}</p>

        {msg && (
          <div className={`mb-4 px-3 py-2 rounded-ctl border text-sm ${msg.type === "success" ? "bg-success-50 border-success-200 text-success-700" : "bg-danger-50 border-danger-200 text-danger-600"}`}>{msg.text}</div>
        )}

        {conns === null ? (
          <p className="text-sm text-ink-500">Loading&hellip;</p>
        ) : !configured ? (
          <p className="text-sm text-warn-800">Facebook isn&rsquo;t configured on the portal yet (see docs/meta-setup.md).</p>
        ) : conns.length === 0 ? (
          <p className="text-sm text-ink-600">
            No Facebook Page connected yet. Connect one in{" "}
            <a href="/dashboard/profile#social-accounts" className="text-accent-700 font-semibold hover:underline">Profile &rarr; Social accounts</a>.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="label-caps mb-1.5">Page</p>
              <div className="flex items-center gap-3">
                {conn && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pagePicture(conn.page_id)} alt="" className="h-9 w-9 rounded-full bg-ink-100 object-cover shrink-0" />
                )}
                <select value={connId} onChange={(e) => setConnId(e.target.value)} className={box}>
                  {conns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.page_name ?? c.page_id}{c.ig_username ? ` · @${c.ig_username}` : ""}{c.broker_name ? ` — ${c.broker_name}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-5">
              <label className="flex items-center gap-2 text-sm text-ink-800">
                <input type="checkbox" className="h-4 w-4 accent-accent-500" checked={fb} onChange={(e) => setFb(e.target.checked)} /> Facebook Reel
              </label>
              <label className={`flex items-center gap-2 text-sm ${igAvailable ? "text-ink-800" : "text-ink-400"}`} title={igAvailable ? "" : "This Page has no linked Instagram professional account."}>
                <input type="checkbox" className="h-4 w-4 accent-accent-500" checked={wantIg} disabled={!igAvailable} onChange={(e) => setIg(e.target.checked)} />
                Instagram Reel{conn?.ig_username ? ` (@${conn.ig_username})` : ""}
              </label>
            </div>
            {!igAvailable && <p className="text-xs text-ink-500 -mt-2">No Instagram account is linked to this Page, so Instagram is off.</p>}

            <div>
              <p className="label-caps mb-1.5">Caption</p>
              <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={5} className={box + " resize-y"} />
              <p className={`text-xs mt-1 ${caption.length > MAX_CAPTION ? "text-danger-700" : "text-ink-400"}`}>{caption.length} / {MAX_CAPTION}</p>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-ink-800">
                <input type="radio" name="when" checked={when === "now"} onChange={() => setWhen("now")} className="accent-accent-500" /> Post now
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-800 flex-wrap">
                <input type="radio" name="when" checked={when === "later"} onChange={() => setWhen("later")} className="accent-accent-500" /> Schedule for
                <input type="datetime-local" value={at} onChange={(e) => { setAt(e.target.value); setWhen("later"); }}
                  className="border border-hairline-strong rounded-ctl px-2 py-1 text-sm" />
              </label>
              {when === "later" && (
                <p className="text-xs text-ink-500">
                  Facebook publishes at exactly this time. Instagram has no scheduling, so it goes out at the portal&rsquo;s daily run (9am ET in summer, 8am in winter) on or after this time.
                </p>
              )}
            </div>

            <div className="flex gap-3 pt-1">
              <button onClick={onClose} disabled={busy === "post" || busy === "upload"}
                className="flex-1 bg-white border border-hairline-strong hover:bg-ink-50 disabled:opacity-50 text-ink-700 text-sm font-medium py-2.5 rounded-ctl">
                Close
              </button>
              <button onClick={() => void submit()} disabled={!!busy || !conn || caption.length > MAX_CAPTION || (!fb && !wantIg)}
                className="flex-1 bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold py-2.5 rounded-ctl">
                {busy === "upload" ? `Uploading… ${uploadPct}%` : busy === "post" ? (when === "now" ? "Posting… (up to a minute)" : "Scheduling…") : when === "now" ? "Post now" : "Schedule"}
              </button>
            </div>
            {busy === "upload" && (
              <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden" role="progressbar" aria-valuenow={uploadPct} aria-valuemin={0} aria-valuemax={100} aria-label="Uploading the reel">
                <div className="h-full bg-accent-500 transition-all" style={{ width: `${uploadPct}%` }} />
              </div>
            )}
            {isListing && !busy && (
              <p className="text-xs text-ink-400">The reel uploads to the portal&rsquo;s private storage first; Facebook and Instagram fetch it from there.</p>
            )}
          </div>
        )}

        {(posts.length > 0 || scope === "all") && (
          <div className="mt-6 border-t border-hairline pt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="label-caps">{scope === "reel" ? (isListing ? "This listing\u2019s reel posts" : "This reel\u2019s posts") : "Recent posts, all reels"}</p>
              <button onClick={() => setScope(scope === "reel" ? "all" : "reel")} className="text-xs text-accent-700 font-semibold hover:underline">
                {scope === "reel" ? "Show all recent" : isListing ? "Just this listing" : "Just this reel"}
              </button>
            </div>
            {posts.length === 0 && <p className="text-xs text-ink-400">No posts yet.</p>}
            <ul className="divide-y divide-hairline">
              {posts.map((p) => (
                <li key={p.id} className="py-2 flex items-center gap-2 flex-wrap text-xs">
                  <span className="font-semibold text-ink-800 w-20">{p.platform === "facebook" ? "Facebook" : "Instagram"}</span>
                  <span className={`font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[p.status] ?? ""}`}>{p.status === "posting" ? "processing" : p.status}</span>
                  <span className="text-ink-500">
                    {p.status === "scheduled" && p.scheduled_for ? new Date(p.scheduled_for).toLocaleString() : new Date(p.posted_at ?? p.created_at).toLocaleString()}
                    {p.page_name ? ` · ${p.page_name}` : ""}
                  </span>
                  {p.permalink && p.status === "posted" && (
                    <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="text-accent-700 font-semibold hover:underline">View</a>
                  )}
                  {p.status === "scheduled" && (
                    <button onClick={() => void cancel(p)} disabled={!!busy} className="text-danger-600 hover:text-danger-700 disabled:opacity-50 ml-auto">
                      {busy === p.id ? "Cancelling…" : "Cancel"}
                    </button>
                  )}
                  {p.status === "failed" && p.error && <span className="w-full text-danger-700">{p.error}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
