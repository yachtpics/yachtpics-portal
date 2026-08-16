"use client";

import { useState } from "react";

type Admin = { id: string; name: string };
type Inviter = { id: string; name: string; role: string };

export default function AddedByEditor({
  brokerId,
  admins,
  initialAdminId,
  initialInviter,
}: {
  brokerId: string;
  admins: Admin[];
  initialAdminId: string | null;
  initialInviter?: Inviter | null;
}) {
  const [adminId, setAdminId] = useState<string>(initialAdminId ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function change(next: string) {
    const prev = adminId;
    setAdminId(next);
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/brokers/${brokerId}/added-by`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId: next || null }),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setAdminId(prev); // revert
    } finally {
      setSaving(false);
    }
  }

  // If the broker was added by someone who isn't a YachtPics admin (an
  // assistant, a brokerage admin, or another broker), show them as the current
  // value so it reads correctly instead of falling back to "Unassigned".
  const inviterInAdminList = !!initialInviter && admins.some((a) => a.id === initialInviter.id);
  const showInviterOption = !!initialInviter && !inviterInAdminList;

  return (
    <div>
      <p className="label-caps mb-2">Added by</p>
      <select
        value={adminId}
        onChange={(e) => change(e.target.value)}
        disabled={saving}
        className="w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 bg-white focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 disabled:opacity-50"
      >
        <option value="">Unassigned</option>
        {showInviterOption && (
          <option value={initialInviter!.id}>
            {initialInviter!.name}{initialInviter!.role ? ` · ${initialInviter!.role}` : ""}
          </option>
        )}
        {admins.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
      {showInviterOption && (
        <p className="text-xs text-ink-500 mt-1.5">Added by a {initialInviter!.role.toLowerCase()} — reassign to an admin above if needed.</p>
      )}
      {saved && <p className="text-xs text-success-600 mt-1.5">Saved</p>}
    </div>
  );
}
