"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { uploadVideoToPrivateBucket } from "@/lib/uploadListingVideo";

type Photo = { id: string; storage_path: string; filename: string | null; category: string | null; display_order: number | null; is_visible: boolean | null; url: string | null };
type Video = { id: string; storage_path: string; filename: string | null; created_at: string; url: string | null };
type Recipient = {
  userId: string;
  name: string | null;
  email: string | null;
  lastOpenedAt?: string | null;
  openCount?: number;
  filesDownloaded?: number;
  lastDownloadAt?: string | null;
};
type Gallery = { id: string; title: string; gallery_type: string; slug: string; expires_at: string | null; slideshow_published: boolean; downloads_enabled: boolean; created_at: string };
type Metrics = { views: number; downloadEvents: number; downloadItems: number; lastDownloadAt: string | null; openedRecipients: number; totalRecipients: number };

const SITE_URL = "https://portal.yachtpics.com";

/** Storage rejects anything larger, so catch it in the browser first. */
const MAX_VIDEO_BYTES = 2_097_152_000; // 2 GB — matches the listing-videos bucket
const MAX_VIDEO_LABEL = "2 GB";

function fmtGB(bytes: number) {
  const gb = bytes / 1_073_741_824;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1_048_576)} MB`;
}

export default function GalleryDetail({
  gallery,
  photos: initPhotos,
  videos: initVideos,
  recipients: initRecipients,
  metrics,
}: {
  gallery: Gallery;
  photos: Photo[];
  videos: Video[];
  recipients: Recipient[];
  metrics: Metrics;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [photos, setPhotos] = useState<Photo[]>(initPhotos);
  const [videos, setVideos] = useState<Video[]>(initVideos);
  const [recipients, setRecipients] = useState<Recipient[]>(initRecipients);
  const [expiresAt, setExpiresAt] = useState<string | null>(gallery.expires_at);
  const [downloadsEnabled, setDownloadsEnabled] = useState<boolean>(gallery.downloads_enabled);
  const [title, setTitle] = useState(gallery.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(gallery.title);
  const [savingTitle, setSavingTitle] = useState(false);

  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [uploadingVideos, setUploadingVideos] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoError, setVideoError] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [sending, setSending] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [addingRecipient, setAddingRecipient] = useState(false);
  const [recipientError, setRecipientError] = useState("");

  const slideshowUrl = `${SITE_URL}/g/${gallery.slug}`;
  const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;

  function fmtDate(s: string) {
    return new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" });
  }
  function fmtDay(s: string) {
    return new Date(s).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  }

  async function handlePhotos(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadingPhotos(true);
    setMsg("");
    // Stamped with which admin uploaded — "who put these here?" has a name.
    const { data: { user: uploader } } = await supabase.auth.getUser();
    let order = photos.length;
    for (const file of Array.from(fileList)) {
      try {
        const ext = file.name.split(".").pop() || "jpg";
        const path = `galleries/${gallery.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("listing-photos").upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const { data: row, error: insErr } = await supabase
          .from("photos")
          .insert({ gallery_id: gallery.id, storage_path: path, filename: file.name, display_order: order++, is_visible: true, uploaded_by: uploader?.id ?? null })
          .select("id, storage_path, filename, category, display_order, is_visible")
          .single();
        if (insErr) throw insErr;
        const { data: signed } = await supabase.storage.from("listing-photos").createSignedUrl(path, 3600);
        setPhotos((prev) => [...prev, { ...(row as Photo), url: signed?.signedUrl ?? null }]);
      } catch (e) {
        setMsg(`Photo upload failed: ${e instanceof Error ? e.message : "error"}`);
      }
    }
    setUploadingPhotos(false);
  }

  async function handleVideos(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setVideoError("");

    // Storage caps a single video at 2 GB. Catch that HERE rather than letting
    // someone wait out a 30-minute upload that was always going to be rejected —
    // which is exactly what used to happen with raw camera files.
    const all = Array.from(fileList);
    const tooBig = all.filter((f) => f.size > MAX_VIDEO_BYTES);
    const ok = all.filter((f) => f.size <= MAX_VIDEO_BYTES);
    if (tooBig.length > 0) {
      setVideoError(
        `${tooBig.map((f) => `${f.name} (${fmtGB(f.size)})`).join(", ")} ` +
        `${tooBig.length === 1 ? "is" : "are"} over the ${MAX_VIDEO_LABEL} limit and can't be uploaded. ` +
        `Export a finished 1080p version first — a raw camera file is far larger than a broker needs.`
      );
      if (ok.length === 0) return;
    }

    setUploadingVideos(true);
    setVideoProgress(0);
    setMsg("");

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setVideoError("Your session expired. Refresh the page and sign in again.");
      setUploadingVideos(false);
      return;
    }
    for (let i = 0; i < ok.length; i++) {
      const file = ok[i];
      try {
        // Gallery video goes to the private Cloudflare bucket through the same
        // drop-proof transport listings use: large files travel as retried
        // 32MB pieces, so a connection hiccup costs seconds, not the file.
        const uploaded = await uploadVideoToPrivateBucket({
          file,
          target: { galleryId: gallery.id },
          onProgress: (pct) => {
            const base = (i / ok.length) * 100;
            setVideoProgress(Math.round(base + pct / ok.length));
          },
        });
        if (!uploaded.ok) throw new Error(uploaded.error);

        const { data: row, error: insErr } = await supabase
          .from("videos")
          .insert({ gallery_id: gallery.id, storage_path: uploaded.path, storage_host: "r2", filename: file.name, uploaded_by: session.user.id })
          .select("id, storage_path, filename, created_at")
          .single();
        if (insErr) throw insErr;
        setVideos((prev) => [...prev, { ...(row as Video), url: uploaded.playbackUrl }]);
      } catch (e) {
        setVideoError(`${file.name} failed to upload — ${e instanceof Error ? e.message : "error"}.`);
      }
      setVideoProgress(Math.round(((i + 1) / ok.length) * 100));
    }
    setUploadingVideos(false);
    setVideoProgress(0);
  }

  async function deletePhoto(p: Photo) {
    if (!confirm("Remove this photo?")) return;
    // Through the delete API so it lands in the deletion log like every other
    // removal — gallery photos included.
    await fetch("/api/photos/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoIds: [p.id] }),
    });
    setPhotos((prev) => prev.filter((x) => x.id !== p.id));
  }

  async function toggleVisible(p: Photo) {
    const nv = !(p.is_visible ?? true);
    setPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_visible: nv } : x)));
    await supabase.from("photos").update({ is_visible: nv }).eq("id", p.id);
  }

  function onPhotoDrop(toIndex: number) {
    const from = dragIndex;
    setDragIndex(null);
    if (from === null || from === toIndex) return;
    const arr = [...photos];
    const [moved] = arr.splice(from, 1);
    arr.splice(toIndex, 0, moved);
    setPhotos(arr);
    // Persist new order
    arr.forEach((p, i) => {
      supabase.from("photos").update({ display_order: i }).eq("id", p.id).then(() => {});
    });
  }

  async function deleteVideo(v: Video) {
    if (!confirm("Remove this video?")) return;
    // Through the API, because the file may live on the private Cloudflare
    // bucket, which the browser has no credentials to delete from. The route
    // clears whichever store holds it.
    const res = await fetch("/api/videos/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId: v.id }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setVideoError(`Couldn't delete that video — ${data.error ?? res.statusText}.`);
      return;
    }
    setVideos((prev) => prev.filter((x) => x.id !== v.id));
  }

  async function addRecipient() {
    if (!newEmail.trim()) return;
    setAddingRecipient(true);
    setRecipientError("");
    try {
      const res = await fetch(`/api/admin/galleries/${gallery.id}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim(), firstName: newFirst.trim(), lastName: newLast.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add recipient");
      setRecipients((prev) => [
        ...prev,
        { userId: data.userId, name: [newFirst, newLast].filter(Boolean).join(" ").trim() || null, email: newEmail.trim() },
      ]);
      setMsg(data.tempPassword ? `Invited ${newEmail.trim()} — temporary password: ${data.tempPassword}` : `${newEmail.trim()} was given access and emailed.`);
      setNewEmail("");
      setNewFirst("");
      setNewLast("");
    } catch (e) {
      setRecipientError(e instanceof Error ? e.message : "Failed to add recipient");
    } finally {
      setAddingRecipient(false);
    }
  }

  async function removeRecipient(userId: string) {
    setRecipients((prev) => prev.filter((r) => r.userId !== userId));
    await fetch(`/api/admin/galleries/${gallery.id}/invite`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    }).catch(() => {});
  }

  async function saveTitle() {
    const next = titleDraft.trim();
    if (!next || next === title) {
      setEditingTitle(false);
      setTitleDraft(title);
      return;
    }
    setSavingTitle(true);
    const res = await fetch(`/api/admin/galleries/${gallery.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    });
    setSavingTitle(false);
    if (res.ok) {
      setTitle(next);
      setEditingTitle(false);
      setMsg("Gallery name updated.");
    } else {
      setMsg("Couldn't update the name. Please try again.");
      setTitleDraft(title);
    }
  }

  async function toggleDownloads() {
    const nv = !downloadsEnabled;
    setDownloadsEnabled(nv); // optimistic
    const res = await fetch(`/api/admin/galleries/${gallery.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ downloadsEnabled: nv }),
    });
    if (!res.ok) {
      setDownloadsEnabled(!nv);
      setMsg("Couldn't update the download setting. Please try again.");
    } else {
      setMsg(nv ? "Downloads are ON — visitors can download this gallery." : "Downloads are OFF — this gallery is view-only.");
    }
  }

  async function setExpiry(payload: { days?: number | null; date?: string | null; clear?: boolean }) {
    const res = await fetch(`/api/admin/galleries/${gallery.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiry: payload }),
    });
    if (res.ok) {
      if (payload.clear) setExpiresAt(null);
      else if (typeof payload.days === "number") setExpiresAt(new Date(Date.now() + payload.days * 86400000).toISOString());
      else if (payload.date) setExpiresAt(new Date(payload.date).toISOString());
      setMsg("Expiry updated.");
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(slideshowUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  }

  async function sendSlideshow() {
    if (!sendEmail.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/galleries/${gallery.id}/send-slideshow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: sendEmail.trim(), message: sendMessage.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send");
      setMsg(`Slideshow sent to ${sendEmail.trim()}.`);
      setSendEmail("");
      setSendMessage("");
      setSendOpen(false);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link href="/admin/galleries" className="text-ink-400 hover:text-ink-600 text-sm transition-colors duration-fast ease-quiet">&larr; All galleries</Link>
        <div className="mt-2 flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            {editingTitle ? (
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveTitle();
                    if (e.key === "Escape") { setEditingTitle(false); setTitleDraft(title); }
                  }}
                  className="text-display text-ink-900 border border-hairline-strong rounded-ctl px-3 py-1.5 min-w-[18rem] focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
                  placeholder="Gallery name"
                />
                <button
                  onClick={saveTitle}
                  disabled={savingTitle}
                  className="text-xs font-semibold px-3 py-2 rounded-ctl bg-ink-950 text-white hover:bg-ink-800 disabled:opacity-50 transition-colors duration-fast ease-quiet"
                >
                  {savingTitle ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => { setEditingTitle(false); setTitleDraft(title); }}
                  className="text-xs font-medium px-3 py-2 rounded-ctl text-ink-500 hover:text-ink-700 transition-colors duration-fast ease-quiet"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-display text-ink-900">{title}</h1>
                <button
                  onClick={() => { setTitleDraft(title); setEditingTitle(true); }}
                  className="text-xs font-medium px-2.5 py-1 rounded-ctl border border-hairline-strong text-ink-600 hover:border-ink-400 hover:text-ink-900 transition-colors duration-fast ease-quiet"
                  title="Rename this gallery"
                >
                  Rename
                </button>
              </div>
            )}
            <p className="text-ink-500 text-sm mt-0.5 capitalize">
              {gallery.gallery_type} · {photos.length} photo{photos.length !== 1 ? "s" : ""}{videos.length > 0 ? `, ${videos.length} video${videos.length !== 1 ? "s" : ""}` : ""}
            </p>
          </div>
          <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${expired ? "bg-ink-100 text-ink-600 border-hairline" : "bg-success-50 text-success-700 border-success-200"}`}>
            {expired ? "Gallery expired" : expiresAt ? `Available until ${fmtDay(expiresAt)}` : "No time limit"}
          </span>
        </div>
      </div>

      {msg && (
        <div className="mb-5 px-4 py-3 rounded-ctl text-sm bg-success-50 border border-success-200 text-success-700 flex items-start justify-between gap-3">
          <span>{msg}</span>
          <button onClick={() => setMsg("")} className="shrink-0 text-success-600 hover:text-success-700 font-bold">×</button>
        </div>
      )}

      {/* Share + metrics */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
          <h2 className="label-caps mb-2">Slideshow link</h2>
          <p className="text-xs text-ink-500 mb-3">Anyone with this link can view the slideshow. Downloads still require a recipient login.</p>
          <div className="flex items-center gap-2">
            <input readOnly value={slideshowUrl} className="flex-1 text-sm border border-hairline-strong rounded-ctl px-3 py-2 bg-ink-50 text-ink-600" />
            <button onClick={copyLink} className="text-sm font-medium px-3 py-2 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400 transition-colors duration-fast ease-quiet shrink-0">
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <div className="mt-3 pt-3 border-t border-hairline">
            {!sendOpen ? (
              <button
                onClick={() => setSendOpen(true)}
                className="w-full text-sm font-semibold px-4 py-2 rounded-ctl border border-ink-300 text-ink-800 hover:border-ink-400 hover:bg-ink-50 transition-colors duration-fast ease-quiet"
              >
                ✉ Email this slideshow to someone
              </button>
            ) : (
              <div className="space-y-2">
                <input
                  type="email"
                  value={sendEmail}
                  onChange={(e) => setSendEmail(e.target.value)}
                  placeholder="recipient@email.com"
                  className="w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
                />
                <textarea
                  value={sendMessage}
                  onChange={(e) => setSendMessage(e.target.value)}
                  placeholder="Optional message…"
                  rows={2}
                  className="w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={sendSlideshow}
                    disabled={sending || !sendEmail.trim()}
                    className="bg-ink-950 hover:bg-ink-800 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
                  >
                    {sending ? "Sending…" : "Send link"}
                  </button>
                  <button onClick={() => setSendOpen(false)} className="text-xs font-medium px-3 py-2 rounded-ctl text-ink-500 hover:text-ink-700 transition-colors duration-fast ease-quiet">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
          <h2 className="label-caps mb-3">Activity</h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xl font-light tabular-nums text-ink-900">{metrics.views}</p>
              <p className="text-[11px] text-ink-500">Slideshow views</p>
            </div>
            <div>
              <p className="text-xl font-light tabular-nums text-ink-900">{metrics.downloadItems}</p>
              <p className="text-[11px] text-ink-500">Files downloaded</p>
            </div>
            <div>
              <p className="text-xl font-light tabular-nums text-ink-900">{metrics.downloadEvents}</p>
              <p className="text-[11px] text-ink-500">Download sessions</p>
            </div>
          </div>
          {metrics.totalRecipients > 0 && (
            <p className="text-[11px] text-ink-500 mt-3 text-center tabular-nums">
              Opened by {metrics.openedRecipients} of {metrics.totalRecipients} recipient{metrics.totalRecipients === 1 ? "" : "s"}
            </p>
          )}
          {metrics.lastDownloadAt && (
            <p className="text-[11px] text-ink-500 mt-1 text-center tabular-nums">Last download {fmtDate(metrics.lastDownloadAt)}</p>
          )}
          <p className="text-[10px] text-ink-400 mt-3 leading-relaxed">
            Slideshow views count anonymous opens of the public share link. Opens and downloads below are tracked per signed-in recipient.
          </p>
        </div>
      </div>

      {/* Downloads control */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="label-caps mb-1">Allow downloads</h2>
            <p className="text-xs text-ink-500">
              {downloadsEnabled
                ? "Anyone viewing this gallery can download the photos and videos."
                : "This gallery is view-only — no download button is shown."}
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <span className={`text-xs font-semibold uppercase tracking-wide tabular-nums w-7 text-right ${downloadsEnabled ? "text-success-700" : "text-ink-400"}`}>
              {downloadsEnabled ? "On" : "Off"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={downloadsEnabled}
              onClick={toggleDownloads}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-fast ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 ${downloadsEnabled ? "bg-success-600 border-success-700" : "bg-ink-300 border-ink-400"}`}
              aria-label="Allow downloads for this gallery"
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-fast ease-quiet ${downloadsEnabled ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-hairline">
        <h2 className="label-caps mb-1">Time limit</h2>
        <p className="text-xs text-ink-500 mb-3">Set how long this gallery link stays good for. After it expires, the link stops working &mdash; both viewing and downloads. Leave as &ldquo;No expiry&rdquo; to keep it open indefinitely.</p>
        <div className="flex flex-wrap gap-2">
          {[30, 60, 90].map((d) => (
            <button key={d} onClick={() => setExpiry({ days: d })} className="text-sm px-3 py-2 rounded-ctl border border-hairline-strong text-ink-700 hover:border-accent-500 transition-colors duration-fast ease-quiet">
              {d} days from now
            </button>
          ))}
          <button onClick={() => setExpiry({ clear: true })} className="text-sm px-3 py-2 rounded-ctl border border-hairline-strong text-ink-700 hover:border-accent-500 transition-colors duration-fast ease-quiet">
            No expiry
          </button>
          <label className="text-sm px-3 py-2 rounded-ctl border border-hairline-strong text-ink-700 hover:border-accent-500 transition-colors duration-fast ease-quiet cursor-pointer">
            Set date…
            <input type="date" className="ml-2 text-xs" onChange={(e) => e.target.value && setExpiry({ date: e.target.value })} />
          </label>
        </div>
        </div>
      </div>

      {/* Recipients */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6">
        <h2 className="label-caps mb-1">Recipients</h2>
        <p className="text-xs text-ink-500 mb-4">People with a free login to download from this gallery. They&apos;re emailed an invite when added.</p>

        <div className="flex flex-wrap items-end gap-2 mb-4">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] font-medium text-ink-500 mb-1">Email</label>
            <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="recipient@email.com" className="w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ink-500 mb-1">First name</label>
            <input value={newFirst} onChange={(e) => setNewFirst(e.target.value)} className="w-32 text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ink-500 mb-1">Last name</label>
            <input value={newLast} onChange={(e) => setNewLast(e.target.value)} className="w-32 text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500" />
          </div>
          <button onClick={addRecipient} disabled={addingRecipient} className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet">
            {addingRecipient ? "Adding…" : "Add & invite"}
          </button>
        </div>
        {recipientError && <p className="text-xs text-danger-600 mb-3">{recipientError}</p>}

        {recipients.length === 0 ? (
          <p className="text-sm text-ink-400">No recipients yet.</p>
        ) : (
          <div className="space-y-1.5">
            {recipients.map((r) => {
              const opened = (r.openCount ?? 0) > 0;
              const files = r.filesDownloaded ?? 0;
              return (
              <div key={r.userId} className="flex items-center justify-between gap-3 border border-hairline rounded-ctl px-3 py-2">
                <div className="min-w-0">
                  <div>
                    {r.name && <span className="text-sm font-medium text-ink-800">{r.name} </span>}
                    <span className="text-sm text-ink-500">{r.email}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                    {opened ? (
                      <span className="inline-flex items-center gap-1 text-success-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-success-500" aria-hidden />
                        Opened{r.lastOpenedAt ? ` · last ${fmtDate(r.lastOpenedAt)}` : ""}
                        {(r.openCount ?? 0) > 1 ? ` · ${r.openCount}×` : ""}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-ink-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-ink-300" aria-hidden />
                        Not opened yet
                      </span>
                    )}
                    {files > 0 && (
                      <span className="text-ink-500 tabular-nums">
                        · {files} file{files === 1 ? "" : "s"} downloaded{r.lastDownloadAt ? ` · last ${fmtDate(r.lastDownloadAt)}` : ""}
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => removeRecipient(r.userId)} className="text-xs font-medium text-danger-600 hover:text-danger-700 shrink-0">Remove</button>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Photos */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="label-caps">Photos ({photos.length})</h2>
          <label className="bg-ink-950 hover:bg-ink-800 text-white text-sm font-medium px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet cursor-pointer">
            {uploadingPhotos ? "Uploading…" : "Upload photos"}
            <input type="file" accept="image/*" multiple className="hidden" disabled={uploadingPhotos} onChange={(e) => handlePhotos(e.target.files)} />
          </label>
        </div>
        {photos.length === 0 ? (
          <p className="text-sm text-ink-400">No photos yet.</p>
        ) : (
          <>
            <p className="text-xs text-ink-500 mb-3">Drag to reorder · click the eye to hide a photo from the slideshow and downloads.</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {photos.map((p, i) => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onPhotoDrop(i)}
                  className={`group relative aspect-square rounded-lg overflow-hidden bg-ink-100 cursor-move ${dragIndex === i ? "ring-2 ring-accent-500" : ""} ${p.is_visible === false ? "opacity-40" : ""}`}
                >
                  {p.url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.url} alt={p.filename ?? "Photo"} loading="lazy" className="w-full h-full object-cover pointer-events-none" />
                  )}
                  <button
                    onClick={() => toggleVisible(p)}
                    className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 bg-black/60 text-white text-xs w-6 h-6 rounded-full transition-opacity flex items-center justify-center"
                    title={p.is_visible === false ? "Show in slideshow" : "Hide from slideshow"}
                  >
                    {p.is_visible === false ? "🚫" : "👁"}
                  </button>
                  <button
                    onClick={() => deletePhoto(p)}
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-black/60 text-white text-xs w-6 h-6 rounded-full transition-opacity"
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                  {p.is_visible === false && (
                    <span className="absolute bottom-1 left-1 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded">Hidden</span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Videos */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="label-caps">Videos ({videos.length})</h2>
          <label className="bg-ink-950 hover:bg-ink-800 text-white text-sm font-medium px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet cursor-pointer">
            {uploadingVideos ? `Uploading… ${videoProgress}%` : "Upload videos"}
            <input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" multiple className="hidden" disabled={uploadingVideos} onChange={(e) => handleVideos(e.target.files)} />
          </label>
        </div>

        <p className="text-xs text-ink-500 -mt-2 mb-4">
          Finished 1080p exports only — {MAX_VIDEO_LABEL} max per file. Raw camera files are far
          larger than a broker needs.
        </p>

        {uploadingVideos && (
          <div className="mb-4">
            <div className="bg-ink-100 rounded-full h-2 overflow-hidden">
              <div
                className="bg-accent-500 h-2 rounded-full transition-all duration-base ease-quiet"
                style={{ width: `${videoProgress}%` }}
              />
            </div>
            <p className="text-xs text-ink-500 mt-2">
              Uploading… {videoProgress}% &middot;{" "}
              <span className="text-warn-800 font-medium">
                keep this tab open and your computer awake until it finishes.
              </span>
            </p>
          </div>
        )}

        {videoError && (
          <div className="mb-4 bg-danger-50 border border-danger-200 text-danger-700 text-sm px-4 py-3 rounded-ctl flex items-start justify-between gap-3">
            <span>{videoError}</span>
            <button onClick={() => setVideoError("")} className="shrink-0 font-bold text-danger-600 hover:text-danger-700">×</button>
          </div>
        )}
        {videos.length === 0 ? (
          <p className="text-sm text-ink-400">No videos yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {videos.map((v) => (
              <div key={v.id} className="group relative rounded-lg overflow-hidden bg-black border border-hairline">
                {v.url ? (
                  // A real video element previewing the first frame — same as the
                  // broker listing page — so galleries show a thumbnail, not an icon.
                  // The #t=0.1 fragment nudges browsers to paint that frame as the poster.
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video
                    src={`${v.url}#t=0.1`}
                    muted
                    playsInline
                    preload="metadata"
                    className="w-full aspect-video object-cover pointer-events-none"
                  />
                ) : (
                  <div className="w-full aspect-video flex items-center justify-center text-white/60 text-2xl">🎬</div>
                )}
                <span aria-hidden className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="w-10 h-10 rounded-full bg-black/55 flex items-center justify-center">
                    <span className="ml-0.5 border-y-[7px] border-y-transparent border-l-[12px] border-l-white" />
                  </span>
                </span>
                <button
                  onClick={() => deleteVideo(v)}
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-black/60 text-white text-xs w-6 h-6 rounded-full transition-opacity flex items-center justify-center"
                  aria-label="Remove video"
                >
                  ×
                </button>
                {v.filename && (
                  <span className="absolute bottom-1 left-1 right-8 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded truncate">{v.filename}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Danger zone */}
      <DeleteGalleryButton galleryId={gallery.id} title={title} />
    </div>
  );
}

function DeleteGalleryButton({ galleryId, title }: { galleryId: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function del() {
    if (!confirm(`Delete the gallery "${title}" and all its photos and videos? This can't be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/galleries/${galleryId}`, { method: "DELETE" });
    if (res.ok) router.push("/admin/galleries");
    else setBusy(false);
  }
  return (
    <button onClick={del} disabled={busy} className="text-xs font-medium text-danger-600 hover:text-danger-700 transition-colors duration-fast ease-quiet">
      {busy ? "Deleting…" : "Delete this gallery"}
    </button>
  );
}
