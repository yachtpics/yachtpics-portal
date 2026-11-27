"use client";

/**
 * "Upload to YouTube" on the admin listing page (Nov 27, 2026). Admin only —
 * used by src/app/admin/listings/[id]/_components/AdminListingDetail.tsx.
 *
 * useYouTubeListing() makes ONE call for the whole listing
 * (GET /api/admin/youtube/uploads?listingId=) and polls every few seconds
 * only while an upload is in flight. <YouTubeVideoControl> sits in each
 * video's row: the button, the dialog, and the progress line. Before Google
 * and the migration are set up it shows one quiet line and nothing else.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  YOUTUBE_APP_AUDITED, YOUTUBE_DESCRIPTION_MAX, YOUTUBE_NOT_SET_UP, YOUTUBE_PRIVATE_UNTIL_AUDIT_NOTE, YOUTUBE_TITLE_MAX,
  isActiveUpload, type YouTubePrivacy,
} from "@/lib/youtube/config";

type Channel = { id: string; title: string | null; handle: string | null; needsReconnect: boolean };
type Upload = {
  id: string;
  videoId: string | null;
  channelId: string | null;
  title: string;
  status: string;
  bytesSent: number;
  bytesTotal: number | null;
  youtubeUrl: string | null;
  listingLinkWritten: boolean;
  error: string | null;
  createdAt: string;
};
type Ready = {
  channels: Channel[];
  uploads: Upload[];
  prefill: { title: string; description: string };
  listingYoutubeUrl: string | null;
};

export type YouTubeListingState =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "off" }
  | ({ kind: "ready" } & Ready);

export type YouTubeListing = {
  state: YouTubeListingState;
  refresh: () => Promise<void>;
  addUpload: (u: Upload) => void;
  listingId: string;
};

const POLL_MS = 4000;
const LAST_CHANNEL_KEY = "yp_youtube_last_channel";

export function useYouTubeListing(listingId: string): YouTubeListing {
  const [state, setState] = useState<YouTubeListingState>({ kind: "loading" });
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/youtube/uploads?listingId=${encodeURIComponent(listingId)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!alive.current) return;
      if (!res.ok) {
        // A read problem shouldn't put an error on the listing page.
        setState((prev) => (prev.kind === "ready" ? prev : { kind: "hidden" }));
        return;
      }
      if (!data.ready) {
        setState({ kind: "off" });
        return;
      }
      setState({
        kind: "ready",
        channels: data.channels ?? [],
        uploads: data.uploads ?? [],
        prefill: data.prefill ?? { title: "", description: "" },
        listingYoutubeUrl: data.listingYoutubeUrl ?? null,
      });
    } catch {
      if (alive.current) setState((prev) => (prev.kind === "ready" ? prev : { kind: "hidden" }));
    }
  }, [listingId]);

  useEffect(() => {
    alive.current = true;
    refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  const inFlight = state.kind === "ready" && state.uploads.some((u) => isActiveUpload(u.status));
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [inFlight, refresh]);

  const addUpload = useCallback((u: Upload) => {
    setState((prev) => (prev.kind === "ready" ? { ...prev, uploads: [u].concat(prev.uploads.filter((x) => x.id !== u.id)) } : prev));
  }, []);

  return { state, refresh, addUpload, listingId };
}

function pct(u: Upload): number {
  if (!u.bytesTotal) return 0;
  return Math.max(0, Math.min(100, Math.floor((u.bytesSent / u.bytesTotal) * 100)));
}

function readLastChannel(): string | null {
  try {
    return window.localStorage.getItem(LAST_CHANNEL_KEY);
  } catch {
    return null;
  }
}

function writeLastChannel(id: string) {
  try {
    window.localStorage.setItem(LAST_CHANNEL_KEY, id);
  } catch {
    /* private mode — nothing to remember */
  }
}

export function YouTubeVideoControl({ yt, videoId }: { yt: YouTubeListing; videoId: string }) {
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const s = yt.state;

  if (s.kind === "loading" || s.kind === "hidden") return null;
  if (s.kind === "off") return <p className="text-[11px] text-ink-400 mt-1.5">{YOUTUBE_NOT_SET_UP}</p>;

  const usable = s.channels.filter((c) => !c.needsReconnect);
  const latest = s.uploads.filter((u) => u.videoId === videoId)[0] ?? null;
  const active = latest && isActiveUpload(latest.status) ? latest : null;

  async function stop(u: Upload) {
    setStopping(true);
    setRowError(null);
    try {
      const res = await fetch(`/api/admin/youtube/uploads/${u.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setRowError(data.error ?? "Couldn't stop the upload.");
      await yt.refresh();
    } finally {
      setStopping(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setRowError("Couldn't copy. The link is " + url);
    }
  }

  const button = (
    <button
      onClick={() => setOpen(true)}
      className="text-xs font-medium text-accent-700 hover:text-accent-800 transition-colors duration-fast ease-quiet"
    >
      Upload to YouTube
    </button>
  );

  return (
    <div className="mt-1.5 text-xs">
      {active ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-ink-700 tabular-nums">
            {active.status === "processing"
              ? "YouTube is processing it"
              : active.status === "queued"
                ? "Getting ready to upload to YouTube"
                : `Uploading to YouTube: ${pct(active)}%`}
          </span>
          {active.status !== "processing" && (
            <span className="inline-block w-24 h-1.5 bg-ink-100 rounded-full overflow-hidden align-middle">
              <span className="block h-full bg-accent-500" style={{ width: `${pct(active)}%` }} />
            </span>
          )}
          {active.status !== "processing" && (
            <button onClick={() => stop(active)} disabled={stopping} className="text-ink-500 hover:text-danger-700 disabled:opacity-50">
              {stopping ? "Stopping…" : "Stop"}
            </button>
          )}
          <span className="text-ink-400">You can close this page.</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {latest?.status === "done" && latest.youtubeUrl && (
            <>
              <span className="text-ink-700">On YouTube</span>
              <a href={latest.youtubeUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-700 hover:text-accent-800">
                Open
              </a>
              <button onClick={() => copy(latest.youtubeUrl as string)} className="font-medium text-accent-700 hover:text-accent-800">
                {copied ? "Copied" : "Copy link"}
              </button>
              {latest.listingLinkWritten && <span className="text-ink-400">The link is on the listing.</span>}
            </>
          )}
          {latest?.status === "failed" && (
            <span className="text-danger-700">Didn&apos;t reach YouTube: {latest.error ?? "something went wrong."}</span>
          )}
          {latest?.status === "cancelled" && <span className="text-ink-500">Upload stopped.</span>}
          {s.channels.length === 0 ? (
            <Link href="/admin/youtube" className="font-medium text-accent-700 hover:text-accent-800">
              Connect a YouTube channel first
            </Link>
          ) : usable.length === 0 ? (
            <Link href="/admin/youtube" className="font-medium text-danger-700 hover:text-danger-600">
              Connect your YouTube channel again
            </Link>
          ) : (
            button
          )}
        </div>
      )}
      {rowError && <p className="text-danger-700 mt-1">{rowError}</p>}
      {open && usable.length > 0 && (
        <UploadDialog
          yt={yt}
          videoId={videoId}
          channels={usable}
          prefill={s.prefill}
          listingHasLink={!!s.listingYoutubeUrl}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function UploadDialog({
  yt, videoId, channels, prefill, listingHasLink, onClose,
}: {
  yt: YouTubeListing;
  videoId: string;
  channels: Channel[];
  prefill: { title: string; description: string };
  listingHasLink: boolean;
  onClose: () => void;
}) {
  const [channelId, setChannelId] = useState<string>(() => {
    const last = typeof window !== "undefined" ? readLastChannel() : null;
    return last && channels.some((c) => c.id === last) ? last : channels[0].id;
  });
  const [title, setTitle] = useState(prefill.title);
  const [description, setDescription] = useState(prefill.description);
  const [privacy, setPrivacy] = useState<YouTubePrivacy>("public");
  // Empty listing link: on by default. A link already there: replacing it is opt-in.
  const [setLink, setSetLink] = useState(!listingHasLink);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/youtube/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: yt.listingId,
          videoId,
          channelId,
          title,
          description,
          privacy,
          setListingLink: setLink,
          replaceListingLink: setLink && listingHasLink,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't start the upload.");
        return;
      }
      writeLastChannel(channelId);
      if (data.upload) yt.addUpload(data.upload as Upload);
      onClose();
      yt.refresh();
    } catch {
      setError("Couldn't reach the Portal. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const label = "block text-xs font-medium text-ink-700 mb-1";
  const field = "block w-full border border-hairline-strong rounded-ctl px-3 py-2 text-sm text-ink-900 focus:outline-none focus:border-accent-500";

  return (
    <div
      className="fixed inset-0 z-50 bg-ink-950/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Upload to YouTube"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div className="bg-white rounded-card p-6 max-w-lg w-full shadow-elev-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-h2 text-ink-900 mb-4">Upload to YouTube</h3>

        <div className="space-y-4">
          {channels.length > 1 && (
            <div>
              <label className={label} htmlFor="yt-channel">Channel</label>
              <select id="yt-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} className={field}>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title ?? c.handle ?? "Channel"}
                  </option>
                ))}
              </select>
            </div>
          )}
          {channels.length === 1 && (
            <p className="text-xs text-ink-500">
              Channel: <span className="text-ink-800 font-medium">{channels[0].title ?? channels[0].handle ?? "Connected channel"}</span>
            </p>
          )}

          <div>
            <label className={label} htmlFor="yt-title">Title</label>
            <input
              id="yt-title"
              value={title}
              maxLength={YOUTUBE_TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              className={field}
            />
            <p className="text-[11px] text-ink-400 mt-1 tabular-nums">{title.length} / {YOUTUBE_TITLE_MAX}</p>
          </div>

          <div>
            <label className={label} htmlFor="yt-description">Description</label>
            <textarea
              id="yt-description"
              value={description}
              maxLength={YOUTUBE_DESCRIPTION_MAX}
              rows={5}
              onChange={(e) => setDescription(e.target.value)}
              className={field}
            />
          </div>

          <fieldset>
            <legend className={label}>Visibility</legend>
            <div className="flex flex-wrap gap-4">
              {(["public", "unlisted", "private"] as YouTubePrivacy[]).map((p) => (
                <label key={p} className="flex items-center gap-1.5 text-sm text-ink-800">
                  <input type="radio" name="yt-privacy" value={p} checked={privacy === p} onChange={() => setPrivacy(p)} />
                  {p === "public" ? "Public" : p === "unlisted" ? "Unlisted" : "Private"}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex items-start gap-2 text-sm text-ink-800">
            <input type="checkbox" className="mt-0.5" checked={setLink} onChange={(e) => setSetLink(e.target.checked)} />
            {listingHasLink ? "Replace the listing's YouTube link" : "Put the YouTube link on this listing"}
          </label>

          {!YOUTUBE_APP_AUDITED && <p className="text-xs text-ink-500">{YOUTUBE_PRIVATE_UNTIL_AUDIT_NOTE}</p>}
          {error && <p className="text-sm text-danger-700">{error}</p>}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 bg-white border border-hairline-strong hover:bg-ink-50 disabled:opacity-50 text-ink-700 text-sm font-medium py-2.5 rounded-ctl transition-colors duration-fast ease-quiet"
          >
            Cancel
          </button>
          <button
            onClick={start}
            disabled={busy || !title.trim()}
            className="flex-1 bg-ink-900 hover:bg-ink-800 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-ctl transition-colors duration-fast ease-quiet"
          >
            {busy ? "Starting…" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}
