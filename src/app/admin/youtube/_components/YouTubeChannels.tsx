"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { YOUTUBE_NOT_SET_UP } from "@/lib/youtube/config";
import { youtubeConnectError } from "@/lib/youtube/messages";

type Channel = {
  id: string;
  channelId: string;
  title: string | null;
  handle: string | null;
  thumbnailUrl: string | null;
  needsReconnect: boolean;
  connectedAt: string;
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "off"; reason: string }
  | { kind: "ready"; channels: Channel[] };

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

export default function YouTubeChannels({ connected, errorCode }: { connected: boolean; errorCode: string | null }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [pending, setPending] = useState<Channel | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(connected ? "Channel connected." : null);
  const [error, setError] = useState<string | null>(youtubeConnectError(errorCode));

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/youtube/channels", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ kind: "error", message: data.error ?? "Couldn't load the channels." });
        return;
      }
      if (!data.ready) {
        setState({ kind: "off", reason: data.reason ?? "env" });
        return;
      }
      setState({ kind: "ready", channels: (data.channels ?? []) as Channel[] });
    } catch {
      setState({ kind: "error", message: "Couldn't load the channels." });
    }
  }, []);

  useEffect(() => {
    load();
    // Drop ?connected / ?error from the address bar so a reload doesn't repeat the message.
    if (connected || errorCode) {
      try {
        window.history.replaceState(null, "", "/admin/youtube");
      } catch {
        /* ignore */
      }
    }
  }, [load, connected, errorCode]);

  async function disconnect() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/youtube/channels/${pending.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't disconnect that channel.");
      } else {
        setNote(`${pending.title ?? "The channel"} is disconnected. Videos already on YouTube stay there.`);
        await load();
      }
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  if (state.kind === "loading") return <p className="text-sm text-ink-500">Loading…</p>;
  if (state.kind === "error") return <p className="text-sm text-danger-700">{state.message}</p>;

  if (state.kind === "off") {
    return (
      <div className="bg-white border border-hairline rounded-card p-5">
        <p className="text-sm font-medium text-ink-900">{YOUTUBE_NOT_SET_UP}</p>
        <p className="text-xs text-ink-500 mt-1">
          {state.reason === "migration"
            ? "The Google keys are in place. The database update (supabase/migrations/20261127_youtube_upload.sql) still needs to be run."
            : state.reason === "error"
              ? "The YouTube tables couldn't be read. Try again in a minute."
              : "The Google sign-in keys aren't in Vercel yet. The steps are in docs/youtube-setup.md."}
        </p>
        {error && <p className="text-xs text-danger-700 mt-2">{error}</p>}
      </div>
    );
  }

  const channels = state.channels;
  return (
    <div className="space-y-4">
      {note && <p className="text-sm text-ink-700 bg-ink-50 border border-hairline rounded-ctl px-3 py-2">{note}</p>}
      {error && <p className="text-sm text-danger-700 bg-danger-50 border border-danger-200 rounded-ctl px-3 py-2">{error}</p>}

      <div className="bg-white border border-hairline rounded-card">
        {channels.length === 0 ? (
          <p className="text-sm text-ink-500 px-5 py-4">No channel connected yet.</p>
        ) : (
          channels.map((c) => (
            <div key={c.id} className="flex items-center gap-4 px-5 py-4 border-b border-hairline last:border-0">
              {c.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.thumbnailUrl} alt="" className="w-10 h-10 rounded-full object-cover shrink-0 bg-ink-100" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-ink-100 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink-900 truncate">{c.title ?? "Untitled channel"}</p>
                <p className="text-xs text-ink-500 truncate">
                  {c.handle ?? c.channelId} · connected {fmtDate(c.connectedAt)}
                </p>
                {c.needsReconnect && (
                  <p className="text-xs text-danger-700 mt-0.5">
                    Google stopped the Portal&apos;s permission. Connect this channel again to keep uploading.
                  </p>
                )}
              </div>
              {c.needsReconnect && (
                <a href="/api/admin/youtube/connect" className="text-xs font-semibold text-accent-700 hover:text-accent-800 shrink-0">
                  Connect again
                </a>
              )}
              <button
                onClick={() => setPending(c)}
                className="text-xs font-medium text-danger-600 hover:text-danger-700 transition-colors duration-fast ease-quiet shrink-0"
              >
                Disconnect
              </button>
            </div>
          ))
        )}
      </div>

      <div>
        <a
          href="/api/admin/youtube/connect"
          className="inline-block bg-ink-900 hover:bg-ink-800 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
        >
          Connect a channel
        </a>
        <p className="text-xs text-ink-500 mt-2">
          One channel per Google sign-in. If the channel belongs to a Brand Account, pick it on Google&apos;s screen.
        </p>
      </div>

      <ConfirmDeleteDialog
        open={!!pending}
        title={`Disconnect ${pending?.title ?? "this channel"}?`}
        body="The Portal won't be able to upload to it until it's connected again. Videos already on YouTube stay there."
        confirmLabel="Disconnect"
        busy={busy}
        busyLabel="Disconnecting…"
        onConfirm={disconnect}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
