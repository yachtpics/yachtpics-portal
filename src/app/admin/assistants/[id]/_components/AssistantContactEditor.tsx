"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  assistantId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

export default function AssistantContactEditor({ assistantId, firstName, lastName, email }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [first, setFirst] = useState(firstName ?? "");
  const [last, setLast] = useState(lastName ?? "");
  const [mail, setMail] = useState(email ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function openEditor() {
    setFirst(firstName ?? "");
    setLast(lastName ?? "");
    setMail(email ?? "");
    setError("");
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/update-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: assistantId, email: mail, firstName: first, lastName: last }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Contact</p>
          <p className="text-sm text-gray-900">{email ?? "—"}</p>
        </div>
        <button
          onClick={openEditor}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:border-gray-300 transition-colors shrink-0"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Edit contact</p>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="block text-[11px] text-gray-400 mb-1">First name</label>
          <input
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#d4a843]"
          />
        </div>
        <div>
          <label className="block text-[11px] text-gray-400 mb-1">Last name</label>
          <input
            value={last}
            onChange={(e) => setLast(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#d4a843]"
          />
        </div>
      </div>
      <label className="block text-[11px] text-gray-400 mb-1">Email (login)</label>
      <input
        type="email"
        value={mail}
        onChange={(e) => setMail(e.target.value)}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#d4a843] mb-1"
      />
      <p className="text-[11px] text-gray-400 mb-3">
        This is the email the assistant logs in with. Changing it updates their login right away — no re-invite needed.
      </p>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => setEditing(false)}
          className="text-sm font-medium px-3 py-2 rounded-lg text-gray-500 hover:text-gray-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
