"use client";

import { useState } from "react";
import { Button, Card, Input, Label } from "@/components/ui";

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
    <Card>
      <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
        <h2 className="text-h2 text-ink-900">
          Assistants {assistants.length > 0 && <span className="text-ink-400 font-normal">({assistants.length})</span>}
        </h2>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="bg-ink-950 hover:bg-ink-800 text-white text-sm font-medium px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2"
          >
            + Invite Assistant
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleInvite} className="px-6 py-5 border-b border-hairline bg-ink-50 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5">First Name</Label>
              <Input
                type="text"
                placeholder="Jane"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div>
              <Label className="mb-1.5">Last Name</Label>
              <Input
                type="text"
                placeholder="Smith"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label className="mb-1.5">
              Email Address <span className="text-danger-600">*</span>
            </Label>
            <Input
              type="email"
              required
              placeholder="assistant@brokerage.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <p className="text-xs text-ink-500">
            If they already have a YachtPics Portal account, they&apos;ll be linked instantly — no new email needed.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={loading} className="px-5">
              {loading ? "Sending…" : "Send Invite"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setShowForm(false); setEmail(""); setFirstName(""); setLastName(""); }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {message && (
        <div className={`mx-6 mt-4 px-4 py-3 rounded-card border text-sm ${
          message.type === "success"
            ? "bg-success-50 border-success-200 text-success-700"
            : "bg-danger-50 border-danger-200 text-danger-700"
        }`}>
          {message.text}
        </div>
      )}

      {assistants.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-ink-500 text-sm">No assistants yet.</p>
          <p className="text-ink-400 text-xs mt-1">Invite someone to help manage your listings.</p>
        </div>
      ) : (
        <ul className="divide-y divide-hairline">
          {assistants.map((a) => (
            <li key={a.id} className="px-6 py-4 flex items-center justify-between">
              <div>
                {a.name && <p className="text-sm font-medium text-ink-900">{a.name}</p>}
                <p className={`text-sm ${a.name ? "text-ink-500" : "text-ink-900"}`}>{a.email ?? "—"}</p>
              </div>
              <button
                onClick={() => handleRemove(a.id)}
                disabled={removingId === a.id}
                className="text-xs text-danger-600 hover:text-danger-700 disabled:opacity-50 transition-colors duration-fast"
              >
                {removingId === a.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
