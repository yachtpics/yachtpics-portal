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
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Linked Brokers</h2>
          <span className="text-xs text-gray-400">{linkedBrokers.length} broker{linkedBrokers.length !== 1 ? "s" : ""}</span>
        </div>

        {linkedBrokers.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-gray-400 text-sm">No brokers linked yet.</p>
            <p className="text-gray-400 text-xs mt-1">Use the form below to link this assistant to a broker.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {linkedBrokers.map((broker) => (
              <li key={broker.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{broker.name}</p>
                  {broker.email && <p className="text-xs text-gray-400 mt-0.5">{broker.email}</p>}
                </div>
                <div className="flex items-center gap-4">
                  <a
                    href={`/admin/brokers/${broker.id}`}
                    className="text-[#c49a35] hover:text-[#b08c2a] text-xs font-medium transition-colors"
                  >
                    View →
                  </a>
                  <button
                    onClick={() => handleRemove(broker.id)}
                    disabled={removingId === broker.id}
                    className="text-red-400 hover:text-red-600 text-xs font-medium transition-colors disabled:opacity-50"
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
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Link to a Broker</h3>
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
              onClick={handleAdd}
              disabled={!selectedBrokerId || adding}
              className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors whitespace-nowrap"
            >
              {adding ? "Linking…" : "Link Broker"}
            </button>
          </div>
        </div>
      )}

      {availableBrokers.length === 0 && linkedBrokers.length > 0 && (
        <p className="text-xs text-gray-400 text-center">This assistant is linked to all available brokers.</p>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">{error}</p>
      )}
    </div>
  );
}
