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
          <p className="label-caps mb-1">Contact</p>
          <p className="text-sm text-ink-900">{email ?? "—"}</p>
        </div>
        <button
          onClick={openEditor}
          className="text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400 transition-colors duration-fast ease-quiet shrink-0"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="label-caps mb-3">Edit contact</p>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="block text-[11px] text-ink-500 mb-1">First name</label>
          <input
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            className="w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
          />
        </div>
        <div>
          <label className="block text-[11px] text-ink-500 mb-1">Last name</label>
          <input
            value={last}
            onChange={(e) => setLast(e.target.value)}
            className="w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
          />
        </div>
      </div>
      <label className="block text-[11px] text-ink-500 mb-1">Email (login)</label>
      <input
        type="email"
        value={mail}
        onChange={(e) => setMail(e.target.value)}
        className="w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 mb-1"
      />
      <p className="text-[11px] text-ink-500 mb-3">
        This is the email the assistant logs in with. Changing it updates their login right away — no re-invite needed.
      </p>
      {error && <p className="text-xs text-danger-600 mb-2">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => setEditing(false)}
          className="text-sm font-medium px-3 py-2 rounded-ctl text-ink-500 hover:text-ink-700 transition-colors duration-fast ease-quiet"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
