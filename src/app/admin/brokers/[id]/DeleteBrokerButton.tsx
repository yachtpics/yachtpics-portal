"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteBrokerButton({ brokerId, brokerName }: { brokerId: string; brokerName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        onClick={() => setConfirming(true)}
        className="text-xs text-red-400 hover:text-red-600 transition-colors px-2"
      >
        Delete broker
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {error && <p className="text-xs text-red-500">{error}</p>}
      <p className="text-xs text-gray-500">Delete <strong>{brokerName}</strong> and all their data?</p>
      <button
        onClick={handleDelete}
        disabled={loading}
        className="text-xs font-semibold bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition-colors"
      >
        {loading ? "Deleting…" : "Yes, delete"}
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
