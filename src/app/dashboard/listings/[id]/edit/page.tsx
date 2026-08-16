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

  const VESSEL_TYPES = ["Billfish", "Bowrider", "Catamaran", "Center Console", "Convertible", "Cruiser", "Cuddy Cabin", "Dinghy", "Downeast", "Dual Console", "Enclosed Flybridge", "Express", "Express Cruiser", "Flybridge", "Flybridge Motor Yacht", "Motor Yacht", "Runabout", "Sailing Yacht", "Sportfish", "Sports Cruiser", "Tender", "Trawler", "Walkaround", "Other"];
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
    beam_ft: "",
    draft_ft: "",
    staterooms: "",
    heads: "",
    engines: "",
    engine_hours: "",
    fuel_type: "",
    cruising_speed_kn: "",
    max_speed_kn: "",
    hull_material: "",
  });

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // No broker_id filter — access is enforced by the PATCH API for both
      // brokers and linked assistants. RLS allows reads by authenticated users.
      const { data } = await supabase
        .from("listings")
        .select("vessel_name, vessel_type, year, length_ft, make, model, asking_price, location, description, status, beam_ft, draft_ft, staterooms, heads, engines, engine_hours, fuel_type, cruising_speed_kn, max_speed_kn, hull_material")
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
        beam_ft: data.beam_ft?.toString() ?? "",
        draft_ft: data.draft_ft?.toString() ?? "",
        staterooms: data.staterooms?.toString() ?? "",
        heads: data.heads?.toString() ?? "",
        engines: data.engines ?? "",
        engine_hours: data.engine_hours?.toString() ?? "",
        fuel_type: data.fuel_type ?? "",
        cruising_speed_kn: data.cruising_speed_kn?.toString() ?? "",
        max_speed_kn: data.max_speed_kn?.toString() ?? "",
        hull_material: data.hull_material ?? "",
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
        beam_ft: form.beam_ft ? parseFloat(form.beam_ft) : null,
        draft_ft: form.draft_ft ? parseFloat(form.draft_ft) : null,
        staterooms: form.staterooms ? parseInt(form.staterooms) : null,
        heads: form.heads ? parseInt(form.heads) : null,
        engines: form.engines || null,
        engine_hours: form.engine_hours ? parseInt(form.engine_hours) : null,
        fuel_type: form.fuel_type || null,
        cruising_speed_kn: form.cruising_speed_kn ? parseFloat(form.cruising_speed_kn) : null,
        max_speed_kn: form.max_speed_kn ? parseFloat(form.max_speed_kn) : null,
        hull_material: form.hull_material || null,
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

  const inputClass = "w-full bg-white border border-hairline-strong text-ink-900 placeholder:text-ink-400 rounded-ctl px-4 py-2.5 text-sm focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/40 transition-colors duration-fast ease-quiet";
  const labelClass = "block label-caps mb-1.5";

  if (loading) return <div className="flex items-center justify-center h-64 text-ink-400 text-sm">Loading...</div>;

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-8 pb-6 border-b border-hairline">
        <Link href={`/dashboard/listings/${id}`} className="text-ink-500 hover:text-ink-700 text-sm transition-colors duration-fast">
          ← Back to Listing
        </Link>
        <h1 className="text-display text-ink-900 mt-1">Edit Listing</h1>
        <p className="text-ink-500 mt-1 text-sm">Update the vessel details.</p>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-card border text-sm bg-danger-50 border-danger-200 text-danger-600">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <section className="bg-white border border-hairline rounded-card shadow-elev-1 p-6">
          <h2 className="text-h2 text-ink-900 mb-4">Vessel Information</h2>
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
                    className="text-ink-500 hover:text-ink-700 text-sm px-3 border border-hairline-strong rounded-ctl transition-colors duration-fast">✕</button>
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
              <label className={labelClass}>Description <span className="text-ink-400 font-normal">(optional)</span></label>
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

        <section className="bg-white border border-hairline rounded-card shadow-elev-1 p-6">
          <h2 className="text-h2 text-ink-900 mb-1">Specifications <span className="text-ink-400 font-normal text-sm">(optional)</span></h2>
          <p className="text-ink-500 text-sm mb-4">These appear on the public listing and the printable flyer.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Beam (ft)</label>
              <input className={inputClass} type="number" step="any" value={form.beam_ft} onChange={(e) => setForm({ ...form, beam_ft: e.target.value })} placeholder="15.5" />
            </div>
            <div>
              <label className={labelClass}>Draft (ft)</label>
              <input className={inputClass} type="number" step="any" value={form.draft_ft} onChange={(e) => setForm({ ...form, draft_ft: e.target.value })} placeholder="4.2" />
            </div>
            <div>
              <label className={labelClass}>Staterooms</label>
              <input className={inputClass} type="number" value={form.staterooms} onChange={(e) => setForm({ ...form, staterooms: e.target.value })} placeholder="3" />
            </div>
            <div>
              <label className={labelClass}>Heads</label>
              <input className={inputClass} type="number" value={form.heads} onChange={(e) => setForm({ ...form, heads: e.target.value })} placeholder="2" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Engines</label>
              <input className={inputClass} value={form.engines} onChange={(e) => setForm({ ...form, engines: e.target.value })} placeholder="Twin Volvo Penta IPS 600" />
            </div>
            <div>
              <label className={labelClass}>Engine Hours</label>
              <input className={inputClass} type="number" value={form.engine_hours} onChange={(e) => setForm({ ...form, engine_hours: e.target.value })} placeholder="450" />
            </div>
            <div>
              <label className={labelClass}>Fuel Type</label>
              <input className={inputClass} value={form.fuel_type} onChange={(e) => setForm({ ...form, fuel_type: e.target.value })} placeholder="Diesel" />
            </div>
            <div>
              <label className={labelClass}>Cruising Speed (kn)</label>
              <input className={inputClass} type="number" step="any" value={form.cruising_speed_kn} onChange={(e) => setForm({ ...form, cruising_speed_kn: e.target.value })} placeholder="22" />
            </div>
            <div>
              <label className={labelClass}>Max Speed (kn)</label>
              <input className={inputClass} type="number" step="any" value={form.max_speed_kn} onChange={(e) => setForm({ ...form, max_speed_kn: e.target.value })} placeholder="30" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Hull Material</label>
              <input className={inputClass} value={form.hull_material} onChange={(e) => setForm({ ...form, hull_material: e.target.value })} placeholder="Fiberglass" />
            </div>
          </div>
        </section>

        <div className="flex justify-end gap-3">
          <Link href={`/dashboard/listings/${id}`} className="px-5 py-2.5 text-sm text-ink-600 hover:text-ink-900 transition-colors duration-fast">
            Cancel
          </Link>
          <button type="submit" disabled={saving}
            className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 font-semibold px-6 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2">
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
