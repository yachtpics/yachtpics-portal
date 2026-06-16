"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Member = { id: string; name: string; email: string | null; role: string; isShared: boolean; isBrokerageAdmin: boolean };
type Available = { id: string; name: string; email: string | null; role: string; inOtherBrokerage: boolean };

export default function BrokerageMembers({
  brokerageId,
  brokerageName,
  initialMembers,
  available: initialAvailable,
}: {
  brokerageId: string;
  brokerageName: string;
  initialMembers: Member[];
  available: Available[];
}) {
  const router = useRouter();
  const [name, setName] = useState(brokerageName);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [available, setAvailable] = useState<Available[]>(initialAvailable);
  const [addId, setAddId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const brokers = members.filter((m) => m.role === "broker");
  const assistants = members.filter((m) => m.role === "assistant");

  async function saveName() {
    if (!name.trim() || name.trim() === brokerageName) return;
    await fetch(`/api/admin/brokerages/${brokerageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    setMsg("Name saved.");
    router.refresh();
  }

  async function addMember() {
    if (!addId) return;
    const person = available.find((a) => a.id === addId);
    if (!person) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/admin/brokerages/${brokerageId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: addId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add");
      setMembers((prev) => [...prev, { id: person.id, name: person.name, email: person.email, role: person.role, isShared: false, isBrokerageAdmin: false }]);
      setAvailable((prev) => prev.filter((a) => a.id !== addId));
      setAddId("");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(m: Member) {
    setMembers((prev) => prev.filter((x) => x.id !== m.id));
    setAvailable((prev) => [...prev, { id: m.id, name: m.name, email: m.email, role: m.role, inOtherBrokerage: false }]);
    await fetch(`/api/admin/brokerages/${brokerageId}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: m.id }),
    }).catch(() => {});
  }

  async function toggleShared(m: Member) {
    const nv = !m.isShared;
    setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, isShared: nv } : x)));
    await fetch(`/api/admin/brokerages/${brokerageId}/members`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: m.id, isShared: nv }),
    }).catch(() => {});
  }

  async function toggleBrokerageAdmin(m: Member) {
    const nv = !m.isBrokerageAdmin;
    setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, isBrokerageAdmin: nv } : x)));
    await fetch(`/api/admin/brokerages/${brokerageId}/members`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: m.id, brokerageAdmin: nv }),
    }).catch(() => {});
  }

  async function deleteBrokerage() {
    if (!confirm(`Delete the brokerage "${brokerageName}"? Members stay as accounts but lose shared access.`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/brokerages/${brokerageId}`, { method: "DELETE" });
    if (res.ok) router.push("/admin/brokerages");
    else setBusy(false);
  }

  return (
    <div className="mt-3">
      {/* Name */}
      <div className="flex items-end gap-2 mb-6">
        <div className="flex-1">
          <label className="block text-[11px] font-medium text-gray-400 mb-1">Brokerage name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full text-2xl font-bold text-gray-900 border-b border-transparent hover:border-gray-200 focus:border-[#d4a843] focus:outline-none pb-1"
          />
        </div>
        {name.trim() !== brokerageName && (
          <button onClick={saveName} className="text-sm font-medium px-3 py-2 rounded-lg border border-gray-200 text-gray-700 hover:border-gray-300">
            Save name
          </button>
        )}
      </div>

      {msg && <p className="text-xs text-green-600 mb-3">{msg}</p>}

      {/* Add member */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <p className="text-sm font-semibold text-gray-700 mb-2">Add a broker or assistant</p>
        <div className="flex gap-2">
          <select value={addId} onChange={(e) => setAddId(e.target.value)} className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#d4a843]">
            <option value="">Select a person…</option>
            <optgroup label="Brokers">
              {available.filter((a) => a.role === "broker").map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.inOtherBrokerage ? " (in another brokerage)" : ""}</option>
              ))}
            </optgroup>
            <optgroup label="Assistants">
              {available.filter((a) => a.role === "assistant").map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.inOtherBrokerage ? " (in another brokerage)" : ""}</option>
              ))}
            </optgroup>
          </select>
          <button onClick={addMember} disabled={busy || !addId} className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
            Add
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">Adding someone already in another brokerage moves them here.</p>
      </div>

      {/* Brokers */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <p className="text-sm font-semibold text-gray-700 mb-1">Brokers ({brokers.length})</p>
        <p className="text-xs text-gray-400 mb-3">Toggle &ldquo;Shared inventory&rdquo; for a house / new-inventory account so every broker in this brokerage can see its boats.</p>
        {brokers.length === 0 ? (
          <p className="text-sm text-gray-400">No brokers yet.</p>
        ) : (
          <div className="space-y-2">
            {brokers.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2 flex-wrap">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-gray-800">{m.name}</span>
                  {m.email && <span className="ml-1 text-gray-400 text-xs">{m.email}</span>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                    <input type="checkbox" checked={m.isBrokerageAdmin} onChange={() => toggleBrokerageAdmin(m)} className="w-4 h-4 accent-[#d4a843]" />
                    Brokerage admin
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                    <input type="checkbox" checked={m.isShared} onChange={() => toggleShared(m)} className="w-4 h-4 accent-[#d4a843]" />
                    Shared inventory
                  </label>
                  <button onClick={() => removeMember(m)} className="text-xs font-medium text-red-600 hover:text-red-700">Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assistants */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-8">
        <p className="text-sm font-semibold text-gray-700 mb-1">Assistants ({assistants.length})</p>
        <p className="text-xs text-gray-400 mb-3">Assistants here can see and manage every broker&apos;s boats in this brokerage.</p>
        {assistants.length === 0 ? (
          <p className="text-sm text-gray-400">No assistants yet.</p>
        ) : (
          <div className="space-y-2">
            {assistants.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2 flex-wrap">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-gray-800">{m.name}</span>
                  {m.email && <span className="ml-1 text-gray-400 text-xs">{m.email}</span>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                    <input type="checkbox" checked={m.isBrokerageAdmin} onChange={() => toggleBrokerageAdmin(m)} className="w-4 h-4 accent-[#d4a843]" />
                    Brokerage admin
                  </label>
                  <button onClick={() => removeMember(m)} className="text-xs font-medium text-red-600 hover:text-red-700">Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <button onClick={deleteBrokerage} disabled={busy} className="text-xs font-medium text-red-600 hover:text-red-700 transition-colors">
        Delete this brokerage
      </button>
    </div>
  );
}
