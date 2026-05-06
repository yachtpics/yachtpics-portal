"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PHOTO_CATEGORIES } from "@/lib/photoCategories";
import { guessCategory } from "@/lib/guessCategory";
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
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);


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
          vesselName: vessel.vesselName,
          photosReady: photos.length > 0,
          assistantEmail: broker.assistantEmail || undefined,
        }),
      });
      const inviteData = await inviteRes.json();
      if (!inviteRes.ok) {
        setError(inviteData.error ?? "Failed to create broker account.");
        return;
      }
      const brokerId = inviteData.brokerId;

      // Step 2: Create listing if vessel info provided
      let listingId: string | null = null;
      if (vessel.vesselName || photos.length > 0) {
        setProgress("Creating listing…");
        const { data: listing, error: listingError } = await supabase
          .from("listings")
          .insert({
            broker_id: brokerId,
            vessel_name: vessel.vesselName || null,
            vessel_type: vessel.vesselType || null,
            year: vessel.year ? parseInt(vessel.year) : null,
            length_ft: vessel.lengthFt ? parseFloat(vessel.lengthFt) : null,
            make: vessel.make || null,
            model: vessel.model || null,
            asking_price: vessel.askingPrice ? parseFloat(vessel.askingPrice) : null,
            location: vessel.location || null,
            status: "active",
          })
          .select("id")
          .single();

        if (listingError || !listing) {
          setError(listingError?.message ?? "Failed to create listing.");
          return;
        }
        listingId = listing.id;
      }

      // Step 3: Upload photos
      if (photos.length > 0 && listingId) {
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
            });
          }
        }
      }

      router.push(`/admin/brokers/${brokerId}?invited=true`);
    } catch {
      setError("Unexpected error. Please try again.");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const inputClass = "w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#d4a843] focus:ring-1 focus:ring-[#d4a843]/30";
  const labelClass = "block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5";

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href="/admin/brokers" className="text-gray-400 hover:text-gray-600 text-sm transition-colors">
          ← All brokers
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Invite Broker</h1>
        <p className="text-gray-500 text-sm mt-1">
          Fill in everything below and hit Send — the broker gets their invite and their photos in one go.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Broker Info */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Broker Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>First Name <span className="text-red-400">*</span></label>
              <input type="text" required value={broker.firstName}
                onChange={(e) => setBroker({ ...broker, firstName: e.target.value })}
                className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Last Name <span className="text-red-400">*</span></label>
              <input type="text" required value={broker.lastName}
                onChange={(e) => setBroker({ ...broker, lastName: e.target.value })}
                className={inputClass} />
            </div>
          </div>
          <div className="mt-4">
            <label className={labelClass}>Email Address <span className="text-red-400">*</span></label>
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
          <div className="mt-4 pt-4 border-t border-gray-100">
            <label className={labelClass}>
              Assistant Email <span className="text-gray-400 normal-case font-normal tracking-normal">(optional)</span>
            </label>
            <input type="email" value={broker.assistantEmail}
              onChange={(e) => setBroker({ ...broker, assistantEmail: e.target.value })}
              placeholder="assistant@brokerage.com"
              className={inputClass} />
            <p className="text-xs text-gray-400 mt-1.5">
              If this broker has an assistant who manages their portal, add their email here. They&apos;ll be linked automatically and notified when photos are ready.
            </p>
          </div>
        </div>

        {/* Vessel Info */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 mb-1">Vessel Information</h2>
          <p className="text-xs text-gray-400 mb-4">Optional — used to personalize the invite email and create the listing.</p>
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
                  {["Billfish","Bowrider","Catamaran","Center Console","Convertible","Cruiser","Cuddy Cabin","Dinghy","Downeast","Dual Console","Express Cruiser","Flybridge","Motor Yacht","Runabout","Sailing Yacht","Sportfish","Sports Cruiser","Tender","Trawler","Walkaround","Other"].map((t) => (
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
                    className="text-gray-400 hover:text-gray-600 text-sm px-3 border border-gray-200 rounded-lg">✕</button>
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
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 mb-1">Photos</h2>
          <p className="text-xs text-gray-400 mb-4">
            Upload now — photos will be in the broker&apos;s portal the moment they log in.
          </p>

          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
            className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-[#d4a843] transition-colors mb-4"
          >
            <p className="text-gray-400 text-sm">Click or drag photos here</p>
            <p className="text-gray-300 text-xs mt-1">JPG, PNG, WEBP</p>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => handleFiles(e.target.files)} />
          </div>

          {photos.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {photos.map((photo, i) => (
                <div key={i} className="relative rounded-lg overflow-hidden border border-gray-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.preview} alt={photo.file.name} className="w-full h-28 object-cover" />
                  <button type="button" onClick={() => removePhoto(i)}
                    className="absolute top-1.5 right-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs transition-colors">
                    ×
                  </button>
                  <div className="p-2 space-y-1">
                    {(PHOTO_CATEGORIES as readonly string[]).includes(photo.category) ? (
                      <select value={photo.category}
                        onChange={(e) => updateCategory(i, e.target.value === "__custom__" ? "" : e.target.value)}
                        className="w-full text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-[#d4a843]">
                        <option value="__custom__">+ Custom...</option>
                        {PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (
                      <div className="flex items-center gap-1">
                        <input type="text" value={photo.category} autoFocus
                          onChange={(e) => updateCategory(i, e.target.value)}
                          placeholder="Enter category..."
                          className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-[#d4a843]" />
                        <button type="button" onClick={() => updateCategory(i, "Other")}
                          className="text-gray-400 hover:text-gray-600 text-xs px-1">✕</button>
                      </div>
                    )}
                    <p className="text-[10px] text-gray-400 truncate">{photo.file.name}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={loading}
            className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-60 text-[#050b14] font-semibold text-sm px-6 py-2.5 rounded-lg transition-colors min-w-[160px]">
            {loading
              ? (progress ?? "Working…")
              : photos.length > 0
                ? `Send Invite & Upload ${photos.length} Photo${photos.length !== 1 ? "s" : ""}`
                : "Send Invite"}
          </button>
          <Link href="/admin/brokers" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
