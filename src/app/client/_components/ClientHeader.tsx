"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ClientHeader({ name }: { name: string | null }) {
  const router = useRouter();
  const [pwOpen, setPwOpen] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  async function changePassword() {
    setMsg("");
    if (newPw.length < 8) {
      setMsg("Password must be at least 8 characters.");
      return;
    }
    if (newPw !== confirmPw) {
      setMsg("Passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      setMsg("Password updated ✓");
      setNewPw("");
      setConfirmPw("");
      setTimeout(() => {
        setPwOpen(false);
        setMsg("");
      }, 1500);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't update password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="bg-[#050b14] text-white">
        <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between">
          <span className="text-sm font-semibold tracking-wide">
            YachtPics <span className="text-[#d4a843]">Gallery</span>
          </span>
          <div className="flex items-center gap-3">
            {name && <span className="text-xs text-gray-400 hidden sm:inline">{name}</span>}
            <button onClick={() => setPwOpen(true)} className="text-xs text-gray-300 hover:text-white transition-colors">
              Change password
            </button>
            <button onClick={signOut} className="text-xs text-gray-300 hover:text-white transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </header>

      {pwOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setPwOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-gray-900 mb-1">Change password</h2>
            <p className="text-sm text-gray-500 mb-4">Set a new password for your account.</p>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="New password"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#d4a843] mb-2"
            />
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="Confirm new password"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#d4a843] mb-2"
            />
            {msg && <p className="text-xs text-gray-600 mb-2">{msg}</p>}
            <div className="flex gap-2 mt-2">
              <button
                onClick={changePassword}
                disabled={saving}
                className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                {saving ? "Saving…" : "Update password"}
              </button>
              <button onClick={() => setPwOpen(false)} className="text-sm font-medium px-3 py-2 rounded-lg text-gray-500 hover:text-gray-700">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
