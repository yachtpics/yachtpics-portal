"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Photo = { id: string; storage_path: string; filename: string | null; category: string | null; display_order: number | null; url: string | null };
type Video = { id: string; storage_path: string; filename: string | null; created_at: string; url: string | null };
type Recipient = { userId: string; name: string | null; email: string | null };
type Gallery = { id: string; title: string; gallery_type: string; slug: string; expires_at: string | null; slideshow_published: boolean; created_at: string };
type Metrics = { views: number; downloadEvents: number; downloadItems: number; lastDownloadAt: string | null };

const SITE_URL = "https://portal.yachtpics.com";

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

  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [uploadingVideos, setUploadingVideos] = useState(false);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [addingRecipient, setAddingRecipient] = useState(false);
  const [recipientError, setRecipientError] = useState("");

  const slideshowUrl = `${SITE_URL}/g/${gallery.slug}`;
  const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;

  function fmtDate(s: string) {
    return new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function fmtDay(s: string) {
    return new Date(s).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }

  async function handlePhotos(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadingPhotos(true);
    setMsg("");
    let order = photos.length;
    for (const file of Array.from(fileList)) {
      try {
        const ext = file.name.split(".").pop() || "jpg";
        const path = `galleries/${gallery.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("listing-photos").upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const { data: row, error: insErr } = await supabase
          .from("photos")
          .insert({ gallery_id: gallery.id, storage_path: path, filename: file.name, display_order: order++, is_visible: true })
          .select("id, storage_path, filename, category, display_order")
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
    setUploadingVideos(true);
    setMsg("");
    for (const file of Array.from(fileList)) {
      try {
        const ext = file.name.split(".").pop() || "mp4";
        const path = `galleries/${gallery.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("listing-videos").upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const { data: row, error: insErr } = await supabase
          .from("videos")
          .insert({ gallery_id: gallery.id, storage_path: path, filename: file.name })
          .select("id, storage_path, filename, created_at")
          .single();
        if (insErr) throw insErr;
        const { data: signed } = await supabase.storage.from("listing-videos").createSignedUrl(path, 3600);
        setVideos((prev) => [...prev, { ...(row as Video), url: signed?.signedUrl ?? null }]);
      } catch (e) {
        setMsg(`Video upload failed: ${e instanceof Error ? e.message : "error"}`);
      }
    }
    setUploadingVideos(false);
  }

  async function deletePhoto(p: Photo) {
    if (!confirm("Remove this photo?")) return;
    await supabase.storage.from("listing-photos").remove([p.storage_path]);
    await supabase.from("photos").delete().eq("id", p.id);
    setPhotos((prev) => prev.filter((x) => x.id !== p.id));
  }

  async function deleteVideo(v: Video) {
    if (!confirm("Remove this video?")) return;
    await supabase.storage.from("listing-videos").remove([v.storage_path]);
    await supabase.from("videos").delete().eq("id", v.id);
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

  const availablePhotos = photos.filter((p) => p.url);

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link href="/admin/galleries" className="text-gray-400 hover:text-gray-600 text-sm transition-colors">&larr; All galleries</Link>
        <div className="mt-2 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{gallery.title}</h1>
            <p className="text-gray-500 text-sm mt-0.5 capitalize">
              {gallery.gallery_type} · {photos.length} photo{photos.length !== 1 ? "s" : ""}{videos.length > 0 ? `, ${videos.length} video${videos.length !== 1 ? "s" : ""}` : ""}
            </p>
          </div>
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${expired ? "bg-gray-100 text-gray-500" : "bg-green-50 text-green-700"}`}>
            {expired ? "Downloads expired" : expiresAt ? `Downloads until ${fmtDay(expiresAt)}` : "No expiry"}
          </span>
        </div>
      </div>

      {msg && (
        <div className="mb-5 px-4 py-3 rounded-lg text-sm bg-green-50 border border-green-200 text-green-800 flex items-start justify-between gap-3">
          <span>{msg}</span>
          <button onClick={() => setMsg("")} className="shrink-0 text-green-500 hover:text-green-700 font-bold">×</button>
        </div>
      )}

      {/* Share + metrics */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Slideshow link</h2>
          <p className="text-xs text-gray-500 mb-3">Anyone with this link can view the slideshow. Downloads still require a recipient login.</p>
          <div className="flex items-center gap-2">
            <input readOnly value={slideshowUrl} className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-gray-600" />
            <button onClick={copyLink} className="text-sm font-medium px-3 py-2 rounded-lg border border-gray-200 text-gray-700 hover:border-gray-300 transition-colors shrink-0">
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Activity</h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xl font-bold text-gray-900">{metrics.views}</p>
              <p className="text-[11px] text-gray-400">Slideshow views</p>
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{metrics.downloadItems}</p>
              <p className="text-[11px] text-gray-400">Files downloaded</p>
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{metrics.downloadEvents}</p>
              <p className="text-[11px] text-gray-400">Download sessions</p>
            </div>
          </div>
          {metrics.lastDownloadAt && (
            <p className="text-[11px] text-gray-400 mt-3 text-center">Last download {fmtDate(metrics.lastDownloadAt)}</p>
          )}
        </div>
      </div>

      {/* Expiry control */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Download window</h2>
        <p className="text-xs text-gray-500 mb-3">Set how long recipients can download. The slideshow stays viewable after expiry.</p>
        <div className="flex flex-wrap gap-2">
          {[30, 60, 90].map((d) => (
            <button key={d} onClick={() => setExpiry({ days: d })} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-700 hover:border-[#d4a843] transition-colors">
              {d} days from now
            </button>
          ))}
          <button onClick={() => setExpiry({ clear: true })} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-700 hover:border-[#d4a843] transition-colors">
            No expiry
          </button>
          <label className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-700 hover:border-[#d4a843] transition-colors cursor-pointer">
            Set date…
            <input type="date" className="ml-2 text-xs" onChange={(e) => e.target.value && setExpiry({ date: e.target.value })} />
          </label>
        </div>
      </div>

      {/* Recipients */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Recipients</h2>
        <p className="text-xs text-gray-500 mb-4">People with a free login to download from this gallery. They&apos;re emailed an invite when added.</p>

        <div className="flex flex-wrap items-end gap-2 mb-4">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] font-medium text-gray-400 mb-1">Email</label>
            <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="recipient@email.com" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#d4a843]" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">First name</label>
            <input value={newFirst} onChange={(e) => setNewFirst(e.target.value)} className="w-32 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#d4a843]" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">Last name</label>
            <input value={newLast} onChange={(e) => setNewLast(e.target.value)} className="w-32 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#d4a843]" />
          </div>
          <button onClick={addRecipient} disabled={addingRecipient} className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
            {addingRecipient ? "Adding…" : "Add & invite"}
          </button>
        </div>
        {recipientError && <p className="text-xs text-red-600 mb-3">{recipientError}</p>}

        {recipients.length === 0 ? (
          <p className="text-sm text-gray-400">No recipients yet.</p>
        ) : (
          <div className="space-y-1.5">
            {recipients.map((r) => (
              <div key={r.userId} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  {r.name && <span className="text-sm font-medium text-gray-800">{r.name} </span>}
                  <span className="text-sm text-gray-500">{r.email}</span>
                </div>
                <button onClick={() => removeRecipient(r.userId)} className="text-xs font-medium text-red-600 hover:text-red-700 shrink-0">Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Photos */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Photos ({photos.length})</h2>
          <label className="bg-[#050b14] hover:bg-[#0c1626] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer">
            {uploadingPhotos ? "Uploading…" : "Upload photos"}
            <input type="file" accept="image/*" multiple className="hidden" disabled={uploadingPhotos} onChange={(e) => handlePhotos(e.target.files)} />
          </label>
        </div>
        {availablePhotos.length === 0 ? (
          <p className="text-sm text-gray-400">No photos yet.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {availablePhotos.map((p) => (
              <div key={p.id} className="group relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url!} alt={p.filename ?? "Photo"} loading="lazy" className="w-full h-full object-cover" />
                <button onClick={() => deletePhoto(p)} className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-black/60 text-white text-xs w-6 h-6 rounded-full transition-opacity" aria-label="Remove photo">×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Videos */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Videos ({videos.length})</h2>
          <label className="bg-[#050b14] hover:bg-[#0c1626] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer">
            {uploadingVideos ? "Uploading…" : "Upload videos"}
            <input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" multiple className="hidden" disabled={uploadingVideos} onChange={(e) => handleVideos(e.target.files)} />
          </label>
        </div>
        {videos.length === 0 ? (
          <p className="text-sm text-gray-400">No videos yet.</p>
        ) : (
          <div className="space-y-2">
            {videos.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2">
                <span className="text-sm text-gray-700 truncate">🎬 {v.filename ?? "Video"}</span>
                <button onClick={() => deleteVideo(v)} className="text-xs font-medium text-red-600 hover:text-red-700 shrink-0">Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Danger zone */}
      <DeleteGalleryButton galleryId={gallery.id} title={gallery.title} />
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
    <button onClick={del} disabled={busy} className="text-xs font-medium text-red-600 hover:text-red-700 transition-colors">
      {busy ? "Deleting…" : "Delete this gallery"}
    </button>
  );
}
