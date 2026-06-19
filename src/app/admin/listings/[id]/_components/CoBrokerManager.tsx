"use client";

import { useState } from "react";

type Broker = { id: string; name: string };

export default function CoBrokerManager({
  listingId,
  brokers,
  initialCoBrokers,
}: {
  listingId: string;
  brokers: Broker[];
  initialCoBrokers: Broker[];
}) {
  const [coBrokers, setCoBrokers] = useState<Broker[]>(initialCoBrokers);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const coIds = new Set(coBrokers.map((b) => b.id));
  const available = brokers.filter((b) => !coIds.has(b.id));

  async function add() {
    if (!pick) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/listings/${listingId}/co-brokers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brokerId: pick }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add");
      const broker = brokers.find((b) => b.id === pick);
      if (broker) setCoBrokers((prev) => [...prev, broker]);
      setPick("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setBusy(false);
    }
  }

  async function remove(brokerId: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/listings/${listingId}/co-brokers`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brokerId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to remove");
      }
      setCoBrokers((prev) => prev.filter((b) => b.id !== brokerId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-8">
      <p className="text-sm font-semibold text-gray-900">Co-brokers</p>
      <p className="text-xs text-gray-500 mt-0.5 mb-4">
        Give another broker access to this one listing — they can view, download, upload, and send it, but not delete. The boat stays owned by the listing&rsquo;s broker.
      </p>

      {coBrokers.length > 0 && (
        <div className="space-y-1.5 mb-4">
          {coBrokers.map((b) => (
            <div key={b.id} className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2">
              <span className="text-sm text-gray-800">{b.name}</span>
              <button
                onClick={() => remove(b.id)}
                disabled={busy}
                className="text-xs text-red-400 hover:text-red-600 transition-colors disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <select
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          disabled={busy}
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-[#d4a843] disabled:opacity-50"
        >
          <option value="">Add a co-broker…</option>
          {available.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <button
          onClick={add}
          disabled={busy || !pick}
          className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          Add
        </button>
      </div>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}
