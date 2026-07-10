"use client";

import { useEffect, useState } from "react";

type DownloadLink = {
  id: string;
  token: string;
  url: string;
  label: string | null;
  expires_at: string | null;
  revoked: boolean;
  created_at: string;
  download_count: number;
  status: "active" | "expired" | "revoked";
};

const EXPIRY_OPTIONS = [
  { value: 30, label: "30 days" },
  { value: 7, label: "7 days" },
  { value: 90, label: "90 days" },
  { value: 0, label: "Never expires" },
];

export default function DownloadLinkManager({ listingId }: { listingId: string }) {
  const [links, setLinks] = useState<DownloadLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [expiryDays, setExpiryDays] = useState(30);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [emailOpenId, setEmailOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/download-links?listingId=${listingId}`)
      .then((r) => r.json())
      .then((d) => setLinks(d.links ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [listingId]);

  async function createLink() {
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/admin/download-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, label, expiryDays }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create link");
      setLinks((prev) => [data.link, ...prev]);
      setLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCreating(false);
    }
  }

  async function copyLink(link: DownloadLink) {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopiedId(link.id);
      setTimeout(() => setCopiedId((c) => (c === link.id ? null : c)), 1800);
    } catch {
      /* ignore */
    }
  }

  async function revokeLink(id: string) {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, revoked: true, status: "revoked" } : l)));
    await fetch(`/api/admin/download-links/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revoked: true }),
    }).catch(() => {});
  }

  function fmtDate(s: string) {
    return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  }

  const statusStyles: Record<string, string> = {
    active: "bg-success-50 text-success-700 border-success-200",
    expired: "bg-warn-50 text-warn-700 border-warn-200",
    revoked: "bg-ink-100 text-ink-600 border-hairline",
  };

  return (
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="label-caps">Public download links</h2>
        <span className="text-[11px] text-ink-500 bg-ink-50 border border-hairline rounded-full px-2 py-0.5">
          Admin only
        </span>
      </div>
      <p className="text-xs text-ink-500 mb-4 max-w-xl">
        Generate a private link anyone can use to download these photos — no portal login required.
        Brokers can&apos;t create these; only admins. Each link is tracked and can be revoked anytime.
      </p>

      {/* Create */}
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <div className="flex-1 min-w-[160px]">
          <label className="block text-[11px] font-medium text-ink-500 mb-1">Label (optional)</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Surveyor, John at XYZ"
            className="w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-ink-500 mb-1">Expires</label>
          <select
            value={expiryDays}
            onChange={(e) => setExpiryDays(Number(e.target.value))}
            className="text-sm bg-white border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={createLink}
          disabled={creating}
          className="bg-ink-950 hover:bg-ink-800 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
        >
          {creating ? "Creating…" : "Create link"}
        </button>
      </div>
      {error && <p className="text-xs text-danger-600 mb-3">{error}</p>}

      {/* List */}
      {loading ? (
        <p className="text-sm text-ink-400">Loading…</p>
      ) : links.length === 0 ? (
        <p className="text-sm text-ink-400">No download links yet.</p>
      ) : (
        <div className="space-y-2">
          {links.map((link) => (
            <div key={link.id} className="border border-hairline rounded-ctl p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold uppercase border rounded px-1.5 py-0.5 ${statusStyles[link.status]}`}>
                      {link.status}
                    </span>
                    {link.label && <span className="text-sm font-medium text-ink-800 truncate">{link.label}</span>}
                  </div>
                  <p className="text-[11px] text-ink-500 mt-1 tabular-nums">
                    Created {fmtDate(link.created_at)}
                    {" · "}
                    {link.expires_at ? `expires ${fmtDate(link.expires_at)}` : "no expiry"}
                    {" · "}
                    {link.download_count} download{link.download_count !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {link.status === "active" && (
                    <>
                      <button
                        onClick={() => copyLink(link)}
                        className="text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400 transition-colors duration-fast ease-quiet"
                      >
                        {copiedId === link.id ? "Copied ✓" : "Copy link"}
                      </button>
                      <button
                        onClick={() => setEmailOpenId(emailOpenId === link.id ? null : link.id)}
                        className="text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400 transition-colors duration-fast ease-quiet"
                      >
                        Email
                      </button>
                      <button
                        onClick={() => revokeLink(link.id)}
                        className="text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong text-danger-600 hover:border-danger-300 transition-colors duration-fast ease-quiet"
                      >
                        Revoke
                      </button>
                    </>
                  )}
                </div>
              </div>
              {emailOpenId === link.id && (
                <EmailForm link={link} onDone={() => setEmailOpenId(null)} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmailForm({ link, onDone }: { link: DownloadLink; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    if (!email) return;
    setSending(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/download-links/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkId: link.id, email, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send");
      setSent(true);
      setTimeout(onDone, 1200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  if (sent) return <p className="text-xs text-success-600 mt-3">Sent to {email} ✓</p>;

  return (
    <div className="mt-3 pt-3 border-t border-hairline space-y-2">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="recipient@email.com"
        className="w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
      />
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Optional message…"
        rows={2}
        className="w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 resize-none"
      />
      {err && <p className="text-xs text-danger-600">{err}</p>}
      <div className="flex gap-2">
        <button
          onClick={send}
          disabled={sending || !email}
          className="bg-ink-950 hover:bg-ink-800 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
        >
          {sending ? "Sending…" : "Send link"}
        </button>
        <button
          onClick={onDone}
          className="text-xs font-medium px-3 py-2 rounded-ctl text-ink-500 hover:text-ink-700 transition-colors duration-fast ease-quiet"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
