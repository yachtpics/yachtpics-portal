"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PHOTO_CATEGORIES } from "@/lib/photoCategories";
import { guessCategory } from "@/lib/guessCategory";
import { uploadListingVideo, isSupportedVideo, VIDEO_ACCEPT, formatFileSize } from "@/lib/uploadListingVideo";
import Link from "next/link";

export default function InviteBrokerPage() {
  const router = useRouter();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [broker, setBroker] = useState({
    firstName: "",
    lastName: "",
    email: "",
    brokerage: "",
    assistantEmail: "",
    assistantFirstName: "",
    assistantLastName: "",
  });

  const [customVesselType, setCustomVesselType] = useState(false);
  const [vessel, setVessel] = useState({
    vesselName: "",
    vesselType: "",
    year: "",
    make: "",
    model: "",
    lengthFt: "",
    askingPrice: "",
    location: "",
  });

  const [photos, setPhotos] = useState<{ file: File; category: string; preview: string }[]>([]);

  // Video, on the same footing as photos — a first job can be video only.
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoRejected, setVideoRejected] = useState("");
  const [videoFailures, setVideoFailures] = useState<string[]>([]);
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
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ brokerId: string; tempPassword: string; assistantTempPassword?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/photo-categories")
      .then((r) => r.json())
      .then((d) => { if (d.categories) setCustomCategories(d.categories.map((c: { name: string }) => c.name)); })
      .catch(() => {});
  }, []);

  async function saveCustomCategory(name: string) {
    if ((PHOTO_CATEGORIES as readonly string[]).includes(name)) return;
    if (customCategories.includes(name)) return;
    try {
      await fetch("/api/photo-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setCustomCategories((prev) => [...prev, name].sort());
    } catch {}
  }

  const allCategories = [...(PHOTO_CATEGORIES as readonly string[]), ...customCategories.filter(c => !(PHOTO_CATEGORIES as readonly string[]).includes(c))];


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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Step 1: Create broker account + send invite email
      setProgress("Creating broker account…");
      const inviteRes = await fetch("/api/admin/invite-broker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: broker.firstName,
          lastName: broker.lastName,
          email: broker.email,
          brokerage: broker.brokerage,
          photosReady: photos.length > 0,
          videoReady: videoFiles.length > 0,
          assistantEmail: broker.assistantEmail || undefined,
          assistantFirstName: broker.assistantFirstName || undefined,
          assistantLastName: broker.assistantLastName || undefined,
          // Vessel — create listing server-side to bypass RLS
          vesselName: vessel.vesselName || undefined,
          vesselType: vessel.vesselType || undefined,
          year: vessel.year ? parseInt(vessel.year) : undefined,
          lengthFt: vessel.lengthFt ? parseFloat(vessel.lengthFt) : undefined,
          make: vessel.make || undefined,
          model: vessel.model || undefined,
          askingPrice: vessel.askingPrice ? parseFloat(vessel.askingPrice) : undefined,
          location: vessel.location || undefined,
          // A video-only first job still needs a listing to hang it on.
          createListing: !!(vessel.vesselName || photos.length > 0 || videoFiles.length > 0),
        }),
      });
      const inviteData = await inviteRes.json();
      if (!inviteRes.ok) {
        setError(inviteData.error ?? "Failed to create broker account.");
        return;
      }
      const brokerId = inviteData.brokerId;
      const listingId: string | null = inviteData.listingId ?? null;

      // Step 2: Upload photos — stamped with which admin delivered them.
      if (photos.length > 0 && listingId) {
        const { data: { user: uploader } } = await supabase.auth.getUser();
        for (let i = 0; i < photos.length; i++) {
          setProgress(`Uploading photo ${i + 1} of ${photos.length}…`);
          const photo = photos[i];
          const ext = photo.file.name.split(".").pop();
          const path = `${brokerId}/${listingId}/${Date.now()}-${i}.${ext}`;

          const { error: uploadError } = await supabase.storage
            .from("listing-photos")
            .upload(path, photo.file, { upsert: false });

          if (!uploadError) {
            await supabase.from("photos").insert({
              listing_id: listingId,
              storage_path: path,
              filename: photo.file.name,
              category: photo.category,
              display_order: i,
              is_visible: true,
              uploaded_by: uploader?.id ?? null,
            });
          }
        }
      }

      // Step 3: Videos, after the photos — much larger files, so the quick part
      // of the job is safely saved first.
      const failures: string[] = [];
      if (videoFiles.length > 0 && listingId) {
        const { data: { user } } = await supabase.auth.getUser();
        for (let i = 0; i < videoFiles.length; i++) {
          setVideoProgress(0);
          setProgress(`Uploading video ${i + 1} of ${videoFiles.length}…`);
          const result = await uploadListingVideo({
            supabase,
            file: videoFiles[i],
            listingId,
            uploadedBy: user?.id ?? brokerId,
            displayOrder: i,
            onProgress: setVideoProgress,
          });
          if (!result.ok) failures.push(`${videoFiles[i].name} — ${result.error}`);
        }
      }
      // The broker account is created either way, so don't hide this — but
      // don't lose the temp password by erroring out of the success screen.
      setVideoFailures(failures);

      setSuccess({
        brokerId,
        tempPassword: inviteData.brokerTempPassword ?? "",
        assistantTempPassword: inviteData.assistantTempPassword ?? undefined,
      });
    } catch {
      setError("Unexpected error. Please try again.");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Names whatever is attached, so it's clear the video is part of the send.
  const attached = [
    photos.length > 0 ? `${photos.length} Photo${photos.length !== 1 ? "s" : ""}` : null,
    videoFiles.length > 0 ? `${videoFiles.length} Video${videoFiles.length !== 1 ? "s" : ""}` : null,
  ].filter(Boolean);
  const inviteLabel = attached.length > 0
    ? `Send Invite & Upload ${attached.join(" + ")}`
    : "Send Invite";

  const inputClass = "w-full border border-hairline-strong rounded-ctl px-3 py-2.5 text-sm text-ink-900 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500";
  const labelClass = "block label-caps mb-1.5";

  if (success) {
    return (
      <div className="px-6 py-8 max-w-3xl mx-auto">
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-8">
          <div className="w-10 h-10 bg-success-50 rounded-full flex items-center justify-center mb-4">
            <svg className="w-5 h-5 text-success-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-h1 text-ink-900 mb-1">Broker invited</h1>
          <p className="text-ink-500 text-sm mb-6">
            Account created and login details sent to {broker.email}. Share the temporary password with them if needed.
          </p>

          {/* Shown here rather than as an error, so the temp password above is
              never lost just because a video didn't make it. */}
          {videoFailures.length > 0 && (
            <div className="bg-danger-50 border border-danger-200 rounded-card p-5 mb-4">
              <p className="text-xs font-semibold text-danger-700 uppercase tracking-wide mb-2">
                {videoFailures.length === 1 ? "A video didn't upload" : "Some videos didn't upload"}
              </p>
              <ul className="text-sm text-danger-700 space-y-1 mb-2">
                {videoFailures.map((f, i) => <li key={i} className="break-all">{f}</li>)}
              </ul>
              <p className="text-xs text-danger-600">
                The broker and listing were created. Add the video from the listing page.
              </p>
            </div>
          )}

          <div className="bg-warn-50 border border-warn-200 rounded-card p-5 mb-4">
            <p className="text-xs font-semibold text-warn-700 uppercase tracking-wide mb-3">Broker Login Details</p>
            <div className="space-y-1.5 text-sm text-ink-700 mb-3">
              <p><span className="text-ink-500">Email:</span> <span className="font-medium">{broker.email}</span></p>
              <p className="flex items-center gap-2">
                <span className="text-ink-500">Temp password:</span>
                <span className="font-mono font-semibold text-ink-900">{success.tempPassword}</span>
                <button
                  onClick={() => handleCopy(success.tempPassword)}
                  className="text-xs text-accent-700 hover:text-accent-800 transition-colors duration-fast ease-quiet"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </p>
            </div>
            <p className="text-xs text-ink-500">The broker can update their password from profile settings after logging in.</p>
          </div>

          {success.assistantTempPassword && broker.assistantEmail && (
            <div className="bg-info-50 border border-info-200 rounded-card p-5 mb-6">
              <p className="text-xs font-semibold text-info-700 uppercase tracking-wide mb-3">Assistant Login Details</p>
              <div className="space-y-1.5 text-sm text-ink-700">
                <p><span className="text-ink-500">Email:</span> <span className="font-medium">{broker.assistantEmail}</span></p>
                <p><span className="text-ink-500">Temp password:</span> <span className="font-mono font-semibold text-ink-900">{success.assistantTempPassword}</span></p>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => router.push(`/admin/brokers/${success.brokerId}`)}
              className="bg-accent-500 hover:bg-accent-400 text-ink-950 font-semibold text-sm px-5 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet"
            >
              View broker profile
            </button>
            <button
              onClick={() => router.push("/admin/brokers/new")}
              className="text-sm text-ink-500 hover:text-ink-700 transition-colors duration-fast ease-quiet px-2"
            >
              Invite another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href="/admin/brokers" className="text-ink-400 hover:text-ink-600 text-sm transition-colors duration-fast ease-quiet">
          ← All brokers
        </Link>
        <h1 className="text-display text-ink-900 mt-2">Invite Broker</h1>
        <p className="text-ink-500 text-sm mt-1">
          Fill in everything below and hit Send — the broker gets their invite and their photos in one go.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Broker Info */}
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-6">
          <h2 className="text-h2 text-ink-900 mb-4">Broker Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>First Name <span className="text-danger-500">*</span></label>
              <input type="text" required value={broker.firstName}
                onChange={(e) => setBroker({ ...broker, firstName: e.target.value })}
                className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Last Name <span className="text-danger-500">*</span></label>
              <input type="text" required value={broker.lastName}
                onChange={(e) => setBroker({ ...broker, lastName: e.target.value })}
                className={inputClass} />
            </div>
          </div>
          <div className="mt-4">
            <label className={labelClass}>Email Address <span className="text-danger-500">*</span></label>
            <input type="email" required value={broker.email}
              onChange={(e) => setBroker({ ...broker, email: e.target.value })}
              className={inputClass} />
          </div>
          <div className="mt-4">
            <label className={labelClass}>Brokerage</label>
            <input type="text" value={broker.brokerage}
              onChange={(e) => setBroker({ ...broker, brokerage: e.target.value })}
              className={inputClass} />
          </div>
          <div className="mt-4 pt-4 border-t border-hairline">
            <label className={labelClass}>
              Assistant <span className="text-ink-400 normal-case font-normal tracking-normal">(optional)</span>
            </label>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <input type="text" value={broker.assistantFirstName}
                onChange={(e) => setBroker({ ...broker, assistantFirstName: e.target.value })}
                placeholder="First name"
                className={inputClass} />
              <input type="text" value={broker.assistantLastName}
                onChange={(e) => setBroker({ ...broker, assistantLastName: e.target.value })}
                placeholder="Last name"
                className={inputClass} />
            </div>
            <input type="email" value={broker.assistantEmail}
              onChange={(e) => setBroker({ ...broker, assistantEmail: e.target.value })}
              placeholder="assistant@brokerage.com"
              className={inputClass} />
            <p className="text-xs text-ink-500 mt-1.5">
              If this broker has an assistant who manages their portal, add their details here. They&apos;ll be linked automatically and notified when photos are ready.
            </p>
          </div>
        </div>

        {/* Vessel Info */}
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-6">
          <h2 className="text-h2 text-ink-900 mb-1">Vessel Information</h2>
          <p className="text-xs text-ink-500 mb-4">Optional — used to personalize the invite email and create the listing.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={labelClass}>Vessel Name</label>
              <input type="text" value={vessel.vesselName}
                onChange={(e) => setVessel({ ...vessel, vesselName: e.target.value })}
                className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Type</label>
              {!customVesselType ? (
                <select value={vessel.vesselType}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") { setCustomVesselType(true); setVessel({ ...vessel, vesselType: "" }); }
                    else setVessel({ ...vessel, vesselType: e.target.value });
                  }}
                  className={inputClass}>
                  <option value="">Select type...</option>
                  <option value="__custom__">+ Custom...</option>
                  {["Billfish","Bowrider","Catamaran","Center Console","Convertible","Cruiser","Cuddy Cabin","Dinghy","Downeast","Dual Console","Enclosed Flybridge","Express","Express Cruiser","Flybridge","Flybridge Motor Yacht","Motor Yacht","Runabout","Sailing Yacht","Sportfish","Sports Cruiser","Tender","Trawler","Walkaround","Other"].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              ) : (
                <div className="flex gap-2">
                  <input type="text" autoFocus value={vessel.vesselType}
                    onChange={(e) => setVessel({ ...vessel, vesselType: e.target.value })}
                    placeholder="Enter vessel type..."
                    className={inputClass} />
                  <button type="button" onClick={() => { setCustomVesselType(false); setVessel({ ...vessel, vesselType: "" }); }}
                    className="text-ink-400 hover:text-ink-600 text-sm px-3 border border-hairline-strong rounded-ctl">✕</button>
                </div>
              )}
            </div>
            <div>
              <label className={labelClass}>Year</label>
              <input type="number" value={vessel.year} min="1900" max="2030"
                onChange={(e) => setVessel({ ...vessel, year: e.target.value })}
                className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Make</label>
              <input type="text" value={vessel.make}
                onChange={(e) => setVessel({ ...vessel, make: e.target.value })}
                className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Model</label>
              <input type="text" value={vessel.model}
                onChange={(e) => setVessel({ ...vessel, model: e.target.value })}
                className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Length (ft)</label>
              <input type="number" value={vessel.lengthFt}
                onChange={(e) => setVessel({ ...vessel, lengthFt: e.target.value })}
                className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Asking Price ($)</label>
              <input type="number" value={vessel.askingPrice}
                onChange={(e) => setVessel({ ...vessel, askingPrice: e.target.value })}
                className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Location</label>
              <input type="text" value={vessel.location}
                onChange={(e) => setVessel({ ...vessel, location: e.target.value })}
                className={inputClass} />
            </div>
          </div>
        </div>

        {/* Photos */}
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-6">
          <h2 className="text-h2 text-ink-900 mb-1">Photos</h2>
          <p className="text-xs text-ink-500 mb-4">
            Upload now — photos will be in the broker&apos;s portal the moment they log in.
          </p>

          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
            className="border-2 border-dashed border-ink-200 rounded-card p-8 text-center cursor-pointer hover:border-accent-500 transition-colors duration-fast ease-quiet mb-4"
          >
            <p className="text-ink-400 text-sm">Click or drag photos here</p>
            <p className="text-ink-300 text-xs mt-1">JPG, PNG, WEBP</p>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => handleFiles(e.target.files)} />
          </div>

          {photos.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {photos.map((photo, i) => (
                <div key={i} className="relative rounded-lg overflow-hidden border border-hairline">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.preview} alt={photo.file.name} className="w-full h-28 object-cover" />
                  <button type="button" onClick={() => removePhoto(i)}
                    className="absolute top-1.5 right-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs transition-colors">
                    &times;
                  </button>
                  <div className="p-2 space-y-1">
                    {allCategories.includes(photo.category) ? (
                      <select value={photo.category}
                        onChange={(e) => updateCategory(i, e.target.value === "__custom__" ? "" : e.target.value)}
                        className="w-full text-xs bg-ink-50 border border-hairline-strong rounded px-2 py-1 focus:outline-none focus:border-accent-500">
                        <option value="__custom__">+ Custom...</option>
                        {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (
                      <div className="flex items-center gap-1">
                        <input type="text" value={photo.category} autoFocus
                          onChange={(e) => updateCategory(i, e.target.value)}
                          onBlur={(e) => { const v = e.target.value.trim(); if (v) saveCustomCategory(v); }}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const v = photo.category.trim(); if (v) saveCustomCategory(v); } }}
                          placeholder="Enter category..."
                          className="flex-1 text-xs bg-ink-50 border border-hairline-strong rounded px-2 py-1 focus:outline-none focus:border-accent-500" />
                        <button type="button" onClick={() => updateCategory(i, "Other")}
                          className="text-ink-400 hover:text-ink-600 text-xs px-1">&times;</button>
                      </div>
                    )}
                    <p className="text-[10px] text-ink-400 truncate">{photo.file.name}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Video */}
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-6">
          <h2 className="text-h2 text-ink-900 mb-1">Video</h2>
          <p className="text-xs text-ink-500 mb-4">
            Optional, and independent of photos — a first job can be video only.
          </p>

          <div
            onClick={() => videoInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleVideoFiles(e.dataTransfer.files); }}
            className="border-2 border-dashed border-ink-200 rounded-card p-8 text-center cursor-pointer hover:border-accent-500 transition-colors duration-fast ease-quiet mb-4"
          >
            <p className="text-ink-400 text-sm">Click or drag video here</p>
            <p className="text-ink-300 text-xs mt-1">MP4 or MOV</p>
            <input ref={videoInputRef} type="file" accept={VIDEO_ACCEPT} multiple className="hidden"
              onChange={(e) => handleVideoFiles(e.target.files)} />
          </div>

          {videoRejected && <p className="text-xs text-warn-700 mb-3">{videoRejected}</p>}

          {videoFiles.length > 0 && (
            <ul className="space-y-2">
              {videoFiles.map((file, i) => (
                <li key={i} className="flex items-center gap-3 border border-hairline rounded-ctl px-3 py-2.5">
                  <svg className="w-4 h-4 text-ink-400 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                    <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
                  </svg>
                  <span className="text-sm text-ink-900 truncate flex-1 min-w-0">{file.name}</span>
                  <span className="text-xs text-ink-400 shrink-0 tabular-nums">{formatFileSize(file.size)}</span>
                  <button type="button" onClick={() => removeVideo(i)}
                    className="text-ink-400 hover:text-danger-600 transition-colors duration-fast shrink-0 w-5 h-5 flex items-center justify-center"
                    aria-label={`Remove ${file.name}`}>
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Real byte progress — these files are large enough that a static
              "Working…" reads as a hang. */}
          {loading && videoFiles.length > 0 && videoProgress > 0 && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-ink-500 mb-1">
                <span>{progress ?? "Uploading video…"}</span>
                <span className="tabular-nums">{videoProgress}%</span>
              </div>
              <div className="bg-ink-100 rounded-full h-2">
                <div className="bg-accent-500 h-2 rounded-full transition-all" style={{ width: `${videoProgress}%` }} />
              </div>
              <p className="text-xs text-ink-400 mt-1.5">Keep this page open until it finishes.</p>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-danger-50 border border-danger-200 text-danger-700 text-sm rounded-ctl px-4 py-3">{error}</div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={loading}
            className="bg-accent-500 hover:bg-accent-400 disabled:opacity-60 text-ink-950 font-semibold text-sm px-6 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet min-w-[160px]">
            {loading ? (progress ?? "Working…") : inviteLabel}
          </button>
          <Link href="/admin/brokers" className="text-sm text-ink-500 hover:text-ink-700 transition-colors duration-fast ease-quiet">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
