"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Broker = {
  id: string;
  name: string;
  email: string | null;
};

export default function ConnectBrokerPanel({
  availableBrokers,
}: {
  availableBrokers: Broker[];
}) {
  const router = useRouter();
  const [selectedBrokerId, setSelectedBrokerId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (availableBrokers.length === 0) return null;

  const handleConnect = async () => {
    if (!selectedBrokerId) return;
    setError(null);
    setConnecting(true);

    try {
      const res = await fetch("/api/assistant/brokers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brokerId: selectedBrokerId }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to connect.");
      } else {
        setSelectedBrokerId("");
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="mt-8">
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Connect to a Broker</h3>
        <p className="text-xs text-gray-400 mb-4">
          Add a broker to your account so you can manage their listings.
        </p>
        <div className="flex gap-3">
          <select
            value={selectedBrokerId}
            onChange={(e) => setSelectedBrokerId(e.target.value)}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#d4a843]/40 focus:border-[#d4a843] bg-white"
          >
            <option value="">Select a broker…</option>
            {availableBrokers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}{b.email ? ` — ${b.email}` : ""}
              </option>
            ))}
          </select>
          <button
            onClick={handleConnect}
            disabled={!selectedBrokerId || connecting}
            className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors whitespace-nowrap"
          >
            {connecting ? "Connecting…" : "Connect"}
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3 mt-3">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
