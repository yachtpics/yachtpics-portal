"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteListingButton({ listingId, vesselName, brokerId, redirectTo }: { listingId: string; vesselName: string | null; brokerId: string; redirectTo?: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/delete-listing", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to delete listing.");
        setLoading(false);
        return;
      }
      router.push(redirectTo ?? `/admin/brokers/${brokerId}`);
    } catch {
      setError("Unexpected error. Please try again.");
      setLoading(false);
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-xs text-danger-600 hover:text-danger-700 transition-colors duration-fast ease-quiet px-2"
      >
        Delete listing
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {error && <p className="text-xs text-danger-600">{error}</p>}
      <p className="text-xs text-ink-500">Delete <strong>{vesselName ?? "this listing"}</strong> and all its photos?</p>
      <button
        onClick={handleDelete}
        disabled={loading}
        className="text-xs font-semibold bg-danger-600 hover:bg-danger-500 disabled:opacity-60 text-white px-3 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet"
      >
        {loading ? "Deleting…" : "Yes, delete"}
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="text-xs text-ink-400 hover:text-ink-600 transition-colors duration-fast ease-quiet"
      >
        Cancel
      </button>
    </div>
  );
}
