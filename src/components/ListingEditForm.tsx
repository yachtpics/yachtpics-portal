"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

/**
 * The listing details form, shared by the broker's edit page and the admin one.
 *
 * Admin had no way to correct vessel details at all — a typo in the year or
 * length meant deleting the listing and re-uploading every photo. The API
 * already allowed admins through; there was simply no screen. Rather than keep
 * two copies of a twenty-field form in step, both sections render this.
 *
 * `basePath` is where Cancel and Save return to, since the two live at
 * different addresses.
 */
export default function ListingEditForm({ basePath = "/dashboard/listings" }: { basePath?: string }) {
  const supabase = createClient();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const VESSEL_TYPES = ["Billfish", "Bowrider", "Catamaran", "Center Console", "Convertible", "Cruiser", "Cuddy Cabin", "Dinghy", "Downeast", "Dual Console", "Enclosed Flybridge", "Express", "Express Cruiser", "Flybridge", "Flybridge Motor Yacht", "Motor Yacht", "Runabout", "Sailing Yacht", "Sportfish", "Sports Cruiser", "Tender", "Trawler", "Walkaround", "Other"];
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [customVesselType, setCustomVesselType] = useState(false);

  // AI description draft — only offered when the server has a key.
  const [aiConfigured, setAiConfigured] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState("");
  useEffect(() => {
    fetch("/api/photos/categorize").then((r) => (r.ok ? r.json() : null)).then((d) => setAiConfigured(!!d?.configured)).catch(() => {});
  }, []);

  async function draftWithAi() {
    setDrafting(true);
    setDraftError("");
    try {
      const res = await fetch(`/api/listings/${id}/describe`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.description) throw new Error(data?.error ?? "Couldn't write a draft right now.");
      setForm((f) => ({ ...f, description: data.description }));
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Couldn't write a draft right now.");
    } finally {
      setDrafting(false);
    }
  }

  // Deck plan — an image, stored beside the listing's photos.
  const [deckPlanUrl, setDeckPlanUrl] = useState<string | null>(null);
  const [deckPlanBusy, setDeckPlanBusy] = useState(false);
  async function uploadDeckPlan(file: File | null) {
    if (!file) return;
    setDeckPlanBusy(true);
    setError("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `${user.id}/${id}/deck-plan-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("listing-photos").upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (upErr) throw new Error(upErr.message);
      setForm((f) => ({ ...f, deck_plan_path: path }));
      const { data: signed } = await supabase.storage.from("listing-photos").createSignedUrl(path, 3600);
      setDeckPlanUrl(signed?.signedUrl ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload the deck plan.");
    } finally {
      setDeckPlanBusy(false);
    }
  }

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
    tour_url: "",
    deck_plan_path: "",
  });

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // No broker_id filter — access is enforced by the PATCH API for both
      // brokers and linked assistants. RLS allows reads by authenticated users.
      const { data } = await supabase
        .from("listings")
        .select("vessel_name, vessel_type, year, length_ft, make, model, asking_price, location, description, status, beam_ft, draft_ft, staterooms, heads, engines, engine_hours, fuel_type, cruising_speed_kn, max_speed_kn, hull_material, tour_url, deck_plan_path")
        .eq("id", id)
        .single();

      if (!data) { router.push(basePath); return; }

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
        tour_url: data.tour_url ?? "",
        deck_plan_path: data.deck_plan_path ?? "",
      });
      if (data.deck_plan_path) {
        const { data: signed } = await supabase.storage.from("listing-photos").createSignedUrl(data.deck_plan_path, 3600);
        setDeckPlanUrl(signed?.signedUrl ?? null);
      }
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
        tour_url: form.tour_url || null,
        deck_plan_path: form.deck_plan_path || null,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to save changes.");
      setSaving(false);
      return;
    }

    router.push(`${basePath}/${id}`);
  }

  const inputClass = "w-full bg-white border border-hairline-strong text-ink-900 placeholder:text-ink-400 rounded-ctl px-4 py-2.5 text-sm focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/40 transition-colors duration-fast ease-quiet";
  const labelClass = "block label-caps mb-1.5";

  if (loading) return <div className="flex items-center justify-center h-64 text-ink-400 text-sm">Loading...</div>;

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-8 pb-6 border-b border-hairline">
        <Link href={`${basePath}/${id}`} className="text-ink-500 hover:text-ink-700 text-sm transition-colors duration-fast">
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
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <label className="label-caps">Description <span className="text-ink-400 font-normal">(optional)</span></label>
                {aiConfigured && (
                  <button type="button" onClick={draftWithAi} disabled={drafting}
                    title="Write a first draft from the specs and photos — you can change every word before saving"
                    className="text-xs font-semibold text-accent-700 hover:text-accent-600 disabled:opacity-50 transition-colors duration-fast">
                    {drafting ? "Writing…" : form.description ? "Rewrite with AI" : "Draft with AI"}
                  </button>
                )}
              </div>
              <textarea className={`${inputClass} resize-y`} rows={form.description.length > 240 ? 7 : 3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Key features, recent upgrades..." />
              {draftError && <p className="text-xs text-danger-600 mt-1">{draftError}</p>}
              {aiConfigured && !draftError && <p className="text-xs text-ink-400 mt-1">A draft uses only the specs above and what&rsquo;s visible in the photos. Fill in the specs first for a better one.</p>}
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

        <section className="bg-white border border-hairline rounded-card shadow-elev-1 p-6">
          <h2 className="text-h2 text-ink-900 mb-1">Virtual tour &amp; deck plan <span className="text-ink-400 font-normal text-sm">(optional)</span></h2>
          <p className="text-ink-500 text-sm mb-4">Both appear on the client slideshow — a 360° Tour button up top, and the deck plan under Details.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>360° tour link</label>
              <input className={inputClass} type="url" inputMode="url" value={form.tour_url} onChange={(e) => setForm({ ...form, tour_url: e.target.value })} placeholder="https://my.matterport.com/show/?m=…" />
              <p className="text-xs text-ink-400 mt-1">Matterport, VRCloud, Kuula, YouTube 360 — any link that opens the tour.</p>
            </div>
            <div>
              <label className={labelClass}>Deck plan / GA</label>
              {deckPlanUrl && (
                <div className="mb-2 rounded-ctl border border-hairline bg-ink-50 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={deckPlanUrl} alt="Deck plan" className="max-h-40 w-auto mx-auto object-contain" />
                </div>
              )}
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium px-3 py-2 rounded-ctl border border-hairline-strong bg-white text-ink-600 hover:border-accent-500 hover:text-ink-900 transition-colors duration-fast cursor-pointer">
                  {deckPlanBusy ? "Uploading…" : deckPlanUrl ? "Replace image" : "Upload image"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={deckPlanBusy} onChange={(e) => uploadDeckPlan(e.target.files?.[0] ?? null)} />
                </label>
                {deckPlanUrl && (
                  <button type="button" onClick={() => { setForm({ ...form, deck_plan_path: "" }); setDeckPlanUrl(null); }} className="text-xs text-ink-400 hover:text-danger-600 transition-colors duration-fast">Remove</button>
                )}
              </div>
              <p className="text-xs text-ink-400 mt-1">A PNG or JPG of the layout. Takes effect when you save.</p>
            </div>
          </div>
        </section>

        <div className="flex justify-end gap-3">
          <Link href={`${basePath}/${id}`} className="px-5 py-2.5 text-sm text-ink-600 hover:text-ink-900 transition-colors duration-fast">
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
