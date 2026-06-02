"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { PHOTO_CATEGORIES } from "@/lib/photoCategories";
import { guessCategory } from "@/lib/guessCategory";

interface Broker {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_email: string | null;
  broker_details: { brokerage_name: string | null }[] | null;
}

export default function NewListingPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedBrokerId = searchParams.get("broker") ?? "";
  const fromInvite = searchParams.get("fromInvite") === "true";

  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [customVesselType, setCustomVesselType] = useState(false);
  const [form, setForm] = useState({
    broker_id: preselectedBrokerId,
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

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, first_name, last_name, display_email, broker_details(brokerage_name)")
      .eq("role", "broker")
      .order("first_name")
      .then(({ data }) => setBrokers((data as Broker[]) ?? []));
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
    if (!form.broker_id) { setError("Please select a broker."); return; }
    setSaving(true);
    setError("");

    // 1. Create listing
    const { data: listing, error: listingError } = await supabase
      .from("listings")
      .insert({
        broker_id: form.broker_id,
        vessel_name: form.vessel_name || null,
        vessel_type: form.vessel_type || null,
        year: form.year ? parseInt(form.year) : null,
        length_ft: form.length_ft ? parseFloat(form.length_ft) : null,
        make: form.make || null,
        model: form.model || null,
        asking_price: form.asking_price ? parseFloat(form.asking_price) : null,
        location: form.location || null,
        description: form.description || null,
        status: "active",
      })
      .select("id")
      .single();

    if (listingError || !listing) {
      setError(listingError?.message ?? "Failed to create listing.");
      setSaving(false);
      return;
    }

    // 2. Upload photos
    if (photos.length > 0) {
      setUploading(true);
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const ext = photo.file.name.split(".").pop();
        const path = `${form.broker_id}/${listing.id}/${Date.now()}-${i}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("listing-photos")
          .upload(path, photo.file, { upsert: false });

        if (!uploadError) {
          await supabase.from("photos").insert({
            listing_id: listing.id,
            storage_path: path,
            filename: photo.file.name,
            category: photo.category,
            display_order: i,
            is_visible: true,
          });
        }

        setUploadProgress(Math.round(((i + 1) / photos.length) * 100));
      }
      setUploading(false);
    }

    // 3. If coming from broker invite flow and photos were uploaded, auto-notify broker
    if (fromInvite && photos.length > 0) {
      await fetch("/api/email/notify-broker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: listing.id }),
      });
      router.push(`/admin/brokers/${form.broker_id}?invited=true`);
    } else {
      router.push(`/admin/listings/${listing.id}`);
    }
  }

  const inputClass = "w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4a843] transition-colors";
  const labelClass = "block text-gray-700 text-sm font-medium mb-1.5";

  const preselectedBroker = brokers.find((b) => b.id === preselectedBrokerId);
  const preselectedBrokerName = preselectedBroker?.first_name
    ? `${preselectedBroker.first_name} ${preselectedBroker.last_name ?? ""}`.trim()
    : preselectedBroker?.display_email ?? "—";
  const preselectedBrokerage = preselectedBroker?.broker_details?.[0]?.brokerage_name ?? null;

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">New Listing</h1>
        <p className="text-gray-500 mt-1 text-sm">
          {fromInvite
            ? "Invite sent. Now create their listing and upload photos — the broker will be notified automatically when you save."
            : "Create a listing and upload photos for a broker."}
        </p>
      </div>

      {fromInvite && (
        <div className="mb-6 flex items-start gap-3 bg-green-50 border border-green-200 rounded-xl px-5 py-4">
          <span className="text-green-500 text-lg leading-none mt-0.5">✓</span>
          <div>
            <p className="text-sm font-semibold text-green-800">Invite sent successfully</p>
            <p className="text-sm text-green-700 mt-0.5">
              The broker will receive a second email when you save this listing confirming their photos are ready.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg text-sm bg-red-50 border border-red-200 text-red-600">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Broker */}
        {preselectedBrokerId ? (
          <section className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="font-semibold text-gray-900 mb-1">Broker</h2>
            <p className="text-gray-700 text-sm">
              {preselectedBrokerName}{preselectedBrokerage ? ` — ${preselectedBrokerage}` : ""}
            </p>
          </section>
        ) : (
          <section className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Broker</h2>
            <div>
              <label className={labelClass}>Select Broker *</label>
              <select
                className={inputClass}
                value={form.broker_id}
                onChange={(e) => setForm({ ...form, broker_id: e.target.value })}
                required
              >
                <option value="">Choose a broker...</option>
                {brokers.map((b) => {
                  const brokerage = b.broker_details?.[0]?.brokerage_name;
                  const name = b.first_name ? `${b.first_name} ${b.last_name ?? ""}`.trim() : b.display_email ?? b.id;
                  return (
                    <option key={b.id} value={b.id}>
                      {name}{brokerage ? ` — ${brokerage}` : ""}
                    </option>
                  );
                })}
              </select>
            </div>
          </section>
        )}

        {/* Vessel Info */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Vessel Information</h2>
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
                  {["Billfish", "Bowrider", "Catamaran", "Center Console", "Convertible", "Cruiser", "Cuddy Cabin", "Dinghy", "Downeast", "Dual Console", "Express", "Express Cruiser", "Flybridge", "Motor Yacht", "Runabout", "Sailing Yacht", "Sportfish", "Sports Cruiser", "Tender", "Trawler", "Walkaround", "Other"].map((t) => (
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
                    className="text-gray-400 hover:text-gray-600 text-sm px-3 border border-gray-200 rounded-lg">✕</button>
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
              <label className={labelClass}>Description <span className="text-gray-400 font-normal">(optional)</span></label>
              <textarea className={`${inputClass} resize-none`} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
        </section>

        {/* Photos */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 mb-1">Photos</h2>
          <p className="text-gray-500 text-sm mb-4">
            {fromInvite
              ? "Upload their photos here — the broker will be notified automatically when you save."
              : "Drag files in or click to select. Categories are auto-detected from filenames."}
          </p>

          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
            className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-[#d4a843] transition-colors mb-4"
          >
            <p className="text-gray-400 text-sm">Click or drag photos here</p>
            <p className="text-gray-300 text-xs mt-1">JPG, PNG, WEBP</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          {photos.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {photos.map((photo, i) => (
                <div key={i} className="relative group rounded-lg overflow-hidden border border-gray-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.preview} alt={photo.file.name} className="w-full h-28 object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute top-1.5 right-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs transition-colors"
                  >
                    ×
                  </button>
                  <div className="p-2 space-y-1">
                    {(PHOTO_CATEGORIES as readonly string[]).includes(photo.category) ? (
                      <select
                        value={photo.category}
                        onChange={(e) => updateCategory(i, e.target.value === "__custom__" ? "" : e.target.value)}
                        className="w-full text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-[#d4a843]"
                      >
                        <option value="__custom__">+ Custom...</option>
                        {PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={photo.category}
                          onChange={(e) => updateCategory(i, e.target.value)}
                          placeholder="Enter category..."
                          autoFocus
                          className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-[#d4a843]"
                        />
                        <button type="button" onClick={() => updateCategory(i, "Other")} className="text-gray-400 hover:text-gray-600 text-xs px-1" title="Back to list">✕</button>
                      </div>
                    )}
                    <p className="text-[10px] text-gray-400 truncate">{photo.file.name}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {uploading && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Uploading photos...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="bg-gray-100 rounded-full h-2">
                <div
                  className="bg-[#d4a843] h-2 rounded-full transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}
        </section>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm"
          >
            {saving
              ? (fromInvite ? "Saving & notifying broker…" : "Creating...")
              : fromInvite
                ? `Save & Notify Broker${photos.length > 0 ? ` (${photos.length} photo${photos.length !== 1 ? "s" : ""})` : ""}`
                : `Create Listing${photos.length > 0 ? ` & Upload ${photos.length} Photo${photos.length !== 1 ? "s" : ""}` : ""}`}
          </button>
        </div>
      </form>
    </div>
  );
}
