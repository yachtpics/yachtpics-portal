"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import JSZip from "jszip";

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

export default function BrokerListingPage() {
  const supabase = createClient();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [listing, setListing] = useState<{ vessel_name: string | null; location: string | null; status: string } | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Page-level drag detection — reliable across all child elements
  function handlePageDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) setDragOver(true);
  }
  function handlePageDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragOver(false);
  }
  function handlePageDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  function handlePageDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: l } = await supabase.from("listings")
      .select("vessel_name, location, status")
      .eq("id", id)
      .eq("broker_id", user.id)
      .single();

    if (!l) { router.push("/dashboard/listings"); return; }
    setListing(l);

    const { data: p } = await supabase.from("photos")
      .select("id, storage_path, filename, category, display_order, is_visible")
      .eq("listing_id", id)
      .order("display_order");

    const withUrls = await Promise.all((p ?? []).map(async (photo) => {
      const { data } = await supabase.storage.from("listing-photos").createSignedUrl(photo.storage_path, 3600);
      return { ...photo, url: data?.signedUrl ?? null };
    }));

    setPhotos(withUrls);
    setLoading(false);
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setUploading(true);
    setUploadProgress(0);
    const fileArr = Array.from(files);

    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i];
      const ext = file.name.split(".").pop();
      const path = `${user.id}/${id}/${Date.now()}-${i}.${ext}`;

      const { error } = await supabase.storage.from("listing-photos").upload(path, file, { upsert: false });

      if (!error) {
        const { data: newPhoto } = await supabase.from("photos").insert({
          listing_id: id,
          storage_path: path,
          filename: file.name,
          category: guessCategory(file.name),
          display_order: photos.length + i,
          is_visible: true,
          uploaded_by: user.id,
        }).select().single();

        if (newPhoto) {
          const { data: signed } = await supabase.storage.from("listing-photos").createSignedUrl(path, 3600);
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
    // Check exact category names first
    for (const cat of PHOTO_CATEGORIES) {
      if (name.includes(cat.toLowerCase().replace(" ", "_")) || name.includes(cat.toLowerCase())) return cat;
    }
    // Common aliases / alternate naming conventions
    const aliases: Record<string, string> = {
      exterior: "Starboard", profile: "Port", profiles: "Port",
      front: "Bow", aft: "Stern", back: "Stern",
      bridge: "Flybridge", fly: "Flybridge", flybridge: "Flybridge",
      interior: "Salon", living: "Salon", main_salon: "Salon", mainsalon: "Salon",
      kitchen: "Galley", dining: "Galley",
      master: "Master Stateroom", master_cabin: "Master Stateroom",
      guest: "Guest Stateroom", cabin: "Guest Stateroom",
      bath: "Head", bathroom: "Head", toilet: "Head",
      engine: "Engine Room", bilge: "Engine Room",
      swim: "Swim Platform", platform: "Swim Platform",
      wheel: "Helm", helm: "Helm", steering: "Helm",
      cockpit: "Cockpit", deck: "Cockpit",
    };
    for (const [alias, cat] of Object.entries(aliases)) {
      if (name.includes(alias)) return cat;
    }
    return "Other";
  }

  function toggleSelect(photoId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(photoId) ? next.delete(photoId) : next.add(photoId);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(photos.filter(p => p.is_visible).map(p => p.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectMode(false);
  }

  async function downloadPhotos(targets: Photo[]) {
    if (targets.length === 0) return;
    setDownloading(true);
    setDownloadProgress(0);

    const folderName = listing?.vessel_name ?? "photos";

    // Single photo — direct download, no ZIP needed
    if (targets.length === 1 && targets[0].url) {
      const response = await fetch(targets[0].url);
      const blob = await response.blob();
      const ext = targets[0].filename?.split(".").pop() ?? "jpg";
      const filename = `${targets[0].category ?? "photo"}.${ext}`;
      triggerDownload(blob, filename);
      setDownloading(false);
      setDownloadProgress(0);
      clearSelection();
      return;
    }

    // Multiple photos — ZIP
    const zip = new JSZip();
    for (let i = 0; i < targets.length; i++) {
      const photo = targets[i];
      if (!photo.url) continue;
      try {
        const response = await fetch(photo.url);
        const blob = await response.blob();
        const ext = photo.filename?.split(".").pop() ?? "jpg";
        const filename = `${String(i + 1).padStart(2, "0")}-${photo.category ?? "photo"}.${ext}`;
        zip.file(filename, blob);
      } catch { /* skip */ }
      setDownloadProgress(Math.round(((i + 1) / targets.length) * 100));
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const zipName = `${folderName}-photos.zip`;

    if ("showSaveFilePicker" in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: zipName,
          types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(zipBlob);
        await writable.close();
        setDownloading(false);
        setDownloadProgress(0);
        clearSelection();
        return;
      } catch { /* cancelled — fall through */ }
    }

    triggerDownload(zipBlob, zipName);
    setDownloading(false);
    setDownloadProgress(0);
    clearSelection();
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function toggleVisibility(photoId: string, current: boolean) {
    await supabase.from("photos").update({ is_visible: !current }).eq("id", photoId);
    setPhotos((prev) => prev.map((p) => p.id === photoId ? { ...p, is_visible: !current } : p));
  }

  async function updateCategory(photoId: string, category: string) {
    await supabase.from("photos").update({ category }).eq("id", photoId);
    setPhotos((prev) => prev.map((p) => p.id === photoId ? { ...p, category } : p));
  }

  const visiblePhotos = photos.filter(p => p.is_visible);
  const selectedPhotos = photos.filter(p => selectedIds.has(p.id));

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>;
  if (!listing) return null;

  return (
    <div
      className="px-6 py-8 max-w-5xl mx-auto relative"
      onDragEnter={handlePageDragEnter}
      onDragLeave={handlePageDragLeave}
      onDragOver={handlePageDragOver}
      onDrop={handlePageDrop}
    >
      {/* Full-page drop overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-50 bg-amber-50/90 border-2 border-dashed border-[#d4a843] rounded-xl flex items-center justify-center pointer-events-none">
          <p className="text-[#c49a35] text-lg font-semibold">Drop photos to upload</p>
        </div>
      )}
      {/* Header */}
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/dashboard/listings" className="text-gray-400 hover:text-gray-600 text-sm transition-colors">← My Listings</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{listing.vessel_name ?? "Untitled vessel"}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{listing.location ?? ""}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {photos.length > 0 && !selectMode && (
            <>
              <button
                onClick={() => { setSelectMode(true); }}
                className="bg-white border border-gray-200 hover:border-[#d4a843] text-gray-700 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
              >
                Select
              </button>
              <button
                onClick={() => downloadPhotos(visiblePhotos)}
                disabled={downloading}
                className="bg-white border border-gray-200 hover:border-[#d4a843] text-gray-700 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {downloading ? `Zipping... ${downloadProgress}%` : `⬇ Download All (${visiblePhotos.length})`}
              </button>
            </>
          )}

          {selectMode && (
            <>
              <button onClick={selectAll} className="text-sm text-[#c49a35] hover:text-[#b08c2a] font-medium transition-colors px-2">
                Select all
              </button>
              <button onClick={clearSelection} className="text-sm text-gray-400 hover:text-gray-600 transition-colors px-2">
                Cancel
              </button>
              {selectedIds.size > 0 && (
                <button
                  onClick={() => downloadPhotos(selectedPhotos)}
                  disabled={downloading}
                  className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
                >
                  {downloading ? `Zipping... ${downloadProgress}%` : `⬇ Download ${selectedIds.size} Photo${selectedIds.size !== 1 ? "s" : ""}`}
                </button>
              )}
            </>
          )}

          <button onClick={() => fileInputRef.current?.click()}
            className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors">
            + Add Photos
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      </div>

      {message && (
        <div className="mb-5 px-4 py-3 rounded-lg text-sm bg-green-50 border border-green-200 text-green-700">{message}</div>
      )}

      {uploading && (
        <div className="mb-5">
          <div className="flex justify-between text-xs text-gray-500 mb-1"><span>Uploading...</span><span>{uploadProgress}%</span></div>
          <div className="bg-gray-100 rounded-full h-2">
            <div className="bg-[#d4a843] h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
          </div>
        </div>
      )}

      {photos.length === 0 ? (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-200 rounded-xl p-16 text-center cursor-pointer hover:border-[#d4a843] transition-colors"
        >
          <p className="text-gray-400 text-sm">No photos yet — drag here or click to upload</p>
          <p className="text-gray-300 text-xs mt-1">YachtPics professional photos will also appear here after your shoot</p>
        </div>
      ) : (
        <div>
          <div className="columns-2 sm:columns-3 md:columns-4 gap-3">
          {photos.map((photo) => {
            const isSelected = selectedIds.has(photo.id);
            return (
              <div
                key={photo.id}
                onClick={() => selectMode && toggleSelect(photo.id)}
                className={`break-inside-avoid mb-3 relative rounded-lg overflow-hidden border-2 transition-all ${
                  isSelected ? "border-[#d4a843] shadow-md" :
                  photo.is_visible ? "border-transparent" : "border-gray-200 opacity-60"
                } ${selectMode ? "cursor-pointer" : ""}`}
              >
                {photo.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.url} alt={photo.filename ?? ""} className="w-full h-auto block" />
                ) : (
                  <div className="w-full h-40 bg-gray-100 flex items-center justify-center text-gray-400 text-xs">No preview</div>
                )}

                {/* Checkbox in select mode */}
                {selectMode && (
                  <div className={`absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                    isSelected ? "bg-[#d4a843] border-[#d4a843]" : "bg-white/80 border-gray-300"
                  }`}>
                    {isSelected && <span className="text-[#050b14] text-xs font-bold">✓</span>}
                  </div>
                )}

                {/* Hover actions (non-select mode) */}
                {!selectMode && (
                  <div className="absolute inset-0 bg-black/0 hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 hover:opacity-100">
                    {photo.url && (
                      <button
                        onClick={(e) => { e.stopPropagation(); downloadPhotos([photo]); }}
                        className="bg-white/90 hover:bg-white text-gray-700 text-xs font-medium px-2 py-1 rounded transition-colors"
                      >
                        Download
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleVisibility(photo.id, photo.is_visible); }}
                      className="bg-white/90 hover:bg-white text-gray-700 text-xs font-medium px-2 py-1 rounded transition-colors"
                    >
                      {photo.is_visible ? "Hide" : "Show"}
                    </button>
                  </div>
                )}

                <div className="p-2 bg-white">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium text-gray-500 shrink-0">
                      {String(photos.indexOf(photo) + 1).padStart(2, "0")} ·
                    </span>
                    <select
                      value={photo.category ?? "Other"}
                      onChange={(e) => { e.stopPropagation(); updateCategory(photo.id, e.target.value); }}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs font-medium text-gray-700 bg-transparent border-none outline-none cursor-pointer hover:text-[#c49a35] transition-colors flex-1 min-w-0 truncate"
                    >
                      {PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {!photo.is_visible && <span className="text-gray-400 text-xs shrink-0">· hidden</span>}
                  </div>
                  {photo.filename && (
                    <p className="text-xs text-gray-400 truncate mt-0.5" title={photo.filename}>{photo.filename}</p>
                  )}
                </div>
              </div>
            );
          })}
          </div>

          {/* Drop zone strip */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="mt-3 border-2 border-dashed border-gray-200 rounded-xl py-4 text-center cursor-pointer hover:border-[#d4a843] transition-colors"
          >
            <p className="text-gray-400 text-xs">Drag photos anywhere on this page, or click here to add more</p>
          </div>
        </div>
      )}
    </div>
  );
}
