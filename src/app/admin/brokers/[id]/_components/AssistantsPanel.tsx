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
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 mb-6">
      <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
        <div>
          <h2 className="text-h2 text-ink-900">Assistants ({assistants.length})</h2>
          <p className="text-xs text-ink-500 mt-0.5">Full access to this broker&apos;s listings.</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="text-accent-700 hover:text-accent-800 text-sm font-medium transition-colors duration-fast ease-quiet"
          >
            + Add Assistant
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleInvite} className="px-6 py-4 border-b border-hairline bg-ink-50">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <input
              type="text"
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="border border-hairline-strong rounded-ctl px-3 py-2 text-sm focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
            />
            <input
              type="text"
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="border border-hairline-strong rounded-ctl px-3 py-2 text-sm focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="email"
              required
              placeholder="assistant@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 border border-hairline-strong rounded-ctl px-3 py-2 text-sm focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
            >
              {loading ? "Sending…" : "Send Invite"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setEmail(""); setFirstName(""); setLastName(""); }}
              className="text-ink-400 hover:text-ink-600 text-sm px-3 py-2 transition-colors duration-fast ease-quiet"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {message && (
        <div className={`mx-6 mt-4 px-4 py-3 rounded-ctl text-sm ${
          message.type === "success" ? "bg-success-50 border border-success-200 text-success-700" : "bg-danger-50 border border-danger-200 text-danger-700"
        }`}>
          {message.text}
        </div>
      )}

      {assistants.length === 0 ? (
        <div className="py-10 text-center text-ink-400 text-sm">No assistants linked yet.</div>
      ) : (
        <ul className="divide-y divide-hairline">
          {assistants.map((a) => (
            <li key={a.id} className="px-6 py-4 flex items-center justify-between">
              <div>
                {a.name && <p className="text-sm font-medium text-ink-900">{a.name}</p>}
                <p className="text-sm text-ink-500">{a.email ?? "—"}</p>
              </div>
              <button
                onClick={() => handleRemove(a.id)}
                disabled={removingId === a.id}
                className="text-xs text-danger-600 hover:text-danger-700 disabled:opacity-50 transition-colors duration-fast ease-quiet"
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
