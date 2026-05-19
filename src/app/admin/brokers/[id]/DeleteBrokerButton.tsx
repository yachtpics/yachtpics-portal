"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteBrokerButton({ brokerId, brokerName, listingCount }: { brokerId: string; brokerName: string; listingCount?: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchingCount, setFetchingCount] = useState(false);
  const [count, setCount] = useState<number | null>(listingCount ?? null);
  const [error, setError] = useState<string | null>(null);

  async function startConfirm() {
    // If listing count wasn't passed in, fetch it now
    if (count === null) {
      setFetchingCount(true);
      try {
        const res = await fetch(`/api/admin/broker-listing-count?brokerId=${brokerId}`);
        const data = await res.json();
        setCount(data.count ?? 0);
      } catch {
        setCount(0);
      }
      setFetchingCount(false);
    }
    setConfirming(true);
  }

  async function handleDelete() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/delete-broker", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brokerId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to delete broker.");
        setLoading(false);
        return;
      }
      router.push("/admin/brokers");
    } catch {
      setError("Unexpected error. Please try again.");
      setLoading(false);
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={startConfirm}
        disabled={fetchingCount}
        className="text-xs text-red-400 hover:text-red-600 transition-colors px-2 disabled:opacity-50"
      >
        {fetchingCount ? "…" : "Delete broker"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 items-start">
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 max-w-sm">
        <p className="text-sm font-semibold text-red-700 mb-1">Delete {brokerName}?</p>
        <p className="text-xs text-red-600 leading-relaxed">
          This will permanently delete their account
          {count !== null && count > 0
            ? `, ${count} listing${count !== 1 ? "s" : ""}, and all associated photos, videos, and documents.`
            : " and all associated data."}
          {" "}This cannot be undone.
        </p>
        {count !== null && count > 0 && (
          <p className="text-xs font-semibold text-red-700 mt-2">
            ⚠️ {count} listing{count !== 1 ? "s" : ""} will be permanently deleted.
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleDelete}
          disabled={loading}
          className="text-xs font-semibold bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          {loading ? "Deleting…" : "Yes, permanently delete"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
