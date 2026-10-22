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
 *
 * Listing reels also get a Cover row: eight frames pulled from the rendered
 * MP4 right here in the browser, tap one (and fine-tune it with the slider).
 * On Post the chosen frame is grabbed at full size, uploaded next to the reel,
 * and sent to Meta — otherwise Facebook picks the cover itself and often
 * lands on a fade. A cover that fails never stops the post.
 */

type Connection = { id: string; page_id: string; page_name: string | null; ig_user_id: string | null; ig_username: string | null; broker_id: string; broker_name?: string };
type Post = {
  id: string; platform: "facebook" | "instagram"; status: "scheduled" | "posting" | "posted" | "failed" | "cancelled";
  scheduled_for: string | null; permalink: string | null; error: string | null; created_at: string; posted_at: string | null; page_name: string | null;
  /** Listing reels with a chosen cover: 'set', or why Meta didn't take it. */
  cover_note?: string | null;
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
 *    `blob` is the rendered MP4 the cover frames are pulled from, and
 *    `uploadCover` puts the chosen frame (a JPEG) next to it and resolves to
 *    its key — remembered per render and time, so re-posting doesn't re-upload.
 */
export type SocialSource =
  | { kind: "reel_service_job"; id: string }
  | {
      kind: "listing_reel"; id: string;
      upload: (onProgress: (pct: number) => void) => Promise<string>;
      durationSec: number; width: number; height: number;
      blob: Blob; renderId: string;
      uploadCover: (cover: Blob, atSec: number, onProgress: (pct: number) => void) => Promise<string>;
    };

/** Cover picker: how many frames to offer, and the thumbnail's pixel width (2× its 56 px on screen). */
const COVER_SAMPLES = 8;
const COVER_THUMB_W = 112;
/** Skip the opening fade-in and the closing card, which make poor covers. */
const COVER_SKIP_START = 0.6;
const COVER_SKIP_END = 1;
/** Facebook's thumbnail limit is 10 MB; re-encode lighter above this. */
const COVER_MAX_BYTES = 9.5 * 1024 * 1024;

/** Wait for one event on a media element, or fail after `ms` (a browser that can't decode it never fires). */
function onceEvent(el: HTMLMediaElement, name: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (ok: boolean) => {
      clearTimeout(t);
      el.removeEventListener(name, onOk);
      el.removeEventListener("error", onErr);
      if (ok) resolve(); else reject(new Error("This browser couldn't read the reel's frames."));
    };
    const onOk = () => done(true);
    const onErr = () => done(false);
    const t = setTimeout(() => done(false), ms);
    el.addEventListener(name, onOk);
    el.addEventListener("error", onErr);
  });
}

/** Seek the (hidden) video to `t` seconds and draw that frame as a JPEG at w×h. */
async function grabFrame(v: HTMLVideoElement, t: number, w: number, h: number, quality: number): Promise<Blob> {
  // Setting the same time again fires no 'seeked', so only wait when it moves.
  if (Math.abs(v.currentTime - t) > 0.001) {
    const seeked = onceEvent(v, "seeked", 8000);
    v.currentTime = t;
    await seeked;
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw the reel's frames.");
  ctx.drawImage(v, 0, 0, w, h);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the cover image."))), "image/jpeg", quality);
  });
}

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

  // ── Cover picker (listing reels) ───────────────────────────────────────────
  // baseTimes: where the eight samples sit (fixed); picks: each sample's time
  // after any fine-tuning; thumbs: their pictures (object URLs).
  const reelBlob = source.kind === "listing_reel" ? source.blob : null;
  const reelW = source.kind === "listing_reel" ? source.width : 0;
  const reelH = source.kind === "listing_reel" ? source.height : 0;
  const [coverState, setCoverState] = useState<"loading" | "ready" | "unsupported">("loading");
  const [baseTimes, setBaseTimes] = useState<number[]>([]);
  const [picks, setPicks] = useState<number[]>([]);
  const [thumbs, setThumbs] = useState<(string | null)[]>([]);
  const [sel, setSel] = useState(0);
  const [coverNote, setCoverNote] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // One seek at a time: frames are grabbed from a single hidden <video>.
  const grabChain = useRef<Promise<unknown>>(Promise.resolve());
  const thumbUrls = useRef<string[]>([]);
  const tuned = useRef(false);
  const thumbH = reelW > 0 ? Math.round((COVER_THUMB_W * reelH) / reelW) : 200;

  const grab = useCallback((t: number, w: number, h: number, quality: number): Promise<Blob> => {
    const run = grabChain.current.catch(() => undefined).then(() => {
      const v = videoRef.current;
      if (!v) throw new Error("The reel isn't loaded.");
      return grabFrame(v, t, w, h, quality);
    });
    grabChain.current = run;
    return run;
  }, []);

  const keepThumb = useCallback((blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    thumbUrls.current.push(url);
    return url;
  }, []);

  // Load the rendered MP4 into a hidden <video> and pull the eight samples.
  useEffect(() => {
    if (!reelBlob) return;
    let cancelled = false;
    const url = URL.createObjectURL(reelBlob);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    videoRef.current = v;
    void (async () => {
      try {
        if (v.readyState < 2) await onceEvent(v, "loadeddata", 15000);
        const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
        if (!dur) throw new Error("No duration.");
        const lo = Math.min(COVER_SKIP_START, dur / 4);
        const hi = Math.max(lo, dur - COVER_SKIP_END);
        const times = Array.from({ length: COVER_SAMPLES }, (_, i) => lo + ((hi - lo) * i) / (COVER_SAMPLES - 1));
        if (cancelled) return;
        setBaseTimes(times);
        setPicks(times);
        setThumbs(times.map(() => null));
        setSel(0);
        for (let i = 0; i < times.length; i++) {
          const b = await grab(times[i], COVER_THUMB_W, thumbH, 0.85);
          if (cancelled) return;
          const t = keepThumb(b);
          setThumbs((prev) => { const next = prev.slice(); next[i] = t; return next; });
        }
        if (!cancelled) setCoverState("ready");
      } catch {
        if (!cancelled) setCoverState("unsupported");
      }
    })();
    return () => {
      cancelled = true;
      videoRef.current = null;
      v.removeAttribute("src");
      v.load();
      URL.revokeObjectURL(url);
    };
  }, [reelBlob, thumbH, grab, keepThumb]);

  // Thumbnails are freed when the dialog closes.
  useEffect(() => () => { thumbUrls.current.forEach((u) => URL.revokeObjectURL(u)); thumbUrls.current = []; }, []);

  // Fine-tuning: re-grab the selected sample's picture once the slider settles.
  const selTime = picks[sel];
  useEffect(() => {
    if (!tuned.current || coverState !== "ready" || selTime === undefined) return;
    const t = setTimeout(() => {
      tuned.current = false;
      const at = sel;
      grab(selTime, COVER_THUMB_W, thumbH, 0.85).then((b) => {
        const u = keepThumb(b);
        setThumbs((prev) => { const next = prev.slice(); next[at] = u; return next; });
      }).catch(() => { /* the old picture stays; the time is still what gets used */ });
    }, 200);
    return () => clearTimeout(t);
  }, [sel, selTime, coverState, grab, keepThumb, thumbH]);

  // The slider moves within half a gap either side of the chosen sample.
  const gap = baseTimes.length > 1 ? baseTimes[1] - baseTimes[0] : 1;
  const tuneMin = baseTimes.length ? Math.max(baseTimes[0], baseTimes[sel] - gap / 2) : 0;
  const tuneMax = baseTimes.length ? Math.min(baseTimes[baseTimes.length - 1], baseTimes[sel] + gap / 2) : 0;

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
        // The chosen cover, full size. Any trouble here posts without it
        // (Meta picks) and says so in one line — it never blocks the post.
        let coverPath: string | undefined;
        setCoverNote(null);
        if (coverState === "ready" && selTime !== undefined) {
          setBusy("cover");
          try {
            let jpeg = await grab(selTime, source.width, source.height, 0.9);
            if (jpeg.size > COVER_MAX_BYTES) jpeg = await grab(selTime, source.width, source.height, 0.75);
            if (jpeg.size > COVER_MAX_BYTES) throw new Error("the frame is over 10 MB");
            coverPath = await source.uploadCover(jpeg, selTime, () => {});
          } catch (e) {
            setCoverNote(`Couldn\u2019t use the chosen cover (${e instanceof Error ? e.message : "unknown error"}) \u2014 posting with Facebook\u2019s own pick.`);
          }
        } else if (coverState === "loading") {
          setCoverNote("The cover frames weren\u2019t ready yet \u2014 posting with Facebook\u2019s own pick.");
        }
        body = {
          sourceKind: "listing_reel", listingId: source.id, videoPath, coverPath,
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

            {isListing && (
              <div>
                <p className="label-caps mb-1.5">Cover</p>
                {coverState === "unsupported" ? (
                  <p className="text-xs text-ink-500">This browser can&rsquo;t read frames from the reel, so Facebook and Instagram will pick the cover.</p>
                ) : (
                  <>
                    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="listbox" aria-label="Cover frame">
                      {(thumbs.length ? thumbs : Array.from({ length: COVER_SAMPLES }, () => null)).map((t, i) => (
                        <button key={i} type="button" role="option" aria-selected={i === sel} disabled={!!busy || !t}
                          onClick={() => setSel(i)}
                          className={`shrink-0 w-14 aspect-[9/16] rounded-md overflow-hidden bg-ink-100 ring-2 ring-offset-1 ${i === sel ? "ring-accent-500" : "ring-transparent"} ${t ? "" : "animate-pulse"}`}>
                          {t && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={t} alt={`Frame at ${(picks[i] ?? 0).toFixed(1)} s`} className="h-full w-full object-cover" />
                          )}
                        </button>
                      ))}
                    </div>
                    {coverState === "ready" && selTime !== undefined && (
                      <div className="flex items-center gap-3 mt-2">
                        <input type="range" min={tuneMin} max={tuneMax} step={0.04} value={selTime} disabled={!!busy}
                          onChange={(e) => {
                            const t = Number(e.target.value);
                            tuned.current = true;
                            setPicks((prev) => { const next = prev.slice(); next[sel] = t; return next; });
                          }}
                          className="flex-1 accent-accent-500" aria-label="Fine-tune the cover frame" />
                        <span className="text-xs text-ink-500 tabular-nums w-12 text-right">{selTime.toFixed(1)} s</span>
                      </div>
                    )}
                    <p className="text-xs text-ink-400 mt-1">The picture Facebook and Instagram show before anyone taps the reel.</p>
                  </>
                )}
                {coverNote && <p className="text-xs text-warn-800 mt-1">{coverNote}</p>}
              </div>
            )}

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
              <button onClick={onClose} disabled={busy === "post" || busy === "upload" || busy === "cover"}
                className="flex-1 bg-white border border-hairline-strong hover:bg-ink-50 disabled:opacity-50 text-ink-700 text-sm font-medium py-2.5 rounded-ctl">
                Close
              </button>
              <button onClick={() => void submit()} disabled={!!busy || !conn || caption.length > MAX_CAPTION || (!fb && !wantIg)}
                className="flex-1 bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold py-2.5 rounded-ctl">
                {busy === "upload" ? `Uploading… ${uploadPct}%` : busy === "cover" ? "Preparing cover…" : busy === "post" ? (when === "now" ? "Posting… (up to a minute)" : "Scheduling…") : when === "now" ? "Post now" : "Schedule"}
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
                  {p.cover_note && p.cover_note !== "set" && <span className="w-full text-ink-400">Cover couldn&rsquo;t be set: {p.cover_note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
