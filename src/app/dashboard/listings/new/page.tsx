"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PHOTO_CATEGORIES } from "@/lib/photoCategories";
import { guessCategory } from "@/lib/guessCategory";
import { uploadListingVideo, isSupportedVideo, VIDEO_ACCEPT, formatFileSize } from "@/lib/uploadListingVideo";

type BrokerOption = { id: string; name: string };

export default function NewListingPage() {
  const supabase = createClient();
  const router = useRouter();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Set when the listing was created but a video failed — gives the person a
  // way through to the listing instead of stranding them on the form.
  const [createdListingId, setCreatedListingId] = useState<string | null>(null);
  const [customVesselType, setCustomVesselType] = useState(false);

  // Role / broker state
  const [isAssistant, setIsAssistant] = useState(false);
  const [brokerOptions, setBrokerOptions] = useState<BrokerOption[]>([]);
  const [selectedBrokerId, setSelectedBrokerId] = useState("");
  const [roleLoaded, setRoleLoaded] = useState(false);

  const [form, setForm] = useState({
    vessel_name: "",
    vessel_type: "",
    year: "",
    length_ft: "",
    make: "",
    model: "",
    asking_price: "",
    location: "",
    description: "",
  });

  const [photos, setPhotos] = useState<{ file: File; category: string; preview: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Video. A listing may be video only — plenty of jobs are — so nothing here
  // requires a photo to be present.
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoIndex, setVideoIndex] = useState(0);
  const [videoRejected, setVideoRejected] = useState("");
  const videoInputRef = useRef<HTMLInputElement>(null);

  function handleVideoFiles(files: FileList | null) {
    if (!files) return;
    const all = Array.from(files);
    const ok = all.filter(isSupportedVideo);
    setVideoRejected(
      ok.length < all.length
        ? `${all.length - ok.length} file${all.length - ok.length !== 1 ? "s" : ""} skipped — only .mp4 and .mov can be played in a browser.`
        : ""
    );
    setVideoFiles((prev) => [...prev, ...ok]);
  }

  function removeVideo(index: number) {
    setVideoFiles((prev) => prev.filter((_, i) => i !== index));
  }

  // Detect role and fetch linked brokers if assistant
  useEffect(() => {
    async function loadRole() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profile?.role === "assistant") {
        setIsAssistant(true);
        const { data: links } = await supabase
          .from("broker_assistants")
          .select("broker_id, profiles:broker_id(id, first_name, last_name, display_email)")
          .eq("assistant_id", user.id);

        const options: BrokerOption[] = (links ?? []).map((l) => {
          const p = l.profiles as unknown as {
            id: string;
            first_name: string | null;
            last_name: string | null;
            display_email: string | null;
          } | null;
          return {
            id: l.broker_id as string,
            name: p?.first_name
              ? `${p.first_name} ${p.last_name ?? ""}`.trim()
              : p?.display_email ?? "Unknown broker",
          };
        });

        setBrokerOptions(options);
        if (options.length === 1) setSelectedBrokerId(options[0].id);
      }

      setRoleLoaded(true);
    }
    loadRole();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const newPhotos = Array.from(files).map((file) => ({
      file,
      category: guessCategory(file.name),
      preview: URL.createObjectURL(file),
    }));
    setPhotos((prev) => [...prev, ...newPhotos]);
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  function updateCategory(index: number, category: string) {
    setPhotos((prev) => prev.map((p, i) => i === index ? { ...p, category } : p));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    if (isAssistant && !selectedBrokerId) {
      setError("Please select a broker for this listing.");
      setSaving(false);
      return;
    }

    const res = await fetch("/api/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brokerId: isAssistant ? selectedBrokerId : undefined,
        ...form,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to create listing.");
      setSaving(false);
      return;
    }

    const listingId: string = data.listingId;
    const brokerId: string = data.brokerId;

    if (photos.length > 0) {
      setUploading(true);
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const ext = photo.file.name.split(".").pop();
        const path = `${brokerId}/${listingId}/${Date.now()}-${i}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("listing-photos")
          .upload(path, photo.file, { upsert: false });

        if (!uploadError) {
          const { data: { user } } = await supabase.auth.getUser();
          await supabase.from("photos").insert({
            listing_id: listingId,
            storage_path: path,
            filename: photo.file.name,
            category: photo.category,
            display_order: i,
            is_visible: true,
            uploaded_by: user?.id ?? brokerId,
          });
        }
        setUploadProgress(Math.round(((i + 1) / photos.length) * 100));
      }
      setUploading(false);
    }

    // Videos last — they're much the largest files, and doing them after the
    // photos means the quick part of the job is already safely saved.
    if (videoFiles.length > 0) {
      setUploadingVideo(true);
      const { data: { user } } = await supabase.auth.getUser();
      const failures: string[] = [];
      if (user) {
        for (let i = 0; i < videoFiles.length; i++) {
          setVideoIndex(i);
          setVideoProgress(0);
          const result = await uploadListingVideo({
            supabase,
            file: videoFiles[i],
            listingId,
            uploadedBy: user.id,
            displayOrder: i,
            onProgress: setVideoProgress,
          });
          if (!result.ok) failures.push(`${videoFiles[i].name} — ${result.error}`);
        }
      }
      setUploadingVideo(false);

      // The listing and photos are saved either way — so stay on the page and
      // say what didn't make it, rather than redirecting as though all was well.
      if (failures.length > 0) {
        setError(
          `The listing was created, but ${failures.length === 1 ? "this video didn't upload" : "these videos didn't upload"}:\n${failures.join("\n")}\nYou can add ${failures.length === 1 ? "it" : "them"} from the listing page.`
        );
        setSaving(false);
        setCreatedListingId(listingId);
        return;
      }
    }

    router.push(`/dashboard/listings/${listingId}`);
  }

  // Button label names whatever is actually attached, so it's obvious that the
  // video is included in what's about to happen.
  const attached = [
    photos.length > 0 ? `${photos.length} Photo${photos.length !== 1 ? "s" : ""}` : null,
    videoFiles.length > 0 ? `${videoFiles.length} Video${videoFiles.length !== 1 ? "s" : ""}` : null,
  ].filter(Boolean);
  const submitLabel = attached.length > 0
    ? `Create Listing & Upload ${attached.join(" + ")}`
    : "Create Listing";

  const inputClass = "w-full bg-white border border-hairline-strong text-ink-900 placeholder:text-ink-400 rounded-ctl px-4 py-2.5 text-sm focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/40 transition-colors duration-fast ease-quiet";
  const labelClass = "block label-caps mb-1.5";

  if (!roleLoaded) {
    return (
      <div className="px-6 py-8 max-w-3xl mx-auto">
        <div className="h-8 w-48 bg-ink-100 rounded-ctl animate-pulse mb-4" />
        <div className="h-64 bg-ink-100 rounded-card animate-pulse" />
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-8 pb-6 border-b border-hairline">
        <Link href="/dashboard/listings" className="text-ink-500 hover:text-ink-700 text-sm transition-colors duration-fast">
          {isAssistant ? "← Listings" : "← My Listings"}
        </Link>
        <h1 className="text-display text-ink-900 mt-1">New Listing</h1>
        <p className="text-ink-500 mt-1 text-sm">
          {isAssistant ? "Create a listing on behalf of a broker." : "Add a vessel listing with photos, video, or both."}
        </p>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-card border text-sm bg-danger-50 border-danger-200 text-danger-600">
          <p className="whitespace-pre-line">{error}</p>
          {createdListingId && (
            <Link
              href={`/dashboard/listings/${createdListingId}`}
              className="mt-2 inline-block font-semibold underline underline-offset-2 hover:text-danger-700"
            >
              Go to the listing →
            </Link>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">

        {isAssistant && (
          <section className="bg-white border border-hairline rounded-card shadow-elev-1 p-6">
            <h2 className="text-h2 text-ink-900 mb-4">Broker</h2>
            {brokerOptions.length === 0 ? (
              <p className="text-sm text-ink-500">You are not linked to any brokers. Contact an admin to be linked.</p>
            ) : brokerOptions.length === 1 ? (
              <p className="text-sm text-ink-700">
                Creating listing for <strong>{brokerOptions[0].name}</strong>
              </p>
            ) : (
              <div>
                <label className={labelClass}>Select broker <span className="text-danger-600">*</span></label>
                <select
                  className={inputClass}
                  value={selectedBrokerId}
                  onChange={(e) => setSelectedBrokerId(e.target.value)}
                  required
                >
                  <option value="">Select a broker...</option>
                  {brokerOptions.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}
          </section>
        )}

        <section className="bg-white border border-hairline rounded-card shadow-elev-1 p-6">
          <h2 className="text-h2 text-ink-900 mb-4">Vessel Information</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={labelClass}>Vessel Name</label>
              <input className={inputClass} value={form.vessel_name} onChange={(e) => setForm({ ...form, vessel_name: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Type</label>
              {!customVesselType ? (
                <select className={inputClass} value={form.vessel_type} onChange={(e) => {
                  if (e.target.value === "__custom__") { setCustomVesselType(true); setForm({ ...form, vessel_type: "" }); }
                  else setForm({ ...form, vessel_type: e.target.value });
                }}>
                  <option value="">Select type...</option>
                  <option value="__custom__">+ Custom...</option>
                  {["Billfish", "Bowrider", "Catamaran", "Center Console", "Convertible", "Cruiser", "Cuddy Cabin", "Dinghy", "Downeast", "Dual Console", "Enclosed Flybridge", "Express", "Express Cruiser", "Flybridge", "Flybridge Motor Yacht", "Motor Yacht", "Runabout", "Sailing Yacht", "Sportfish", "Sports Cruiser", "Tender", "Trawler", "Walkaround", "Other"].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              ) : (
                <div className="flex gap-2">
                  <input type="text" autoFocus value={form.vessel_type}
                    onChange={(e) => setForm({ ...form, vessel_type: e.target.value })}
                    placeholder="Enter vessel type..."
                    className={inputClass} />
                  <button type="button" onClick={() => { setCustomVesselType(false); setForm({ ...form, vessel_type: "" }); }}
                    className="text-ink-500 hover:text-ink-700 text-sm px-3 border border-hairline-strong rounded-ctl transition-colors duration-fast">✕</button>
                </div>
              )}
            </div>
            <div>
              <label className={labelClass}>Year</label>
              <input className={inputClass} type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} min="1900" max="2030" />
            </div>
            <div>
              <label className={labelClass}>Make</label>
              <input className={inputClass} value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Model</label>
              <input className={inputClass} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Length (ft)</label>
              <input className={inputClass} type="number" value={form.length_ft} onChange={(e) => setForm({ ...form, length_ft: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Asking Price ($)</label>
              <input className={inputClass} type="number" value={form.asking_price} onChange={(e) => setForm({ ...form, asking_price: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Location</label>
              <input className={inputClass} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Description <span className="text-ink-400 font-normal">(optional)</span></label>
              <textarea className={`${inputClass} resize-none`} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Key features, recent upgrades..." />
            </div>
          </div>
        </section>

        <section className="bg-white border border-hairline rounded-card shadow-elev-1 p-6">
          <h2 className="text-h2 text-ink-900 mb-1">Photos</h2>
          <p className="text-ink-500 text-sm mb-4">
            Upload photos now, or add them later from the listing page.
          </p>

          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
            className="border-2 border-dashed border-hairline-strong rounded-card p-8 text-center cursor-pointer hover:border-accent-500 transition-colors duration-fast ease-quiet mb-4"
          >
            <p className="text-ink-500 text-sm">Click or drag photos here</p>
            <p className="text-ink-400 text-xs mt-1">JPG, PNG, WEBP</p>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
          </div>

          {photos.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {photos.map((photo, i) => (
                <div key={i} className="relative rounded-ctl overflow-hidden border border-hairline">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.preview} alt={photo.file.name} className="w-full h-28 object-cover" />
                  <button type="button" onClick={() => removePhoto(i)}
                    className="absolute top-1.5 right-1.5 bg-ink-950/60 hover:bg-ink-950/80 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs transition-colors duration-fast">
                    ×
                  </button>
                  <div className="p-2">
                    <select value={photo.category} onChange={(e) => updateCategory(i, e.target.value)}
                      className="w-full text-xs bg-ink-50 border border-hairline-strong rounded px-2 py-1 focus:outline-none focus:border-accent-500 transition-colors duration-fast">
                      {PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}

          {uploading && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-ink-500 mb-1">
                <span>Uploading photos...</span><span>{uploadProgress}%</span>
              </div>
              <div className="bg-ink-100 rounded-full h-2">
                <div className="bg-accent-500 h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}
        </section>

        <section className="bg-white border border-hairline rounded-card shadow-elev-1 p-6">
          <h2 className="text-h2 text-ink-900 mb-1">Video</h2>
          <p className="text-ink-500 text-sm mb-4">
            Optional, and independent of photos — a listing can be video only.
          </p>

          <div
            onClick={() => videoInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleVideoFiles(e.dataTransfer.files); }}
            className="border-2 border-dashed border-hairline-strong rounded-card p-8 text-center cursor-pointer hover:border-accent-500 transition-colors duration-fast ease-quiet mb-4"
          >
            <p className="text-ink-500 text-sm">Click or drag video here</p>
            <p className="text-ink-400 text-xs mt-1">MP4 or MOV</p>
            <input ref={videoInputRef} type="file" accept={VIDEO_ACCEPT} multiple className="hidden" onChange={(e) => handleVideoFiles(e.target.files)} />
          </div>

          {videoRejected && (
            <p className="text-xs text-warn-700 mb-3">{videoRejected}</p>
          )}

          {videoFiles.length > 0 && (
            <ul className="space-y-2">
              {videoFiles.map((file, i) => (
                <li key={i} className="flex items-center gap-3 border border-hairline rounded-ctl px-3 py-2.5">
                  <svg className="w-4 h-4 text-ink-400 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                    <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
                  </svg>
                  <span className="text-sm text-ink-900 truncate flex-1 min-w-0">{file.name}</span>
                  <span className="text-xs text-ink-400 shrink-0 tabular-nums">{formatFileSize(file.size)}</span>
                  <button
                    type="button"
                    onClick={() => removeVideo(i)}
                    className="text-ink-400 hover:text-danger-600 transition-colors duration-fast shrink-0 w-5 h-5 flex items-center justify-center"
                    aria-label={`Remove ${file.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Videos are big. Show which file, and its real byte progress, so a
              long upload never looks like a stall. */}
          {uploadingVideo && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-ink-500 mb-1">
                <span>
                  Uploading video{videoFiles.length > 1 ? ` ${videoIndex + 1} of ${videoFiles.length}` : ""}…
                </span>
                <span className="tabular-nums">{videoProgress}%</span>
              </div>
              <div className="bg-ink-100 rounded-full h-2">
                <div className="bg-accent-500 h-2 rounded-full transition-all" style={{ width: `${videoProgress}%` }} />
              </div>
              <p className="text-xs text-ink-400 mt-1.5">Keep this page open until it finishes.</p>
            </div>
          )}
        </section>

        <div className="flex justify-end gap-3">
          <Link href="/dashboard/listings" className="px-5 py-2.5 text-sm text-ink-600 hover:text-ink-900 transition-colors duration-fast">
            Cancel
          </Link>
          <button type="submit" disabled={saving || (isAssistant && !selectedBrokerId && brokerOptions.length > 1)}
            className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 font-semibold px-6 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2">
            {saving ? "Creating…" : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
