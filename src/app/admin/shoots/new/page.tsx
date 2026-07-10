"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

interface Broker {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_email: string | null;
  broker_details: { brokerage_name: string | null }[] | null;
}

interface Listing {
  id: string;
  vessel_name: string | null;
  location: string | null;
}

function NewShootForm() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedBroker = searchParams.get("broker") ?? "";

  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    broker_id: preselectedBroker,
    listing_id: "",
    shoot_date: new Date().toISOString().split("T")[0],
    location: "",
    amount: "",
    payment_method: "pending",
    payment_status: "pending",
    notes: "",
  });

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, first_name, last_name, display_email, broker_details(brokerage_name)")
      .eq("role", "broker")
      .order("first_name")
      .then(({ data }) => setBrokers((data as Broker[]) ?? []));
  }, []);

  useEffect(() => {
    if (!form.broker_id) { setListings([]); return; }
    supabase
      .from("listings")
      .select("id, vessel_name, location")
      .eq("broker_id", form.broker_id)
      .eq("status", "active")
      .order("vessel_name")
      .then(({ data }) => setListings(data ?? []));
  }, [form.broker_id]);

  function generateInvoiceNumber(): string {
    const date = new Date();
    const y = date.getFullYear().toString().slice(-2);
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const rand = Math.floor(Math.random() * 900 + 100);
    return `YP-${y}${m}${d}-${rand}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.broker_id) { setError("Please select a broker."); return; }
    setSaving(true);
    setError("");

    const amountCents = form.amount ? Math.round(parseFloat(form.amount) * 100) : null;

    const { data: shoot, error: shootError } = await supabase
      .from("shoots")
      .insert({
        broker_id: form.broker_id,
        listing_id: form.listing_id || null,
        shoot_date: form.shoot_date || null,
        location: form.location || null,
        amount_cents: amountCents,
        payment_method: form.payment_method,
        payment_status: form.payment_status,
        invoice_number: generateInvoiceNumber(),
        notes: form.notes || null,
      })
      .select("id")
      .single();

    if (shootError || !shoot) {
      setError(shootError?.message ?? "Failed to create invoice.");
      setSaving(false);
      return;
    }

    router.push(`/admin/shoots/${shoot.id}`);
  }

  const inputClass = "w-full bg-white border border-hairline-strong text-ink-900 placeholder-ink-400 rounded-ctl px-4 py-2.5 text-sm focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-colors duration-fast ease-quiet";
  const labelClass = "block label-caps mb-1.5";

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-display text-ink-900">New Invoice</h1>
        <p className="text-ink-500 mt-1 text-sm">Log a shoot and create an invoice for a broker.</p>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-ctl text-sm bg-danger-50 border border-danger-200 text-danger-600">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <section className="bg-white border border-hairline rounded-card shadow-elev-1 p-6 space-y-4">
          <h2 className="text-h2 text-ink-900">Shoot Details</h2>

          <div>
            <label className={labelClass}>Broker *</label>
            <select
              className={inputClass}
              value={form.broker_id}
              onChange={(e) => setForm({ ...form, broker_id: e.target.value, listing_id: "" })}
              required
            >
              <option value="">Select a broker...</option>
              {brokers.map((b) => {
                const brokerage = b.broker_details?.[0]?.brokerage_name;
                const name = b.first_name ? `${b.first_name} ${b.last_name ?? ""}`.trim() : b.display_email ?? b.id;
                return <option key={b.id} value={b.id}>{name}{brokerage ? ` — ${brokerage}` : ""}</option>;
              })}
            </select>
          </div>

          <div>
            <label className={labelClass}>Listing <span className="text-ink-400 normal-case font-normal tracking-normal">(optional)</span></label>
            <select
              className={inputClass}
              value={form.listing_id}
              onChange={(e) => setForm({ ...form, listing_id: e.target.value })}
              disabled={!form.broker_id}
            >
              <option value="">No listing / general shoot</option>
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.vessel_name ?? "Untitled"}{l.location ? ` · ${l.location}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Shoot Date</label>
              <input
                type="date"
                className={inputClass}
                value={form.shoot_date}
                onChange={(e) => setForm({ ...form, shoot_date: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Location</label>
              <input
                className={inputClass}
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="North Palm Beach, FL"
              />
            </div>
          </div>
        </section>

        <section className="bg-white border border-hairline rounded-card shadow-elev-1 p-6 space-y-4">
          <h2 className="text-h2 text-ink-900">Payment</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Amount ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className={inputClass}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="450.00"
              />
            </div>
            <div>
              <label className={labelClass}>Payment Method</label>
              <select
                className={inputClass}
                value={form.payment_method}
                onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
              >
                <option value="pending">Not yet set</option>
                <option value="stripe">Stripe (card)</option>
                <option value="zelle">Zelle</option>
                <option value="venmo">Venmo</option>
                <option value="check">Check</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>Payment Status</label>
            <select
              className={inputClass}
              value={form.payment_status}
              onChange={(e) => setForm({ ...form, payment_status: e.target.value })}
            >
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div>
            <label className={labelClass}>Notes <span className="text-ink-400 normal-case font-normal tracking-normal">(optional)</span></label>
            <textarea
              className={`${inputClass} resize-none`}
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Any notes about this shoot or invoice..."
            />
          </div>
        </section>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-5 py-2.5 text-sm text-ink-600 hover:text-ink-900 transition-colors duration-fast ease-quiet"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 font-semibold px-6 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet text-sm"
          >
            {saving ? "Creating..." : "Create Invoice"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function NewShootPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 text-ink-400 text-sm">Loading...</div>}>
      <NewShootForm />
    </Suspense>
  );
}
