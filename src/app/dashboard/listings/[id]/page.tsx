"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
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
  const [message, setMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    for (const cat of PHOTO_CATEGORIES) {
      if (name.includes(cat.toLowerCase())) return cat;
    }
    return "Other";
  }

  async function toggleVisibility(photoId: string, current: boolean) {
    await supabase.from("photos").update({ is_visible: !current }).eq("id", photoId);
    setPhotos((prev) => prev.map((p) => p.id === photoId ? { ...p, is_visible: !current } : p));
  }

  async function downloadPhoto(url: string, filename: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.target = "_blank";
    a.click();
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>;
  if (!listing) return null;

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <Link href="/dashboard/listings" className="text-gray-400 hover:text-gray-600 text-sm transition-colors">← My Listings</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{listing.vessel_name ?? "Untitled vessel"}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{listing.location ?? ""}</p>
        </div>
        <button onClick={() => fileInputRef.current?.click()}
          className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors">
          + Add Photos
        </button>
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
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
          className="border-2 border-dashed border-gray-200 rounded-xl p-16 text-center cursor-pointer hover:border-[#d4a843] transition-colors"
        >
          <p className="text-gray-400 text-sm">No photos yet — drag here or click to upload</p>
          <p className="text-gray-300 text-xs mt-1">YachtPics professional photos will also appear here after your shoot</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map((photo) => (
            <div key={photo.id} className={`relative rounded-lg overflow-hidden border-2 transition-colors ${photo.is_visible ? "border-transparent" : "border-gray-200 opacity-60"}`}>
              {photo.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.url} alt={photo.filename ?? ""} className="w-full h-32 object-cover" />
              ) : (
                <div className="w-full h-32 bg-gray-100 flex items-center justify-center text-gray-400 text-xs">No preview</div>
              )}

              <div className="absolute inset-0 bg-black/0 hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 hover:opacity-100">
                {photo.url && (
                  <button onClick={() => downloadPhoto(photo.url!, photo.filename ?? "photo.jpg")}
                    className="bg-white/90 hover:bg-white text-gray-700 text-xs font-medium px-2 py-1 rounded transition-colors">
                    Download
                  </button>
                )}
                <button onClick={() => toggleVisibility(photo.id, photo.is_visible)}
                  className="bg-white/90 hover:bg-white text-gray-700 text-xs font-medium px-2 py-1 rounded transition-colors">
                  {photo.is_visible ? "Hide" : "Show"}
                </button>
              </div>

              <div className="p-1.5 bg-white">
                <p className="text-xs text-gray-500 truncate">{photo.category ?? "Other"}{!photo.is_visible && " · hidden"}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
