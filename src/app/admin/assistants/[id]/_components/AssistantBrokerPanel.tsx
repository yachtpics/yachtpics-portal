"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Broker = {
  id: string;
  name: string;
  email: string | null;
};

export default function AssistantBrokerPanel({
  assistantId,
  linkedBrokers,
  brokerOptions,
}: {
  assistantId: string;
  linkedBrokers: Broker[];
  brokerOptions: Broker[];
}) {
  const router = useRouter();
  const [selectedBrokerId, setSelectedBrokerId] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const linkedIds = new Set(linkedBrokers.map((b) => b.id));
  const availableBrokers = brokerOptions.filter((b) => !linkedIds.has(b.id));

  const handleAdd = async () => {
    if (!selectedBrokerId) return;
    setError(null);
    setAdding(true);

    try {
      const res = await fetch(`/api/admin/assistants/${assistantId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brokerId: selectedBrokerId }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to link broker.");
      } else {
        setSelectedBrokerId("");
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (brokerId: string) => {
    setError(null);
    setRemovingId(brokerId);

    try {
      const res = await fetch(`/api/admin/assistants/${assistantId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brokerId }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to remove broker.");
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Linked brokers */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-hidden">
        <div className="px-6 py-4 border-b border-hairline flex items-center justify-between">
          <h2 className="text-h2 text-ink-900">Linked Brokers</h2>
          <span className="text-xs text-ink-400">{linkedBrokers.length} broker{linkedBrokers.length !== 1 ? "s" : ""}</span>
        </div>

        {linkedBrokers.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-ink-400 text-sm">No brokers linked yet.</p>
            <p className="text-ink-400 text-xs mt-1">Use the form below to link this assistant to a broker.</p>
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {linkedBrokers.map((broker) => (
              <li key={broker.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-ink-900">{broker.name}</p>
                  {broker.email && <p className="text-xs text-ink-500 mt-0.5">{broker.email}</p>}
                </div>
                <div className="flex items-center gap-4">
                  <a
                    href={`/admin/brokers/${broker.id}`}
                    className="text-accent-700 hover:text-accent-800 text-xs font-medium transition-colors duration-fast ease-quiet"
                  >
                    View →
                  </a>
                  <button
                    onClick={() => handleRemove(broker.id)}
                    disabled={removingId === broker.id}
                    className="text-danger-600 hover:text-danger-700 text-xs font-medium transition-colors duration-fast ease-quiet disabled:opacity-50"
                  >
                    {removingId === broker.id ? "Removing…" : "Remove"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add broker */}
      {availableBrokers.length > 0 && (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-6">
          <h3 className="label-caps mb-4">Link to a Broker</h3>
          <div className="flex gap-3">
            <select
              value={selectedBrokerId}
              onChange={(e) => setSelectedBrokerId(e.target.value)}
              className="flex-1 border border-hairline-strong rounded-ctl px-3 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 bg-white"
            >
              <option value="">Select a broker…</option>
              {availableBrokers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}{b.email ? ` — ${b.email}` : ""}
                </option>
              ))}
            </select>
            <button
              onClick={handleAdd}
              disabled={!selectedBrokerId || adding}
              className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-4 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet whitespace-nowrap"
            >
              {adding ? "Linking…" : "Link Broker"}
            </button>
          </div>
        </div>
      )}

      {availableBrokers.length === 0 && linkedBrokers.length > 0 && (
        <p className="text-xs text-ink-400 text-center">This assistant is linked to all available brokers.</p>
      )}

      {error && (
        <p className="text-sm text-danger-600 bg-danger-50 border border-danger-200 rounded-ctl px-4 py-3">{error}</p>
      )}
    </div>
  );
}
