"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PHOTO_CATEGORIES } from "@/lib/photoCategories";
import { guessCategory } from "@/lib/guessCategory";

type BrokerOption = { id: string; name: string };

export default function NewListingPage() {
  const supabase = createClient();
  const router = useRouter();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
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

    router.push(`/dashboard/listings/${listingId}`);
  }

  const inputClass = "w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4a843] transition-colors";
  const labelClass = "block text-gray-700 text-sm font-medium mb-1.5";

  if (!roleLoaded) {
    return (
      <div className="px-6 py-8 max-w-3xl mx-auto">
        <div className="h-8 w-48 bg-gray-100 rounded animate-pulse mb-4" />
        <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <Link href="/dashboard/listings" className="text-gray-400 hover:text-gray-600 text-sm transition-colors">
          {isAssistant ? "← Listings" : "← My Listings"}
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">New Listing</h1>
        <p className="text-gray-500 mt-1 text-sm">
          {isAssistant ? "Create a listing on behalf of a broker." : "Add a vessel listing and upload photos."}
        </p>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg text-sm bg-red-50 border border-red-200 text-red-600">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">

        {isAssistant && (
          <section className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Broker</h2>
            {brokerOptions.length === 0 ? (
              <p className="text-sm text-gray-500">You are not linked to any brokers. Contact an admin to be linked.</p>
            ) : brokerOptions.length === 1 ? (
              <p className="text-sm text-gray-700">
                Creating listing for <strong>{brokerOptions[0].name}</strong>
              </p>
            ) : (
              <div>
                <label className={labelClass}>Select broker <span className="text-red-400">*</span></label>
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
                  {["Billfish", "Bowrider", "Catamaran", "Center Console", "Convertible", "Cruiser", "Cuddy Cabin", "Dinghy", "Downeast", "Dual Console", "Express Cruiser", "Flybridge", "Motor Yacht", "Runabout", "Sailing Yacht", "Sportfish", "Sports Cruiser", "Tender", "Trawler", "Walkaround", "Other"].map((t) => (
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
              <textarea className={`${inputClass} resize-none`} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Key features, recent upgrades..." />
            </div>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 mb-1">Photos</h2>
          <p className="text-gray-500 text-sm mb-4">
            Upload photos now, or add them later from the listing page.
          </p>

          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
            className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-[#d4a843] transition-colors mb-4"
          >
            <p className="text-gray-400 text-sm">Click or drag photos here</p>
            <p className="text-gray-300 text-xs mt-1">JPG, PNG, WEBP</p>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
          </div>

          {photos.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {photos.map((photo, i) => (
                <div key={i} className="relative rounded-lg overflow-hidden border border-gray-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.preview} alt={photo.file.name} className="w-full h-28 object-cover" />
                  <button type="button" onClick={() => removePhoto(i)}
                    className="absolute top-1.5 right-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                    ×
                  </button>
                  <div className="p-2">
                    <select value={photo.category} onChange={(e) => updateCategory(i, e.target.value)}
                      className="w-full text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-[#d4a843]">
                      {PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}

          {uploading && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Uploading photos...</span><span>{uploadProgress}%</span>
              </div>
              <div className="bg-gray-100 rounded-full h-2">
                <div className="bg-[#d4a843] h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}
        </section>

        <div className="flex justify-end gap-3">
          <Link href="/dashboard/listings" className="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-900 transition-colors">
            Cancel
          </Link>
          <button type="submit" disabled={saving || (isAssistant && !selectedBrokerId && brokerOptions.length > 1)}
            className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm">
            {saving ? "Creating..." : `Create Listing${photos.length > 0 ? ` & Upload ${photos.length} Photo${photos.length !== 1 ? "s" : ""}` : ""}`}
          </button>
        </div>
      </form>
    </div>
  );
}
