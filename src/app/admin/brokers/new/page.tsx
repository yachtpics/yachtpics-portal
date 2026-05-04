"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function InviteBrokerPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    brokerage: "",
    vesselName: "",
    photosReady: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: string, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/invite-broker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      // Redirect to new listing page with broker pre-selected and invite context
      router.push(`/admin/listings/new?broker=${data.brokerId}&fromInvite=true`);
    } catch {
      setError("Unexpected error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const hasVessel = form.vesselName.trim().length > 0;

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link href="/admin/brokers" className="text-gray-400 hover:text-gray-600 text-sm transition-colors">
          ← All brokers
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Invite Broker</h1>
        <p className="text-gray-500 text-sm mt-1">
          Creates an account and sends a personalized invite email. The broker sets their own password via the link.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Broker info */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Broker Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                First Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#d4a843] focus:ring-1 focus:ring-[#d4a843]/30"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                Last Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                value={form.lastName}
                onChange={(e) => set("lastName", e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#d4a843] focus:ring-1 focus:ring-[#d4a843]/30"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
              Email Address <span className="text-red-400">*</span>
            </label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#d4a843] focus:ring-1 focus:ring-[#d4a843]/30"
            />
          </div>
          <div className="mt-4">
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
              Brokerage
            </label>
            <input
              type="text"
              value={form.brokerage}
              onChange={(e) => set("brokerage", e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#d4a843] focus:ring-1 focus:ring-[#d4a843]/30"
            />
          </div>
        </div>

        {/* Photos / vessel */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 mb-1">Photos</h2>
          <p className="text-xs text-gray-400 mb-4">
            Optional — personalizes the invite email with vessel info and photos status.
          </p>
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
              Vessel Name
            </label>
            <input
              type="text"
              value={form.vesselName}
              onChange={(e) => set("vesselName", e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#d4a843] focus:ring-1 focus:ring-[#d4a843]/30"
            />
          </div>

          {hasVessel && (
            <div
              onClick={() => set("photosReady", !form.photosReady)}
              className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                form.photosReady
                  ? "border-[#d4a843] bg-[#fdf8ec]"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className={`w-5 h-5 rounded flex-shrink-0 mt-0.5 flex items-center justify-center border-2 transition-colors ${
                form.photosReady ? "bg-[#d4a843] border-[#d4a843]" : "border-gray-300"
              }`}>
                {form.photosReady && <span className="text-white text-xs font-bold">✓</span>}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Photos are ready now</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  The invite email will tell them their photos for <strong>{form.vesselName}</strong> are ready to view. If unchecked, it will say photos are coming soon.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Preview hint */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs text-gray-500 leading-relaxed">
          <strong className="text-gray-700">What the broker receives:</strong> A branded YachtPics email with a
          secure link to set their password
          {hasVessel
            ? form.photosReady
              ? ` and a notice that their photos for "${form.vesselName}" are ready.`
              : ` and a note that photos for "${form.vesselName}" are on the way.`
            : ". After that, you can create a listing and upload their photos."}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-60 text-[#050b14] font-semibold text-sm px-6 py-2.5 rounded-lg transition-colors"
          >
            {loading ? "Sending invite…" : "Send Invite"}
          </button>
          <Link href="/admin/brokers" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
