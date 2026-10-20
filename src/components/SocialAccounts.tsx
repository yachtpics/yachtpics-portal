"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Profile → Social accounts.
 *
 * Connect a Facebook Page (and the Instagram professional account linked to
 * it) so finished reels can be posted from the portal. Renders nothing unless
 * the server says the feature is open to this viewer (META_APP_ID set, and
 * admin — or brokers once SOCIAL_PUBLISHING_FOR_BROKERS is on).
 */

type Connection = { id: string; page_id: string; page_name: string | null; ig_user_id: string | null; ig_username: string | null; connected_at: string };
type PendingPage = { id: string; name: string; ig_user_id: string | null; ig_username: string | null; connected: boolean };
type State = {
  configured: boolean; allowed: boolean; isAdmin: boolean; missing?: string[];
  connections: Connection[]; pending: PendingPage[] | null; pendingError?: string; error?: string;
};

/** Public Page profile picture (redirects to the image; no token needed for public Pages). */
export function pagePicture(pageId: string) {
  return `https://graph.facebook.com/${encodeURIComponent(pageId)}/picture?type=square&width=80&height=80`;
}

/** Help page entry on where the Portal can post (section id on the Help page). */
const HELP_WHERE_TO_POST = "/dashboard/help#where-can-the-portal-post";

/** Quiet note under a Page that has no Instagram account linked to it. */
function NoInstagramNote() {
  return (
    <p className="text-xs text-ink-500 mt-1 leading-relaxed">
      No Instagram account is linked to this Page yet. If your Instagram is a personal account, switch it to Creator
      (free, two minutes) and link it to this Page. Then click Connect Facebook &amp; Instagram again.{" "}
      <a href={HELP_WHERE_TO_POST} className="underline hover:text-ink-700">Show me how</a>
    </p>
  );
}

export default function SocialAccounts() {
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/social/connections", { cache: "no-store" });
      if (!res.ok) { setS(null); return; }
      const d = (await res.json()) as State;
      setS(d);
      if (d.pending) setPicked(d.pending.filter((p) => !p.connected).slice(0, 1).map((p) => p.id));
    } catch {
      setS(null);
    }
  }, []);

  useEffect(() => {
    void load();
    // Messages from the Facebook round trip (?social=choose / ?social=error&reason=…).
    const q = new URLSearchParams(window.location.search);
    const social = q.get("social");
    if (social === "error") setMsg({ type: "error", text: q.get("reason") || "Couldn’t connect to Facebook." });
    if (social) {
      q.delete("social"); q.delete("reason");
      const rest = q.toString();
      window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash);
    }
  }, [load]);

  if (!s || !s.allowed) return null;

  async function choose() {
    if (picked.length === 0) return;
    setBusy("choose"); setMsg(null);
    try {
      const res = await fetch("/api/social/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "choose", pageIds: picked }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error ?? "Couldn’t save.");
      setMsg({ type: "success", text: `Connected ${d.saved} Page${d.saved === 1 ? "" : "s"}.` });
      await load();
    } catch (e) {
      setMsg({ type: "error", text: e instanceof Error ? e.message : "Couldn’t save." });
    } finally { setBusy(""); }
  }

  async function discard() {
    setBusy("discard");
    await fetch("/api/social/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "discard" }) }).catch(() => null);
    setBusy("");
    await load();
  }

  async function disconnect(c: Connection) {
    if (!window.confirm(`Disconnect ${c.page_name ?? "this Page"}? The portal deletes its stored Facebook access right away, and any posts scheduled to it are cancelled.`)) return;
    setBusy(c.id); setMsg(null);
    try {
      const res = await fetch(`/api/social/connections?id=${encodeURIComponent(c.id)}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error ?? "Couldn’t disconnect.");
      setMsg({ type: "success", text: `Disconnected ${c.page_name ?? "the Page"}.` });
      await load();
    } catch (e) {
      setMsg({ type: "error", text: e instanceof Error ? e.message : "Couldn’t disconnect." });
    } finally { setBusy(""); }
  }

  const connectBtn = "inline-flex items-center gap-2 bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-semibold px-4 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet";

  return (
    <section id="social-accounts" className="bg-white border border-hairline rounded-card shadow-elev-1 p-6 mb-5 scroll-mt-6">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-h2 text-ink-900">Social accounts</h2>
        {s.isAdmin && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-ink-100 text-ink-600">Admin only for now</span>}
      </div>
      <p className="text-ink-500 text-sm mb-5">
        Connect your Facebook Page and its linked Instagram account to post finished reels straight from the portal.
        We only publish the reels you choose &mdash; we never read your messages, comments or followers.
      </p>

      {msg && (
        <div className={`mb-4 px-4 py-3 rounded-card border text-sm ${msg.type === "success" ? "bg-success-50 border-success-200 text-success-700" : "bg-danger-50 border-danger-200 text-danger-600"}`}>
          {msg.text}
        </div>
      )}
      {s.error && <p className="mb-4 text-sm text-danger-700">{s.error}</p>}

      {!s.configured ? (
        <div className="px-4 py-3 rounded-card border border-warn-300 bg-warn-50 text-sm text-warn-800">
          Facebook isn&rsquo;t configured on the portal yet.
          {s.missing?.length ? <> Missing in Vercel: <code className="text-xs">{s.missing.join(", ")}</code>. See <code className="text-xs">docs/meta-setup.md</code>.</> : null}
        </div>
      ) : (
        <>
          {s.pending && (
            <div className="mb-5 border border-accent-300 bg-accent-50 rounded-card p-4">
              <p className="text-sm font-semibold text-ink-900 mb-1">Pick the Page to connect</p>
              {s.pending.length === 0 ? (
                <div className="text-sm text-ink-600 space-y-1.5">
                  <p>
                    Facebook did not show any Pages for this login. The Portal can post to a Facebook Page, not to a personal
                    profile. Create a Page for your business (free, five minutes), then try again.{" "}
                    <a href="https://www.facebook.com/pages/create" target="_blank" rel="noopener noreferrer" className="underline hover:text-ink-800">Create a Page</a>
                  </p>
                  <p className="text-xs text-ink-500">Already have a Page? Click Connect again and tick it when Facebook asks which Pages to allow.</p>
                </div>
              ) : (
                <ul className="divide-y divide-hairline mt-2">
                  {s.pending.map((p) => (
                    <li key={p.id} className="py-2.5 flex items-center gap-3">
                      <input type="checkbox" className="h-4 w-4 accent-accent-500" checked={picked.indexOf(p.id) >= 0}
                        onChange={(e) => setPicked((cur) => e.target.checked ? cur.concat(p.id) : cur.filter((x) => x !== p.id))} />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={pagePicture(p.id)} alt="" className="h-8 w-8 rounded-full bg-ink-100 object-cover" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-900 truncate">{p.name}{p.connected && <span className="text-xs font-normal text-ink-500"> &middot; already connected</span>}</p>
                        {p.ig_user_id
                          ? <p className="text-xs text-ink-500">{p.ig_username ? `Instagram @${p.ig_username}` : "Instagram linked"}</p>
                          : <NoInstagramNote />}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {s.pendingError && <p className="text-sm text-danger-700 mt-2">{s.pendingError}</p>}
              <div className="flex gap-3 mt-3">
                <button onClick={() => void choose()} disabled={picked.length === 0 || !!busy}
                  className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl">
                  {busy === "choose" ? "Connecting…" : "Connect selected"}
                </button>
                <button onClick={() => void discard()} disabled={!!busy} className="text-sm text-ink-500 hover:text-ink-700">Cancel</button>
              </div>
            </div>
          )}

          {s.connections.length > 0 && (
            <ul className="divide-y divide-hairline mb-4">
              {s.connections.map((c) => (
                <li key={c.id} className="py-3 flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pagePicture(c.page_id)} alt="" className="h-10 w-10 rounded-full bg-ink-100 object-cover" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink-900 truncate">{c.page_name ?? "Facebook Page"}</p>
                    {c.ig_user_id
                      ? <p className="text-xs text-ink-500">{c.ig_username ? `@${c.ig_username}` : "Instagram linked"}</p>
                      : <><p className="text-xs text-ink-500">Facebook only for now</p><NoInstagramNote /></>}
                  </div>
                  <button onClick={() => void disconnect(c)} disabled={!!busy}
                    className="text-xs text-danger-600 hover:text-danger-700 disabled:opacity-50">
                    {busy === c.id ? "Disconnecting…" : "Disconnect"}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <a href="/api/meta/connect" className={connectBtn}>
            {s.connections.length ? "Connect another Page" : "Connect Facebook & Instagram"}
          </a>
          <p className="text-ink-500 text-xs mt-2">
            To post to Instagram, your Instagram must be a business or creator account (not a personal one) and be linked to the Page.{" "}
            <a href={HELP_WHERE_TO_POST} className="underline hover:text-ink-700">Show me how</a>{" · "}
            <a href="/privacy" className="underline hover:text-ink-700">Privacy</a>
          </p>
        </>
      )}
    </section>
  );
}
