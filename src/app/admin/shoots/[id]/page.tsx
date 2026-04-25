"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

export default function ShootDetailPage() {
  const supabase = createClient();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [form, setForm] = useState({
    shoot_date: "",
    location: "",
    amount: "",
    payment_method: "pending",
    payment_status: "pending",
    notes: "",
    invoice_number: "",
  });
  const [brokerName, setBrokerName] = useState("");
  const [vesselName, setVesselName] = useState("");

  useEffect(() => {
    supabase
      .from("shoots")
      .select(`
        id, shoot_date, location, amount_cents, payment_method,
        payment_status, invoice_number, notes,
        profiles:broker_id(first_name, last_name, display_email),
        listings:listing_id(vessel_name)
      `)
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (!data) return;
        const brokerArr = data.profiles as { first_name: string | null; last_name: string | null; display_email: string | null }[] | null;
        const broker = Array.isArray(brokerArr) ? brokerArr[0] : brokerArr;
        const listingArr = data.listings as { vessel_name: string | null }[] | null;
        const listing = Array.isArray(listingArr) ? listingArr[0] : listingArr;

        setBrokerName(broker?.first_name ? `${broker.first_name} ${broker.last_name ?? ""}`.trim() : broker?.display_email ?? "");
        setVesselName(listing?.vessel_name ?? "");
        setForm({
          shoot_date: data.shoot_date ?? "",
          location: data.location ?? "",
          amount: data.amount_cents ? (data.amount_cents / 100).toFixed(2) : "",
          payment_method: data.payment_method ?? "pending",
          payment_status: data.payment_status ?? "pending",
          notes: data.notes ?? "",
          invoice_number: data.invoice_number ?? "",
        });
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const amountCents = form.amount ? Math.round(parseFloat(form.amount) * 100) : null;

    const { error } = await supabase.from("shoots").update({
      shoot_date: form.shoot_date || null,
      location: form.location || null,
      amount_cents: amountCents,
      payment_method: form.payment_method,
      payment_status: form.payment_status,
      notes: form.notes || null,
      updated_at: new Date().toISOString(),
    }).eq("id", id);

    if (error) {
      setMessage({ type: "error", text: error.message });
    } else {
      setMessage({ type: "success", text: "Invoice saved." });
    }
    setSaving(false);
  }

  const inputClass = "w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4a843] transition-colors";
  const labelClass = "block text-gray-700 text-sm font-medium mb-1.5";

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>;
  }

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link href="/admin/shoots" className="text-gray-400 hover:text-gray-600 text-sm transition-colors">
          ← All shoots
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Invoice {form.invoice_number}</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          {[brokerName, vesselName].filter(Boolean).join(" · ")}
        </p>
      </div>

      {message && (
        <div className={`mb-5 px-4 py-3 rounded-lg text-sm ${
          message.type === "success" ? "bg-green-50 border border-green-200 text-green-700"
          : "bg-red-50 border border-red-200 text-red-600"
        }`}>{message.text}</div>
      )}

      <div className="space-y-5">
        <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Shoot Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Shoot Date</label>
              <input type="date" className={inputClass} value={form.shoot_date} onChange={(e) => setForm({ ...form, shoot_date: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Location</label>
              <input className={inputClass} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="North Palm Beach, FL" />
            </div>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Payment</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Amount ($)</label>
              <input type="number" step="0.01" min="0" className={inputClass} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="450.00" />
            </div>
            <div>
              <label className={labelClass}>Payment Method</label>
              <select className={inputClass} value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
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
            <select className={inputClass} value={form.payment_status} onChange={(e) => setForm({ ...form, payment_status: e.target.value })}>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Notes</label>
            <textarea className={`${inputClass} resize-none`} rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any notes..." />
          </div>
        </section>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => router.back()} className="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-900 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm">
            {saving ? "Saving..." : "Save Invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}
