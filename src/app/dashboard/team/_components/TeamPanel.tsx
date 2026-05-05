"use client";

import { useState } from "react";

interface Assistant {
  id: string;
  name: string | null;
  email: string | null;
}

export default function TeamPanel({ brokerId, initialAssistants }: { brokerId: string; initialAssistants: Assistant[] }) {
  const [assistants, setAssistants] = useState<Assistant[]>(initialAssistants);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const res = await fetch("/api/admin/invite-assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, brokerId, firstName: firstName || undefined, lastName: lastName || undefined }),
    });
    const data = await res.json();

    if (!res.ok) {
      setMessage({ type: "error", text: data.error ?? "Something went wrong." });
    } else {
      const newAssistant: Assistant = {
        id: data.assistantId,
        name: [firstName, lastName].filter(Boolean).join(" ") || null,
        email,
      };
      setAssistants((prev) => {
        if (prev.find((a) => a.id === data.assistantId)) return prev;
        return [...prev, newAssistant];
      });
      setMessage({
        type: "success",
        text: data.isNewUser
          ? `Invite sent to ${email}.`
          : `${email} is already on the portal — they now have access to your listings.`,
      });
      setEmail("");
      setFirstName("");
      setLastName("");
      setShowForm(false);
    }
    setLoading(false);
    setTimeout(() => setMessage(null), 5000);
  }

  async function handleRemove(assistantId: string) {
    setRemovingId(assistantId);
    await fetch("/api/admin/invite-assistant", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brokerId, assistantId }),
    });
    setAssistants((prev) => prev.filter((a) => a.id !== assistantId));
    setRemovingId(null);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900">
          Assistants {assistants.length > 0 && <span className="text-gray-400 font-normal">({assistants.length})</span>}
        </h2>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="bg-[#050b14] hover:bg-[#0a1628] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Invite Assistant
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleInvite} className="px-6 py-5 border-b border-gray-100 bg-gray-50 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">First Name</label>
              <input
                type="text"
                placeholder="Jane"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a843]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Last Name</label>
              <input
                type="text"
                placeholder="Smith"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a843]"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
              Email Address <span className="text-red-400">*</span>
            </label>
            <input
              type="email"
              required
              placeholder="assistant@brokerage.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a843]"
            />
          </div>
          <p className="text-xs text-gray-400">
            If they already have a YachtPics Portal account, they&apos;ll be linked instantly — no new email needed.
          </p>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
            >
              {loading ? "Sending…" : "Send Invite"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setEmail(""); setFirstName(""); setLastName(""); }}
              className="text-gray-400 hover:text-gray-600 text-sm px-4 py-2.5 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {message && (
        <div className={`mx-6 mt-4 px-4 py-3 rounded-lg text-sm ${
          message.type === "success"
            ? "bg-green-50 border border-green-200 text-green-700"
            : "bg-red-50 border border-red-200 text-red-700"
        }`}>
          {message.text}
        </div>
      )}

      {assistants.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-gray-400 text-sm">No assistants yet.</p>
          <p className="text-gray-300 text-xs mt-1">Invite someone to help manage your listings.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {assistants.map((a) => (
            <li key={a.id} className="px-6 py-4 flex items-center justify-between">
              <div>
                {a.name && <p className="text-sm font-medium text-gray-900">{a.name}</p>}
                <p className={`text-sm ${a.name ? "text-gray-500" : "text-gray-900"}`}>{a.email ?? "—"}</p>
              </div>
              <button
                onClick={() => handleRemove(a.id)}
                disabled={removingId === a.id}
                className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50 transition-colors"
              >
                {removingId === a.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
