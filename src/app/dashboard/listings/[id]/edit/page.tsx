"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function EditListingPage() {
  const supabase = createClient();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const VESSEL_TYPES = ["Billfish", "Bowrider", "Catamaran", "Center Console", "Convertible", "Cruiser", "Cuddy Cabin", "Dinghy", "Downeast", "Dual Console", "Express", "Express Cruiser", "Flybridge", "Motor Yacht", "Runabout", "Sailing Yacht", "Sportfish", "Sports Cruiser", "Tender", "Trawler", "Walkaround", "Other"];
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [customVesselType, setCustomVesselType] = useState(false);

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
    status: "active",
  });

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // No broker_id filter — access is enforced by the PATCH API for both
      // brokers and linked assistants. RLS allows reads by authenticated users.
      const { data } = await supabase
        .from("listings")
        .select("vessel_name, vessel_type, year, length_ft, make, model, asking_price, location, description, status")
        .eq("id", id)
        .single();

      if (!data) { router.push("/dashboard/listings"); return; }

      if (data.vessel_type && !VESSEL_TYPES.includes(data.vessel_type)) setCustomVesselType(true);

      setForm({
        vessel_name: data.vessel_name ?? "",
        vessel_type: data.vessel_type ?? "",
        year: data.year?.toString() ?? "",
        length_ft: data.length_ft?.toString() ?? "",
        make: data.make ?? "",
        model: data.model ?? "",
        asking_price: data.asking_price?.toString() ?? "",
        location: data.location ?? "",
        description: data.description ?? "",
        status: data.status ?? "active",
      });
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    // Route through the API so assistants and brokers both go through the same
    // server-side access check (uses service role, bypasses RLS restrictions).
    const res = await fetch(`/api/listings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vessel_name: form.vessel_name || null,
        vessel_type: form.vessel_type || null,
        year: form.year ? parseInt(form.year) : null,
        length_ft: form.length_ft ? parseFloat(form.length_ft) : null,
        make: form.make || null,
        model: form.model || null,
        asking_price: form.asking_price ? parseFloat(form.asking_price) : null,
        location: form.location || null,
        description: form.description || null,
        status: form.status,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to save changes.");
      setSaving(false);
      return;
    }

    router.push(`/dashboard/listings/${id}`);
  }

  const inputClass = "w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4a843] transition-colors";
  const labelClass = "block text-gray-700 text-sm font-medium mb-1.5";

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>;

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <Link href={`/dashboard/listings/${id}`} className="text-gray-400 hover:text-gray-600 text-sm transition-colors">
          ← Back to Listing
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Edit Listing</h1>
        <p className="text-gray-500 mt-1 text-sm">Update the vessel details.</p>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg text-sm bg-red-50 border border-red-200 text-red-600">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Vessel Information</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={labelClass}>Vessel Name</label>
              <input className={inputClass} value={form.vessel_name} onChange={(e) => setForm({ ...form, vessel_name: e.target.value })} placeholder="Sea Scape" />
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
                  {VESSEL_TYPES.map((t) => (
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
              <input className={inputClass} type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder="2019" min="1900" max="2030" />
            </div>
            <div>
              <label className={labelClass}>Make</label>
              <input className={inputClass} value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} placeholder="Azimut" />
            </div>
            <div>
              <label className={labelClass}>Model</label>
              <input className={inputClass} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="55" />
            </div>
            <div>
              <label className={labelClass}>Length (ft)</label>
              <input className={inputClass} type="number" value={form.length_ft} onChange={(e) => setForm({ ...form, length_ft: e.target.value })} placeholder="55" />
            </div>
            <div>
              <label className={labelClass}>Asking Price ($)</label>
              <input className={inputClass} type="number" value={form.asking_price} onChange={(e) => setForm({ ...form, asking_price: e.target.value })} placeholder="750000" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Location</label>
              <input className={inputClass} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="North Palm Beach, FL" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Description <span className="text-gray-400 font-normal">(optional)</span></label>
              <textarea className={`${inputClass} resize-none`} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Key features, recent upgrades..." />
            </div>
            <div>
              <label className={labelClass}>Status</label>
              <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="sold">Sold</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>
        </section>

        <div className="flex justify-end gap-3">
          <Link href={`/dashboard/listings/${id}`} className="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-900 transition-colors">
            Cancel
          </Link>
          <button type="submit" disabled={saving}
            className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm">
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
