"use client";

import { useState } from "react";
import Link from "next/link";

type Member = { id: string; name: string; email: string | null; role: string };

export default function BrokerageTeam({ brokerageName, members: initialMembers }: { brokerageName: string; members: Member[] }) {
  const [members, setMembers] = useState<Member[]>(initialMembers);

  // Invite broker
  const [bFirst, setBFirst] = useState("");
  const [bLast, setBLast] = useState("");
  const [bEmail, setBEmail] = useState("");
  const [bBusy, setBBusy] = useState(false);
  const [bMsg, setBMsg] = useState("");

  // Invite assistant
  const [aFirst, setAFirst] = useState("");
  const [aLast, setALast] = useState("");
  const [aEmail, setAEmail] = useState("");
  const [aBroker, setABroker] = useState("");
  const [aBusy, setABusy] = useState(false);
  const [aMsg, setAMsg] = useState("");

  const brokers = members.filter((m) => m.role === "broker");
  const assistants = members.filter((m) => m.role === "assistant");

  async function inviteBroker() {
    if (!bEmail.trim()) return;
    setBBusy(true);
    setBMsg("");
    try {
      const res = await fetch("/api/brokerage/invite-broker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: bFirst.trim(), lastName: bLast.trim(), email: bEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to invite");
      setMembers((prev) => [...prev, { ...data.broker, role: "broker" }]);
      setBMsg(data.tempPassword ? `Invited ${bEmail.trim()} — temporary password: ${data.tempPassword}` : `Invited ${bEmail.trim()}.`);
      setBFirst(""); setBLast(""); setBEmail("");
    } catch (e) {
      setBMsg(e instanceof Error ? e.message : "Failed to invite");
    } finally {
      setBBusy(false);
    }
  }

  async function inviteAssistant() {
    if (!aEmail.trim()) return;
    setABusy(true);
    setAMsg("");
    try {
      const res = await fetch("/api/brokerage/invite-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: aFirst.trim(), lastName: aLast.trim(), email: aEmail.trim(), brokerId: aBroker || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to invite");
      setMembers((prev) => [...prev, { ...data.assistant, role: "assistant" }]);
      setAMsg(data.tempPassword ? `Invited ${aEmail.trim()} — temporary password: ${data.tempPassword}` : `Invited ${aEmail.trim()}.`);
      setAFirst(""); setALast(""); setAEmail(""); setABroker("");
    } catch (e) {
      setAMsg(e instanceof Error ? e.message : "Failed to invite");
    } finally {
      setABusy(false);
    }
  }

  const inputClass = "w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#d4a843]";

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{brokerageName} — Team</h1>
          <p className="text-gray-500 mt-1 text-sm">Add brokers and assistants to your brokerage. You see and manage every broker&apos;s boats here.</p>
        </div>
        <Link
          href="/dashboard/brokerage/help"
          className="shrink-0 text-xs font-medium text-gray-500 hover:text-[#c49a35] border border-gray-200 hover:border-[#d4a843] px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
        >
          ? Help
        </Link>
      </div>

      {/* Invite broker */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <p className="text-sm font-semibold text-gray-700 mb-3">Add a broker</p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input value={bFirst} onChange={(e) => setBFirst(e.target.value)} placeholder="First name" className={inputClass} />
          <input value={bLast} onChange={(e) => setBLast(e.target.value)} placeholder="Last name" className={inputClass} />
        </div>
        <div className="flex gap-2">
          <input type="email" value={bEmail} onChange={(e) => setBEmail(e.target.value)} placeholder="broker@email.com" className={`flex-1 ${inputClass}`} />
          <button onClick={inviteBroker} disabled={bBusy || !bEmail.trim()} className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
            {bBusy ? "Inviting…" : "Invite"}
          </button>
        </div>
        {bMsg && <p className="text-xs text-gray-600 mt-2">{bMsg}</p>}
      </div>

      {/* Invite assistant */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-8">
        <p className="text-sm font-semibold text-gray-700 mb-3">Add an assistant</p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input value={aFirst} onChange={(e) => setAFirst(e.target.value)} placeholder="First name" className={inputClass} />
          <input value={aLast} onChange={(e) => setALast(e.target.value)} placeholder="Last name" className={inputClass} />
        </div>
        <input type="email" value={aEmail} onChange={(e) => setAEmail(e.target.value)} placeholder="assistant@email.com" className={`${inputClass} mb-2`} />
        <select value={aBroker} onChange={(e) => setABroker(e.target.value)} className={`${inputClass} mb-2`}>
          <option value="">Link to a broker (optional)…</option>
          {brokers.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <button onClick={inviteAssistant} disabled={aBusy || !aEmail.trim()} className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
          {aBusy ? "Inviting…" : "Invite"}
        </button>
        <p className="text-xs text-gray-400 mt-2">Assistants see the broker(s) you link them to. Leave blank to link them later.</p>
        {aMsg && <p className="text-xs text-gray-600 mt-2">{aMsg}</p>}
      </div>

      {/* Members */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <p className="text-sm font-semibold text-gray-700 mb-3">Brokers ({brokers.length})</p>
        {brokers.length === 0 ? (
          <p className="text-sm text-gray-400">No brokers yet.</p>
        ) : (
          <div className="space-y-1.5">
            {brokers.map((m) => (
              <div key={m.id} className="border border-gray-100 rounded-lg px-3 py-2">
                <span className="text-sm font-medium text-gray-800">{m.name}</span>
                {m.email && <span className="ml-1 text-gray-400 text-xs">{m.email}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <p className="text-sm font-semibold text-gray-700 mb-3">Assistants ({assistants.length})</p>
        {assistants.length === 0 ? (
          <p className="text-sm text-gray-400">No assistants yet.</p>
        ) : (
          <div className="space-y-1.5">
            {assistants.map((m) => (
              <div key={m.id} className="border border-gray-100 rounded-lg px-3 py-2">
                <span className="text-sm font-medium text-gray-800">{m.name}</span>
                {m.email && <span className="ml-1 text-gray-400 text-xs">{m.email}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
