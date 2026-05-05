"use client";

import { useState } from "react";

interface Assistant {
  id: string;
  name: string | null;
  email: string | null;
}

export default function AssistantsPanel({ brokerId, initialAssistants }: { brokerId: string; initialAssistants: Assistant[] }) {
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
          : `${email} already has an account — they've been linked to this broker.`,
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
    const res = await fetch("/api/admin/invite-assistant", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brokerId, assistantId }),
    });
    if (res.ok) {
      setAssistants((prev) => prev.filter((a) => a.id !== assistantId));
    }
    setRemovingId(null);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl mb-6">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <h2 className="font-semibold text-gray-900">Assistants ({assistants.length})</h2>
          <p className="text-xs text-gray-400 mt-0.5">Full access to this broker&apos;s listings.</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="text-[#c49a35] hover:text-[#b08c2a] text-sm font-medium transition-colors"
          >
            + Add Assistant
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleInvite} className="px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <input
              type="text"
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#d4a843]"
            />
            <input
              type="text"
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#d4a843]"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="email"
              required
              placeholder="assistant@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#d4a843]"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              {loading ? "Sending…" : "Send Invite"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setEmail(""); setFirstName(""); setLastName(""); }}
              className="text-gray-400 hover:text-gray-600 text-sm px-3 py-2 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {message && (
        <div className={`mx-6 mt-4 px-4 py-3 rounded-lg text-sm ${
          message.type === "success" ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"
        }`}>
          {message.text}
        </div>
      )}

      {assistants.length === 0 ? (
        <div className="py-10 text-center text-gray-400 text-sm">No assistants linked yet.</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {assistants.map((a) => (
            <li key={a.id} className="px-6 py-4 flex items-center justify-between">
              <div>
                {a.name && <p className="text-sm font-medium text-gray-900">{a.name}</p>}
                <p className="text-sm text-gray-500">{a.email ?? "—"}</p>
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
