"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewBrokerageForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/brokerages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create");
      setName("");
      router.push(`/admin/brokerages/${data.brokerage.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6">
      <p className="label-caps mb-2">New brokerage</p>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Valhalla Yacht Sales"
          className="flex-1 text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
        />
        <button
          onClick={create}
          disabled={saving || !name.trim()}
          className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
        >
          {saving ? "Creating…" : "Create"}
        </button>
      </div>
      {error && <p className="text-xs text-danger-600 mt-2">{error}</p>}
    </div>
  );
}
