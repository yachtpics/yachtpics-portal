"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

const PHOTO_CATEGORIES = [
  "Bow", "Stern", "Port", "Starboard", "Helm", "Cockpit",
  "Salon", "Galley", "Master Stateroom", "Guest Stateroom",
  "Head", "Engine Room", "Flybridge", "Swim Platform", "Other",
];

interface Photo {
  id: string;
  storage_path: string;
  filename: string | null;
  category: string | null;
  display_order: number;
  is_visible: boolean;
  url: string | null;
}

interface Listing {
  id: string;
  vessel_name: string | null;
  vessel_type: string | null;
  year: number | null;
  length_ft: number | null;
  make: string | null;
  model: string | null;
  asking_price: number | null;
  location: string | null;
  description: string | null;
  status: string;
  broker_id: string;
  profiles: { first_name: string | null; last_name: string | null; display_email: string | null } | null;
}

export default function AdminListingDetail({ listing, photos: initialPhotos }: { listing: Listing; photos: Photo[] }) {
  const supabase = createClient();
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [status, setStatus] = useState(listing.status);
  const [saving, setSaving] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const broker = listing.profiles;
  const brokerName = broker?.first_name
    ? `${broker.first_name} ${broker.last_name ?? ""}`.trim()
    : broker?.display_email ?? "Unknown";

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    setUploading(true);
    setUploadProgress(0);
    const fileArr = Array.from(files);

    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i];
      const ext = file.name.split(".").pop();
      const path = `${listing.broker_id}/${listing.id}/${Date.now()}-${i}.${ext}`;

      const { error } = await supabase.storage
        .from("listing-photos")
        .upload(path, file, { upsert: false });

      if (!error) {
        const category = guessCategory(file.name);
        const { data: newPhoto } = await supabase.from("photos").insert({
          listing_id: listing.id,
          storage_path: path,
          filename: file.name,
          category,
          display_order: photos.length + i,
          is_visible: true,
        }).select().single();

        if (newPhoto) {
          const { data: signed } = await supabase.storage
            .from("listing-photos")
            .createSignedUrl(path, 3600);
          setPhotos((prev) => [...prev, { ...newPhoto, url: signed?.signedUrl ?? null } as Photo]);
        }
      }
      setUploadProgress(Math.round(((i + 1) / fileArr.length) * 100));
    }
    setUploading(false);
    setMessage(`${fileArr.length} photo${fileArr.length !== 1 ? "s" : ""} uploaded.`);
    setTimeout(() => setMessage(""), 3000);
  }

  function guessCategory(filename: string): string {
    const name = filename.toLowerCase();
    for (const cat of PHOTO_CATEGORIES) {
      if (name.includes(cat.toLowerCase())) return cat;
    }
    return "Other";
  }

  async function toggleVisibility(photoId: string, current: boolean) {
    await supabase.from("photos").update({ is_visible: !current }).eq("id", photoId);
    setPhotos((prev) => prev.map((p) => p.id === photoId ? { ...p, is_visible: !current } : p));
  }

  async function deletePhoto(photoId: string, storagePath: string) {
    await supabase.storage.from("listing-photos").remove([storagePath]);
    await supabase.from("photos").delete().eq("id", photoId);
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(photoId); return next; });
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const toDelete = photos.filter((p) => selectedIds.has(p.id));
    await Promise.all(toDelete.map((p) => supabase.storage.from("listing-photos").remove([p.storage_path])));
    await Promise.all(toDelete.map((p) => supabase.from("photos").delete().eq("id", p.id)));
    setPhotos((prev) => prev.filter((p) => !selectedIds.has(p.id)));
    setSelectedIds(new Set());
    setSelectMode(false);
    setDeleting(false);
    setMessage(`${toDelete.length} photo${toDelete.length !== 1 ? "s" : ""} deleted.`);
    setTimeout(() => setMessage(""), 3000);
  }

  async function deleteAll() {
    setDeleting(true);
    setConfirmDeleteAll(false);
    await Promise.all(photos.map((p) => supabase.storage.from("listing-photos").remove([p.storage_path])));
    await supabase.from("photos").delete().eq("listing_id", listing.id);
    setPhotos([]);
    setSelectedIds(new Set());
    setSelectMode(false);
    setDeleting(false);
    setMessage("All photos deleted.");
    setTimeout(() => setMessage(""), 3000);
  }

  async function notifyBroker() {
    setNotifying(true);
    try {
      const res = await fetch("/api/email/notify-broker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: listing.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send");
      setMessage(`Notification sent to ${broker?.display_email ?? brokerName}.`);
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setNotifying(false);
      setTimeout(() => setMessage(""), 5000);
    }
  }

  async function updateStatus() {
    setSaving(true);
    await supabase.from("listings").update({ status }).eq("id", listing.id);
    setSaving(false);
    setMessage("Status updated.");
    setTimeout(() => setMessage(""), 3000);
  }

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <Link href="/admin/listings" className="text-gray-400 hover:text-gray-600 text-sm transition-colors">
            ← All listings
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">
            {listing.vessel_name ?? "Untitled vessel"}
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {[listing.year, listing.vessel_type, listing.length_ft ? `${listing.length_ft}′` : null, listing.location].filter(Boolean).join(" · ")}
          </p>
          <p className="text-gray-400 text-xs mt-1">Broker: {brokerName}</p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#d4a843]"
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="sold">Sold</option>
          </select>
          <button
            onClick={notifyBroker}
            disabled={notifying}
            className="bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg border border-gray-200 transition-colors"
          >
            {notifying ? "Sending..." : "📧 Notify Broker"}
          </button>
          <button
            onClick={updateStatus}
            disabled={saving}
            className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-5 px-4 py-3 rounded-lg text-sm bg-green-50 border border-green-200 text-green-700">
          {message}
        </div>
      )}

      {/* Photos section */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="font-semibold text-gray-900">Photos</h2>
            <p className="text-gray-500 text-sm">{photos.length} photo{photos.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {photos.length > 0 && !selectMode && (
              <>
                <button
                  onClick={() => setSelectMode(true)}
                  className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Select
                </button>
                <button
                  onClick={() => setConfirmDeleteAll(true)}
                  className="text-sm text-red-500 hover:text-red-600 border border-gray-200 hover:border-red-300 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Delete All
                </button>
              </>
            )}
            {selectMode && (
              <>
                <button
                  onClick={() => setSelectedIds(new Set(photos.map((p) => p.id)))}
                  className="text-sm text-[#c49a35] font-medium transition-colors px-2"
                >
                  Select all
                </button>
                <button
                  onClick={() => { setSelectedIds(new Set()); setSelectMode(false); }}
                  className="text-sm text-gray-400 hover:text-gray-600 transition-colors px-2"
                >
                  Cancel
                </button>
                {selectedIds.size > 0 && (
                  <button
                    onClick={deleteSelected}
                    disabled={deleting}
                    className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors"
                  >
                    {deleting ? "Deleting..." : `🗑 Delete ${selectedIds.size}`}
                  </button>
                )}
              </>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-[#050b14] hover:bg-[#0a1628] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              + Add Photos
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        </div>

        {/* Delete All confirmation */}
        {confirmDeleteAll && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl">
              <h3 className="text-lg font-bold text-gray-900 mb-2">Delete all photos?</h3>
              <p className="text-gray-500 text-sm mb-6">
                This will permanently delete all {photos.length} photo{photos.length !== 1 ? "s" : ""} for this listing. This can&apos;t be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDeleteAll(false)}
                  className="flex-1 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium py-2.5 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={deleteAll}
                  disabled={deleting}
                  className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
                >
                  {deleting ? "Deleting..." : "Delete All"}
                </button>
              </div>
            </div>
          </div>
        )}

        {uploading && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Uploading...</span><span>{uploadProgress}%</span>
            </div>
            <div className="bg-gray-100 rounded-full h-2">
              <div className="bg-[#d4a843] h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        )}

        {photos.length === 0 ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
            className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center cursor-pointer hover:border-[#d4a843] transition-colors"
          >
            <p className="text-gray-400 text-sm">Drag photos here or click to upload</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {photos.map((photo) => {
              const isSelected = selectedIds.has(photo.id);
              return (
                <div
                  key={photo.id}
                  className={`relative rounded-lg overflow-hidden border-2 transition-colors cursor-pointer ${
                    isSelected ? "border-[#d4a843] shadow-md" :
                    photo.is_visible ? "border-transparent" : "border-gray-200 opacity-50"
                  }`}
                  onClick={() => selectMode && setSelectedIds((prev) => {
                    const next = new Set(prev);
                    next.has(photo.id) ? next.delete(photo.id) : next.add(photo.id);
                    return next;
                  })}
                >
                  {photo.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo.url} alt={photo.filename ?? ""} className="w-full h-28 object-cover" />
                  ) : (
                    <div className="w-full h-28 bg-gray-100 flex items-center justify-center text-gray-400 text-xs">No preview</div>
                  )}

                  {/* Checkbox in select mode */}
                  {selectMode && (
                    <div className={`absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      isSelected ? "bg-[#d4a843] border-[#d4a843]" : "bg-white/80 border-gray-300"
                    }`}>
                      {isSelected && <span className="text-[#050b14] text-xs font-bold">✓</span>}
                    </div>
                  )}

                  {/* Actions overlay — hidden in select mode */}
                  {!selectMode && (
                    <div className="absolute inset-0 bg-black/0 hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 hover:opacity-100">
                      <button
                        onClick={() => toggleVisibility(photo.id, photo.is_visible)}
                        className="bg-white/90 hover:bg-white text-gray-700 text-xs font-medium px-2 py-1 rounded transition-colors"
                        title={photo.is_visible ? "Hide" : "Show"}
                      >
                        {photo.is_visible ? "Hide" : "Show"}
                      </button>
                      <button
                        onClick={() => deletePhoto(photo.id, photo.storage_path)}
                        className="bg-red-500/90 hover:bg-red-500 text-white text-xs font-medium px-2 py-1 rounded transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  )}

                  {/* Category badge */}
                  <div className="p-1.5">
                    <span className="text-xs text-gray-500">{photo.category ?? "Other"}</span>
                    {!photo.is_visible && <span className="text-xs text-gray-400 ml-1">· hidden</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
