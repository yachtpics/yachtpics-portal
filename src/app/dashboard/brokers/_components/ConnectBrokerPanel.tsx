"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

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
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-6">
        <h3 className="text-sm font-semibold text-ink-900 mb-1">Connect to a Broker</h3>
        <p className="text-xs text-ink-500 mb-4">
          Add a broker to your account so you can manage their listings.
        </p>
        <div className="flex gap-3">
          <select
            value={selectedBrokerId}
            onChange={(e) => setSelectedBrokerId(e.target.value)}
            className="flex-1 bg-white border border-hairline-strong rounded-ctl px-3 py-2.5 text-sm text-ink-900 transition-colors duration-fast ease-quiet focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/40"
          >
            <option value="">Select a broker…</option>
            {availableBrokers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}{b.email ? ` — ${b.email}` : ""}
              </option>
            ))}
          </select>
          <Button
            onClick={handleConnect}
            disabled={!selectedBrokerId || connecting}
          >
            {connecting ? "Connecting…" : "Connect"}
          </Button>
        </div>

        {error && (
          <p className="text-sm text-danger-600 bg-danger-50 border border-danger-200 rounded-card px-4 py-3 mt-3">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
